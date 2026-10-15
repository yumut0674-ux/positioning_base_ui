import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import type { RouteReportData } from "../src/server/reports/routeReportService";
import { buildTagReport, filterTagReportToRoom, type ReportDecision, type ReportRow } from "../src/server/reports/routeReport";
import { createRouteReportPdf } from "../src/server/reports/routeReportPdf";
import { loadRouteReport, RouteReportError, validateRouteReportRequest } from "../src/server/reports/routeReportService";

const from = "2026-09-25T07:00:00.000Z";
const to = "2026-09-25T07:30:00.000Z";
const point = (at: string, room: string): ReportDecision => ({ tagCode: "TAG-001", at, mapId: "Kat 1", roomId: room, roomName: room, state: "IN_REGION", corridorEvidence: false });

test("report range accepts only selected tags and at most seven days", () => {
  assert.deepEqual(validateRouteReportRequest({ tags: ["tag-001", "TAG-001"], from, to }, new Date("2026-09-25T08:00:00Z")).tags, ["TAG-001"]);
  assert.deepEqual(validateRouteReportRequest({ tags: ["TAG-001"], from, to, room: { mapId: "Kat 1", roomId: "oda-a" } }, new Date("2026-09-25T08:00:00Z")).room, { mapId: "Kat 1", roomId: "oda-a" });
  assert.throws(() => validateRouteReportRequest({ tags: ["TAG-001"], from, to, room: { mapId: "Kat 1", roomId: "" } }, new Date("2026-09-25T08:00:00Z")), RouteReportError);
  assert.throws(() => validateRouteReportRequest({ tags: ["TAG-001"], from, to: "2026-10-03T07:00:00Z" }, new Date("2026-10-04T00:00:00Z")), RouteReportError);
  assert.throws(() => validateRouteReportRequest({ tags: [], from, to }, new Date("2026-09-25T08:00:00Z")), RouteReportError);
});

test("room selection matches both floor and room ID after durations are calculated", () => {
  const report = buildTagReport("TAG-001", "Forklift", from, to, [
    point("2026-09-25T07:00:00Z", "oda-a"),
    point("2026-09-25T07:02:00Z", "oda-a"),
    { ...point("2026-09-25T07:04:00Z", "oda-a"), mapId: "Kat 2" },
    { ...point("2026-09-25T07:06:00Z", "oda-a"), mapId: "Kat 2" },
  ]);
  const selected = filterTagReportToRoom(report, { mapId: "Kat 1", roomId: "oda-a" });
  assert.equal(selected.hasRecords, true);
  assert.deepEqual(selected.rows.map(row => [row.floor, row.room, row.gap]), [["Kat 1", "oda-a", false], ["—", "Veri yok", true]]);
  assert.equal(Date.parse(selected.rows[0].to) - Date.parse(selected.rows[0].from), 4 * 60_000);
  assert.equal(filterTagReportToRoom(report, { mapId: "Kat 1", roomId: "oda-b" }).hasRecords, false);
});

test("last preceding room seeds the start; missing intervals never add to room duration", () => {
  const report = buildTagReport("TAG-001", "Forklift", from, to, [
    point("2026-09-25T06:58:00Z", "Oda A"),
    point("2026-09-25T07:02:00Z", "Oda A"),
    point("2026-09-25T07:04:00Z", "Oda B"),
    point("2026-09-25T07:12:00Z", "Oda B"),
    point("2026-09-25T07:14:00Z", "Oda B"),
    { ...point("2026-09-25T07:15:00Z", "Oda C"), tagCode: "OTHER" },
  ]);
  assert.deepEqual(report.rows.map(row => [row.from.slice(11, 16), row.to.slice(11, 16), row.room, row.gap]), [
    ["07:00", "07:04", "Oda A", false],
    ["07:04", "07:12", "Veri yok", true],
    ["07:12", "07:14", "Oda B", false],
    ["07:14", "07:30", "Veri yok", true],
  ]);
  assert.equal(report.rows.filter(row => !row.gap).reduce((sum, row) => sum + Date.parse(row.to) - Date.parse(row.from), 0), 6 * 60_000);
});

test("stale preceding room is not carried into the report", () => {
  const report = buildTagReport("TAG-001", "Forklift", from, to, [point("2026-09-25T06:00:00Z", "Oda A"), point("2026-09-25T07:10:00Z", "Oda B")]);
  assert.equal(report.rows[0].room, "Veri yok");
  assert.equal(report.rows[0].to, to);
  assert.equal(report.rows.length, 1);
});

test("only measured corridor evidence replaces an unknown room label", () => {
  const outside = (at: string, corridorEvidence: boolean): ReportDecision => ({ ...point(at, ""), state: "TRACKING_OUTSIDE", roomId: null, roomName: null, corridorEvidence });
  const report = buildTagReport("TAG-001", "Forklift", from, to, [
    outside("2026-09-25T07:00:00Z", true), outside("2026-09-25T07:01:00Z", true),
    outside("2026-09-25T07:02:00Z", false), outside("2026-09-25T07:03:00Z", false),
    point("2026-09-25T07:04:00Z", "Oda A"),
  ]);
  assert.deepEqual(report.rows.slice(0, 2).map(row => row.room), ["Koridor", "—"]);
  assert.equal(report.rows[0].gap, false);
});

