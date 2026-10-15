import { queryPostgres } from "../postgresClient";
import type { PersistedTagObservation } from "../../features/tracking/types/tagPresence.types";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const SCHEMA = `CREATE TABLE IF NOT EXISTS tag_presence_state (
  tag_code VARCHAR(100) PRIMARY KEY,
  measured_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);`;

export interface TagPresenceRepository {
  restore(): Promise<readonly PersistedTagObservation[]>;
  save(observations: readonly PersistedTagObservation[]): Promise<void>;
}

export class PostgresTagPresenceRepository implements TagPresenceRepository {
  private schemaReady?: Promise<void>;
  public constructor(private readonly query = queryPostgres) {}

  private async ensureSchema(): Promise<void> {
    this.schemaReady ??= this.query(SCHEMA).then(() => undefined).catch(error => { this.schemaReady = undefined; throw error; });
    return this.schemaReady;
  }

  public async restore(): Promise<readonly PersistedTagObservation[]> {
    await this.ensureSchema();
    const rows = await this.query(`SELECT p.payload::text FROM tag_presence_state p
      INNER JOIN tags t ON upper(t.tag_code) = p.tag_code ORDER BY p.measured_at DESC LIMIT 5000;`);
    return rows.flatMap(row => {
      try {
        const value = JSON.parse(row.payload ?? "null") as PersistedTagObservation;
        if (!value?.tagCode || value.raw?.id !== value.tagCode || !Number.isFinite(value.raw.x) || !Number.isFinite(value.raw.y)
          || !Number.isFinite(value.lastRawMeasuredAt) || !Number.isFinite(value.lastRawReceivedAt)
          || value.raw.timestamp !== value.lastRawMeasuredAt || !value.lastObservedLocation) return [];
        return [value];
      } catch { return []; }
    });
  }

  public async save(observations: readonly PersistedTagObservation[]): Promise<void> {
    if (!observations.length) return;
    await this.ensureSchema();
    // Joining the registry prevents unknown broadcasters from becoming a durable archive.
    const values = observations.map(value => `(${quote(value.tagCode)},${quote(new Date(value.lastRawMeasuredAt).toISOString())}::timestamptz,${quote(JSON.stringify(value))}::jsonb)`).join(",");
    await this.query(`INSERT INTO tag_presence_state(tag_code,measured_at,payload)
      SELECT v.tag_code,v.measured_at,v.payload FROM (VALUES ${values}) AS v(tag_code,measured_at,payload)
      WHERE EXISTS (SELECT 1 FROM tags t WHERE upper(t.tag_code) = v.tag_code)
      ON CONFLICT(tag_code) DO UPDATE SET measured_at=EXCLUDED.measured_at,payload=EXCLUDED.payload
      WHERE EXCLUDED.measured_at > tag_presence_state.measured_at;`);
  }
}
