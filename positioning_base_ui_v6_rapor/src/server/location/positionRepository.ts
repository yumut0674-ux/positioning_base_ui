import { queryPostgres, type PgRow } from "../postgresClient";
import { toIstanbulIso, type PositionRecord, type TagAssignment } from "./location.types";

export interface PositionHistoryResult {
  readonly positions: readonly PositionRecord[];
  readonly sourcePointCount: number;
  readonly processingTruncated: boolean;
  readonly aggregation?: { readonly method: "median"; readonly intervalSeconds: 60; readonly pointCountBeforeLimit: number };
  readonly observedRange?: { readonly from: string; readonly to: string };
}

export interface PositionRepository {
  latest(tagCode: string): Promise<PositionRecord | null>;
  nearest(tagCode: string, at: string, toleranceSeconds: number): Promise<PositionRecord | null>;
  history(assignments: readonly TagAssignment[], from: string, to: string, limit: number, mapId?: string): Promise<PositionHistoryResult>;
  timelineHistory(assignments: readonly TagAssignment[], from: string, to: string, processingLimit: number, mapId?: string): Promise<PositionHistoryResult>;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function fromRow(row: PgRow): PositionRecord {
  return {
    tagCode: row.tagCode ?? "", x: Number(row.x), y: Number(row.y),
    pdop: row.pdop == null ? null : Number(row.pdop),
    observedAt: toIstanbulIso(row.observedAt ?? ""),
    gapBeforeSeconds: row.gapBeforeSeconds === null ? null : Number(row.gapBeforeSeconds),
    mapId: row.mapId ?? null, sourceZoneId: row.sourceZoneId ?? null, sourceZoneName: row.sourceZoneName ?? null,
  };
}

function assignmentFilters(assignments: readonly TagAssignment[], from: string, to: string): string {
  return assignments.map((assignment) => {
    const sliceFrom = new Date(Math.max(Date.parse(from), Date.parse(assignment.assignedAt))).toISOString();
    const assignmentEnd = assignment.unassignedAt ? Date.parse(assignment.unassignedAt) : Date.parse(to);
    const sliceTo = new Date(Math.min(Date.parse(to), assignmentEnd)).toISOString();
    return `(tag_code = ${sqlString(assignment.tagCode)} AND created_at >= ${sqlString(sliceFrom)}::timestamptz AND created_at < ${sqlString(sliceTo)}::timestamptz)`;
  }).join(" OR ");
}

export class PostgresPositionRepository implements PositionRepository {
  public constructor(private readonly query = queryPostgres) {}

  public async latest(tagCode: string): Promise<PositionRecord | null> {
    const [row] = await this.query(`
SELECT tag_code AS "tagCode", x::text, y::text, pdop::text, map_id AS "mapId", zone_id AS "sourceZoneId", zone_name AS "sourceZoneName",
  created_at AS "observedAt", NULL::text AS "gapBeforeSeconds"
FROM tag_location_history WHERE tag_code = ${sqlString(tagCode)}
ORDER BY created_at DESC, id DESC LIMIT 1;`);
    return row ? fromRow(row) : null;
  }

  public async nearest(tagCode: string, at: string, toleranceSeconds: number): Promise<PositionRecord | null> {
    const [row] = await this.query(`
SELECT tag_code AS "tagCode", x::text, y::text, pdop::text, map_id AS "mapId", zone_id AS "sourceZoneId", zone_name AS "sourceZoneName",
  created_at AS "observedAt", NULL::text AS "gapBeforeSeconds"
FROM tag_location_history
WHERE tag_code = ${sqlString(tagCode)}
  AND created_at BETWEEN ${sqlString(at)}::timestamptz - (${toleranceSeconds} * interval '1 second')
                     AND ${sqlString(at)}::timestamptz + (${toleranceSeconds} * interval '1 second')
ORDER BY abs(extract(epoch FROM (created_at - ${sqlString(at)}::timestamptz))), created_at DESC
LIMIT 1;`);
    return row ? fromRow(row) : null;
  }

