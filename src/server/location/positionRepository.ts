import { queryPostgres, type PgRow } from "../postgresClient";
import { toIstanbulIso, type PositionRecord, type TagAssignment } from "./location.types";

export interface PositionHistoryResult {
  readonly positions: readonly PositionRecord[];
  readonly sourcePointCount: number;
  readonly processingTruncated: boolean;
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
  public async latest(tagCode: string): Promise<PositionRecord | null> {
    const [row] = await queryPostgres(`
SELECT tag_code AS "tagCode", x::text, y::text, map_id AS "mapId", zone_id AS "sourceZoneId", zone_name AS "sourceZoneName",
  created_at AS "observedAt", NULL::text AS "gapBeforeSeconds"
FROM tag_location_history WHERE tag_code = ${sqlString(tagCode)}
ORDER BY created_at DESC, id DESC LIMIT 1;`);
    return row ? fromRow(row) : null;
  }

  public async nearest(tagCode: string, at: string, toleranceSeconds: number): Promise<PositionRecord | null> {
    const [row] = await queryPostgres(`
SELECT tag_code AS "tagCode", x::text, y::text, map_id AS "mapId", zone_id AS "sourceZoneId", zone_name AS "sourceZoneName",
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

    const rows = await queryPostgres(`
WITH ordered AS (
  SELECT tag_code, x, y, map_id, zone_id, zone_name, created_at, id,
    extract(epoch FROM (created_at - lag(created_at) OVER (ORDER BY created_at, id))) AS gap_before_seconds,
    row_number() OVER (ORDER BY created_at, id) AS row_number,
    count(*) OVER () AS total_count
  FROM tag_location_history WHERE (${filters})${mapId ? ` AND map_id = ${sqlString(mapId)}` : ""}
), sampled AS (
  SELECT * FROM ordered
  WHERE total_count <= ${limit}
     OR mod(row_number - 1, CEIL(total_count::numeric / ${limit})::bigint) = 0
  ORDER BY created_at, id LIMIT ${limit}
)
SELECT tag_code AS "tagCode", x::text, y::text, map_id AS "mapId", zone_id AS "sourceZoneId", zone_name AS "sourceZoneName",
  created_at AS "observedAt", gap_before_seconds::text AS "gapBeforeSeconds",
  total_count::text AS "sourcePointCount"
FROM sampled ORDER BY created_at, id;`);
    return {
      positions: rows.map(fromRow),
      sourcePointCount: Number(rows[0]?.sourcePointCount ?? 0),
      processingTruncated: false,
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
    const rows = await queryPostgres(`
WITH ordered AS (
  SELECT tag_code, x, y, map_id, zone_id, zone_name, created_at, id,
    extract(epoch FROM (created_at - lag(created_at) OVER (ORDER BY created_at, id))) AS gap_before_seconds,
    count(*) OVER () AS total_count
  FROM tag_location_history WHERE (${filters})${mapId ? ` AND map_id = ${sqlString(mapId)}` : ""}
)
SELECT tag_code AS "tagCode", x::text, y::text, map_id AS "mapId", zone_id AS "sourceZoneId", zone_name AS "sourceZoneName",
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