test("server report query uses the preceding measured decision and refuses truncated results", async () => {
  const input = { tags: ["TAG-001"], from, to };
  const seed = { tag_code: "TAG-001", at: "2026-09-25 06:58:00+00", map_id: "Kat 1", room_id: "oda-a", room_name: "Oda A", state: "IN_REGION", corridor_kind: null };
  const current = { ...seed, at: "2026-09-25 07:02:00+00" };
  const queries: string[] = [];
  const query = async (sql: string) => {
    queries.push(sql);
    if (sql.includes("FROM tags")) return [{ tag_code: "TAG-001", display_name: "Forklift" }];
    if (sql.includes("DISTINCT ON")) return [seed];
    return [current];
  };
  const report = await loadRouteReport(input, new Date("2026-09-25T08:00:00Z"), query);
  assert.equal(report.tags[0].rows[0].room, "Oda A");
  assert.match(queries[1], /measured_at>=/);
  assert.match(queries[2], /measured_at</);
  assert.match(queries[1], /LIMIT 50001/);
  assert.match(queries[1], /corridor_kind/);
  const corridor = { ...seed, room_id: null, room_name: null, state: "TRACKING_OUTSIDE", corridor_kind: "corridor" };
  const corridorReport = await loadRouteReport(input, new Date("2026-09-25T08:00:00Z"), async sql => {
    if (sql.includes("FROM tags")) return [{ tag_code: "TAG-001", display_name: "Forklift" }];
    if (sql.includes("DISTINCT ON")) return [corridor];
    return [{ ...corridor, at: "2026-09-25 07:02:00+00" }];
  });
  assert.equal(corridorReport.tags[0].rows[0].room, "Koridor");
  await assert.rejects(() => loadRouteReport(input, new Date(), async sql => {
    if (sql.includes("FROM tags")) return [{ tag_code: "TAG-001", display_name: "Forklift" }];
    return Array(50_001).fill(current);
  }), error => error instanceof RouteReportError && error.status === 422);
});

test("server accepts configured room and reports empty selected-room results", async () => {
  const selectedRoom = { mapId: "Kat 1", mapName: "Birinci Kat", roomId: "oda-a", roomName: "Oda A" };
  const row = { tag_code: "TAG-001", at: "2026-09-25 07:00:00+00", map_id: "Kat 1", room_id: "oda-a", room_name: "Oda A", state: "IN_REGION", corridor_kind: null };
  const query = async (sql: string) => {
    if (sql.includes("FROM tags")) return [{ tag_code: "TAG-001", display_name: "Forklift" }];
    if (sql.includes("DISTINCT ON")) return [];
    return [row, { ...row, at: "2026-09-25 07:02:00+00" }];
  };
  const input = { tags: ["TAG-001"], from, to, room: { mapId: "Kat 1", roomId: "oda-a" } };
  const report = await loadRouteReport(input, new Date("2026-09-25T08:00:00Z"), query, async () => [selectedRoom]);
  assert.deepEqual(report.room, selectedRoom);
  assert.equal(report.tags[0].rows[0].room, "Oda A");
  await assert.rejects(() => loadRouteReport({ ...input, room: { mapId: "Kat 1", roomId: "oda-b" } }, new Date("2026-09-25T08:00:00Z"), query, async () => [{ ...selectedRoom, roomId: "oda-b" }]),
    error => error instanceof RouteReportError && error.status === 422);
  await assert.rejects(() => loadRouteReport({ ...input, room: { mapId: "Kat 2", roomId: "oda-a" } }, new Date("2026-09-25T08:00:00Z"), query, async () => [selectedRoom]),
    error => error instanceof RouteReportError && error.status === 400);
});

test("PDF is multipage with a repeated table header and Turkish text", async () => {
  const start = Date.parse(from);
  const rows: ReportRow[] = Array.from({ length: 140 }, (_, index) => ({
    from: new Date(start + index * 20 * 60_000).toISOString(),
    to: new Date(start + (index + 1) * 20 * 60_000).toISOString(),
    mapId: "Kat 1", roomId: index % 2 ? "calisma" : "giris",
    floor: "Kat 1", room: index % 2 ? "Çalışma Odası" : "Giriş Bölümü", gap: false,
  }));
  const pdf = await createRouteReportPdf({ from, to: rows.at(-1)!.to, generatedAt: to, tags: [{ tagCode: "TAG-001", displayName: "Örnek Tag", rows, hasRecords: true }] });
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString("ascii"), "%PDF-");
  assert.ok((Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length >= 2);
});

