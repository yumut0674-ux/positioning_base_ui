import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, rename, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withPostgresReadOnlySnapshot, type PgReadOnlySnapshot } from "../../src/server/postgresClient";
import { exportRange, type ExportRange } from "./input";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const EXPORT_ROOT = path.join(PROJECT_ROOT, ".data", "exports");
const TABLES = ["tag_location_history", "tag_room_decisions", "tag_area_events", "tag_area_states", "tags", "room_test_sessions", "room_test_actions"] as const;
type Table = typeof TABLES[number];
interface Column { name: string; type: string }
type Schema = Map<Table, Column[]>;
const SOURCES = [
  { table: "tag_location_history", file: "raw", time: "created_at", count: "rawCount" },
  { table: "tag_room_decisions", file: "decisions", time: "published_at", count: "decisionCount" },
  { table: "tag_area_events", file: "area-events", time: "decided_at", count: "areaEventCount" },
] as const;

export interface TagCandidate {
  tagCode: string; displayName: string | null; rawCount: number; decisionCount: number; areaEventCount: number;
  firstAt: string; lastAt: string;
}
export interface FileInfo {
  path: string; sha256: string; bytes: number; rowCount?: number; columns?: string[];
  scope?: string; windows?: { requested: number; warmup: number; observation: number };
}
export interface ArchiveManifest {
  schemaVersion: 1; kind: "uwb-benchmark-archive"; status: "complete"; archiveId: string;
  timezone: "Europe/Istanbul"; createdAt: string; completedAt: string;
  requestedRange: ExportRange; exportRange: ExportRange; interval: "[from,to)";
  warmupMs: number; observationMs: number; selectedTags: string[]; candidateTags: TagCandidate[];
  database: { snapshotAt: string; snapshot: string; isolation: "REPEATABLE READ READ ONLY" };
  tables: Record<string, Column[]>; files: FileInfo[]; mapIds: string[];
  engineVersions: { engineVersion: string | null; configVersion: string | null; mapId: string | null; records: number }[];
  rawQuality: { missingReceivedAt: number; missingPdop: number; missingCoordinates: number; timingAnomalies: number };
  git: { commit: string | null; dirty: boolean | null }; warnings: string[];
}
export interface ExportOptions {
  range: ExportRange; tags: readonly string[]; warmupMs?: number; observationMs?: number; csv?: boolean;
  batchSize?: number; timeoutMs?: number; signal?: AbortSignal; onProgress?: (message: string) => void;
}
export type SnapshotRunner = <T>(work: (client: PgReadOnlySnapshot) => Promise<T>, options?: {
  batchSize?: number; timeoutMs?: number; signal?: AbortSignal;
}) => Promise<T>;

// SET LOCAL standard_conforming_strings=on is enforced by the snapshot connection.
export function sqlLiteral(value: string): string {
  if (value.includes("\0")) throw new Error("Tag veya tarih null karakteri içeremez.");
  return `'${value.replaceAll("'", "''")}'`;
}
const identifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;
const has = (schema: Schema, table: Table, column: string): boolean => schema.get(table)?.some(field => field.name === column) ?? false;
const tagFilter = (tags: readonly string[], alias = "t"): string => `${alias}.tag_code IN (${tags.map(sqlLiteral).join(",")})`;
const timeFilter = (column: string, range: ExportRange, alias = "t"): string =>
  `${alias}.${identifier(column)} >= ${sqlLiteral(range.from)}::timestamptz AND ${alias}.${identifier(column)} < ${sqlLiteral(range.to)}::timestamptz`;

