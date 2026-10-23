import { readFile } from "node:fs/promises";
import path from "node:path";
import { queryPostgres, type PgRow } from "../postgresClient";
import { istanbulDate, shiftDate, type AssistantCounts, type AssistantRequestFilters, type AssistantRequestPage, type AssistantRequestRecord, type AssistantSettings, type AssistantSummary } from "../../features/assistantAdmin/types/assistantAdmin.types";

// Hex-encoded text avoids both SQL interpolation and backslash/string-mode ambiguity.
const textSql = (value: string) => `convert_from(decode('${Buffer.from(value, "utf8").toString("hex")}','hex'),'UTF8')`;
const nullableSql = (value: string | null | undefined) => value == null ? "NULL" : textSql(value);
const requestFields = `id, session_key AS "sessionKey", created_at AS "createdAt", completed_at AS "completedAt", duration_ms AS "durationMs", question, answer, status, provider, model, mode, error_code AS "errorCode", error_summary AS "errorSummary", upstream_status AS "upstreamStatus", provider_attempted AS "providerAttempted"`;
const settingsFields = `enabled, version, updated_at AS "updatedAt", updated_by AS "updatedBy", recording_started_at AS "recordingStartedAt"`;
const aggregateFields = `count(*)::int AS total, count(*) FILTER (WHERE status='success')::int AS success, count(*) FILTER (WHERE status='error')::int AS error, count(*) FILTER (WHERE status='disabled')::int AS disabled, count(*) FILTER (WHERE status='pending')::int AS pending, count(*) FILTER (WHERE status='interrupted')::int AS interrupted`;
const jsonRow = <T>(row: PgRow | undefined): T => {
  if (!row?.payload) throw new Error("Assistant database response is empty");
  return JSON.parse(row.payload) as T;
};
const emptyCounts = (): AssistantCounts => ({ total: 0, success: 0, error: 0, disabled: 0, pending: 0, interrupted: 0 });
export const dayStartSql = (date: string) => `${textSql(`${date}T00:00:00+03:00`)}::timestamptz`;

export class AssistantAdminError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "ADMIN_REQUEST_INVALID") { super(message); }
}
export interface BeginAssistantRequest { id: string; sessionKey: string; question: string; mode?: "live" | "history"; }
export interface FinishAssistantRequest {
  status: AssistantRequestRecord["status"];
  answer: string;
  durationMs: number;
  provider?: AssistantRequestRecord["provider"];
  model?: string;
  errorCode?: string;
  errorSummary?: string;
  upstreamStatus?: number;
}

export class AssistantManagementRepository {
  private initialized: Promise<void> | null = null;
  constructor(private readonly query: (sql: string) => Promise<PgRow[]> = sql => queryPostgres(sql, { timeoutMs: 5_000 })) {}

