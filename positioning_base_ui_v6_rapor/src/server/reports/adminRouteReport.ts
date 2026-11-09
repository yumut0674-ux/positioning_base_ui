import type { ProcessedPosition } from "../regionEngine/types";
import type { RouteReportRoom } from "./routeReportRooms";
import type { AdminRouteReportRequest, AdminRouteReportRow } from "../../features/reports/types/adminRouteReport.types";

export interface StoredRouteDecision {
  readonly position: ProcessedPosition;
  readonly tagName: string;
}

const stamp = (value: string | undefined): number => value ? Date.parse(value) : NaN;

/** Projection only: no engine instances, timers, settings or persistence calls. */
export function buildAdminRouteRows(input: AdminRouteReportRequest, decisions: readonly StoredRouteDecision[], rooms: readonly RouteReportRoom[]): AdminRouteReportRow[] {
  const start = Date.parse(input.from), end = Date.parse(input.to);
  const names = new Map(rooms.map(room => [`${room.mapId}/${room.roomId}`, room.roomName]));
  const maps = new Map(rooms.map(room => [room.mapId, room.mapName]));
  const byTag = new Map<string, StoredRouteDecision[]>();
  for (const decision of decisions) {
    const key = decision.position.tagCode.toUpperCase();
    const list = byTag.get(key) ?? [];
    list.push(decision); byTag.set(key, list);
  }
  const result: AdminRouteReportRow[] = [];
  for (const list of byTag.values()) {
    // Stable sort preserves the database's published_at,id order for simultaneous decisions.
    list.sort((a, b) => stamp(a.position.publishedAt) - stamp(b.position.publishedAt));
    const hasWithin = list.some(item => stamp(item.position.publishedAt) >= start);
    const last = list.at(-1)!.position;
    if (!hasWithin && !last.regionInference.outsideArea
      && !(stamp(last.regionInference.uncertainAfter) > start || stamp(last.regionInference.validUntil) > start)) continue;
    const tag = list[0];
    const rows: AdminRouteReportRow[] = [];
    const append = (row: AdminRouteReportRow) => {
      const previous = rows.at(-1);
      if (previous && previous.to === row.from && previous.mapId === row.mapId
        && previous.kind === row.kind && previous.roomId === row.roomId && previous.candidateRoomId === row.candidateRoomId) {
        rows[rows.length - 1] = { ...previous, to: row.to, durationMs: Date.parse(row.to) - Date.parse(previous.from),
          measurementKinds: [...new Set([...previous.measurementKinds, ...row.measurementKinds])] };
      } else rows.push(row);
    };
    const unknown = (from: number, to: number) => append({ tagCode: tag.position.tagCode, tagName: tag.tagName,
      from: new Date(from).toISOString(), to: new Date(to).toISOString(), durationMs: to - from,
      mapId: "", mapName: "", roomId: "", location: "Veri yok", kind: "gap", candidateRoomId: "", measurementKinds: [] });
    const firstAt = stamp(list[0].position.publishedAt);
    if (firstAt > start) unknown(start, Math.min(firstAt, end));
    for (const [index, item] of list.entries()) {
      const p = item.position, d = p.regionInference;
      const at = stamp(p.publishedAt), next = list[index + 1];
      const noTailEvidence = !next && !d.outsideArea && !Number.isFinite(stamp(d.validUntil)) && !Number.isFinite(stamp(d.uncertainAfter));
      const from = Math.max(start, at), to = Math.min(end, next ? stamp(next.position.publishedAt) : noTailEvidence ? Math.max(start, at) : end);
      if (from > to || at > end || (to === start && at < start)) continue;
      const boundaries = [...new Set([from, to, stamp(d.validUntil), stamp(d.uncertainAfter)]
        .filter(value => Number.isFinite(value) && value >= from && value <= to))].sort((a,b) => a-b);
      // A simultaneous transition remains visible even though its duration is zero.
      if (boundaries.length === 1) boundaries.push(to);
      for (let part = 0; part < boundaries.length - 1; part++) {
        const left = boundaries[part], right = boundaries[part + 1];
        const expired = Number.isFinite(stamp(d.uncertainAfter)) && left >= stamp(d.uncertainAfter);
        const stale = d.measurementKind === "measured" && Number.isFinite(stamp(d.validUntil)) && left >= stamp(d.validUntil);
        const uncertain = expired || d.measurementKind === "uncertain" || d.state === "ENTRY_CANDIDATE" || d.state === "LOCATION_LOST" || (stale && !d.regionId);
        const mapId = p.mapId ?? "";
        const roomId = !uncertain && d.regionId ? d.regionId : "";
        const candidateRoomId = !expired && uncertain ? d.candidateRegionId ?? "" : "";
        const kind = d.outsideArea ? "outside" : uncertain ? "uncertain" : roomId ? "room" : d.state === "TRACKING_OUTSIDE" ? "corridor" : "uncertain";
        const location = kind === "outside" ? "Alandan çıktı" : kind === "room" ? d.regionName || names.get(`${mapId}/${roomId}`) || roomId
          : kind === "corridor" ? "Koridor" : candidateRoomId ? `Oda adayı: ${names.get(`${mapId}/${candidateRoomId}`) ?? candidateRoomId}` : "Konum belirsiz";
        append({ tagCode: p.tagCode, tagName: item.tagName, from: new Date(left).toISOString(), to: new Date(right).toISOString(), durationMs: right - left,
          mapId, mapName: maps.get(mapId) ?? mapId, roomId, location, kind, candidateRoomId,
          measurementKinds: [uncertain ? "uncertain" : stale && roomId ? "estimated" : d.measurementKind ?? ""] });
      }
      if (noTailEvidence && to < end) unknown(to, end);
    }
    // Scope selection happens after forming the complete timeline. A hidden intervening
    // corridor/room/map/uncertain interval can never join two visits to the selected room.
    result.push(...rows.filter(row => (!input.mapId || row.mapId === input.mapId) && (!input.regionId || row.roomId === input.regionId)));
  }
  return result.sort((a,b) => a.tagName.localeCompare(b.tagName, "tr") || a.tagCode.localeCompare(b.tagCode) || Date.parse(a.from) - Date.parse(b.from));
}
