import { queryPostgres } from "../postgresClient";
import { logger } from "../logger";
import type { ProcessedPosition } from "../regionEngine/types";
import type { TagAssignment } from "./location.types";
import type { DecisionLogFilters, DecisionLogListResponse, DecisionLogSummary } from "../../features/decisionLogs/types/decisionLog.types";

export interface RoomDecisionRepository {
  latest(tag: string, at: string): Promise<ProcessedPosition | null>;
  latestMeasuredRoom(assignments: readonly TagAssignment[], at: string): Promise<ProcessedPosition | null>;
  history(tags: readonly string[], from: string, to: string, limit: number): Promise<readonly ProcessedPosition[]>;
  list(filters: DecisionLogFilters): Promise<DecisionLogListResponse>;
  detail(decisionId: string): Promise<ProcessedPosition | null>;
}
const quote = (v: string) => `'${v.replaceAll("'", "''")}'`;
const IMPORTANT_EVENTS = new Set(["MEASUREMENT_REJECTED", "ROOM_CONFIRMED", "ROOM_TRANSITIONED", "ROOM_INFERRED", "ROOM_EXITED", "LOCATION_LOST", "CONFIG_RELOADED"]);
type SharedDecisionProcess = NodeJS.Process & { __uwbRoomDecisionRecentCache?: Map<string, ProcessedPosition> };
function sharedRecentDecisions(): Map<string, ProcessedPosition> {
  const host = process as SharedDecisionProcess;
  return host.__uwbRoomDecisionRecentCache ??= new Map<string, ProcessedPosition>();
}

interface CursorValue { readonly publishedAt: string; readonly key: string }
export function encodeDecisionCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
export function decodeDecisionCursor(value: string): CursorValue | null {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CursorValue>;
    return typeof decoded.publishedAt === "string" && Number.isFinite(Date.parse(decoded.publishedAt)) && typeof decoded.key === "string"
      ? { publishedAt: decoded.publishedAt, key: decoded.key } : null;
  } catch { return null; }
}

export function projectDecisionSummary(p: ProcessedPosition): DecisionLogSummary {
  const trace = p.decisionTrace;
  return {
    decisionId: p.decisionId ?? `${p.tagCode}-${p.publishedAt}`,
    tagCode: p.tagCode, measuredAt: trace?.input.measuredAt ?? p.lastRawDataTimestamp, ...((trace?.input.receivedAt ?? p.rawPosition?.receivedAt) ? { receivedAt: trace?.input.receivedAt ?? p.rawPosition!.receivedAt } : {}),
    publishedAt: p.publishedAt!, ...(p.mapId ? { mapId: p.mapId } : {}),
    eventType: trace?.eventType ?? "MEASUREMENT_ACCEPTED", severity: trace?.severity ?? "info",
    ...(trace?.previousState ? { previousState: trace.previousState } : {}), nextState: p.regionInference.state,
    ...(p.regionInference.regionId ? { regionId: p.regionInference.regionId } : {}), ...(p.regionInference.regionName ? { regionName: p.regionInference.regionName } : {}),
    ...(p.regionInference.candidateRegionId ? { candidateRegionId: p.regionInference.candidateRegionId } : {}),
    ...(p.regionInference.measurementKind ? { measurementKind: p.regionInference.measurementKind } : {}),
    ...(p.regionInference.confidence !== undefined ? { confidence: p.regionInference.confidence } : {}),
    rawX: trace?.input.x ?? p.rawPosition?.x ?? p.x, rawY: trace?.input.y ?? p.rawPosition?.y ?? p.y, publishedX: p.x, publishedY: p.y,
    ...(trace?.evidence?.doorId ? { doorId: trace.evidence.doorId } : {}),
    ...(trace?.evidence?.doorDistanceMeters !== undefined ? { doorDistanceMeters: trace.evidence.doorDistanceMeters } : {}),
    reasonCodes: trace?.reasons.map(reason => reason.code) ?? [], shortReason: trace?.reasons[0]?.message ?? p.regionInference.reasons?.[0],
    engineVersion: p.engineVersion ?? "unknown", configVersion: p.configVersion ?? "unknown",
  };
}

