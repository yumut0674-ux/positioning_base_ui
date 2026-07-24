import { EventEmitter } from "node:events";
import { queryPostgres } from "./postgresClient";

export type TrackingPosition = {
  readonly tagCode: string;
  readonly x: number;
  readonly y: number;
  readonly timestamp: string;
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
  private readonly timer: ReturnType<typeof setInterval>;

  public constructor() {
    super();
    this.timer = setInterval(() => { void this.flush(); }, 5_000);
    this.timer.unref?.();
  }

  public async ingest(position: TrackingPosition): Promise<boolean> {
    this.emit("position", position);
    await this.refreshRegisteredTags();
    if (!this.registeredTagCodes.has(position.tagCode.toUpperCase())) return false;
    this.queue.push(position);
    return true;
  }

  public invalidateRegisteredTagCache(): void {
    this.registrationCheckedAt = 0;
  }

  private async refreshRegisteredTags(): Promise<void> {
    if (Date.now() - this.registrationCheckedAt < REGISTERED_TAG_CACHE_MS) return;
    if (this.registrationRefresh) return this.registrationRefresh;

    this.registrationRefresh = queryPostgres("SELECT tag_code FROM tags;")
      .then((rows) => {
        this.registeredTagCodes = new Set(rows.map((row) => row.tag_code?.trim().toUpperCase()).filter((tagCode): tagCode is string => Boolean(tagCode)));
      })
      .catch((error) => {
        // When the tag registry is unavailable, retain the safe behavior: do not persist unknown data.
        console.error("Registered tag cache refresh failed", error);
        this.registeredTagCodes = new Set();
      })
      .finally(() => {
        this.registrationCheckedAt = Date.now();
        this.registrationRefresh = null;
      });

    return this.registrationRefresh;
  }

  public async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;

    this.flushing = true;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      const values = batch.map((position) => `(${sqlString(position.tagCode)}, ${position.x}, ${position.y}, ${sqlString(position.timestamp)}::timestamptz)`).join(",\n");
      await queryPostgres(`${schemaSql}
INSERT INTO tag_location_history (tag_code, x, y, created_at)
VALUES ${values};`);
    } catch (error) {
      this.queue.unshift(...batch);
      console.error("Tracking history bulk insert failed", error);
    } finally {
      this.flushing = false;
    }
  }

  public stop(): void {
    clearInterval(this.timer);
  }
}

declare global {
  var __uwbTrackingBuffer: TrackingBuffer | undefined;
}

// Vinext/Vite can re-evaluate server modules during development. Keep one
// buffer instance so timers and listeners do not accumulate after hot reloads.
export const trackingBuffer = globalThis.__uwbTrackingBuffer ?? new TrackingBuffer();
globalThis.__uwbTrackingBuffer ??= trackingBuffer;
