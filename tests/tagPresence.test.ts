import assert from "node:assert/strict";
import test from "node:test";
import { TagPresenceService } from "../src/server/tracking/TagPresenceService";
import { resolveLastObservedLocation } from "../src/server/tracking/lastObservedLocation";
import type { PositionMessage } from "../src/features/tracking/types/tracking.types";
import type { LastObservedLocation } from "../src/features/tracking/types/tagPresence.types";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import { DEFAULT_REGIONS_CONFIG } from "../src/features/regions/config/defaultRegionsConfig";
import { DEFAULT_SYSTEM_SETTINGS } from "../src/features/settings/types/settings.types";

const epoch = Date.parse("2026-10-15T00:00:00Z");
const location: LastObservedLocation = { mapId: "map-a", mapName: "1. Kat", floorLabel: "1. Kat", regionId: "A", regionName: "Oda 103", kind: "room" };
function fixture() {
  let now = epoch;
  const service = new TagPresenceService(() => now);
  service.configureMap("map-a", new Set(["A"]));
  service.setEngineEnabled(true);
  const raw = (offset = 0, overrides: Partial<PositionMessage> = {}) => ({ id: "T", mapId: "map-a", x: 2, y: 2,
    timestamp: epoch + offset, receivedAt: new Date(now).toISOString(), ...overrides });
  const observe = (offset = 0, overrides: Partial<PositionMessage> = {}) => service.observeRaw(raw(offset, overrides), location);
  const decision = (state: string, regionId: string | null = "A", uncertainOffset = 120_000) => service.observeDecision({
    ...raw(0), publishedAt: new Date(now).toISOString(), synthetic: true,
    regionInference: { enabled: true, state, regionId, lastKnownRegionId: "A", measurementKind: "estimated", uncertainAfter: new Date(epoch + uncertainOffset).toISOString() },
  });
  return { service, raw, observe, decision, advance: (offset: number) => { now = epoch + offset; service.tick(); }, state: () => service.get("T")! };
}

test("strict one-minute boundary hides an unassigned tag and retains the observation", () => {
  const f = fixture(); f.observe();
  for (const at of [59_999, 60_000]) { f.advance(at); assert.equal(f.state().hiddenForNoData, false); }
  f.advance(60_001);
  assert.equal(f.state().hiddenForNoData, true);
  assert.equal(f.state().lastObservedLocation.regionName, "Oda 103");
  assert.equal(f.state().raw.x, 2);
  f.advance(65_000);
  assert.equal(f.state().hiddenSince, epoch + 60_001);
});

test("only an unexpired current room assignment exempts a silent tag", () => {
  for (const state of ["IN_REGION", "INFERRED_IN_REGION", "EXIT_CANDIDATE", "ROOM_TRANSITIONED"]) {
    const f = fixture(); f.observe(); f.advance(1); f.decision(state); f.advance(60_001);
    assert.equal(f.state().hasCurrentRoomAssignment, true, state);
    assert.equal(f.state().hiddenForNoData, false, state);
    f.advance(120_000);
    assert.equal(f.state().hiddenForNoData, true, state);
  }
  for (const state of ["ENTRY_CANDIDATE", "TRACKING_OUTSIDE", "LOCATION_LOST"]) {
    const f = fixture(); f.observe(); f.advance(1); f.decision(state); f.advance(60_001);
    assert.equal(f.state().hiddenForNoData, true, state);
  }
  const corridor = fixture(); corridor.observe(); corridor.advance(1); corridor.decision("IN_REGION", "corridor"); corridor.advance(60_001);
  assert.equal(corridor.state().hasCurrentRoomAssignment, false);
});

