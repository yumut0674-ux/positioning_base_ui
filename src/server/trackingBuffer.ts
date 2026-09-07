import { EventEmitter } from "node:events";
import { queryPostgres } from "./postgresClient";
import { logger } from "./logger";

export type TrackingPosition = {
  readonly tagCode: string;
  readonly x: number;
  readonly y: number;
  readonly timestamp: string;
  readonly receivedAt?: string;
  readonly quality?: number;
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
  private readonly timer?: ReturnType<typeof setInterval>;

  public constructor(private readonly query = queryPostgres, private readonly now: () => number = Date.now, automaticFlush = true) {
    super();
    if (automaticFlush) { this.timer = setInterval(() => { void this.flush(); }, 5_000); this.timer.unref?.(); }
  }

  public async ingest(position: TrackingPosition): Promise<boolean> {
    position = { ...position, receivedAt: new Date(this.now()).toISOString() };
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
      const values = batch.map((position) => `(${sqlString(position.tagCode)}, ${position.x}, ${position.y}, ${sqlString(position.timestamp)}::timestamptz, ${position.receivedAt ? `${sqlString(position.receivedAt)}::timestamptz` : "NULL"}, ${position.quality ?? "NULL"})`).join(",\n");
      await this.query(`${schemaSql}
INSERT INTO tag_location_history (tag_code, x, y, created_at, received_at, quality)
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
      error,
    } as const;
  }
}

declare global {
  var __uwbTrackingBuffer: TrackingBuffer | undefined;
}

// Vinext/Vite can re-evaluate server modules during development. Keep one
// buffer instance so timers and listeners do not accumulate after hot reloads.
export const trackingBuffer = globalThis.__uwbTrackingBuffer ?? new TrackingBuffer();
globalThis.__uwbTrackingBuffer ??= trackingBuffer;
