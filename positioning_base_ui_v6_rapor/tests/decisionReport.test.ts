import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import test from "node:test";
import type { PgRow } from "../src/server/postgresClient";
import type { ProcessedPosition } from "../src/server/regionEngine/types";
import type { DecisionReportData } from "../src/features/reports/types/decisionReport.types";
import { DecisionReportError, loadDecisionReport, validateDecisionReportRequest } from "../src/server/reports/decisionReportService";
import { createDecisionReportHandler } from "../src/server/reports/decisionReportHttp";
import { createDecisionReportPdf, buildDecisionReportDefinition } from "../src/server/reports/decisionReportPdf";
import { createDecisionReportXlsx } from "../src/server/reports/decisionReportXlsx";
import { decisionReportCsv } from "../src/server/reports/decisionReportColumns";

const from = "2026-10-27T11:00:00.000Z", to = "2026-10-27T17:00:00.000Z";
const now = new Date("2026-10-28T10:00:00.000Z");
const input = { from, to, format: "xlsx" as const };
function position(index: number, overrides: Partial<ProcessedPosition> = {}): ProcessedPosition {
  const at = new Date(Date.parse(from) + index * 500).toISOString();
  return { tagCode: "9A8FA14BB93426F1", x: 1.2, y: 3.4, timestamp: at, lastRawDataTimestamp: at, publishedAt: at,
    mapId: "necmettin-servis", decisionId: `decision-${String(index).padStart(6, "0")}`, engineVersion: "room-hmm-2", configVersion: "original-config",
    positionSource: "RAW", synthetic: false,
    regionInference: { enabled: true, state: "ENTRY_CANDIDATE", regionId: null, candidateRegionId: "room-17", measurementKind: "uncertain", confidence: .4 },
    decisionTrace: { eventType: "ENTRY_CANDIDATE", severity: "info", previousState: "TRACKING_OUTSIDE", nextState: "ENTRY_CANDIDATE", trigger: "measurement",
      input: { x: 1.1, y: 3.3, measuredAt: at }, reasons: [{ code: "CANDIDATE", message: 'Oda adayı, "211"' }], outcome: { measurementKind: "uncertain" } }, ...overrides };
}
function dbRows(positions: readonly ProcessedPosition[]): PgRow[] {
  return positions.map((p, index) => ({ id: String(index + 1), event_id: p.decisionId!, tag_code: p.tagCode,
    published_at: p.publishedAt!, payload: JSON.stringify(p), tag_name: "HBM Mindray Servis" }));
}
const rooms = async () => [{ mapId: "necmettin-servis", mapName: "Servis", roomId: "room-17", roomName: "211" }];
async function report(positions = [position(1), position(2)]): Promise<DecisionReportData> {
  return loadDecisionReport(input, now, { query: async () => dbRows(positions), pending: () => [], rooms });
}

test("admin range validates zoned dates, seven days, formats and fixes the live cutoff", () => {
  assert.equal(validateDecisionReportRequest(input, now).from, from);
  for (const invalid of [{ ...input, from: "2026-10-27T11:00:00" }, { ...input, to: from },
    { ...input, to: "2026-11-10T00:00:00Z" }, { ...input, format: "xml" }, { ...input, importantOnly: true }]) {
    assert.throws(() => validateDecisionReportRequest(invalid, now), DecisionReportError);
  }
  const closeToNow = { ...input, from: "2026-10-28T09:00:00Z", to: "2026-10-28T10:00:30Z" };
  assert.equal(validateDecisionReportRequest(closeToNow, now).to, now.toISOString());
});

