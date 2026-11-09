import { queryPostgres, type PgRow } from "../postgresClient";
import type { EntityMatch, TagAssignment, TrackedEntity } from "./location.types";

export interface EntityRepository {
  search(query: string, limit: number): Promise<readonly EntityMatch[]>;
  getById(entityId: number): Promise<TrackedEntity | null>;
  getAssignmentAt(entityId: number, at: string): Promise<TagAssignment | null>;
  getAssignmentsInRange(entityId: number, from: string, to: string): Promise<readonly TagAssignment[]>;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function numberOf(value: string | null): number {
  return Number(value ?? 0);
}

function entityFromRow(row: PgRow, legacy: boolean): TrackedEntity {
  return {
    entityId: numberOf(row.entityId),
    entityCode: row.entityCode ?? "",
    name: row.name ?? "",
    entityType: row.entityType ?? "product",
    status: row.status ?? "active",
    aliases: row.aliases ? row.aliases.split("\u001f").filter(Boolean) : [],
    usesLegacyTagModel: legacy,
  };
}

function matchFromRow(row: PgRow): EntityMatch {
  return {
    entityId: numberOf(row.entityId), entityCode: row.entityCode ?? "", name: row.name ?? "",
    entityType: row.entityType ?? "product", tagCode: row.tagCode, status: row.status ?? "active",
  };
}

export class PostgresEntityRepository implements EntityRepository {
  private assignmentSchemaAvailable: boolean | null = null;

  private async hasAssignmentSchema(): Promise<boolean> {
    if (this.assignmentSchemaAvailable !== null) return this.assignmentSchemaAvailable;
    const [row] = await queryPostgres("SELECT (to_regclass('public.tracked_entities') IS NOT NULL AND to_regclass('public.tag_assignments') IS NOT NULL)::text AS available;");
    this.assignmentSchemaAvailable = row?.available === "true";
    return this.assignmentSchemaAvailable;
  }

  public async search(query: string, limit: number): Promise<readonly EntityMatch[]> {
    const pattern = `%${query}%`;
    if (await this.hasAssignmentSchema()) {
      const rows = await queryPostgres(`
SELECT e.id::text AS "entityId", e.entity_code AS "entityCode", e.name,
  e.entity_type AS "entityType", a.tag_code AS "tagCode", e.status
FROM tracked_entities e
LEFT JOIN LATERAL (
  SELECT tag_code FROM tag_assignments
  WHERE entity_id = e.id AND unassigned_at IS NULL
  ORDER BY assigned_at DESC LIMIT 1
) a ON TRUE
WHERE e.name ILIKE ${sqlString(pattern)}
   OR e.entity_code ILIKE ${sqlString(pattern)}
   OR COALESCE(array_to_string(e.aliases, ' '), '') ILIKE ${sqlString(pattern)}
   OR COALESCE(a.tag_code, '') ILIKE ${sqlString(pattern)}
ORDER BY CASE
  WHEN lower(e.name) = lower(${sqlString(query)}) THEN 0
  WHEN lower(e.entity_code) = lower(${sqlString(query)}) THEN 1
  WHEN lower(COALESCE(a.tag_code, '')) = lower(${sqlString(query)}) THEN 2
  ELSE 3 END, e.name, e.id
LIMIT ${limit};`);
      return rows.map(matchFromRow);
    }

    const rows = await queryPostgres(`
SELECT id::text AS "entityId", tag_code AS "entityCode",
  COALESCE(display_name, tag_name, tag_code) AS name,
  'tracked_tag' AS "entityType", tag_code AS "tagCode", status
FROM tags
WHERE COALESCE(display_name, tag_name, tag_code) ILIKE ${sqlString(pattern)}
   OR tag_code ILIKE ${sqlString(pattern)}
ORDER BY CASE
  WHEN lower(COALESCE(display_name, tag_name, tag_code)) = lower(${sqlString(query)}) THEN 0
  WHEN lower(tag_code) = lower(${sqlString(query)}) THEN 1
  ELSE 2 END, tag_code
LIMIT ${limit};`);
    return rows.map(matchFromRow);
  }

  public async getById(entityId: number): Promise<TrackedEntity | null> {
    if (await this.hasAssignmentSchema()) {
      const [row] = await queryPostgres(`
SELECT id::text AS "entityId", entity_code AS "entityCode", name,
  entity_type AS "entityType", status, array_to_string(aliases, E'\\x1f') AS aliases
FROM tracked_entities WHERE id = ${entityId} LIMIT 1;`);
      return row ? entityFromRow(row, false) : null;
    }
    const [row] = await queryPostgres(`
SELECT id::text AS "entityId", tag_code AS "entityCode",
  COALESCE(display_name, tag_name, tag_code) AS name,
  'tracked_tag' AS "entityType", status, '' AS aliases
FROM tags WHERE id = ${entityId} LIMIT 1;`);
    return row ? entityFromRow(row, true) : null;
  }

  public async getAssignmentAt(entityId: number, at: string): Promise<TagAssignment | null> {
    if (await this.hasAssignmentSchema()) {
      const [row] = await queryPostgres(`
SELECT entity_id::text AS "entityId", tag_code AS "tagCode",
  assigned_at AS "assignedAt", unassigned_at AS "unassignedAt"
FROM tag_assignments
WHERE entity_id = ${entityId}
  AND assigned_at <= ${sqlString(at)}::timestamptz
  AND (unassigned_at IS NULL OR unassigned_at > ${sqlString(at)}::timestamptz)
ORDER BY assigned_at DESC LIMIT 1;`);
      return row ? {
        entityId: numberOf(row.entityId), tagCode: row.tagCode ?? "", assignedAt: row.assignedAt ?? at,
        unassignedAt: row.unassignedAt, usesLegacyTagModel: false,
      } : null;
    }
    const [row] = await queryPostgres(`SELECT id::text AS "entityId", tag_code AS "tagCode", created_at AS "assignedAt"
FROM tags WHERE id = ${entityId} AND status = 'active' LIMIT 1;`);
    return row ? {
      entityId: numberOf(row.entityId), tagCode: row.tagCode ?? "", assignedAt: row.assignedAt ?? at,
      unassignedAt: null, usesLegacyTagModel: true,
    } : null;
  }

  public async getAssignmentsInRange(entityId: number, from: string, to: string): Promise<readonly TagAssignment[]> {
    if (await this.hasAssignmentSchema()) {
      const rows = await queryPostgres(`
SELECT entity_id::text AS "entityId", tag_code AS "tagCode",
  assigned_at AS "assignedAt", unassigned_at AS "unassignedAt"
FROM tag_assignments
WHERE entity_id = ${entityId}
  AND assigned_at < ${sqlString(to)}::timestamptz
  AND (unassigned_at IS NULL OR unassigned_at > ${sqlString(from)}::timestamptz)
ORDER BY assigned_at;`);
      return rows.map((row) => ({
        entityId: numberOf(row.entityId), tagCode: row.tagCode ?? "", assignedAt: row.assignedAt ?? from,
        unassignedAt: row.unassignedAt, usesLegacyTagModel: false,
      }));
    }
    const assignment = await this.getAssignmentAt(entityId, to);
    return assignment ? [assignment] : [];
  }
}
