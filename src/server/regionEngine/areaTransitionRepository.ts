import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { queryPostgres } from "../postgresClient";
import { logger } from "../logger";
import type { AreaMembershipState, AreaTransitionEvent } from "./AreaTransitionEngine";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const fileKey = (value: string) => createHash("sha256").update(value).digest("hex") + ".json";
const stateKey = (state: AreaMembershipState) => [state.tagCode, state.mapId, state.areaId].join("\u0000");
const DEFAULT_BATCH_SIZE = 50;

interface RepositoryOptions { readonly spoolDir?: string; readonly batchSize?: number; readonly automaticFlush?: boolean; readonly maxPendingEvents?: number; readonly maxPendingStates?: number }
interface PendingEvent { readonly event: AreaTransitionEvent; readonly state?: AreaMembershipState }
export class AreaTransitionPersistenceError extends Error {
  public constructor(message: string) { super(message); this.name = "AreaTransitionPersistenceError"; }
}

/** Files are the durable backlog. A flush loads at most one bounded batch; state files coalesce by tag/map/area. */
export class AreaTransitionRepository {
  private flushing: Promise<void> | null = null;
  private readonly timer: ReturnType<typeof setInterval> | null;
  private readonly eventDir: string;
  private readonly stateDir: string;
  private readonly batchSize: number;
  private readonly maxPendingEvents: number;
  private readonly maxPendingStates: number;
  private lastError: string | null = null;
  private coalescedStateWrites = 0;
  private rejectedWrites = 0;

