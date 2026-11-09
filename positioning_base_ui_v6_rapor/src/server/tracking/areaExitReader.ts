import { queryPostgres } from "../postgresClient";
import { roomDecisions } from "../location/roomDecisionRepository";
import { resolveConfiguredMapName } from "../location/regionLocationResolver";
import type { ProcessedPosition } from "../regionEngine/types";
import type { AreaExitReadSnapshot, AreaExitReadStatus } from "../../features/tracking/types/areaExit.types";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
export const AREA_EXIT_READ_BATCH_SIZE = 200;

export function projectAreaExit(position: ProcessedPosition): AreaExitReadStatus {
  const d = position.regionInference;
  const publishedAt = Date.parse(position.publishedAt ?? "");
  const exitedAt = Date.parse(d?.leftAreaAt ?? "");
  const tagCode = position.tagCode.toUpperCase();
  return { tagCode, publishedAt: position.publishedAt ?? null,
    exit: position.mapId && d?.enabled === true && d.outsideArea === true && Number.isFinite(exitedAt) && exitedAt <= publishedAt ? {
      tagCode, mapId: position.mapId, areaName: resolveConfiguredMapName(position.mapId) ?? position.sourceZoneName ?? position.mapId,
      gateName: d.leftAreaGate ?? null, exitedAt: new Date(exitedAt).toISOString(), publishedAt: position.publishedAt!,
      decisionId: position.decisionId ?? null,
    } : null };
}

/** Reads existing history and the archive's unflushed outputs. No tracking subscriptions or writes. */
export class AreaExitReader {
  public constructor(private readonly query = queryPostgres,
    private readonly pending: () => readonly ProcessedPosition[] = () => roomDecisions.pendingSnapshot()) {}

  public async read(tags: readonly string[], at = new Date().toISOString()): Promise<AreaExitReadSnapshot> {
    const cutoff = Date.parse(at);
    if (!Number.isFinite(cutoff)) throw new Error("Geçersiz çıkış kayıt zamanı");
    const codes = [...new Set(tags.map(tag => tag.toUpperCase()))];
    if (codes.length > AREA_EXIT_READ_BATCH_SIZE) throw new Error("Çok fazla takip etiketi");
    if (!codes.length) return { serverNow: cutoff, byTag: {} };
    const rows = await this.query(`SELECT upper(t.tag_code) tag_code,d.payload::text payload FROM tags t
      LEFT JOIN LATERAL (SELECT payload FROM tag_room_decisions
        WHERE tag_code=t.tag_code AND published_at<=${quote(at)}::timestamptz
        ORDER BY published_at DESC,id DESC LIMIT 1) d ON TRUE
      WHERE upper(t.tag_code) IN (${codes.map(quote).join(",")});`);
    const registered = new Set(rows.map(row => row.tag_code!));
    const latest = new Map<string, ProcessedPosition>();
    const consider = (position: ProcessedPosition) => {
      const code = position.tagCode?.toUpperCase();
      const publishedAt = Date.parse(position.publishedAt ?? "");
      if (!registered.has(code) || !Number.isFinite(publishedAt) || publishedAt > cutoff) return;
      const previous = latest.get(code);
      if (!previous || publishedAt >= Date.parse(previous.publishedAt!)) latest.set(code, position);
    };
    for (const row of rows) if (row.payload) {
      try { consider(JSON.parse(row.payload) as ProcessedPosition); } catch { /* A corrupt historical row is not an exit. */ }
    }
    for (const position of this.pending()) consider(position);
    const byTag: Record<string, AreaExitReadStatus> = {};
    for (const tagCode of registered) {
      const position = latest.get(tagCode);
      byTag[tagCode] = position ? projectAreaExit(position) : { tagCode, publishedAt: null, exit: null };
    }
    return { serverNow: cutoff, byTag };
  }
}

export const areaExitReader = new AreaExitReader();
