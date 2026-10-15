import { EventEmitter } from "node:events";
import { queryPostgres } from "./postgresClient";
import { logger } from "./logger";
import { isPositionPdopAccepted, type PdopFilterSettings } from "../shared/tracking/pdop";
import { mapTrackingFilterSettings } from "./trackingFilterSettings";

export type TrackingPosition = {
  readonly tagCode: string;
  readonly x: number;
  readonly y: number;
  readonly timestamp: string;
  readonly receivedAt?: string;
  readonly quality?: number;
  /** Missing legacy measurements have unknown geometry quality, represented as null. */
  readonly pdop?: number | null;
  /** Optional only for internal rollout compatibility; ingest always supplies an explicit value. */
  readonly sourceZoneId?: string | null;
  readonly sourceZoneName?: string | null;
  /** Source metadata only; never evidence for motion, quality, health or region decisions. */
  readonly motionLabel?: "moving" | "stationary" | "unknown";
  readonly mapId?: string | null;
};

const schemaSql = `
CREATE TABLE IF NOT EXISTS tag_location_history (
  id BIGSERIAL PRIMARY KEY,
  tag_code VARCHAR(100) NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tag_location_history_tag_time
  ON tag_location_history (tag_code, created_at DESC);
ALTER TABLE tag_location_history ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE tag_location_history ADD COLUMN IF NOT EXISTS quality DOUBLE PRECISION;
ALTER TABLE tag_location_history ADD COLUMN IF NOT EXISTS pdop DOUBLE PRECISION;
ALTER TABLE tag_location_history ADD COLUMN IF NOT EXISTS zone_id VARCHAR(100);
ALTER TABLE tag_location_history ADD COLUMN IF NOT EXISTS zone_name VARCHAR(160);
ALTER TABLE tag_location_history ADD COLUMN IF NOT EXISTS map_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_tag_location_history_tag_map_time ON tag_location_history(tag_code, map_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tag_location_history_map_time ON tag_location_history(map_id, created_at DESC, id DESC);
`;