  public constructor(private readonly query = queryPostgres, options: RepositoryOptions = {}) {
    const root = options.spoolDir || process.env.AREA_TRANSITION_SPOOL_DIR || path.join(process.cwd(), ".data", "area-transitions");
    this.eventDir = path.join(root, "events"); this.stateDir = path.join(root, "states");
    mkdirSync(this.eventDir, { recursive: true }); mkdirSync(this.stateDir, { recursive: true });
    this.batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, 100));
    this.maxPendingEvents = Math.max(1, options.maxPendingEvents ?? 20_000);
    this.maxPendingStates = Math.max(1, options.maxPendingStates ?? 20_000);
    this.timer = options.automaticFlush === false ? null : setInterval(() => void this.flush(), 2000);
    this.timer?.unref?.();
  }

  public stop(): void { if (this.timer) clearInterval(this.timer); }
  private files(dir: string): string[] { return readdirSync(dir).filter(file => file.endsWith(".json")).sort(); }
  private writeAtomic(file: string, value: unknown): void {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, JSON.stringify(value)); renameSync(temporary, file); }
    catch (error) { try { unlinkSync(temporary); } catch { /* Nothing to remove. */ } throw error; }
  }

  public saveState(state: AreaMembershipState): void {
    const file = path.join(this.stateDir, fileKey(stateKey(state)));
    try {
      if (existsSync(file)) {
        this.coalescedStateWrites++;
        const queued = JSON.parse(readFileSync(file, "utf8")) as AreaMembershipState;
        if ((queued.revision ?? 0) > (state.revision ?? 0) ||
          ((queued.revision ?? 0) === (state.revision ?? 0) && queued.lastAt > state.lastAt)) return;
      } else if (this.files(this.stateDir).length >= this.maxPendingStates) throw new Error("Alan durum diski kuyruğu dolu; yeni durum kalıcı yazılamadı");
      this.writeAtomic(file, state);
    } catch (error) { this.rejectedWrites++; this.fail("state_spool_failed", error); throw new AreaTransitionPersistenceError(this.lastError ?? "Alan durumu kalıcı yazılamadı"); }
  }

  public saveEvent(event: AreaTransitionEvent, state?: AreaMembershipState): void {
    const file = path.join(this.eventDir, fileKey(event.id));
    if (existsSync(file)) return;
    try {
      this.ensureEventCapacity(1);
      this.writeAtomic(file, { event, state } satisfies PendingEvent);
    } catch (error) {
      if (error instanceof AreaTransitionPersistenceError) throw error;
      this.rejectedWrites++; this.fail("event_spool_failed", error); throw new AreaTransitionPersistenceError(this.lastError ?? "Alan olayı kalıcı yazılamadı");
    }
  }

  public ensureEventCapacity(count: number): void {
    if (this.files(this.eventDir).length + count <= this.maxPendingEvents) return;
    const error = new AreaTransitionPersistenceError("Alan olay diski kuyruğu dolu; yeni geçiş kalıcı yazılamadı");
    this.rejectedWrites++; this.fail("event_spool_failed", error); throw error;
  }

  private fail(code: string, error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    logger.error(`area_transition.${code}`, error, { ...this.status() });
  }

  private stateSql(state: AreaMembershipState): string {
    const revision = Math.max(0, state.revision ?? 0);
    return `INSERT INTO tag_area_states(tag_code,map_id,area_id,state,revision) VALUES (${quote(state.tagCode)},${quote(state.mapId)},${quote(state.areaId)},${quote(JSON.stringify(state))}::jsonb,${revision}) ON CONFLICT(tag_code,map_id,area_id) DO UPDATE SET state=EXCLUDED.state,revision=EXCLUDED.revision,updated_at=NOW() WHERE tag_area_states.revision <= EXCLUDED.revision`;
  }

  private eventSql(event: AreaTransitionEvent): string {
    return `INSERT INTO tag_area_events(id,tag_code,map_id,area_id,area_name,gate_id,event_type,observed,last_measured_at,decided_at,reason,config_version,transition_id,payload) VALUES (${quote(event.id)},${quote(event.tagCode)},${quote(event.mapId)},${quote(event.areaId)},${quote(event.areaName)},${event.gateId ? quote(event.gateId) : "NULL"},${quote(event.type)},${event.observed},${quote(event.lastMeasuredAt)}::timestamptz,${quote(event.decidedAt)}::timestamptz,${quote(event.reason)},${quote(event.configVersion)},${event.transitionId ? quote(event.transitionId) : "NULL"},${quote(JSON.stringify(event))}::jsonb) ON CONFLICT(id) DO NOTHING`;
  }

  public flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      try {
        while (true) {
          const eventFiles = this.files(this.eventDir).slice(0, this.batchSize);
          if (eventFiles.length) {
            const entries = eventFiles.map(file => JSON.parse(readFileSync(path.join(this.eventDir, file), "utf8")) as PendingEvent);
            const sql = entries.flatMap(({ event, state }) => [this.eventSql(event), ...(state ? [this.stateSql(state)] : [])]);
            await this.query(`BEGIN;\n${sql.join(";\n")};\nCOMMIT;`);
            for (const file of eventFiles) unlinkSync(path.join(this.eventDir, file));
            this.lastError = null;
            continue;
          }
          const stateFiles = this.files(this.stateDir).slice(0, this.batchSize);
          if (!stateFiles.length) break;
          const entries = stateFiles.map(file => ({ file, content: readFileSync(path.join(this.stateDir, file), "utf8") }));
          await this.query(`BEGIN;\n${entries.map(({ content }) => this.stateSql(JSON.parse(content) as AreaMembershipState)).join(";\n")};\nCOMMIT;`);
          for (const { file, content } of entries) {
            const target = path.join(this.stateDir, file);
            if (existsSync(target) && readFileSync(target, "utf8") === content) unlinkSync(target);
          }
          this.lastError = null;
        }
      } catch (error) { this.fail("persistence_failed", error); }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  public async restore(): Promise<AreaMembershipState[]> {
    await this.query(await readFile(path.join(process.cwd(), "drizzle", "0006_area_transitions.sql"), "utf8"));
    await this.query(await readFile(path.join(process.cwd(), "drizzle", "0007_area_transition_state_revision.sql"), "utf8"));
    await this.flush();
    if (this.lastError) throw new Error(`Alan olay kuyruğu işlenemedi: ${this.lastError}`);
    const rows = await this.query("SELECT state::text AS state FROM tag_area_states");
    return rows.map(row => JSON.parse(row.state!) as AreaMembershipState);
  }

  public status() {
    const queuedEvents = this.files(this.eventDir).length, queuedStates = this.files(this.stateDir).length;
    return { pendingWrites: queuedEvents + queuedStates, queuedEvents, queuedStates, batchSize: this.batchSize,
      maxPendingEvents: this.maxPendingEvents, maxPendingStates: this.maxPendingStates, coalescedStateWrites: this.coalescedStateWrites,
      droppedRecords: 0, rejectedWrites: this.rejectedWrites, error: this.lastError };
  }

  public async list(filters: { tagCode?: string; mapId?: string; areaId?: string; type?: string; from?: string; to?: string; limit?: number }): Promise<AreaTransitionEvent[]> {
    const clauses = [filters.tagCode ? `tag_code ILIKE ${quote(`%${filters.tagCode}%`)}` : null,
      filters.mapId ? `map_id=${quote(filters.mapId)}` : null, filters.areaId ? `area_id=${quote(filters.areaId)}` : null,
      filters.type ? `event_type=${quote(filters.type)}` : null,
      filters.from ? `decided_at>=${quote(filters.from)}::timestamptz` : null,
      filters.to ? `decided_at<=${quote(filters.to)}::timestamptz` : null].filter(Boolean);
    const rows = await this.query(`SELECT payload::text AS payload FROM tag_area_events ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY decided_at DESC,id DESC LIMIT ${Math.min(Math.max(filters.limit ?? 100, 1), 500)}`);
    return rows.map(row => JSON.parse(row.payload!) as AreaTransitionEvent);
  }
}
export const areaTransitions = new AreaTransitionRepository();