function rowNumber(value: string | null | undefined): number | undefined {
  if (value == null) return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined;
}

function summaryFromRow(row: Record<string, string | null>): DecisionLogSummary {
  const optional = (value: string | null | undefined) => value || undefined;
  let reasonCodes: string[] = [];
  try { reasonCodes = row.reason_codes ? JSON.parse(row.reason_codes) as string[] : []; } catch { /* Legacy malformed arrays stay empty. */ }
  return {
    decisionId: row.decision_id!, tagCode: row.tag_code!, measuredAt: row.measured_at!, ...(optional(row.received_at) ? { receivedAt: row.received_at! } : {}),
    publishedAt: row.published_at!, ...(optional(row.map_id) ? { mapId: row.map_id! } : {}),
    eventType: (row.event_type ?? "MEASUREMENT_ACCEPTED") as DecisionLogSummary["eventType"],
    severity: (row.severity ?? "info") as DecisionLogSummary["severity"],
    ...(optional(row.previous_state) ? { previousState: row.previous_state as DecisionLogSummary["previousState"] } : {}),
    nextState: row.state as DecisionLogSummary["nextState"], ...(optional(row.region_id) ? { regionId: row.region_id! } : {}),
    ...(optional(row.region_name) ? { regionName: row.region_name! } : {}), ...(optional(row.candidate_region_id) ? { candidateRegionId: row.candidate_region_id! } : {}),
    ...(optional(row.measurement_kind) ? { measurementKind: row.measurement_kind as DecisionLogSummary["measurementKind"] } : {}),
    ...(rowNumber(row.confidence) !== undefined ? { confidence: rowNumber(row.confidence) } : {}),
    ...(rowNumber(row.raw_x) !== undefined ? { rawX: rowNumber(row.raw_x) } : {}), ...(rowNumber(row.raw_y) !== undefined ? { rawY: rowNumber(row.raw_y) } : {}),
    ...(rowNumber(row.published_x) !== undefined ? { publishedX: rowNumber(row.published_x) } : {}), ...(rowNumber(row.published_y) !== undefined ? { publishedY: rowNumber(row.published_y) } : {}),
    ...(optional(row.door_id) ? { doorId: row.door_id! } : {}), ...(rowNumber(row.door_distance_meters) !== undefined ? { doorDistanceMeters: rowNumber(row.door_distance_meters) } : {}),
    reasonCodes, ...(optional(row.short_reason) ? { shortReason: row.short_reason! } : {}), engineVersion: row.engine_version!, configVersion: row.config_version!,
  };
}

