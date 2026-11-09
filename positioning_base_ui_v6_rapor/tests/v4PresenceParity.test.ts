import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";
import { RoomHmmEngine } from "../src/server/regionEngine/RoomHmmEngine";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import { TagPresenceService } from "../src/server/tracking/TagPresenceService";
import { presencePosition } from "../src/server/tracking/tagPresenceRuntime";
import type { ProcessedPosition } from "../src/server/regionEngine/types";
import type { TrackingPosition } from "../src/server/trackingBuffer";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import { systemSettingsSchema } from "../src/features/settings/types/settings.types";

const referenceRoot = process.env.V4_REFERENCE_ROOT ?? path.resolve("../inceleme/v4-v5/kaynaklar/positioning_base_ui_v4");
const available = existsSync(path.join(referenceRoot, "src/server/tracking/TagPresenceService.ts"));
const referenceModule = async (file: string) => import(pathToFileURL(path.join(referenceRoot, file)).href);
const t0 = Date.parse("2026-10-26T08:00:00Z");

test("newer engine publications based on older evidence update presence without changing raw clocks", () => {
  let now = t0;
  const service = new TagPresenceService(() => now);
  const location = { mapId: "icu", mapName: "Yoğun Bakım", floorLabel: null, regionId: null, regionName: null, kind: "corridor" as const };
  service.setEngineEnabled(true); service.configureMap("icu", new Set(["room-07"]));
  const raw = { id: "T", mapId: "icu", timestamp: now, receivedAt: new Date(now).toISOString(), x: 1, y: 2 };
  service.observeRaw(raw, location);
  now += 1000;
  service.observeRaw({ ...raw, timestamp: now, receivedAt: new Date(now).toISOString() }, location);
  now += 1000;
  const decision = { ...raw, publishedAt: new Date(now).toISOString(), synthetic: true,
    regionInference: { enabled: true, state: "INFERRED_IN_REGION", regionId: "room-07", uncertainAfter: new Date(now + 60000).toISOString() } };
  service.observeDecision(decision);
  assert.equal(service.get("T")!.processed, decision);
  assert.equal(service.get("T")!.hasCurrentRoomAssignment, true);
  assert.equal(service.get("T")!.lastRawMeasuredAt, t0 + 1000);
  assert.equal(service.get("T")!.lastRawReceivedAt, t0 + 1000);
  service.observeDecision({ ...decision, publishedAt: new Date(now - 1).toISOString(), regionInference: { enabled: true, state: "LOCATION_LOST", regionId: null } });
  assert.equal(service.get("T")!.processed, decision, "older publication must still be rejected");
});

test("v4 reference: tracking acceptance, persistence and room calculation sources are byte-identical", { skip: !available }, () => {
  for (const file of ["src/server/tracking/TagPresenceService.ts", "src/server/tracking/tagPresenceRuntime.ts",
    "src/server/tracking/tagPresenceRepository.ts", "src/features/tracking/types/tagPresence.types.ts",
    "src/server/regionEngine/RoomHmmEngine.ts", "src/server/regionEngine/RegionPositionEngine.ts",
    "config/maps/necmettin-yogun-bakim/regions.json", "config/maps/necmettin-yogun-bakim/room-engine.json",
    "config/maps/necmettin-servis/regions.json", "config/maps/necmettin-servis/room-engine.json"]) {
    assert.ok(readFileSync(file).equals(readFileSync(path.join(referenceRoot, file))), file);
  }
});

