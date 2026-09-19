import { queryPostgres } from "../postgresClient";
import { logger } from "../logger";
import type { ProcessedPosition } from "../regionEngine/types";

export interface RoomDecisionRepository {
  latest(tag: string, at: string): Promise<ProcessedPosition | null>;
  history(tags: readonly string[], from: string, to: string, limit: number): Promise<readonly ProcessedPosition[]>;
}
const quote = (v: string) => `'${v.replaceAll("'", "''")}'`;
export class PostgresRoomDecisionRepository implements RoomDecisionRepository {
  private queue: ProcessedPosition[] = [];
  private latestByTag = new Map<string, ProcessedPosition>();
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
      const values = batch.map(p => `(${p.decisionId ? quote(p.decisionId) : "NULL"},${quote(p.tagCode)},${quote(p.lastRawDataTimestamp)}::timestamptz,${quote(p.publishedAt!)}::timestamptz,${quote(p.engineVersion!)},${quote(p.configVersion!)},${nullable(p.mapId)},${nullable(p.sourceZoneId)},${quote(JSON.stringify(p))}::jsonb)`).join(",");
      await this.query(`ALTER TABLE tag_room_decisions ADD COLUMN IF NOT EXISTS map_id VARCHAR(100); ALTER TABLE tag_room_decisions ADD COLUMN IF NOT EXISTS zone_id VARCHAR(100); INSERT INTO tag_room_decisions(event_id,tag_code,measured_at,published_at,engine_version,config_version,map_id,zone_id,payload) SELECT v.* FROM (VALUES ${values}) AS v(event_id,tag_code,measured_at,published_at,engine_version,config_version,map_id,zone_id,payload) WHERE EXISTS(SELECT 1 FROM tags t WHERE upper(t.tag_code)=upper(v.tag_code)) ON CONFLICT (event_id) DO NOTHING;`);
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
}
declare global { var __uwbRoomDecisions: PostgresRoomDecisionRepository | undefined }
export const roomDecisions = globalThis.__uwbRoomDecisions ??= new PostgresRoomDecisionRepository();