export async function inspectSchema(client: PgReadOnlySnapshot): Promise<Schema> {
  const rows = await client.query(`SELECT table_name,column_name,data_type FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name IN (${TABLES.map(sqlLiteral).join(",")}) ORDER BY table_name,ordinal_position`);
  const schema: Schema = new Map();
  for (const row of rows) {
    const table = row.table_name as Table;
    if (!TABLES.includes(table) || !row.column_name || !row.data_type) throw new Error("Veritabanı şeması okunamadı.");
    const columns = schema.get(table) ?? [];
    columns.push({ name: row.column_name, type: row.data_type });
    schema.set(table, columns);
  }
  for (const source of SOURCES) {
    if (!schema.has(source.table)) continue;
    const required = ["id", "tag_code", source.time, ...(source.table === "tag_location_history" ? ["x", "y"] : ["payload"])];
    for (const column of required) if (!has(schema, source.table, column)) throw new Error(`${source.table}: ${column} sütunu eksik. Şema güncellemelerini kontrol edin.`);
  }
  if (!SOURCES.some(source => schema.has(source.table))) throw new Error("Konum veya motor kayıt tablosu bulunamadı. Veritabanı ayarlarını kontrol edin.");
  return schema;
}

export async function candidatesInSnapshot(client: PgReadOnlySnapshot, range: ExportRange, schema: Schema): Promise<TagCandidate[]> {
  const candidates = new Map<string, TagCandidate>();
  for (const source of SOURCES) {
    if (!schema.has(source.table)) continue;
    const rows = await client.query(`SELECT tag_code,count(*)::text AS count,min(${identifier(source.time)})::text AS first_at,max(${identifier(source.time)})::text AS last_at
      FROM ${identifier(source.table)} t WHERE ${timeFilter(source.time, range)} GROUP BY tag_code ORDER BY tag_code`);
    for (const row of rows) {
      if (!row.tag_code || !row.first_at || !row.last_at) throw new Error("Tag listesinde eksik alan bulundu.");
      const candidate = candidates.get(row.tag_code) ?? { tagCode: row.tag_code, displayName: null, rawCount: 0, decisionCount: 0, areaEventCount: 0, firstAt: row.first_at, lastAt: row.last_at };
      candidate[source.count] = Number(row.count);
      if (Date.parse(row.first_at) < Date.parse(candidate.firstAt)) candidate.firstAt = row.first_at;
      if (Date.parse(row.last_at) > Date.parse(candidate.lastAt)) candidate.lastAt = row.last_at;
      candidates.set(candidate.tagCode, candidate);
    }
  }
  if (has(schema, "tags", "tag_code") && candidates.size) {
    const names = ["display_name", "tag_name"].filter(column => has(schema, "tags", column)).map(identifier);
    const rows = await client.query(`SELECT tag_code,COALESCE(${[...names, "tag_code"].join(",")}) AS display_name FROM tags WHERE tag_code IN (${[...candidates.keys()].map(sqlLiteral).join(",")})`);
    for (const row of rows) { const candidate = candidates.get(row.tag_code ?? ""); if (candidate) candidate.displayName = row.display_name; }
  }
  return [...candidates.values()].sort((a, b) => b.rawCount - a.rawCount || b.decisionCount - a.decisionCount || a.tagCode.localeCompare(b.tagCode));
}

export function listTagCandidates(range: ExportRange, run: SnapshotRunner = withPostgresReadOnlySnapshot, signal?: AbortSignal): Promise<TagCandidate[]> {
  const validated = exportRange(range.from, range.to);
  return run(async client => candidatesInSnapshot(client, validated, await inspectSchema(client)), { signal });
}

