import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { exportArchive, listTagCandidates, PROJECT_ROOT, type SnapshotRunner } from "./exporter";
import { buildArchiveDataset } from "../room-benchmark/importArchive";
import type { Truth } from "../room-benchmark/model";

const origin = Date.parse("2026-10-13T09:00:00Z"), at = (seconds: number) => new Date(origin + seconds * 1000).toISOString();
const range = { from: at(0), to: at(2) };
type RecordValue = Record<string, unknown>;
const raw = (id: string, seconds: number): RecordValue => ({
  id, tag_code: "T", x: 1.125, y: 2.25, created_at: at(seconds), received_at: at(seconds), quality: null,
  pdop: null, map_id: "spor-koridor", zone_id: null, zone_name: null, future_detail: { antenna: [1, 2] },
});
function fixture(fail = false, legacy = false): { run: SnapshotRunner; statements: string[] } {
  const statements: string[] = [];
  const data: Record<string, RecordValue[]> = {
    tag_location_history: [raw("9223372036854775800", -31), raw("9223372036854775801", -1), raw("9223372036854775802", 0), raw("9223372036854775803", 1), raw("9223372036854775804", 2), raw("9223372036854775805", 62)],
    tag_room_decisions: [
      { id: "100", tag_code: "T", measured_at: at(0), published_at: at(0), engine_version: "engine-v", config_version: "config-v", payload: { decisionTrace: { evidence: { complete: [1, 2, 3] } }, rawPosition: { x: 1.125, y: 2.25 }, mapId: "spor-koridor" } },
      { id: "101", tag_code: "ONLY-MOTOR", measured_at: at(1), published_at: at(1), engine_version: "engine-v", config_version: "config-v", payload: {} },
    ],
    tag_area_events: [],
  };
  const tableColumns: Record<string, [string, string][]> = {
    tag_location_history: [["id", "bigint"], ["tag_code", "character varying"], ["x", "double precision"], ["y", "double precision"], ["created_at", "timestamp with time zone"],
      ...(legacy ? [] : [["received_at", "timestamp with time zone"], ["pdop", "double precision"]] as [string, string][]), ["future_detail", "jsonb"]],
    ...(legacy ? {} : {
      tag_room_decisions: [["id", "bigint"], ["tag_code", "character varying"], ["measured_at", "timestamp with time zone"], ["published_at", "timestamp with time zone"], ["engine_version", "text"], ["config_version", "text"], ["payload", "jsonb"]] as [string, string][],
      tag_area_events: [["id", "text"], ["tag_code", "text"], ["decided_at", "timestamp with time zone"], ["payload", "jsonb"]] as [string, string][],
    }),
  };
  const timeColumn = (table: string) => table === "tag_location_history" ? "created_at" : table === "tag_room_decisions" ? "published_at" : "decided_at";
  const limits = (sql: string) => [...sql.matchAll(/'([^']+)'::timestamptz/g)].map(match => Date.parse(match[1]));
  const run: SnapshotRunner = async work => work({
    query: async sql => {
      statements.push(sql);
      if (sql.includes("information_schema.columns")) return Object.entries(tableColumns).flatMap(([table_name, columns]) => columns.map(([column_name, data_type]) => ({ table_name, column_name, data_type })));
      if (sql.includes("txid_current_snapshot")) return [{ snapshot_at: at(100), snapshot: "1:2:" }];
      const table = /FROM "([^"]+)" t/.exec(sql)?.[1];
      if (sql.includes("GROUP BY tag_code") && table) {
        const [from, to] = limits(sql), groups = new Map<string, RecordValue[]>();
        for (const row of data[table]) {
          const time = Date.parse(String(row[timeColumn(table)]));
          if (time >= from && time < to) { const tag = String(row.tag_code), rows = groups.get(tag) ?? []; rows.push(row); groups.set(tag, rows); }
        }
        return [...groups].map(([tag_code, rows]) => ({ tag_code, count: String(rows.length), first_at: String(rows[0][timeColumn(table)]), last_at: String(rows.at(-1)![timeColumn(table)]) }));
      }
      throw new Error("Unexpected fixture query: " + sql);
    },
    stream: async (sql, onRow) => {
      statements.push(sql);
      const table = /FROM "([^"]+)" t/.exec(sql)![1], [from, to] = limits(sql);
      let rows = data[table].filter(row => row.tag_code === "T");
      rows = sql.includes("t.id IN")
        ? rows.filter(row => Date.parse(String(row[timeColumn(table)])) < from).slice(-1)
        : rows.filter(row => Date.parse(String(row[timeColumn(table)])) >= from && Date.parse(String(row[timeColumn(table)])) < to);
      for (const [index, row] of rows.entries()) { if (fail && index === 1) throw new Error("fixture disk failure"); await onRow({ record: JSON.stringify(row) }); }
    },
  });
  return { run, statements };
}

async function temporaryArchive(work: (outputRoot: string) => Promise<void>): Promise<void> {
  const parent = path.join(PROJECT_ROOT, ".data", "export-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "fixture-"));
  try { await work(root); }
  finally {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("fixture-"));
    await rm(root, { recursive: true, force: true });
  }
}