test("PDF shows corridor durations, omits missing decisions and applies the configurable minimum", async context => {
  const PdfPrinter = createRequire(import.meta.url)("pdfmake") as typeof import("pdfmake");
  const printer = context.mock.method(PdfPrinter.prototype, "createPdfKitDocument");
  let cursor = Date.parse(from);
  const rows = [
    ["Kısa oda", 59_999], ["Tam dakika", 60_000], ["Koridor", 59_999], ["Koridor", 120_000],
    ["Veri yok", 59_999], ["Veri yok", 120_000], ["—", 59_999], ["—", 120_000],
  ].map(([room, milliseconds]): ReportRow => {
    const start = cursor;
    cursor += Number(milliseconds);
    return { from: new Date(start).toISOString(), to: new Date(cursor).toISOString(), mapId: "Kat 1", roomId: ["Koridor", "Veri yok", "—"].includes(String(room)) ? null : String(room), floor: "Kat 1", room: String(room), gap: room === "Veri yok" };
  });
  const report: RouteReportData = { from, to, generatedAt: to, tags: [{ tagCode: "TAG-001", displayName: "Test", rows, hasRecords: true }] };
  async function render(data: RouteReportData, minimum?: number) {
    const pdf = await createRouteReportPdf(data, minimum);
    assert.equal(Buffer.from(pdf.subarray(0, 5)).toString("ascii"), "%PDF-");
    const definition = printer.mock.calls.at(-1)!.arguments[0];
    const content = definition.content as { text?: string; table?: { body: { text: string }[][] } }[];
    return { content, rows: content.flatMap(item => item.table?.body.slice(1).map(cells => cells.map(cell => cell.text)) ?? []) };
  }

  const standard = await render(report);
  assert.deepEqual(standard.rows.map(cells => [cells[4], cells[5]]), [["Tam dakika", "1 dk"], ["Koridor", "2 dk"]]);
  assert.deepEqual((await render(report, 120_000)).rows.map(cells => cells[4]), ["Koridor"]);
  assert.deepEqual((await render(report, 0)).rows.map(cells => [cells[4], cells[5]]), [["Kısa oda", "1 dk"], ["Tam dakika", "1 dk"], ["Koridor", "3 dk"]]);
  const empty = await render(report, 86_400_000);
  assert.equal(empty.rows.length, 0);
  assert.ok(empty.content.some(item => item.text === "Seçilen minimum süreyi karşılayan oda veya koridor kararı yok."));
  assert.equal((await render({ ...report, tags: [{ ...report.tags[0], rows: rows.slice(4) }] }, 0)).rows.length, 0);
  assert.equal(report.tags[0].rows.length, 8);

  const midnight = { ...rows[3], from: "2026-09-25T20:59:30Z", to: "2026-09-25T21:01:00Z" };
  const split = await render({ ...report, tags: [{ ...report.tags[0], rows: [midnight] }] });
  assert.deepEqual(split.rows.map(cells => [cells[0], cells[1], cells[2], cells[5]]), [["26.09.2026", "00:00", "00:01", "1 dk"]]);
  const bothDays = await render({ ...report, tags: [{ ...report.tags[0], rows: [{ ...midnight, from: "2026-09-25T20:58:00Z", to: "2026-09-25T21:02:00Z" }] }] });
  assert.deepEqual(bothDays.rows.map(cells => [cells[0], cells[5]]), [["25.09.2026", "2 dk"], ["26.09.2026", "2 dk"]]);
});

test("PDF merges consecutive visible room records and sums only their included durations", async context => {
  const PdfPrinter = createRequire(import.meta.url)("pdfmake") as typeof import("pdfmake");
  const printer = context.mock.method(PdfPrinter.prototype, "createPdfKitDocument");
  const start = Date.parse(from);
  const row = (begin: number, end: number, room: string, roomId: string | null, mapId = "Kat 1"): ReportRow => ({
    from: new Date(start + begin * 1_000).toISOString(), to: new Date(start + end * 1_000).toISOString(),
    mapId, roomId, floor: mapId, room, gap: room === "Veri yok",
  });
  const rows = [
    row(0, 80, "Oda 2", "2"), row(80, 180, "Veri yok", null), row(180, 260, "Oda 2", "2"),
    row(260, 360, "—", null), row(360, 440, "Oda 2", "2"), row(440, 470, "Koridor", null),
    row(470, 550, "Oda 2", "2"), row(550, 670, "Koridor", null), row(670, 730, "Oda 2", "2"),
    row(730, 790, "Oda 2", "2", "Kat 2"), row(790, 850, "Oda 2", "different-room", "Kat 2"),
  ];
  const original = structuredClone(rows);
  await createRouteReportPdf({ from, to, generatedAt: to, tags: [{ tagCode: "TAG-001", displayName: "Test", rows, hasRecords: true }] });
  const content = printer.mock.calls.at(-1)!.arguments[0].content as { table?: { body: { text: string }[][] } }[];
  const displayed = content.flatMap(item => item.table?.body.slice(1).map(cells => cells.slice(1).map(cell => cell.text)) ?? []);
  assert.deepEqual(displayed, [
    ["10:00", "10:09", "Kat 1", "Oda 2", "5 dk"],
    ["10:09", "10:11", "Kat 1", "Koridor", "2 dk"],
    ["10:11", "10:12", "Kat 1", "Oda 2", "1 dk"],
    ["10:12", "10:13", "Kat 2", "Oda 2", "1 dk"],
    ["10:13", "10:14", "Kat 2", "Oda 2", "1 dk"],
  ]);
  assert.deepEqual(rows, original);
});