test("all 3000 half-second decisions are exported even if the UI has loaded only one page", async () => {
  const positions = Array.from({ length: 3000 }, (_, index) => position(index));
  const original = structuredClone(positions);
  const queries: string[] = [];
  const data = await loadDecisionReport(input, now, { query: async sql => { queries.push(sql); return dbRows(positions); }, pending: () => [], rooms });
  assert.equal(data.items.length, 3000);
  assert.equal(new Set(data.items.map(item => item.decisionId)).size, 3000);
  assert.ok(data.items.every(item => item.nextState === "ENTRY_CANDIDATE" && item.measurementKind === "uncertain" && !item.regionId));
  assert.match(queries[0], /^SELECT /);
  assert.doesNotMatch(queries[0], /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|GROUP BY|DISTINCT)\b/i);
  assert.doesNotMatch(queries[0], /measurement_kind.*IN\s*\(/i);
  assert.match(queries[0], /ORDER BY d\.published_at,d\.id LIMIT 50001/);
  assert.deepEqual(positions, original);
});

test("rejected, estimated, uncertain and timer decisions stay separate and only duplicate IDs collapse", async () => {
  const candidate = position(1);
  const rejected = position(2, { decisionTrace: { ...candidate.decisionTrace!, eventType: "MEASUREMENT_REJECTED", severity: "warning" } });
  const timer = position(3, { synthetic: true, lastRawDataTimestamp: candidate.lastRawDataTimestamp,
    regionInference: { enabled: true, state: "INFERRED_IN_REGION", regionId: "room-17", measurementKind: "estimated" },
    decisionTrace: { ...candidate.decisionTrace!, trigger: "timer", eventType: "ROOM_INFERRED", nextState: "INFERRED_IN_REGION" } });
  const rows = [timer, rejected, candidate];
  const pending = [candidate, timer, position(4)];
  const data = await loadDecisionReport(input, now, { query: async () => dbRows(rows), pending: () => pending, rooms });
  assert.deepEqual(data.items.map(item => item.decisionId), [candidate.decisionId, rejected.decisionId, timer.decisionId, position(4).decisionId]);
  assert.equal(data.items[0].candidateRegionName, "211");
  assert.equal(data.items[0].regionId, "");
  assert.equal(data.items[2].regionId, "room-17");
  assert.equal(data.items[2].synthetic, true);
  assert.equal(data.items[2].payload.lastRawDataTimestamp, candidate.lastRawDataTimestamp);
});

test("pending decisions are captured before a flush and obey tag, map, candidate and publication range", async () => {
  const target = position(1);
  let pending = [target, position(2, { tagCode: "OTHER" }), position(3, { mapId: "other-map" }),
    position(4, { regionInference: { enabled: true, state: "ENTRY_CANDIDATE", regionId: null, candidateRegionId: "other-room" } }),
    position(5, { publishedAt: "2026-10-28T00:00:00Z" })];
  const data = await loadDecisionReport({ ...input, tagCode: "9a8f", mapId: "necmettin-servis", regionId: "room-17" }, now, {
    pending: () => pending, rooms, query: async sql => {
      assert.match(sql, /candidate_region_id/); assert.match(sql, /d\.published_at>=/); assert.match(sql, /strpos\(upper\(d.tag_code\),'9A8F'\)>0/);
      pending = []; return [];
    },
  });
  assert.deepEqual(data.items.map(item => item.decisionId), [target.decisionId]);
});

test("row limits and empty selections return errors instead of successful partial downloads", async () => {
  const row = dbRows([position(1)])[0];
  await assert.rejects(() => loadDecisionReport(input, now, { query: async () => Array(50_001).fill(row), pending: () => [], rooms }),
    error => error instanceof DecisionReportError && error.status === 422 && /Eksik çıktı/.test(error.message));
  await assert.rejects(() => loadDecisionReport(input, now, { query: async () => [], pending: () => [], rooms }),
    error => error instanceof DecisionReportError && error.status === 422);
  await assert.rejects(() => loadDecisionReport(input, now, { query: async () => [{ ...row, payload: "{broken" }], pending: () => [], rooms }),
    error => error instanceof DecisionReportError && error.status === 503 && /Eksik çıktı/.test(error.message));
});

test("CSV uses one second-precision decision time, preserves every event and escapes spreadsheet formulas", async () => {
  const data = await report();
  const csv = decisionReportCsv({ ...data, items: [{ ...data.items[0], tagName: '=HYPERLINK("bad")', reasonText: 'Virgül, "tırnak"\nAlt satır' }, data.items[1]] });
  assert.match(csv, /"Karar zamanı \(TR\)"/);
  assert.doesNotMatch(csv, /"Ölçüm zamanı|"Yayımlanma zamanı|\.500/);
  assert.match(csv, /27\.10\.2026 14:00:00/);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /Virgül, ""tırnak""/);
  assert.equal((csv.match(/decision-00000[12]/g) ?? []).length, 2);
});

