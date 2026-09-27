import { queryPostgres, type PgRow } from "@/src/server/postgresClient";
import { roomDecisions } from "@/src/server/location/roomDecisionRepository";
import type { ProcessedPosition } from "@/src/server/regionEngine/types";
import { buildTagReport, filterTagReportToRoom, type ReportDecision, type TagReport } from "./routeReport";
import { listRouteReportRooms, type RouteReportRoom } from "./routeReportRooms";

const MAX_RECORDS = 50_000;
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export class RouteReportError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export interface RouteReportRoomSelection { readonly mapId: string; readonly roomId: string }
export interface RouteReportRequest { readonly tags: readonly string[]; readonly from: string; readonly to: string; readonly room?: RouteReportRoomSelection }
export interface RouteReportData { readonly from: string; readonly to: string; readonly generatedAt: string; readonly tags: readonly TagReport[]; readonly room?: RouteReportRoom }

export function validateRouteReportRequest(value: unknown, now = new Date()): RouteReportRequest {
  if (!value || typeof value !== "object") throw new RouteReportError("Rapor seçimleri geçersiz.", 400);
  const input = value as { tags?: unknown; from?: unknown; to?: unknown; room?: unknown };
  if (!Array.isArray(input.tags) || input.tags.length < 1 || input.tags.length > 20 || input.tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 100 || /[\x00-\x1F\x7F]/.test(tag))) {
    throw new RouteReportError("1 ile 20 arasında geçerli tag seçin.", 400);
  }
  const tags = [...new Set((input.tags as string[]).map(tag => tag.trim().toUpperCase()))];
  const from = typeof input.from === "string" ? input.from : "";
  const to = typeof input.to === "string" ? input.to : "";
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  if (!from || !to || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) throw new RouteReportError("Başlangıç ve bitiş tarihlerini doğru sırayla seçin.", 400);
  if (toMs - fromMs > 7 * 86_400_000) throw new RouteReportError("Rapor tarih aralığı en fazla 7 gün olabilir.", 400);
  if (toMs > now.getTime() + 60_000) throw new RouteReportError("Bitiş tarihi gelecekte olamaz.", 400);
  let room: RouteReportRoomSelection | undefined;
  if (input.room !== undefined) {
    if (!input.room || typeof input.room !== "object") throw new RouteReportError("Oda seçimi geçersiz.", 400);
    const candidate = input.room as Record<string, unknown>;
    if (typeof candidate.mapId !== "string" || typeof candidate.roomId !== "string"
      || !candidate.mapId.trim() || !candidate.roomId.trim() || candidate.mapId.length > 100 || candidate.roomId.length > 100) {
      throw new RouteReportError("Oda seçimi geçersiz.", 400);
    }
    room = { mapId: candidate.mapId, roomId: candidate.roomId };
  }
  return { tags, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), ...(room ? { room } : {}) };
}

function fromRow(row: PgRow): ReportDecision {
  return { tagCode: row.tag_code ?? "", at: row.at ?? "", mapId: row.map_id ?? null, roomId: row.room_id ?? null, roomName: row.room_name ?? null,
    state: row.state ?? null, corridorEvidence: row.corridor_kind === "corridor" };
}

function fromPending(position: ProcessedPosition): ReportDecision {
  return { tagCode: position.tagCode, at: position.lastRawDataTimestamp, mapId: position.mapId ?? null,
    roomId: position.regionInference.regionId, roomName: position.regionInference.regionName ?? null, state: position.regionInference.state,
    corridorEvidence: position.decisionTrace?.evidence?.lastReliableLocation?.kind === "corridor" };
}

export async function loadRouteReport(input: RouteReportRequest, now = new Date(), query = queryPostgres, getRooms = listRouteReportRooms): Promise<RouteReportData> {
  const selectedRoom = input.room ? (await getRooms()).find(room => room.mapId === input.room?.mapId && room.roomId === input.room?.roomId) : undefined;
  if (input.room && !selectedRoom) throw new RouteReportError("Seçilen oda artık mevcut değil. Oda listesini yenileyin.", 400);
  const tagList = input.tags.map(quote).join(",");
  const registered = await query(`SELECT tag_code,COALESCE(display_name,tag_name,tag_code) display_name FROM tags WHERE upper(tag_code) IN (${tagList});`);
  const names = new Map(registered.map(row => [row.tag_code?.toUpperCase(), row.display_name ?? row.tag_code ?? ""]));
  const codes = new Map(registered.map(row => [row.tag_code?.toUpperCase(), row.tag_code ?? ""]));
  const missing = input.tags.filter(tag => !names.has(tag));
  if (missing.length) throw new RouteReportError(`Kayıtlı olmayan tag: ${missing.join(", ")}`, 400);
  const decisionTagList = input.tags.map(tag => quote(codes.get(tag)!)).join(",");

  const fields = `tag_code,measured_at::text at,COALESCE(map_id,payload->>'mapId') map_id,
    COALESCE(region_id,payload#>>'{regionInference,regionId}') room_id,
    payload#>>'{regionInference,regionName}' room_name,
    COALESCE(state,payload#>>'{regionInference,state}') state,
    payload#>>'{decisionTrace,evidence,lastReliableLocation,kind}' corridor_kind`;
  const base = `tag_code IN (${decisionTagList}) AND COALESCE(measurement_kind,payload#>>'{regionInference,measurementKind}')='measured'
    AND COALESCE(event_type,payload#>>'{decisionTrace,eventType}','MEASUREMENT_ACCEPTED')<>'MEASUREMENT_REJECTED'`;
  const inRange = await query(`SELECT ${fields} FROM tag_room_decisions WHERE ${base}
    AND measured_at>=${quote(input.from)}::timestamptz AND measured_at<=${quote(input.to)}::timestamptz
    ORDER BY measured_at,id LIMIT ${MAX_RECORDS + 1};`);
  if (inRange.length > MAX_RECORDS) throw new RouteReportError("Rapor veri sınırına ulaştı. Tarih aralığını veya tag sayısını azaltın.", 422);
  const seeds = await query(`SELECT DISTINCT ON (tag_code) ${fields} FROM tag_room_decisions WHERE ${base}
    AND measured_at<${quote(input.from)}::timestamptz ORDER BY tag_code,measured_at DESC,id DESC;`);
  const pending = roomDecisions.pendingSnapshot().filter(position => input.tags.includes(position.tagCode.toUpperCase())
    && position.regionInference.measurementKind === "measured"
    && position.decisionTrace?.eventType !== "MEASUREMENT_REJECTED"
    && Date.parse(position.lastRawDataTimestamp) <= Date.parse(input.to));
  if (inRange.length + pending.length > MAX_RECORDS) throw new RouteReportError("Rapor veri sınırına ulaştı. Tarih aralığını veya tag sayısını azaltın.", 422);
  const all = [...seeds.map(fromRow), ...inRange.map(fromRow), ...pending.map(fromPending)];
  const tags = input.tags.map(tag => {
    const report = buildTagReport(tag, names.get(tag) ?? tag, input.from, input.to, all);
    return selectedRoom ? filterTagReportToRoom(report, selectedRoom) : report;
  });
  if (tags.every(tag => !tag.hasRecords)) throw new RouteReportError(selectedRoom
    ? "Seçilen tarih aralığında bu odaya ait kayıt bulunamadı."
    : "Seçilen tarih aralığında raporlanacak konum kaydı bulunamadı.", 422);
  return { from: input.from, to: input.to, tags, generatedAt: now.toISOString(), ...(selectedRoom ? { room: selectedRoom } : {}) };
}
