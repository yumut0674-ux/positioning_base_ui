import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { queryPostgres } from "../postgresClient";
import { applyAction, createSession, projectSession, seedSchema, TestError, type SessionSeed, type TestAction, type TestSession } from "@/src/features/roomTests/services/roomTestModel";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
export const hashPlan = (plan: SessionSeed["plan"]) => createHash("sha256").update(JSON.stringify(plan)).digest("hex");

export class RoomTestRepository {
  private initialized: Promise<void> | null = null;
  constructor(private readonly query = queryPostgres) {}
  private async ready() {
    this.initialized ??= readFile(path.join(process.cwd(), "drizzle/0008_room_test_sessions.sql"), "utf8")
      .then(sql => this.query(sql)).then(() => undefined).catch(error => { this.initialized = null; throw error; });
    await this.initialized;
  }
  async get(id: string): Promise<TestSession> {
    await this.ready();
    const [row] = await this.query(`SELECT payload::text FROM room_test_sessions WHERE id=${quote(id)};`);
    if (!row?.payload) throw new TestError("Test kaydı bulunamadı.", 404);
    return JSON.parse(row.payload) as TestSession;
  }
  async create(input: SessionSeed): Promise<TestSession> {
    await this.ready();
    const seed = seedSchema.parse(input), session = createSession(seed, hashPlan(seed.plan));
    const [row] = await this.query(`INSERT INTO room_test_sessions(id,payload) VALUES (${quote(seed.id)},${quote(JSON.stringify(session))}::jsonb) ON CONFLICT(id) DO NOTHING RETURNING payload::text;`);
    if (row?.payload) return JSON.parse(row.payload) as TestSession;
    const existing = await this.get(seed.id);
    const existingSeed = seedSchema.parse(existing);
    if (JSON.stringify(existingSeed) !== JSON.stringify(seed)) throw new TestError("Bu test kimliği başka bir kayıt için kullanılıyor.", 409);
    return existing;
  }
  async act(id: string, action: TestAction, expectedVersion: number): Promise<TestSession> {
    const current = await this.get(id);
    // Retry after a lost response is safe even when the caller's version is old.
    if (current.events.some(event => event.id === action.id)) return applyAction(current, action);
    if (current.version !== expectedVersion) throw new TestError("Test başka bir sekmede değişti. Yerel kaydı yedekleyip sunucudan yeniden yükleyin.", 409);
    const next = applyAction(current, action, new Date().toISOString()), event = next.events.at(-1)!;
    const [row] = await this.query(`WITH changed AS (
      UPDATE room_test_sessions SET payload=${quote(JSON.stringify(next))}::jsonb,version=${next.version},updated_at=NOW()
      WHERE id=${quote(id)} AND version=${expectedVersion} RETURNING id,payload
    ), audited AS (
      INSERT INTO room_test_actions(session_id,action_id,sequence,payload)
      SELECT id,${quote(event.id)}::uuid,${event.sequence},${quote(JSON.stringify(event))}::jsonb FROM changed RETURNING action_id
    ) SELECT payload::text FROM changed WHERE EXISTS(SELECT 1 FROM audited);`);
    if (row?.payload) return JSON.parse(row.payload) as TestSession;
    const latest = await this.get(id);
    if (latest.events.some(event => event.id === action.id)) return applyAction(latest, action);
    throw new TestError("Eşzamanlı bir değişiklik var. Yerel kayıt korunuyor; sunucudan yeniden yükleyin.", 409);
  }
  async list(offset = 0, search = "") {
    await this.ready();
    const tags = `COALESCE((SELECT event->'tagCodes' FROM jsonb_array_elements(payload->'events') WITH ORDINALITY AS history(event,position)
      WHERE event->>'type'='tags' ORDER BY position DESC LIMIT 1),payload->'tagCodes')`;
    const where = search ? `WHERE payload->>'name' ILIKE ${quote(`%${search}%`)} OR ${tags}::text ILIKE ${quote(`%${search}%`)}` : "";
    const rows = await this.query(`SELECT payload::text FROM room_test_sessions ${where} ORDER BY updated_at DESC,id DESC LIMIT 31 OFFSET ${offset};`);
    return { items: rows.slice(0, 30).map(row => {
      const session = JSON.parse(row.payload!) as TestSession, state = projectSession(session);
      return { id: session.id, name: session.name, createdAt: session.createdAt, status: state.status,
        tagCodes: state.tagCodes, visits: state.visits.length, version: session.version };
    }), nextOffset: rows.length > 30 ? offset + 30 : null };
  }
}
export const roomTestRepository = new RoomTestRepository();