test("timer decisions, duplicates, out-of-order and synthetic raw messages do not refresh the raw clock", () => {
  const f = fixture(); f.observe(); f.advance(30_000);
  assert.equal(f.observe(0), false);
  assert.equal(f.observe(-1), false);
  assert.equal(f.observe(30_000, { synthetic: true }), false);
  f.decision("TRACKING_OUTSIDE", null);
  assert.equal(f.state().lastRawReceivedAt, epoch);
  f.advance(60_001);
  assert.equal(f.state().hiddenForNoData, true);
  f.decision("LOCATION_LOST", null);
  assert.equal(f.state().hiddenForNoData, true);
});

test("fresh data recovers a tag, but a delayed historical backlog and future timestamps do not", () => {
  const f = fixture(); f.observe(); f.advance(130_000);
  f.observe(1_000);
  assert.equal(f.state().hiddenForNoData, true);
  assert.equal(f.observe(140_000), false);
  f.observe(130_000);
  assert.equal(f.state().hiddenForNoData, false);
  assert.equal(f.state().hiddenSince, null);
});

test("disabling the engine, losing a room, reconfiguring or moving floors removes the exemption immediately", () => {
  for (const action of ["disable", "lost", "reload", "move"]) {
    const f = fixture(); f.observe(); f.advance(1); f.decision("INFERRED_IN_REGION"); f.advance(60_001);
    assert.equal(f.state().hiddenForNoData, false);
    if (action === "disable") f.service.setEngineEnabled(false);
    if (action === "lost") f.decision("LOCATION_LOST", null);
    if (action === "reload") f.service.invalidateMap("map-a");
    if (action === "move") {
      f.observe(60_001, { mapId: "map-b" }); f.advance(120_002);
      assert.equal(f.state().processed, undefined);
    }
    assert.equal(f.state().hiddenForNoData, true, action);
  }
});

test("changing the global timeout re-evaluates existing tags without restarting room inference", () => {
  const f = fixture(); f.observe(); f.advance(45_000);
  f.service.setSettings({ ...DEFAULT_SYSTEM_SETTINGS, tracking: { noDataHideAfterMs: 30_000 } });
  assert.equal(f.state().hiddenForNoData, true);
  f.service.setSettings({ ...DEFAULT_SYSTEM_SETTINGS, tracking: { noDataHideAfterMs: 120_000 } });
  assert.equal(f.state().hiddenForNoData, false);
});

test("restored observations keep their location but never restore a current room assignment", () => {
  const f = fixture(); f.observe(); f.advance(1); f.decision("IN_REGION");
  const old = f.state();
  const restored = new TagPresenceService(() => epoch + 90_000);
  restored.restore([old]);
  assert.equal(restored.get("T")?.processed, undefined);
  assert.equal(restored.get("T")?.hasCurrentRoomAssignment, false);
  assert.equal(restored.get("T")?.hiddenForNoData, true);
  assert.deepEqual(restored.get("T")?.lastObservedLocation, location);
});

test("last observed place uses raw geometry, handles corridors, ambiguous rooms and unresolved floors", () => {
  const region = (id: string, name: string, x: number, kind: "room" | "corridor" = "room") => ({ id, name, kind, color: "#ffffff",
    polygon: [[x, 0], [x + 5, 0], [x + 5, 5], [x, 5]].map(([x, y]) => ({ world: { x, y }, pixel: { x, y } })), roomCenter: null, entrances: [] });
  const config: RegionsConfig = { ...DEFAULT_REGIONS_CONFIG, map: { ...DEFAULT_REGIONS_CONFIG.map, mapId: "map-a" }, regions: [region("A", "Oda 103", 0), region("C", "Koridor", 6, "corridor")] };
  const f = fixture();
  assert.equal(resolveLastObservedLocation(f.raw(), undefined, config).regionName, "Oda 103");
  assert.equal(resolveLastObservedLocation(f.raw(0, { x: 7 }), undefined, config).regionName, "Koridor");
  assert.equal(resolveLastObservedLocation(f.raw(), undefined, { ...config, regions: [...config.regions, region("B", "Oda 104", 0)] }).regionId, null);
  assert.equal(resolveLastObservedLocation(f.raw(0, { mapId: null }), undefined, config).mapId, null);
});