  async ready(): Promise<void> {
    this.initialized ??= readFile(path.join(process.cwd(), "drizzle/0009_assistant_management.sql"), "utf8")
      .then(sql => this.query(sql)).then(() => undefined)
      .catch(error => { this.initialized = null; throw error; });
    await this.initialized;
  }
  async settings(): Promise<AssistantSettings> {
    await this.ready();
    const rows = await this.query(`SELECT row_to_json(s)::text AS payload FROM (SELECT ${settingsFields} FROM assistant_settings WHERE id=1) s;`);
    return jsonRow<AssistantSettings>(rows[0]);
  }
  async updateSettings(enabled: boolean, version: number, admin: string): Promise<AssistantSettings> {
    await this.ready();
    const rows = await this.query(`WITH previous AS (
      SELECT enabled,version FROM assistant_settings WHERE id=1 FOR UPDATE
    ), changed AS (
      UPDATE assistant_settings s SET enabled=${enabled},version=s.version+1,updated_at=NOW(),updated_by=${textSql(admin)}
      FROM previous p WHERE s.id=1 AND p.version=${version} AND s.version=p.version
      RETURNING s.*,p.enabled AS old_enabled
    ), audit AS (
      INSERT INTO assistant_setting_events(old_enabled,new_enabled,version,changed_by)
      SELECT old_enabled,enabled,version,updated_by FROM changed RETURNING id
    ) SELECT row_to_json(s)::text AS payload FROM (SELECT ${settingsFields} FROM changed WHERE EXISTS(SELECT 1 FROM audit)) s;`);
    if (!rows.length) throw new AssistantAdminError("Ayar başka bir oturumda değişti. Güncel değeri yükleyip tekrar deneyin.", 409, "SETTINGS_CONFLICT");
    return jsonRow<AssistantSettings>(rows[0]);
  }
  async begin(input: BeginAssistantRequest): Promise<void> {
    await this.ready();
    await this.query(`INSERT INTO assistant_requests(id,session_key,question,mode) VALUES (${textSql(input.id)}::uuid,${textSql(input.sessionKey)},${textSql(input.question)},${nullableSql(input.mode)});`);
  }
  async markAttempt(id: string, provider: "local" | "gemini"): Promise<void> {
    await this.query(`UPDATE assistant_requests SET provider=${textSql(provider)},provider_attempted=${provider === "gemini"} WHERE id=${textSql(id)}::uuid AND status='pending';`);
  }
  async finish(id: string, result: FinishAssistantRequest): Promise<void> {
    const rows = await this.query(`UPDATE assistant_requests SET status=${textSql(result.status)},answer=${textSql(result.answer)},completed_at=NOW(),duration_ms=${Math.min(2147483647, Math.max(0, Math.round(result.durationMs)))},provider=COALESCE(${nullableSql(result.provider)},provider),model=${nullableSql(result.model)},error_code=${nullableSql(result.errorCode)},error_summary=${nullableSql(result.errorSummary)},upstream_status=${result.upstreamStatus ?? "NULL"} WHERE id=${textSql(id)}::uuid AND status='pending' RETURNING id;`);
    if (!rows.length) throw new Error("Assistant request could not be completed");
  }
  private async recoverInterrupted(): Promise<void> {
    await this.ready();
    await this.query(`UPDATE assistant_requests SET status='interrupted',completed_at=NOW(),error_code='REQUEST_INTERRUPTED',error_summary='İstek süre sınırı içinde tamamlanmadı.' WHERE status='pending' AND created_at < NOW()-INTERVAL '2 minutes';`);
  }
  async detail(id: string): Promise<AssistantRequestRecord> {
    await this.recoverInterrupted();
    const rows = await this.query(`SELECT row_to_json(r)::text AS payload FROM (SELECT ${requestFields} FROM assistant_requests WHERE id=${textSql(id)}::uuid) r;`);
    if (!rows.length) throw new AssistantAdminError("Soru kaydı bulunamadı.", 404, "REQUEST_NOT_FOUND");
    return jsonRow<AssistantRequestRecord>(rows[0]);
  }
  async list(filters: AssistantRequestFilters): Promise<AssistantRequestPage> {
    await this.recoverInterrupted();
    const where = [
      `created_at >= ${dayStartSql(filters.from)}`,
      `created_at < ${dayStartSql(shiftDate(filters.to, 1))}`,
    ];
    if (filters.status) where.push(`status=${textSql(filters.status)}`);
    if (filters.provider) where.push(`provider=${textSql(filters.provider)}`);
    // Literal substring search: %, _ and quotes in the user's query are not SQL patterns.
    if (filters.search) where.push(`strpos(lower(question),lower(${textSql(filters.search)})) > 0`);
    const pageSize = 25;
    const rows = await this.query(`WITH filtered AS (SELECT * FROM assistant_requests WHERE ${where.join(" AND ")}), items AS (
      SELECT id,session_key AS "sessionKey",created_at AS "createdAt",completed_at AS "completedAt",duration_ms AS "durationMs",left(question,180) AS question,status,provider,model,mode,error_code AS "errorCode",upstream_status AS "upstreamStatus",provider_attempted AS "providerAttempted"
      FROM filtered ORDER BY created_at DESC,id DESC LIMIT ${pageSize} OFFSET ${(filters.page - 1) * pageSize}
    ) SELECT json_build_object('items',COALESCE((SELECT json_agg(items) FROM items),'[]'::json),'total',(SELECT count(*)::int FROM filtered),'page',${filters.page},'pageSize',${pageSize})::text AS payload;`);
    return jsonRow<AssistantRequestPage>(rows[0]);
  }
  async summary(from: string, to: string, now = new Date()): Promise<AssistantSummary> {
    await this.recoverInterrupted();
    const today = istanbulDate(now);
    const rows = await this.query(`WITH selected AS (SELECT * FROM assistant_requests WHERE created_at >= ${dayStartSql(from)} AND created_at < ${dayStartSql(shiftDate(to, 1))}), daily AS (
      SELECT to_char(created_at AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD') AS date,${aggregateFields} FROM selected GROUP BY 1
    ), totals AS (SELECT ${aggregateFields} FROM selected), today AS (
      SELECT ${aggregateFields} FROM assistant_requests WHERE created_at >= ${dayStartSql(today)} AND created_at < ${dayStartSql(shiftDate(today, 1))}
    ) SELECT json_build_object('today',(SELECT row_to_json(today) FROM today),'totals',(SELECT row_to_json(totals) FROM totals),'days',COALESCE((SELECT json_agg(daily ORDER BY date) FROM daily),'[]'::json))::text AS payload;`);
    const data = jsonRow<Omit<AssistantSummary, "from" | "to">>(rows[0]);
    const byDate = new Map(data.days.map(day => [day.date, day]));
    const days: AssistantSummary["days"] = [];
    for (let date = from; date <= to; date = shiftDate(date, 1)) days.push(byDate.get(date) ?? { date, ...emptyCounts() });
    return { ...data, days, from, to };
  }
}
export const assistantManagementRepository = new AssistantManagementRepository();