const REGISTERED_TAG_CACHE_MS = 30_000;

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export class TrackingBuffer extends EventEmitter {
  private queue: TrackingPosition[] = [];
  private flushing = false;
  private registeredTagCodes = new Set<string>();
  private registrationCheckedAt = 0;
  private registrationRefresh: Promise<void> | null = null;
  private lastRegistryError: string | null = null;
  private lastPersistenceError: string | null = null;
  private lastSuccessfulFlushAt: string | null = null;
  private dropped = 0;
  private mappedPositionCount = 0;
  private unresolvedZoneCount = 0;
  private nullZoneCount = 0;
  private knownZoneCount = 0;
  private readonly timer?: ReturnType<typeof setInterval>;

  public constructor(private readonly query = queryPostgres, private readonly now: () => number = Date.now, automaticFlush = true,
    private readonly readPdopSettings?: (mapId: string | null) => Promise<PdopFilterSettings>) {
    super();
    if (automaticFlush) { this.timer = setInterval(() => { void this.flush(); }, 5_000); this.timer.unref?.(); }
  }

  public async ingest(position: TrackingPosition): Promise<boolean> {
    if (position.pdop != null && (!Number.isFinite(position.pdop) || !isPositionPdopAccepted(position.pdop,
      await (this.readPdopSettings ? this.readPdopSettings(position.mapId ?? null) : mapTrackingFilterSettings.read(position.mapId ?? null))))) return false;
    position = { ...position, pdop: position.pdop ?? null, receivedAt: new Date(this.now()).toISOString() };
    if (position.sourceZoneId == null) this.nullZoneCount++;
    else if (position.mapId == null) this.unresolvedZoneCount++;
    else { this.knownZoneCount++; this.mappedPositionCount++; }
    this.emit("position", position);
    await this.refreshRegisteredTags();
    if (!this.registeredTagCodes.has(position.tagCode.toUpperCase())) return false;
    if (this.queue.length >= 20000) { this.queue.shift(); this.dropped++; }
    this.queue.push(position);
    return true;
  }

  public invalidateRegisteredTagCache(): void {
    this.registrationCheckedAt = 0;
  }

  private async refreshRegisteredTags(): Promise<void> {
    if (this.now() - this.registrationCheckedAt < REGISTERED_TAG_CACHE_MS) return;
    if (this.registrationRefresh) return this.registrationRefresh;

    this.registrationRefresh = this.query("SELECT tag_code FROM tags;")
      .then((rows) => {
        this.registeredTagCodes = new Set(rows.map((row) => row.tag_code?.trim().toUpperCase()).filter((tagCode): tagCode is string => Boolean(tagCode)));
        this.lastRegistryError = null;
      })
      .catch((error) => {
        // When the tag registry is unavailable, retain the safe behavior: do not persist unknown data.
        this.lastRegistryError = error instanceof Error ? error.message : String(error);
        logger.error("tracking.registry_refresh_failed", error);
        this.registeredTagCodes = new Set();
      })
      .finally(() => {
        this.registrationCheckedAt = this.now();
        this.registrationRefresh = null;
      });

    return this.registrationRefresh;
  }

  public async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;

    this.flushing = true;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      const nullable = (value: string | null) => value === null ? "NULL" : sqlString(value);
      const values = batch.map((position) => `(${sqlString(position.tagCode)}, ${position.x}, ${position.y}, ${sqlString(position.timestamp)}::timestamptz, ${position.receivedAt ? `${sqlString(position.receivedAt)}::timestamptz` : "NULL"}, ${position.quality ?? "NULL"}, ${nullable(position.sourceZoneId ?? null)}, ${nullable(position.sourceZoneName ?? null)}, ${nullable(position.mapId ?? null)}, ${position.pdop ?? "NULL"})`).join(",\n");
      await this.query(`${schemaSql}
INSERT INTO tag_location_history (tag_code, x, y, created_at, received_at, quality, zone_id, zone_name, map_id, pdop)
VALUES ${values};`);
      this.lastPersistenceError = null;
      this.lastSuccessfulFlushAt = new Date(this.now()).toISOString();
    } catch (error) {
      this.queue.unshift(...batch);
      if (this.queue.length > 20000) { this.dropped += this.queue.length - 20000; this.queue = this.queue.slice(-20000); }
      this.lastPersistenceError = error instanceof Error ? error.message : String(error);
      logger.error("tracking.history_flush_failed", error, { batchSize: batch.length });
    } finally {
      this.flushing = false;
    }
  }

  public stop(): void {
    clearInterval(this.timer);
  }

  public status() {
    const error = this.lastPersistenceError ?? this.lastRegistryError;
    return {
      ok: error === null,
      status: error ? "degraded" : "ready",
      queueSize: this.queue.length,
      dropped: this.dropped,
      registeredTagCount: this.registeredTagCodes.size,
      flushing: this.flushing,
      lastSuccessfulFlushAt: this.lastSuccessfulFlushAt,
      mappedPositionCount: this.mappedPositionCount,
      knownZoneCount: this.knownZoneCount,
      unresolvedZoneCount: this.unresolvedZoneCount,
      nullZoneCount: this.nullZoneCount,
      error,
    } as const;
  }
}

declare global {
  var __uwbTrackingBuffer: TrackingBuffer | undefined;
}

// Keep queue, timers and listeners during HMR while installing current ingest/flush behavior.
export function installGlobalTrackingBuffer(): TrackingBuffer {
  const existing = globalThis.__uwbTrackingBuffer;
  if (existing && Object.getPrototypeOf(existing) !== TrackingBuffer.prototype) Object.setPrototypeOf(existing, TrackingBuffer.prototype);
  const buffer = existing ?? new TrackingBuffer();
  globalThis.__uwbTrackingBuffer = buffer;
  return buffer;
}

export const trackingBuffer = installGlobalTrackingBuffer();