function matches(p: ProcessedPosition, filters: DecisionLogFilters): boolean {
  const summary = projectDecisionSummary(p); const at = Date.parse(summary.publishedAt);
  if (at < Date.parse(filters.from) || at > Date.parse(filters.to)) return false;
  if (filters.tagCode && !summary.tagCode.toLocaleLowerCase("tr-TR").includes(filters.tagCode.toLocaleLowerCase("tr-TR"))) return false;
  if (filters.mapId && summary.mapId !== filters.mapId) return false;
  if (filters.regionId && summary.regionId !== filters.regionId && summary.candidateRegionId !== filters.regionId) return false;
  if (filters.eventType && summary.eventType !== filters.eventType) return false;
  if (filters.state && summary.nextState !== filters.state) return false;
  if (filters.measurementKind && summary.measurementKind !== filters.measurementKind) return false;
  if (filters.engineVersion && summary.engineVersion !== filters.engineVersion) return false;
  if (filters.configVersion && summary.configVersion !== filters.configVersion) return false;
  if (filters.importantOnly && !IMPORTANT_EVENTS.has(summary.eventType)) return false;
  const cursor = filters.cursor ? decodeDecisionCursor(filters.cursor) : null;
  const publishedAt = Date.parse(summary.publishedAt), cursorAt = cursor ? Date.parse(cursor.publishedAt) : 0;
  return !cursor || publishedAt < cursorAt || (publishedAt === cursorAt && summary.decisionId < cursor.key);
}
export class PostgresRoomDecisionRepository implements RoomDecisionRepository {
  private queue: ProcessedPosition[] = [];
  private latestByTag = new Map<string, ProcessedPosition>();
  private recentById = sharedRecentDecisions();
  private flushing = false;
  private inFlight: ProcessedPosition[] = [];
  private dropped = 0;
  private error: string | null = null;
  private timer: ReturnType<typeof setInterval>;
  public constructor(private readonly query = queryPostgres) { this.timer = setInterval(() => void this.flush(), 5000); this.timer.unref?.(); }
  public record(p: ProcessedPosition): void {
    if (!p.engineVersion) return;
    if (this.latestByTag.size >= 5000 && !this.latestByTag.has(p.tagCode)) this.latestByTag.delete(this.latestByTag.keys().next().value!);
    const old = this.latestByTag.get(p.tagCode);
    this.latestByTag.set(p.tagCode, p);
    if (p.decisionId) {
      this.recentById.delete(p.decisionId);
      this.recentById.set(p.decisionId, p);
      if (this.recentById.size > 5000) this.recentById.delete(this.recentById.keys().next().value!);
    }
    // Keep each real decision and synthetic state transitions; repeated centre heartbeats are not events.
    if (p.synthetic && old?.regionInference.state === p.regionInference.state && old.regionInference.regionId === p.regionInference.regionId) return;
    if (this.queue.length >= 20000) { this.queue.shift(); this.dropped++; }
    this.queue.push(p);
  }
  public status() { return { queueSize: this.queue.length, dropped: this.dropped, error: this.error }; }
  public stop() { clearInterval(this.timer); }
  public async flush(): Promise<void> {
    if (this.flushing || !this.queue.length) return;
    this.flushing = true;
    const batch = this.queue.splice(0, 1000);
    this.inFlight = batch;
    try {
      const nullable = (value: string | null | undefined) => value ? quote(value) : "NULL";
      const textArray = (values: readonly string[] | undefined) => values?.length ? `ARRAY[${values.map(quote).join(",")}]::text[]` : "NULL";
      const values = batch.map(p => { const t=p.decisionTrace; return `(${p.decisionId ? quote(p.decisionId) : "NULL"},${quote(p.tagCode)},${quote(t?.input.measuredAt ?? p.lastRawDataTimestamp)}::timestamptz,${quote(p.publishedAt!)}::timestamptz,${quote(p.engineVersion!)},${quote(p.configVersion!)},${nullable(p.mapId)},${nullable(p.sourceZoneId)},${nullable(t?.eventType)},${nullable(t?.severity)},${nullable(p.regionInference.state)},${nullable(p.regionInference.regionId)},${nullable(p.regionInference.candidateRegionId)},${nullable(p.regionInference.measurementKind)},${p.regionInference.confidence ?? "NULL"},${textArray(t?.reasons.map(reason=>reason.code))},${quote(JSON.stringify(p))}::jsonb)`; }).join(",");
      await this.query(`INSERT INTO tag_room_decisions(event_id,tag_code,measured_at,published_at,engine_version,config_version,map_id,zone_id,event_type,severity,state,region_id,candidate_region_id,measurement_kind,confidence,reason_codes,payload) SELECT v.* FROM (VALUES ${values}) AS v(event_id,tag_code,measured_at,published_at,engine_version,config_version,map_id,zone_id,event_type,severity,state,region_id,candidate_region_id,measurement_kind,confidence,reason_codes,payload) WHERE EXISTS(SELECT 1 FROM tags t WHERE upper(t.tag_code)=upper(v.tag_code)) ON CONFLICT (event_id) DO NOTHING;`);
      this.error = null;
    } catch (error) {
      this.queue = [...batch, ...this.queue];
      if (this.queue.length > 20000) { this.dropped += this.queue.length - 20000; this.queue = this.queue.slice(-20000); }
      this.error = String(error); logger.error("tracking.room_decision_flush_failed", error);
    } finally { this.flushing = false; this.inFlight = []; }
  }
  public async latest(tag: string, at: string): Promise<ProcessedPosition | null> {
    const cached = this.latestByTag.get(tag);
    if (cached && Date.parse(cached.publishedAt!) <= Date.parse(at)) return cached;
    const pending = [...this.inFlight,...this.queue].filter(p=>p.tagCode===tag&&Date.parse(p.publishedAt!)<=Date.parse(at)).at(-1);
    if (pending) return pending;
    const [row] = await this.query(`SELECT payload::text FROM tag_room_decisions WHERE tag_code=${quote(tag)} AND published_at<=${quote(at)}::timestamptz ORDER BY published_at DESC,id DESC LIMIT 1;`);
    return row?.payload ? JSON.parse(row.payload) as ProcessedPosition : null;
  }
  public async latestMeasuredRoom(assignments: readonly TagAssignment[], at: string): Promise<ProcessedPosition | null> {
    if (!assignments.length) return null;
    const valid = (p: ProcessedPosition) => assignments.some(a =>
      a.tagCode.toLocaleLowerCase("tr-TR") === p.tagCode.toLocaleLowerCase("tr-TR")
      && Date.parse(p.lastRawDataTimestamp) >= Date.parse(a.assignedAt)
      && (!a.unassignedAt || Date.parse(p.lastRawDataTimestamp) < Date.parse(a.unassignedAt)))
      && Date.parse(p.lastRawDataTimestamp) <= Date.parse(at)
      && p.regionInference.state === "IN_REGION"
      && p.regionInference.measurementKind === "measured"
      && Boolean(p.regionInference.regionId);
    const pending = [...this.inFlight, ...this.queue, ...this.latestByTag.values()].filter(valid)
      .sort((a, b) => Date.parse(b.lastRawDataTimestamp) - Date.parse(a.lastRawDataTimestamp))[0] ?? null;
    const assignmentWhere = assignments.map(a =>
      `(tag_code=${quote(a.tagCode)} AND measured_at>=${quote(a.assignedAt)}::timestamptz${a.unassignedAt ? ` AND measured_at<${quote(a.unassignedAt)}::timestamptz` : ""})`).join(" OR ");
    const [row] = await this.query(`SELECT payload::text FROM tag_room_decisions WHERE (${assignmentWhere})
      AND measured_at<=${quote(at)}::timestamptz AND published_at<=${quote(at)}::timestamptz
      AND COALESCE(state,payload#>>'{regionInference,state}')='IN_REGION'
      AND COALESCE(measurement_kind,payload#>>'{regionInference,measurementKind}')='measured'
      AND COALESCE(region_id,payload#>>'{regionInference,regionId}') IS NOT NULL
      ORDER BY measured_at DESC,published_at DESC,id DESC LIMIT 1;`);
    const stored = row?.payload ? JSON.parse(row.payload) as ProcessedPosition : null;
    if (!stored || !valid(stored)) return pending;
    return pending && Date.parse(pending.lastRawDataTimestamp) > Date.parse(stored.lastRawDataTimestamp) ? pending : stored;
  }
  public async history(tags: readonly string[], from: string, to: string, limit: number): Promise<readonly ProcessedPosition[]> {
    if (!tags.length) return [];
    const rows = await this.query(`WITH decisions AS (
      SELECT * FROM tag_room_decisions WHERE tag_code IN (${tags.map(quote).join(",")}) AND published_at BETWEEN ${quote(from)}::timestamptz AND ${quote(to)}::timestamptz
      UNION ALL (SELECT DISTINCT ON (tag_code) * FROM tag_room_decisions WHERE tag_code IN (${tags.map(quote).join(",")}) AND published_at < ${quote(from)}::timestamptz ORDER BY tag_code,published_at DESC,id DESC)
    ) SELECT payload::text FROM decisions ORDER BY published_at,id LIMIT ${Math.max(1, Math.min(250000, Math.floor(limit)))};`);
    const pending = [...this.inFlight,...this.queue].filter(p => tags.includes(p.tagCode) && Date.parse(p.publishedAt!) >= Date.parse(from) && Date.parse(p.publishedAt!) <= Date.parse(to));
    for (const tag of tags) {
      const seed=[...this.inFlight,...this.queue].filter(p=>p.tagCode===tag&&Date.parse(p.publishedAt!)<Date.parse(from)).at(-1);
      if (seed) pending.push(seed);
    }
    const unique = new Map<string,ProcessedPosition>();
    for (const p of [...rows.map(row => JSON.parse(row.payload!) as ProcessedPosition), ...pending]) unique.set(p.decisionId ?? JSON.stringify(p),p);
    return [...unique.values()].sort((a,b) => Date.parse(a.publishedAt!) - Date.parse(b.publishedAt!)).slice(0, limit);
  }
  public pendingSnapshot(): readonly ProcessedPosition[] { return [...this.inFlight, ...this.queue]; }
  public async detail(decisionId: string): Promise<ProcessedPosition | null> {
    const pending = this.recentById.get(decisionId) ?? this.pendingSnapshot().find(position => position.decisionId === decisionId);
    if (pending) return pending;
    const [row] = await this.query(`SELECT payload::text FROM tag_room_decisions WHERE event_id=${quote(decisionId)} LIMIT 1;`);
    return row?.payload ? JSON.parse(row.payload) as ProcessedPosition : null;
  }
  public async list(filters: DecisionLogFilters): Promise<DecisionLogListResponse> {
    const where = [`published_at>=${quote(filters.from)}::timestamptz`, `published_at<=${quote(filters.to)}::timestamptz`];
    if (filters.tagCode) where.push(`tag_code ILIKE ${quote(`%${filters.tagCode}%`)}`);
    if (filters.mapId) where.push(`COALESCE(map_id,payload->>'mapId')=${quote(filters.mapId)}`);
    if (filters.regionId) where.push(`(COALESCE(region_id,payload#>>'{regionInference,regionId}')=${quote(filters.regionId)} OR COALESCE(candidate_region_id,payload#>>'{regionInference,candidateRegionId}')=${quote(filters.regionId)})`);
    if (filters.eventType) where.push(`COALESCE(event_type,payload#>>'{decisionTrace,eventType}')=${quote(filters.eventType)}`);
    if (filters.state) where.push(`COALESCE(state,payload#>>'{regionInference,state}')=${quote(filters.state)}`);
    if (filters.measurementKind) where.push(`COALESCE(measurement_kind,payload#>>'{regionInference,measurementKind}')=${quote(filters.measurementKind)}`);
    if (filters.engineVersion) where.push(`engine_version=${quote(filters.engineVersion)}`);
    if (filters.configVersion) where.push(`config_version=${quote(filters.configVersion)}`);
    if (filters.importantOnly) where.push(`COALESCE(event_type,payload#>>'{decisionTrace,eventType}') IN (${[...IMPORTANT_EVENTS].map(quote).join(",")})`);
    const cursor = filters.cursor ? decodeDecisionCursor(filters.cursor) : null;
    const cursorWhere = cursor ? `WHERE (published_at,decision_id)<(${quote(cursor.publishedAt)}::timestamptz,${quote(cursor.key)})` : "";
    const rows = await this.query(`WITH filtered AS (
      SELECT COALESCE(event_id,'legacy-'||id::text) decision_id,tag_code,COALESCE(payload#>>'{decisionTrace,input,measuredAt}',measured_at::text) measured_at,published_at::text,COALESCE(map_id,payload->>'mapId') map_id,
        COALESCE(event_type,payload#>>'{decisionTrace,eventType}','MEASUREMENT_ACCEPTED') event_type,
        COALESCE(severity,payload#>>'{decisionTrace,severity}','info') severity,payload#>>'{decisionTrace,previousState}' previous_state,
        COALESCE(state,payload#>>'{regionInference,state}') state,COALESCE(region_id,payload#>>'{regionInference,regionId}') region_id,
        payload#>>'{regionInference,regionName}' region_name,COALESCE(candidate_region_id,payload#>>'{regionInference,candidateRegionId}') candidate_region_id,
        COALESCE(measurement_kind,payload#>>'{regionInference,measurementKind}') measurement_kind,
        COALESCE(confidence,(payload#>>'{regionInference,confidence}')::double precision) confidence,
        COALESCE(payload#>>'{decisionTrace,input,receivedAt}',payload#>>'{rawPosition,receivedAt}') received_at,COALESCE(payload#>>'{decisionTrace,input,x}',payload#>>'{rawPosition,x}') raw_x,COALESCE(payload#>>'{decisionTrace,input,y}',payload#>>'{rawPosition,y}') raw_y,
        payload#>>'{x}' published_x,payload#>>'{y}' published_y,payload#>>'{decisionTrace,evidence,doorId}' door_id,
        payload#>>'{decisionTrace,evidence,doorDistanceMeters}' door_distance_meters,
        COALESCE(array_to_json(reason_codes),(SELECT json_agg(reason->>'code') FROM jsonb_array_elements(COALESCE(payload#>'{decisionTrace,reasons}','[]'::jsonb)) reason),'[]'::json)::text reason_codes,payload#>>'{decisionTrace,reasons,0,message}' short_reason,
        engine_version,config_version FROM tag_room_decisions WHERE ${where.join(" AND ")}
    ), stats AS (SELECT count(*) filtered_total FROM filtered), page AS (
      SELECT * FROM filtered ${cursorWhere} ORDER BY published_at DESC,decision_id DESC LIMIT ${filters.limit + 1}
    ) SELECT page.*,stats.filtered_total::text FROM page CROSS JOIN stats ORDER BY published_at DESC,decision_id DESC;`);
    const dbItems = rows.map(summaryFromRow);
    const pendingAll = this.pendingSnapshot().filter(position => matches(position, { ...filters, cursor: undefined }));
    const pendingPage = pendingAll.filter(position => matches(position, filters)).map(projectDecisionSummary);
    const unique = new Map<string, DecisionLogSummary>();
    for (const item of [...dbItems, ...pendingPage]) unique.set(item.decisionId, item);
    const sorted = [...unique.values()].sort((a,b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.decisionId.localeCompare(a.decisionId));
    const hasMore = sorted.length > filters.limit || dbItems.length > filters.limit;
    const items = sorted.slice(0, filters.limit);
    const dbTotal = Number(rows[0]?.filtered_total ?? 0);
    return { items, nextCursor: hasMore && items.length ? encodeDecisionCursor({ publishedAt: items.at(-1)!.publishedAt, key: items.at(-1)!.decisionId }) : null,
      metadata: { filteredCount: dbTotal + pendingAll.length, returnedCount: items.length, countAccuracy: pendingAll.length ? "estimated" : "exact" } };
  }
}
declare global { var __uwbRoomDecisions: PostgresRoomDecisionRepository | undefined }
// Vite keeps this instance across hot reloads. Refresh its methods when the class changes.
if (globalThis.__uwbRoomDecisions && Object.getPrototypeOf(globalThis.__uwbRoomDecisions) !== PostgresRoomDecisionRepository.prototype) {
  Object.setPrototypeOf(globalThis.__uwbRoomDecisions, PostgresRoomDecisionRepository.prototype);
}
export const roomDecisions = globalThis.__uwbRoomDecisions ??= new PostgresRoomDecisionRepository();
