import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { TagPresenceService } from "../src/server/tracking/TagPresenceService";
import { PostgresTagPresenceRepository } from "../src/server/tracking/tagPresenceRepository";
import { lastObservedLocationLabel } from "../src/features/tracking/services/tagPresencePresentation";
import { ageDecision, decisionZone } from "../src/server/location/roomDecisionProjection";
import { answerLocationQuestion } from "../src/server/assistant/locationAnswer";
import { successEnvelope } from "../src/server/location/location.types";
import { buildTagReport, type ReportDecision } from "../src/server/reports/routeReport";
import { createRouteReportPdf } from "../src/server/reports/routeReportPdf";
import { loadRouteReport } from "../src/server/reports/routeReportService";
import type { ProcessedPosition } from "../src/server/regionEngine/types";
import { AreaExitReader, projectAreaExit } from "../src/server/tracking/areaExitReader";

const stamp = "2026-10-23T15:50:50.301Z", exitAt = "2026-10-23T15:50:46.305Z";
const epoch = Date.parse(stamp);
const inference = { enabled: true as const, state: "TRACKING_OUTSIDE" as const, regionId: null, outsideArea: true,
  leftAreaAt: exitAt, leftAreaGate: "Ameliyathane giriş / çıkış kapısı", measurementKind: "estimated" as const,
  uncertainAfter: new Date(epoch + 60000).toISOString() };
const raw = { id: "PACEMAKER", mapId: "icu", x: 2.819, y: 22.1, timestamp: epoch, receivedAt: stamp };
const decision = { ...raw, publishedAt: new Date(epoch + 9).toISOString(), regionInference: inference };
const location = { mapId: "icu", mapName: "Yoğun Bakım", floorLabel: null, regionId: null, regionName: null, kind: "unknown" as const };

test("exit is read independently from the archive after silence/restart and a later entry supersedes it", async () => {
  let now = epoch + 9;
  const service = new TagPresenceService(() => now);
  service.observeRaw(raw, location); service.observeDecision(decision);
  now += 60001; service.tick();
  const stale = service.get(raw.id)!;
  assert.equal(stale.hiddenForNoData, true);
  assert.equal(stale.lastRawMeasuredAt, epoch);
  let archived = { ...decision, tagCode: raw.id, timestamp: stamp, lastRawDataTimestamp: stamp, synthetic: false, positionSource: "RAW" } as ProcessedPosition;
  const reader = new AreaExitReader(async () => [{ tag_code: raw.id, payload: JSON.stringify(archived) }], () => []);
  const status = (await reader.read([raw.id], new Date(now).toISOString())).byTag[raw.id];
  assert.match(lastObservedLocationLabel(stale, status), /alanından çıktı.*18:50:46/);
  const saved = { tagCode: raw.id, raw, lastRawMeasuredAt: epoch, lastRawReceivedAt: epoch, lastObservedLocation: location };
  const sql: string[] = [];
  const repository = new PostgresTagPresenceRepository(async query => {
    sql.push(query); return query.includes("SELECT p.payload") ? [{ payload: JSON.stringify(saved) }] : [];
  });
  await repository.save([saved]);
  assert.doesNotMatch(sql[1], /lastDecision/);
  const restored = new TagPresenceService(() => now);
  restored.restore(await repository.restore());
  assert.equal(restored.get(raw.id)!.processed, undefined);
  assert.equal(restored.get(raw.id)!.hasCurrentRoomAssignment, false);
  assert.match(lastObservedLocationLabel(restored.get(raw.id)!, status), /alanından çıktı/);
  assert.equal(restored.get(raw.id)!.processed, undefined, "reading history must not apply archived decisions");
  const entered = { ...raw, timestamp: now, receivedAt: new Date(now).toISOString() };
  restored.observeRaw(entered, { ...location, kind: "room", regionId: "room", regionName: "Oda 1" });
  restored.observeDecision({ ...entered, publishedAt: new Date(now).toISOString(), regionInference: { enabled: true, state: "IN_REGION", regionId: "room" } });
  archived = { ...archived, publishedAt: new Date(now).toISOString(), regionInference: { enabled: true, state: "IN_REGION", regionId: "room" } };
  const reentered = (await reader.read([raw.id], new Date(now).toISOString())).byTag[raw.id];
  assert.equal(lastObservedLocationLabel(restored.get(raw.id)!, reentered), "Yoğun Bakım · Oda 1");
});