function projection(table: Table, columns: Column[]): string {
  const overrides: string[] = [];
  for (const column of columns) {
    const ref = `t.${identifier(column.name)}`;
    if (["bigint", "numeric", "decimal"].includes(column.type)) overrides.push(sqlLiteral(column.name), `${ref}::text`);
    else if (column.type === "timestamp with time zone") overrides.push(sqlLiteral(column.name), `to_char(${ref} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
  }
  if (table === "tag_location_history") {
    for (const column of ["received_at", "quality", "map_id", "zone_id", "zone_name", "pdop"]) {
      if (!columns.some(field => field.name === column)) overrides.push(sqlLiteral(column), "NULL");
    }
  }
  return `(to_jsonb(t)${overrides.length ? ` || jsonb_build_object(${overrides.join(",")})` : ""})::text AS record`;
}

export function csvCell(value: unknown): string {
  let text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Spreadsheet viewers must not execute tag names or log text as formulas.
  if (typeof value === "string" && (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^\d{15,}$/.test(text))) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

class HashedFile {
  private readonly hash = createHash("sha256");
  private bytes = 0;
  private constructor(private readonly handle: FileHandle, readonly name: string) {}
  static async create(dir: string, name: string): Promise<HashedFile> { return new HashedFile(await open(path.join(dir, name), "wx", 0o600), name); }
  async write(text: string | Buffer): Promise<void> {
    const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8");
    await this.handle.writeFile(bytes);
    this.hash.update(bytes); this.bytes += bytes.byteLength;
  }
  async finish(): Promise<FileInfo> { await this.handle.close(); return { path: this.name, bytes: this.bytes, sha256: this.hash.digest("hex") }; }
  async close(): Promise<void> { await this.handle.close(); }
}

const CAVEATS = [
  "Bu arşiv yalnız snapshot anında veritabanına kalıcı yazılmış kayıtları içerir; canlı bellek/SSE ve bekleyen disk kuyruğu dahil değildir.",
  "PDOP yüzünden elenmiş paketler, kayıtlı olmayan tagların kaybolan geçmişi ve tekrarlanan sentetik merkez yayınları veritabanında bulunmayabilir.",
  "Motor çıktıları kaydedilmiş gerçek çıktılardır; bu araç motoru yeniden çalıştırmaz. Kararlar published_at, alan olayları decided_at, ham ölçümler created_at ile filtrelenir.",
  "Harita dosyaları dışa aktarım anındaki disk kopyalarıdır; geçmişteki config_version veya çalışan motorun o anki belleğiyle eşleştiği varsayılmaz. Test payload'larındaki plan/config kayıtları ayrıca korunur.",
  "Oda doğruluğu puanlamak için bağımsız, doğrulanmış truth.json ve tag eşleşmesi gerekir; motor kararlarından gerçek rota üretilmez.",
];

export async function exportArchive(options: ExportOptions, dependencies: { run?: SnapshotRunner; outputRoot?: string; projectRoot?: string } = {}): Promise<{ directory: string; manifest: ArchiveManifest }> {
  const range = exportRange(options.range.from, options.range.to);
  const tags = [...new Set(options.tags)];
  if (!tags.length || tags.some(tag => !tag || tag.length > 100 || /[\u0000-\u001f]/.test(tag))) throw new Error("Geçerli bir tag seçimi gerekli.");
  const warmupMs = options.warmupMs ?? 30_000, observationMs = options.observationMs ?? 60_000;
  for (const duration of [warmupMs, observationMs]) if (!Number.isSafeInteger(duration) || duration < 0 || duration > 3_600_000) throw new Error("Ön/son gözlem penceresi 0–3600 saniye olmalı.");
  const window = { from: new Date(Date.parse(range.from) - warmupMs).toISOString(), to: new Date(Date.parse(range.to) + observationMs).toISOString() };
  const root = path.resolve(dependencies.outputRoot ?? EXPORT_ROOT);
  const project = path.resolve(dependencies.projectRoot ?? PROJECT_ROOT);
  const createdAt = new Date().toISOString(), archiveId = `${createdAt.replace(/[-:.]/g, "")}-${randomUUID().slice(0, 8)}`;
  const partial = path.join(root, `.partial-${archiveId}`), directory = path.join(root, archiveId);
  const files: FileInfo[] = [], warnings = [...CAVEATS], mapIds = new Set<string>();
  const versions = new Map<string, ArchiveManifest["engineVersions"][number]>();
  const rawQuality = { missingReceivedAt: 0, missingPdop: 0, missingCoordinates: 0, timingAnomalies: 0 };
  let started = false;
  const run = dependencies.run ?? withPostgresReadOnlySnapshot;
  try {
    const manifest: ArchiveManifest = await run(async client => {
      const schema = await inspectSchema(client);
      const [snapshot] = await client.query("SELECT current_timestamp::text AS snapshot_at,txid_current_snapshot()::text AS snapshot");
      if (!snapshot?.snapshot_at || !snapshot.snapshot) throw new Error("Veritabanı snapshot bilgisi alınamadı.");
      const candidates = await candidatesInSnapshot(client, range, schema);
      for (const tag of tags) if (!candidates.some(candidate => candidate.tagCode === tag)) throw new Error(`Seçilen tag için bu aralıkta kayıt kalmamış: ${tag}`);
      await mkdir(root, { recursive: true });
      await mkdir(partial, { mode: 0o700 }); started = true;

      const dump = async (table: Table, file: string, where: string, order: string, scope: string, timeColumn?: string): Promise<void> => {
        const columns = schema.get(table);
        if (!columns) { warnings.push(`${table} bulunamadı veya okuma yetkisi yok; ${file} üretilmedi.`); return; }
        const names = columns.map(column => column.name);
        if (table === "tag_location_history") for (const name of ["received_at", "quality", "map_id", "zone_id", "zone_name", "pdop"]) if (!names.includes(name)) names.push(name);
        const json = await HashedFile.create(partial, `${file}.jsonl`);
        let csv: HashedFile | undefined;
        let rowCount = 0;
        const windows = { requested: 0, warmup: 0, observation: 0 };
        try {
          if (options.csv !== false) { csv = await HashedFile.create(partial, `${file}.csv`); await csv.write(`\uFEFF${names.map(csvCell).join(";")}\r\n`); }
          await client.stream(`SELECT ${projection(table, columns)} FROM ${identifier(table)} t WHERE ${where} ORDER BY ${order}`, async row => {
            options.signal?.throwIfAborted();
            if (!row.record) throw new Error(`${table}: kayıt içeriği okunamadı.`);
            const record = JSON.parse(row.record) as Record<string, unknown>;
            await json.write(`${row.record}\n`);
            if (csv) await csv.write(`${names.map(name => csvCell(record[name])).join(";")}\r\n`);
            rowCount++;
            if (timeColumn) {
              const time = Date.parse(String(record[timeColumn]));
              if (!Number.isFinite(time)) throw new Error(`${table}: geçersiz kayıt zamanı.`);
              if (time < Date.parse(range.from)) windows.warmup++;
              else if (time >= Date.parse(range.to)) windows.observation++;
              else windows.requested++;
            }
            const payload = typeof record.payload === "object" && record.payload !== null ? record.payload as Record<string, unknown> : {};
            const map = record.map_id ?? payload.mapId;
            if (typeof map === "string" && map) mapIds.add(map);
            if (table === "tag_room_decisions") {
              const entry = { engineVersion: (record.engine_version ?? payload.engineVersion ?? null) as string | null,
                configVersion: (record.config_version ?? payload.configVersion ?? null) as string | null, mapId: typeof map === "string" ? map : null, records: 0 };
              const key = JSON.stringify([entry.engineVersion, entry.configVersion, entry.mapId]);
              const version = versions.get(key) ?? entry; version.records++; versions.set(key, version);
            }
            if (table === "tag_location_history") {
              if (record.received_at == null) rawQuality.missingReceivedAt++;
              if (record.pdop == null) rawQuality.missingPdop++;
              if (record.x == null || record.y == null) rawQuality.missingCoordinates++;
              if (record.created_at && record.received_at && Date.parse(String(record.created_at)) > Date.parse(String(record.received_at))) rawQuality.timingAnomalies++;
            }
            if (rowCount % 10_000 === 0) options.onProgress?.(`${file}: ${rowCount.toLocaleString("tr-TR")} kayıt yazıldı…`);
          });
          const extra = { rowCount, columns: names, scope, ...(timeColumn ? { windows } : {}) };
          files.push({ ...await json.finish(), ...extra });
          if (csv) files.push({ ...await csv.finish(), ...extra });
          options.onProgress?.(`${file}: ${rowCount.toLocaleString("tr-TR")} kayıt tamamlandı.`);
        } finally { await json.close(); await csv?.close(); }
      };

      for (const source of SOURCES) {
        const order = source.table === "tag_location_history" && has(schema, source.table, "received_at")
          ? "COALESCE(t.received_at,t.created_at),t.id" : `t.${identifier(source.time)},t.id`;
        await dump(source.table, source.file, `${tagFilter(tags)} AND ${timeFilter(source.time, window)}`, order, "requested-and-context", source.time);
      }
      if (schema.has("tag_room_decisions")) {
        await dump("tag_room_decisions", "decision-seeds", `t.id IN (SELECT DISTINCT ON (tag_code) id FROM tag_room_decisions
          WHERE ${tagFilter(tags, "tag_room_decisions")} AND published_at < ${sqlLiteral(window.from)}::timestamptz ORDER BY tag_code,published_at DESC,id DESC)`, "t.tag_code,t.published_at,t.id", "last-decision-before-export-window");
      }
      if (has(schema, "tag_area_events", "map_id") && has(schema, "tag_area_events", "area_id")) {
        await dump("tag_area_events", "area-event-seeds", `t.id IN (SELECT DISTINCT ON (tag_code,map_id,area_id) id FROM tag_area_events
          WHERE ${tagFilter(tags, "tag_area_events")} AND decided_at < ${sqlLiteral(window.from)}::timestamptz ORDER BY tag_code,map_id,area_id,decided_at DESC,id DESC)`, "t.tag_code,t.map_id,t.area_id,t.decided_at,t.id", "last-event-per-area-before-export-window");
      }
      if (has(schema, "tag_area_states", "tag_code") && has(schema, "tag_area_states", "map_id") && has(schema, "tag_area_states", "area_id")) {
        await dump("tag_area_states", "area-state-current", tagFilter(tags), "t.tag_code,t.map_id,t.area_id", "current-at-database-snapshot-not-historical");
      }
      if (has(schema, "tags", "tag_code")) await dump("tags", "tags-current", tagFilter(tags), "t.tag_code", "current-at-database-snapshot-not-historical");
      if (has(schema, "room_test_sessions", "payload") && has(schema, "room_test_sessions", "id")) {
        // Preserve recorded labels/config snapshots; never infer truth from engine decisions.
        const tagArray = `ARRAY[${tags.map(tag => sqlLiteral(tag.toUpperCase())).join(",")}]::text[]`;
        const matching = `(EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(t.payload->'tagCodes','[]'::jsonb)) tag WHERE upper(tag.value)=ANY(${tagArray}))
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(t.payload->'events','[]'::jsonb)) event,
            LATERAL jsonb_array_elements_text(COALESCE(event->'tagCodes','[]'::jsonb)) tag WHERE upper(tag.value)=ANY(${tagArray})))
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(t.payload->'events','[]'::jsonb)) event WHERE (event->>'at')::timestamptz < ${sqlLiteral(window.to)}::timestamptz)
          AND (NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(t.payload->'events','[]'::jsonb)) event WHERE event->>'type'='complete')
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(t.payload->'events','[]'::jsonb)) event WHERE (event->>'at')::timestamptz >= ${sqlLiteral(window.from)}::timestamptz))`;
        await dump("room_test_sessions", "room-tests", matching, "t.id", "overlapping-recorded-tests-for-selected-tags");
        if (has(schema, "room_test_actions", "session_id") && has(schema, "room_test_actions", "sequence")) {
          await dump("room_test_actions", "room-test-actions", `t.session_id IN (SELECT s.id FROM room_test_sessions s WHERE ${matching.replaceAll("t.payload", "s.payload")})`, "t.session_id,t.sequence", "all-actions-of-exported-tests");
        }
      }
      if (!files.find(file => file.path === "raw.jsonl")?.rowCount) warnings.push("Seçili tagların ham konum kaydı yok; motor kayıtları tek başına ham veri replay'i için yeterli değildir.");
      if (rawQuality.missingReceivedAt) warnings.push(`${rawQuality.missingReceivedAt} ham kayıtta received_at eksik; motor teslim zamanlaması yaklaşık olacaktır.`);
      return { schemaVersion: 1, kind: "uwb-benchmark-archive", status: "complete", archiveId, timezone: "Europe/Istanbul", createdAt, completedAt: "",
        requestedRange: range, exportRange: window, interval: "[from,to)", warmupMs, observationMs, selectedTags: tags, candidateTags: candidates,
        database: { snapshotAt: snapshot.snapshot_at, snapshot: snapshot.snapshot, isolation: "REPEATABLE READ READ ONLY" },
        tables: Object.fromEntries(schema), files, mapIds: [...mapIds].sort(), engineVersions: [...versions.values()], rawQuality,
        git: { commit: null, dirty: null }, warnings } satisfies ArchiveManifest;
    }, { batchSize: options.batchSize, timeoutMs: options.timeoutMs, signal: options.signal });

    // Disk snapshots have their own provenance; they cannot be called historical engine settings.
    const snapshotFile = async (relative: string): Promise<void> => {
      const source = path.resolve(project, relative);
      if (!source.startsWith(`${project}${path.sep}`)) { warnings.push(`Config yolu proje dışında: ${relative}`); return; }
      let bytes: Buffer;
      try { bytes = await readFile(source); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; warnings.push(`Disk snapshot dosyası bulunamadı: ${relative}`); return; }
      const name = `config-current/${relative.replaceAll(path.sep, "/")}`;
      await mkdir(path.dirname(path.join(partial, name)), { recursive: true });
      const output = await HashedFile.create(partial, name);
      try { await output.write(bytes); files.push({ ...await output.finish(), scope: "current-on-disk-not-historical" }); } finally { await output.close(); }
    };
    await snapshotFile("config/maps/catalog.json");
    for (const map of manifest.mapIds) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(map)) { warnings.push(`Harita kimliği disk yolu olarak kullanılamadı: ${map}`); continue; }
      for (const name of ["regions.json", "map.json", "tracking-filter.json"]) await snapshotFile(`config/maps/${map}/${name}`);
    }
    const sourceHashes: Record<string, string> = {};
    for (const name of ["RegionPositionEngine.ts", "StepDistanceFilter.ts", "AreaTransitionEngine.ts", "configLoader.ts", "geometry.ts"]) {
      const source = `src/server/regionEngine/${name}`;
      sourceHashes[source] = createHash("sha256").update(await readFile(path.join(project, source))).digest("hex");
    }
    const provenance = await HashedFile.create(partial, "source-fingerprints.json");
    try { await provenance.write(JSON.stringify({ scope: "current-on-disk-not-historical", sourceHashes }, null, 2) + "\n"); files.push(await provenance.finish()); } finally { await provenance.close(); }
    try {
      manifest.git.commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      manifest.git.dirty = !!execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch { warnings.push("Git commit bilgisi alınamadı."); }
    options.signal?.throwIfAborted();
    manifest.completedAt = new Date().toISOString();
    await writeFile(path.join(partial, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(partial, directory);
    return { directory, manifest };
  } catch (error) {
    if (started) {
      await writeFile(path.join(partial, "incomplete.json"), JSON.stringify({ status: "incomplete", archiveId, createdAt, requestedRange: range, selectedTags: tags,
        reason: error instanceof Error ? error.message : String(error) }, null, 2) + "\n", { mode: 0o600 }).catch(() => undefined);
      options.onProgress?.(`İşlem tamamlanmadı. Kısmi dosyalar: ${partial}`);
    }
    throw error;
  }
}
