import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RoomHmmEngine } from "../src/server/regionEngine/RoomHmmEngine";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import type { ProcessedPosition } from "../src/server/regionEngine/types";
import { TagPresenceService } from "../src/server/tracking/TagPresenceService";
import { DEFAULT_SYSTEM_SETTINGS, systemSettingsSchema } from "../src/features/settings/types/settings.types";
import { loadDecisionReport } from "../src/server/reports/decisionReportService";
import { createDecisionReportXlsx } from "../src/server/reports/decisionReportXlsx";
import { createDecisionReportPdf } from "../src/server/reports/decisionReportPdf";
import { createRouteReportPdf } from "../src/server/reports/routeReportPdf";
import { decisionReportCsv } from "../src/server/reports/decisionReportColumns";
import { buildTagReport } from "../src/server/reports/routeReport";
import { loadAdminRouteReport } from "../src/server/reports/adminRouteReportService";
import { adminRouteCsv, createAdminRouteXlsx, createAdminRoutePdf } from "../src/server/reports/adminRouteReportFormats";

test("generating admin and user reports leaves the live HMM state and subsequent decisions identical", async () => {
  const compiled = compileRegionsConfig(JSON.parse(readFileSync("config/maps/necmettin-servis/regions.json", "utf8")));
  const start = Date.parse("2026-10-27T11:00:00Z");
  let clock = start;
  const control: ProcessedPosition[] = [], withReports: ProcessedPosition[] = [];
  const first = new RoomHmmEngine(p => control.push(p), 1000, () => clock, false);
  const second = new RoomHmmEngine(p => withReports.push(p), 1000, () => clock, false);
  first.enable(compiled); second.enable(compiled);
  const point = compiled.regions[0].roomCenter;
  const ingest = (seconds: number) => {
    clock = start + seconds * 1000;
    const raw = { tagCode: "REPORT-ISOLATION", mapId: "necmettin-servis", x: point.x, y: point.y, motion: "moving" as const, timestamp: new Date(clock).toISOString() };
    first.ingest(raw); second.ingest(raw); first.tick(); second.tick();
  };
  for (let seconds = 0; seconds <= 12; seconds++) ingest(seconds);
  const state = structuredClone(second.getVehicleState("REPORT-ISOLATION"));
  const count = withReports.length;
  const end = new Date(clock).toISOString();
  const data = await loadDecisionReport({ from: new Date(start).toISOString(), to: end, format: "xlsx" }, new Date(clock), {
    query: async () => [], pending: () => withReports, rooms: async () => [],
  });
  createDecisionReportXlsx(data); decisionReportCsv(data); JSON.stringify(data);
  await createDecisionReportPdf(data);
  const admin = await loadAdminRouteReport({ from: data.from, to: data.to, format: "xlsx" }, new Date(clock), {
    query: async sql => sql.includes("DISTINCT ON") ? [] : withReports.map((p,i) => ({ id: String(i+1), tag_code: p.tagCode,
      published_at: p.publishedAt!, payload: JSON.stringify(p), tag_name: "Test" })), rooms: async () => [],
  });
  createAdminRouteXlsx(admin); adminRouteCsv(admin); JSON.stringify(admin);
  await createAdminRoutePdf(admin);
  const route = buildTagReport("REPORT-ISOLATION", "Test", data.from, data.to, withReports.map(p => ({ tagCode: p.tagCode,
    at: p.lastRawDataTimestamp, mapId: p.mapId ?? null, roomId: p.regionInference.regionId,
    roomName: p.regionInference.regionName ?? null, state: p.regionInference.state, corridorEvidence: p.decisionTrace?.evidence?.lastReliableLocation?.kind === "corridor" })));
  for (const reports of [{ routeHistoryRoomMinDurationMs: 0, routeHistoryCorridorMinDurationMs: 180_000 },
    { routeHistoryRoomMinDurationMs: 60_000, routeHistoryCorridorMinDurationMs: 0 }]) {
    await createRouteReportPdf({ from: data.from, to: data.to, generatedAt: end, tags: [route] }, reports);
  }
  assert.deepEqual(second.getVehicleState("REPORT-ISOLATION"), state);
  assert.equal(withReports.length, count, "report downloads must never publish engine decisions");
  for (let seconds = 13; seconds <= 30; seconds++) ingest(seconds);
  clock += 30_000; first.tick(); second.tick();
  assert.deepEqual(withReports, control, "decisions after reporting must match the control engine exactly");
  assert.deepEqual(second.getVehicleState("REPORT-ISOLATION"), first.getVehicleState("REPORT-ISOLATION"));
  first.disable(); second.disable();
});

test("different report thresholds do not change live presence or visibility deadlines", () => {
  let clock = Date.parse("2026-10-27T11:00:00Z");
  const one = new TagPresenceService(() => clock), two = new TagPresenceService(() => clock);
  const settings = systemSettingsSchema.parse({ ...DEFAULT_SYSTEM_SETTINGS,
    reports: { routeHistoryRoomMinDurationMs: 0, routeHistoryCorridorMinDurationMs: 86_400_000 } });
  one.setSettings(DEFAULT_SYSTEM_SETTINGS); two.setSettings(settings);
  const location = { mapId: "m", mapName: "Servis", floorLabel: "Servis", kind: "corridor" as const, regionId: null, regionName: null };
  const raw = { id: "REPORT-ISOLATION", x: 1, y: 2, mapId: "m", timestamp: clock, receivedAt: new Date(clock).toISOString() };
  one.observeRaw(raw, location); two.observeRaw(raw, location);
  for (const offset of [0, 59_999, 60_000, 60_001, 120_000]) {
    clock = raw.timestamp + offset; one.tick(); two.tick();
    assert.deepEqual(two.get(raw.id), one.get(raw.id));
  }
});