test("aged exit remains available to AI as a past event rather than a corridor or live position", async () => {
  const processed: ProcessedPosition = { ...decision, tagCode: raw.id, timestamp: stamp, lastRawDataTimestamp: stamp, synthetic: false, positionSource: "RAW" };
  const aged = ageDecision(processed, new Date(epoch + 3600000).toISOString());
  assert.match(decisionZone(aged), /Alandan çıktı/);
  const entity = { entityId: 1, entityCode: "P2", name: "Pacemaker 2", tagCode: raw.id, entityType: "asset", status: "active" };
  const answer = await answerLocationQuestion({ intent: "current", subject: "Pacemaker 2" }, undefined, {
    search: async () => successEnvelope({ matches: [entity] }),
    current: async () => successEnvelope({ entityId: 1, entityName: entity.name, tagCode: raw.id,
      observedAt: stamp, ageSeconds: 3600, trackingStatus: "offline", lastAreaExit: projectAreaExit(processed).exit,
      position: { x: raw.x, y: raw.y, floorPlanId: "icu", zoneName: decisionZone(aged), roomDecision: aged.regionInference } }),
    lastKnownRoom: async () => { throw new Error("Past room must not replace a later exit"); },
  });
  assert.match(answer, /son bilinen durum:.*alanından çıktı/);
  assert.match(answer, /çevrimdışı/);
  assert.match(answer, /18:50:46/);
  assert.doesNotMatch(answer, /şu anda.*konumunda görünüyor/);
});

test("estimated room and repeated exits are classified independently with one exit per occurrence", () => {
  const base: ReportDecision = { tagCode: raw.id, at: stamp, mapId: "icu", roomId: null, roomName: null, state: "TRACKING_OUTSIDE", corridorEvidence: true };
  const report = buildTagReport(raw.id, "Pacemaker 2", "2026-10-23T15:48:00Z", "2026-10-23T16:00:00Z", [
    { ...base, at: "2026-10-23T15:48:00Z", state: "INFERRED_IN_REGION", roomId: "r1", roomName: "Oda 1" },
    { ...base, at: exitAt, outsideArea: true, leftAreaAt: exitAt, leftAreaGate: inference.leftAreaGate },
    { ...base, outsideArea: true, leftAreaAt: exitAt, leftAreaGate: inference.leftAreaGate },
  ]);
  assert.equal(report.rows[0].room, "Oda 1");
  assert.equal(report.exits!.length, 1);
  assert.equal(report.exits![0].at, exitAt);
  assert.ok(!report.rows.some(row => row.room === "Koridor"));
  assert.equal(report.rows.at(-1)!.gap, true);
});

test("report query carries estimated exits and their gate into the output", async () => {
  const queries: string[] = [];
  const result = await loadRouteReport({ tags: [raw.id], from: "2026-10-23T15:48:00Z", to: "2026-10-23T16:00:00Z" }, new Date(), async sql => {
    queries.push(sql);
    if (sql.includes("FROM tags")) return [{ tag_code: raw.id, display_name: "Pacemaker 2" }];
    if (sql.includes("DISTINCT ON")) return [];
    return [{ tag_code: raw.id, at: stamp, map_id: "icu", state: "TRACKING_OUTSIDE", outside_area: "true", left_area_at: exitAt, left_area_gate: inference.leftAreaGate, corridor_kind: "corridor" }];
  }, async () => [{ mapId: "icu", mapName: "Yoğun Bakım", roomId: "r1", roomName: "Oda 1" }]);
  assert.match(queries[1], /IN \('measured','estimated'\)/);
  assert.equal(result.tags[0].exits![0].floor, "Yoğun Bakım");
});

test("PDF includes exit even with no qualifying stays and contains no estimate label", async context => {
  const PdfPrinter = createRequire(import.meta.url)("pdfmake") as typeof import("pdfmake");
  const printer = context.mock.method(PdfPrinter.prototype, "createPdfKitDocument");
  const pdf = await createRouteReportPdf({ from: exitAt, to: stamp, generatedAt: stamp, tags: [{ tagCode: raw.id, displayName: "Pacemaker 2", rows: [], hasRecords: true,
    exits: [{ at: exitAt, mapId: "icu", floor: "Yoğun Bakım", gate: inference.leftAreaGate }] }] }, 86400000);
  assert.equal(Buffer.from(pdf.subarray(0,5)).toString(), "%PDF-");
  const content = JSON.stringify(printer.mock.calls.at(-1)!.arguments[0].content);
  assert.match(content, /18:50:46.*Yoğun Bakım.*Alandan çıktı.*Ameliyathane/);
  assert.doesNotMatch(content, /Tahmin edilen|tahmini|estimated/i);
});