async function pair(context: TestContext) {
  const { RoomHmmEngine: BaselineEngine } = await referenceModule("src/server/regionEngine/RoomHmmEngine.ts");
  const { TagPresenceService: BaselinePresence } = await referenceModule("src/server/tracking/TagPresenceService.ts");
  const { compileRegionsConfig: baselineCompile } = await referenceModule("src/server/regionEngine/configLoader.ts");
  const mapId = "necmettin-yogun-bakim";
  const relative = `config/maps/${mapId}/regions.json`;
  const config = compileRegionsConfig(JSON.parse(readFileSync(relative, "utf8")) as RegionsConfig);
  const v4config = baselineCompile(JSON.parse(readFileSync(path.join(referenceRoot, relative), "utf8")));
  const settings = JSON.parse(readFileSync(`config/maps/${mapId}/room-engine.json`, "utf8")).hmm;
  let now = t0, publications = 0, observations = 0;
  const v4: TagPresenceService = new BaselinePresence(() => now);
  const v5 = new TagPresenceService(() => now);
  const outputs: Record<"v4" | "v5", ProcessedPosition[]> = { v4: [], v5: [] };
  for (const presence of [v4, v5]) {
    presence.setEngineEnabled(true); presence.configureMap(mapId, new Set(config.regions.map(room => room.id)));
  }
  const output = (version: "v4" | "v5", service: TagPresenceService) => (position: ProcessedPosition) => {
    outputs[version].push(position); service.observeDecision(presencePosition(position));
  };
  const old: RoomHmmEngine = new BaselineEngine(output("v4", v4), 1000, () => now, false, settings);
  const current = new RoomHmmEngine(output("v5", v5), 1000, () => now, false, settings);
  old.enable(v4config); current.enable(config);
  context.after(() => { old.disable(); current.disable(); });
  const place = { mapId, mapName: "Yoğun Bakım", floorLabel: null, regionId: null, regionName: null, kind: "corridor" as const };
  function compare() {
    assert.equal(outputs.v4.length, outputs.v5.length);
    for (let index = publications; index < outputs.v4.length; index++) assert.deepEqual(outputs.v5[index], outputs.v4[index], `engine publication ${index}`);
    publications = outputs.v4.length;
    const before = v4.snapshot();
    const after = v5.snapshot();
    // The report schema has migrated; compare all settings through that migration while
    // keeping every raw clock, engine publication and presence state under exact comparison.
    assert.deepEqual({ ...after, epoch: "runtime-specific", settings: systemSettingsSchema.parse(after.settings) },
      { ...before, epoch: "runtime-specific", settings: systemSettingsSchema.parse(before.settings) }, `presence after ${observations} raw observations`);
  }
  function packet(point: { x: number; y: number }, ms = 250, anchorCount?: number) {
    now += ms; observations++;
    const raw: TrackingPosition = { tagCode: "PARITY", ...point, timestamp: new Date(now).toISOString(),
      receivedAt: new Date(now).toISOString(), mapId, motion: "moving", ...(anchorCount !== undefined ? { anchorCount } : {}) };
    for (const service of [v4, v5]) service.observeRaw(presencePosition(raw), place);
    old.ingest({ ...raw }); current.ingest({ ...raw });
    old.tick(); current.tick(); v4.tick(); v5.tick(); compare();
  }
  function walk(from: { x: number; y: number }, to: { x: number; y: number }, speed = 1.2) {
    const count = Math.max(1, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / speed * 4));
    for (let i = 1; i <= count; i++) packet({ x: from.x + (to.x - from.x) * i / count, y: from.y + (to.y - from.y) * i / count });
  }
  function silence(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      now += Math.min(1000, ms - elapsed); old.tick(); current.tick(); v4.tick(); v5.tick(); compare();
    }
  }
  context.after(() => context.diagnostic(`${observations} raw observations; ${publications} complete publications and all presence snapshots matched v4`));
  return { config, v4, v5, packet, walk, silence, latest: () => outputs.v5.at(-1)! };
}

test("v4 parity: Room 7 door approach followed by 60 seconds of repeated coordinates", { skip: !available }, async context => {
  const h = await pair(context);
  const door = h.config.regions.find(room => room.id === "room-07")!.entrances[0];
  const n = door.inwardNormal!;
  const approach = (distance: number) => ({ x: door.x - n.x * distance, y: door.y - n.y * distance });
  h.walk({ x: 1.8, y: 10 }, approach(0.9)); h.walk(approach(0.9), approach(0.2), 0.8);
  for (let i = 0; i < 60; i++) h.packet(approach(0.2), 1000);
  assert.equal(h.latest().regionInference.regionId, "room-07");
  assert.equal(h.latest().regionInference.state, "INFERRED_IN_REGION");
  assert.equal(h.v5.get("PARITY")!.processed!.regionInference!.regionId, "room-07");
  assert.ok(Date.parse(h.latest().lastRawDataTimestamp) < h.v5.get("PARITY")!.lastRawMeasuredAt);
});

for (const kind of ["repeated", "low-anchor"] as const) {
  test(`v4 parity: measured Room 4 becomes inferred with 120 seconds of ${kind} observations`, { skip: !available }, async context => {
    const h = await pair(context);
    const room = h.config.regions.find(item => item.id === "room-04")!;
    for (let i = 0; i < 80; i++) h.packet({ x: room.roomCenter.x + (i % 2 ? 0.03 : -0.03), y: room.roomCenter.y + i % 3 * 0.02 });
    assert.equal(h.latest().regionInference.state, "IN_REGION");
    const point = h.latest().rawPosition!;
    for (let i = 0; i < 120; i++) h.packet(point, 1000, kind === "low-anchor" ? 3 : undefined);
    assert.equal(h.latest().regionInference.state, "INFERRED_IN_REGION");
    assert.equal(h.v5.get("PARITY")!.processed!.regionInference!.measurementKind, "estimated");
    assert.ok(Date.parse(h.latest().lastRawDataTimestamp) < h.v5.get("PARITY")!.lastRawMeasuredAt);
  });
}

test("v4 parity: gate exit and 90 seconds without data", { skip: !available }, async context => {
  const h = await pair(context);
  h.walk({ x: 1.8, y: 12 }, { x: 1.4, y: 1.5 });
  h.walk({ x: 1.4, y: 1.5 }, { x: 1, y: -0.3 });
  h.walk({ x: 1, y: -0.3 }, { x: 0.9, y: -2.5 });
  assert.equal(h.latest().regionInference.outsideArea, true);
  h.silence(90000);
  assert.equal(h.v5.get("PARITY")!.hiddenForNoData, true);
});