test("candidate list includes retired tags and motor-only tags using the requested interval", async () => {
  const { run } = fixture();
  const candidates = await listTagCandidates(range, run);
  assert.deepEqual(candidates.map(candidate => [candidate.tagCode, candidate.rawCount, candidate.decisionCount]), [["T", 2, 1], ["ONLY-MOTOR", 0, 1]]);
  assert.equal(candidates[0].displayName, null);
});

test("archive keeps exact bounds, context rows, bigint IDs and complete motor payloads; every file hash matches", async () => {
  await temporaryArchive(async outputRoot => {
    const { run, statements } = fixture();
    const result = await exportArchive({ range, tags: ["T"] }, { run, outputRoot });
    const rawFile = result.manifest.files.find(file => file.path === "raw.jsonl")!;
    assert.equal(rawFile.rowCount, 4);
    assert.deepEqual(rawFile.windows, { requested: 2, warmup: 1, observation: 1 });
    const rows = (await readFile(path.join(result.directory, "raw.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(rows[1].id, "9223372036854775802");
    assert.deepEqual(rows[1].future_detail, { antenna: [1, 2] });
    const decisions = JSON.parse((await readFile(path.join(result.directory, "decisions.jsonl"), "utf8")).trim());
    assert.deepEqual(decisions.payload.decisionTrace.evidence.complete, [1, 2, 3]);
    assert.deepEqual(result.manifest.selectedTags, ["T"]);
    assert.equal(result.manifest.interval, "[from,to)");
    assert.ok(statements.find(sql => sql.startsWith("SELECT (to_jsonb(t)") && sql.includes('"id"::text')));
    for (const file of result.manifest.files) {
      const bytes = await readFile(path.join(result.directory, file.path));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
      assert.equal(bytes.byteLength, file.bytes);
    }
    const second = await exportArchive({ range, tags: ["T"], csv: false }, { run, outputRoot });
    assert.notEqual(second.directory, result.directory);
    assert.ok(!second.manifest.files.some(file => file.path.endsWith(".csv")));
  });
});

test("missing historical PDOP/received_at and missing optional tables remain explicit, without a migration", async () => {
  await temporaryArchive(async outputRoot => {
    const { run, statements } = fixture(false, true);
    const result = await exportArchive({ range, tags: ["T"] }, { run, outputRoot });
    assert.ok(result.manifest.warnings.some(warning => warning.includes("tag_room_decisions")));
    assert.ok(statements.some(sql => sql.includes("'received_at',NULL")));
    assert.ok(statements.some(sql => sql.includes("'pdop',NULL")));
    assert.ok(statements.every(sql => !/\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/.test(sql)));
  });
});

test("failed export is visibly partial and cannot masquerade as a complete archive", async () => {
  await temporaryArchive(async outputRoot => {
    const { run } = fixture(true);
    await assert.rejects(exportArchive({ range, tags: ["T"] }, { run, outputRoot }), /fixture disk failure/);
    const [directory] = await readdir(outputRoot);
    assert.ok(directory.startsWith(".partial-"));
    const contents = await readdir(path.join(outputRoot, directory));
    assert.ok(contents.includes("incomplete.json"));
    assert.ok(!contents.includes("manifest.json"));
  });
});

test("stale tag selection fails before a directory is created", async () => {
  await temporaryArchive(async outputRoot => {
    await assert.rejects(exportArchive({ range, tags: ["MISSING"] }, { run: fixture().run, outputRoot }), /kayıt kalmamış/);
    assert.deepEqual(await readdir(outputRoot), []);
  });
});

test("offline benchmark import verifies the archive, filters its context and never contacts the database", async () => {
  await temporaryArchive(async outputRoot => {
    const { run, statements } = fixture();
    const result = await exportArchive({ range, tags: ["T"] }, { run, outputRoot });
    const truth: Truth = { testId: "test-00000000-0000-0000-0000-000000000099", timezone: "Europe/Istanbul", revision: 1,
      revisionReason: "independent fixture", test: range, visits: [], groups: [{ id: "walker", tagCodes: ["T"] }] };
    const calls = statements.length;
    const dataset = await buildArchiveDataset(result.directory, truth, ["T"], 0, 0);
    assert.equal(statements.length, calls);
    assert.equal(dataset.manifest.rowCount, 2);
    assert.equal(dataset.manifest.testId, truth.testId);
    assert.ok(dataset.manifest.source.includes(result.manifest.archiveId));
    assert.deepEqual(dataset.raw.toString().trim().split("\n").map(line => JSON.parse(line).id), ["9223372036854775802", "9223372036854775803"]);
    await assert.rejects(buildArchiveDataset(result.directory, truth, ["MISSING"], 0, 0), /dışa aktarılmamış/);
    await assert.rejects(buildArchiveDataset(result.directory, { ...truth, test: { from: at(-40), to: at(2) } }, ["T"], 0, 0), /kapsamıyor/);
    const row = (await readFile(path.join(result.directory, "raw.jsonl"), "utf8")).split("\n")[0];
    await appendFile(path.join(result.directory, "raw.jsonl"), row + "\n");
    await assert.rejects(buildArchiveDataset(result.directory, truth, ["T"], 0, 0), /SHA-256/);
  });
});