  public async history(
    assignments: readonly TagAssignment[],
    from: string,
    to: string,
    limit: number,
    mapId?: string,
  ): Promise<PositionHistoryResult> {
    if (assignments.length === 0) return { positions: [], sourcePointCount: 0, processingTruncated: false };
    const filters = assignmentFilters(assignments, from, to);

    const rows = await this.query(`
WITH ordered AS (
  SELECT tag_code, x, y, pdop, map_id, zone_id, zone_name, created_at, id,
    extract(epoch FROM (created_at - lag(created_at) OVER (ORDER BY created_at, id))) AS gap_before_seconds,
    CASE WHEN row(tag_code, map_id, zone_id, zone_name) IS DISTINCT FROM
      lag(row(tag_code, map_id, zone_id, zone_name)) OVER (ORDER BY created_at, id) THEN 1 ELSE 0 END AS segment_start
  FROM tag_location_history WHERE (${filters})${mapId ? ` AND map_id = ${sqlString(mapId)}` : ""}
), segmented AS (
  SELECT *, sum(segment_start) OVER (ORDER BY created_at, id) AS segment_id FROM ordered
), minute_medians AS (
  SELECT tag_code, map_id, zone_id, zone_name, segment_id,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY x) AS x,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY y) AS y,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY pdop) AS pdop,
    min(created_at) AS created_at, max(created_at) AS last_observed_at,
    max(gap_before_seconds) AS gap_before_seconds, count(*) AS source_count
  FROM segmented
  GROUP BY tag_code, map_id, zone_id, zone_name, segment_id, date_trunc('minute', created_at)
), ranked AS (
  SELECT *, row_number() OVER (ORDER BY created_at, segment_id) AS row_number,
    count(*) OVER () AS total_count, sum(source_count) OVER () AS source_point_count,
    min(created_at) OVER () AS first_observed_at, max(last_observed_at) OVER () AS final_observed_at
  FROM minute_medians
), sampled AS (
  SELECT * FROM ranked
  WHERE total_count <= ${limit}
     OR row_number = 1
     OR floor((row_number - 1) * ${limit - 1}::numeric / NULLIF(total_count - 1, 0))
       > floor((row_number - 2) * ${limit - 1}::numeric / NULLIF(total_count - 1, 0))
  ORDER BY created_at, segment_id LIMIT ${limit}
)
SELECT tag_code AS "tagCode", x::text, y::text, pdop::text, map_id AS "mapId", zone_id AS "sourceZoneId", zone_name AS "sourceZoneName",
  created_at AS "observedAt", gap_before_seconds::text AS "gapBeforeSeconds",
  source_point_count::text AS "sourcePointCount", total_count::text AS "aggregatedPointCount",
  first_observed_at AS "firstObservedAt", final_observed_at AS "lastObservedAt"
FROM sampled ORDER BY created_at, segment_id;`);
    return {
      positions: rows.map(fromRow),
      sourcePointCount: Number(rows[0]?.sourcePointCount ?? 0),
      processingTruncated: false,
      aggregation: { method: "median", intervalSeconds: 60, pointCountBeforeLimit: Number(rows[0]?.aggregatedPointCount ?? rows.length) },
      ...(rows[0]?.firstObservedAt && rows[0]?.lastObservedAt ? {
        observedRange: { from: toIstanbulIso(rows[0].firstObservedAt), to: toIstanbulIso(rows[0].lastObservedAt) },
      } : {}),
    };
  }

  public async timelineHistory(
    assignments: readonly TagAssignment[],
    from: string,
    to: string,
    processingLimit: number,
    mapId?: string,
  ): Promise<PositionHistoryResult> {
    if (assignments.length === 0) return { positions: [], sourcePointCount: 0, processingTruncated: false };
    const filters = assignmentFilters(assignments, from, to);
    const rows = await this.query(`
WITH ordered AS (
  SELECT tag_code, x, y, pdop, map_id, zone_id, zone_name, created_at, id,
    extract(epoch FROM (created_at - lag(created_at) OVER (ORDER BY created_at, id))) AS gap_before_seconds,
    count(*) OVER () AS total_count
  FROM tag_location_history WHERE (${filters})${mapId ? ` AND map_id = ${sqlString(mapId)}` : ""}
)
SELECT tag_code AS "tagCode", x::text, y::text, pdop::text, map_id AS "mapId", zone_id AS "sourceZoneId", zone_name AS "sourceZoneName",
  created_at AS "observedAt", gap_before_seconds::text AS "gapBeforeSeconds",
  total_count::text AS "sourcePointCount"
FROM ordered ORDER BY created_at, id LIMIT ${processingLimit};`);
    const sourcePointCount = Number(rows[0]?.sourcePointCount ?? 0);
    return {
      positions: rows.map(fromRow),
      sourcePointCount,
      processingTruncated: sourcePointCount > rows.length,
    };
  }
}