function unzip(bytes: Uint8Array): Map<string, string> {
  const buffer = Buffer.from(bytes), files = new Map<string, string>();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const dataStart = offset + 30 + nameLength + extraLength;
    files.set(name, inflateRawSync(buffer.subarray(dataStart, dataStart + size)).toString("utf8"));
    offset = dataStart + size;
  }
  return files;
}

test("Excel stores each distinct decision, text IDs, frozen headers and scope metadata", async () => {
  const data = await report(Array.from({ length: 120 }, (_, i) => position(i)));
  const files = unzip(createDecisionReportXlsx({ ...data, items: data.items.map(item => ({ ...item, tagName: "=1+1", reasonText: 'A&B <oda> "211"' })) }));
  assert.ok(files.has("[Content_Types].xml"));
  const worksheet = files.get("xl/worksheets/sheet1.xml")!;
  assert.equal((worksheet.match(/<row /g) ?? []).length, 121);
  assert.match(worksheet, /autoFilter ref="A1:AB121"/);
  assert.match(worksheet, /topLeftCell="E2"/);
  assert.match(worksheet, /<c r="B2" s="2"><v>/);
  assert.match(files.get("xl/styles.xml")!, /formatCode="dd.mm.yyyy hh:mm:ss"/);
  assert.match(worksheet, /A&amp;B &lt;oda&gt;/);
  assert.match(worksheet, /t="inlineStr"><is><t xml:space="preserve">=1\+1/);
  assert.doesNotMatch(worksheet, /<f[ >]/);
  assert.match(files.get("xl/worksheets/sheet2.xml")!, /Benzersiz motor kararı/);
});

test("PDF repeats headers, preserves individual candidates and displays a single decision clock", async () => {
  const data = await report(Array.from({ length: 40 }, (_, i) => position(i)));
  let liveTicks = 0;
  const timer = setInterval(() => { liveTicks++; }, 10);
  let pdf: Uint8Array;
  try { pdf = await createDecisionReportPdf(data); } finally { clearInterval(timer); }
  assert.ok(liveTicks >= 2, "the live event loop must continue while the worker renders PDF");
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString(), "%PDF-");
  assert.ok((Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length > 1);
  const definition = buildDecisionReportDefinition(data);
  const content = definition.content as { table?: { headerRows: number; body: { text: string }[][] } }[];
  const table = content.find(item => item.table)!.table!;
  assert.equal(table.headerRows, 1);
  assert.equal(table.body.length, 41);
  assert.equal(table.body[0].filter(cell => /zamanı/.test(cell.text)).length, 1);
  assert.equal(table.body[1][4].text, "—");
  assert.match(table.body[1][5].text, /211/);
  await assert.rejects(() => createDecisionReportPdf({ ...data, items: Array(5001).fill(data.items[0]) }), DecisionReportError);
});

test("download endpoint uses the same complete dataset for all formats and reports errors", async () => {
  const data = await report();
  const handle = createDecisionReportHandler(async () => data, () => now);
  for (const format of ["json", "csv", "xlsx", "pdf"]) {
    const response = await handle(new Request("http://localhost/api/reports/motor-decisions", { method: "POST", body: JSON.stringify({ ...input, format }) }));
    assert.equal(response.status, 200, format);
    assert.equal(response.headers.get("X-Decision-Count"), "2");
    assert.match(response.headers.get("Content-Disposition")!, new RegExp(`\\.${format}"$`));
    if (format === "json") assert.deepEqual((await response.json()).items.map((item: { payload: unknown }) => item.payload), data.items.map(item => item.payload));
  }
  const invalid = await handle(new Request("http://localhost/report", { method: "POST", body: "{broken" }));
  assert.equal(invalid.status, 400);
});
