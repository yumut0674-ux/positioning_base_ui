import { queryPostgres, type PgRow } from "../postgresClient";
import { roomDecisions } from "../location/roomDecisionRepository";
import type { ProcessedPosition } from "../regionEngine/types";
import { listRouteReportRooms, type RouteReportRoom } from "./routeReportRooms";
import type { DecisionReportData, DecisionReportItem, DecisionReportRequest } from "../../features/reports/types/decisionReport.types";
import { DecisionReportError, MAX_DECISION_REPORT_RECORDS } from "./decisionReportRequest";
export { DecisionReportError, MAX_DECISION_REPORT_RECORDS, validateDecisionReportRequest } from "./decisionReportRequest";

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
const finite = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;

function matches(position: ProcessedPosition, input: DecisionReportRequest): boolean {
  const at = Date.parse(position.publishedAt ?? "");
  return at >= Date.parse(input.from) && at <= Date.parse(input.to)
    && (!input.tagCode || position.tagCode.toUpperCase().includes(input.tagCode.toUpperCase()))
    && (!input.mapId || position.mapId === input.mapId)
    && (!input.regionId || position.regionInference.regionId === input.regionId || position.regionInference.candidateRegionId === input.regionId);
}

function project(position: ProcessedPosition, id: string, name: string, rooms: readonly RouteReportRoom[]): DecisionReportItem {
  const inference = position.regionInference, trace = position.decisionTrace;
  const mapId = position.mapId ?? "";
  const names = rooms.filter(room => room.mapId === mapId);
  const roomName = (roomId: string) => names.find(room => room.roomId === roomId)?.roomName ?? roomId;
  const regionId = inference.regionId ?? "", candidateRegionId = inference.candidateRegionId ?? "";
  return {
    decisionId: position.decisionId ?? id, publishedAt: position.publishedAt!, tagCode: position.tagCode, tagName: name,
    mapId, mapName: names[0]?.mapName ?? mapId,
    previousState: trace?.previousState ?? "", nextState: inference.state,
    eventType: trace?.eventType ?? "MEASUREMENT_ACCEPTED",
    regionId, regionName: inference.regionName ?? roomName(regionId),
    candidateRegionId, candidateRegionName: roomName(candidateRegionId),
    measurementKind: inference.measurementKind ?? "", confidence: finite(inference.confidence),
    trigger: trace?.trigger ?? (position.synthetic ? "timer" : "measurement"), synthetic: position.synthetic === true,
    rawX: finite(trace?.input.x ?? position.rawPosition?.x), rawY: finite(trace?.input.y ?? position.rawPosition?.y),
    publishedX: finite(position.x), publishedY: finite(position.y),
    doorId: trace?.evidence?.doorId ?? "", doorDistanceMeters: finite(trace?.evidence?.doorDistanceMeters),
    reasonCodes: trace?.reasons.map(reason => reason.code) ?? [],
    reasonText: trace?.reasons.map(reason => reason.message).join(" | ") ?? inference.reasons?.join(" | ") ?? "",
    engineVersion: position.engineVersion ?? "unknown", configVersion: position.configVersion ?? "unknown",
    payload: position as unknown as Record<string, unknown>,
  };
}

interface ReportSources {
  readonly query?: (sql: string) => Promise<PgRow[]>;
  readonly pending?: () => readonly ProcessedPosition[];
  readonly rooms?: () => Promise<readonly RouteReportRoom[]>;
}

/** Read-only reporting: never calls ingest, record, tick, flush or engine configuration APIs. */
export async function loadDecisionReport(input: DecisionReportRequest, now = new Date(), sources: ReportSources = {}): Promise<DecisionReportData> {
  const query = sources.query ?? queryPostgres;
  // Capture pending decisions before querying so a concurrent flush cannot lose records from this download.
  const pending = (sources.pending ?? (() => roomDecisions.pendingSnapshot()))().filter(p => matches(p, input)).map(p => structuredClone(p));
  const where = [`d.published_at>=${quote(input.from)}::timestamptz`, `d.published_at<=${quote(input.to)}::timestamptz`];
  if (input.tagCode) where.push(`strpos(upper(d.tag_code),${quote(input.tagCode.toUpperCase())})>0`);
  if (input.mapId) where.push(`COALESCE(d.map_id,d.payload->>'mapId')=${quote(input.mapId)}`);
  if (input.regionId) where.push(`(COALESCE(d.region_id,d.payload#>>'{regionInference,regionId}')=${quote(input.regionId)} OR COALESCE(d.candidate_region_id,d.payload#>>'{regionInference,candidateRegionId}')=${quote(input.regionId)})`);
  const rows = await query(`SELECT d.id::text,d.event_id,d.tag_code,d.published_at::text,d.payload::text,
    COALESCE(t.display_name,t.tag_name,d.tag_code) tag_name
    FROM tag_room_decisions d LEFT JOIN tags t ON t.tag_code=d.tag_code
    WHERE ${where.join(" AND ")} ORDER BY d.published_at,d.id LIMIT ${MAX_DECISION_REPORT_RECORDS + 1};`);
  if (rows.length > MAX_DECISION_REPORT_RECORDS) throw new DecisionReportError("Rapor 50.000 kayıt sınırını aşıyor. Tarih aralığını daraltın veya tek tag seçin. Eksik çıktı oluşturulmadı.", 422);
  const rooms = await (sources.rooms ?? listRouteReportRooms)().catch(() => [] as readonly RouteReportRoom[]);
  const names = new Map<string, string>();
  const unique = new Map<string, DecisionReportItem>();
  for (const row of rows) {
    let position: ProcessedPosition;
    try { position = JSON.parse(row.payload!) as ProcessedPosition; }
    catch { throw new DecisionReportError(`Karar kaydı okunamadı (ID: ${row.event_id ?? row.id}). Eksik çıktı oluşturulmadı.`, 503); }
    const normalized = { ...position, tagCode: position.tagCode ?? row.tag_code!, publishedAt: position.publishedAt ?? row.published_at! };
    const id = row.event_id ?? `legacy-${row.id}`;
    const name = row.tag_name ?? normalized.tagCode;
    names.set(normalized.tagCode.toUpperCase(), name);
    const item = project(normalized, id, name, rooms);
    unique.set(item.decisionId, item);
  }
  for (const position of pending) {
    if (!position.decisionId) throw new DecisionReportError("Bekleyen kararın kimliği eksik. Birkaç saniye sonra yeniden deneyin.", 503);
    if (!unique.has(position.decisionId)) {
      unique.set(position.decisionId, project(position, position.decisionId, names.get(position.tagCode.toUpperCase()) ?? position.tagCode, rooms));
    }
  }
  if (unique.size > MAX_DECISION_REPORT_RECORDS) throw new DecisionReportError("Rapor 50.000 kayıt sınırını aşıyor. Tarih aralığını daraltın veya tek tag seçin. Eksik çıktı oluşturulmadı.", 422);
  const items = [...unique.values()].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || a.decisionId.localeCompare(b.decisionId));
  if (!items.length) throw new DecisionReportError("Seçilen aralıkta motor karar kaydı bulunamadı.", 422);
  return { from: input.from, to: input.to, generatedAt: now.toISOString(), timezone: "Europe/Istanbul",
    filters: { ...(input.tagCode ? { tagCode: input.tagCode } : {}), ...(input.mapId ? { mapId: input.mapId } : {}), ...(input.regionId ? { regionId: input.regionId } : {}) }, items };
}
