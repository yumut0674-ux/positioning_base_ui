import assert from "node:assert/strict";
import test from "node:test";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import { RegionPositionEngine } from "../src/server/regionEngine/RegionPositionEngine";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import { scenarioConfig } from "../test_api/room_scenarios.js";

const epoch = Date.parse("2026-10-08T15:02:00Z");
const pair = (x: number, y: number) => ({ pixel: { x, y }, world: { x, y } });
function config(mode?: "preferred" | "required", connection = "corridor-main"): RegionsConfig {
  const base = scenarioConfig() as RegionsConfig;
  return { ...base, engine: { ...base.engine, maximumSpeedMetersPerSecond: 10 }, regions: [
    { id: "corridor-main", name: "Koridor", kind: "corridor", color: "#64748b", polygon: [pair(0, -3), pair(12, -3), pair(12, 0), pair(0, 0)], roomCenter: null, entrances: [] },
    ...base.regions.map(room => ({ ...room, entrances: room.entrances.map(door => ({ ...door, connectsTo: connection })),
      ...(mode ? { inference: { doorDefaults: { evidenceMode: mode } } } : {}) })),
  ] };
}
function setup(value = config()) {
  let now = epoch;
  const engine = new RegionPositionEngine(() => undefined, 250, () => now, false);
  engine.enable(compileRegionsConfig(value));
  return { engine, point(t: number, x: number, y: number, quality?: number) {
    now = epoch + t;
    return engine.ingest({ tagCode: "T", x, y, timestamp: new Date(now).toISOString(), quality })!;
  }, tick(t: number) { now = epoch + t; engine.tick(); }, enter() { this.point(0, 3, 3); return this.point(2000, 3, 3); } };
}

test("default preferred policy releases a room after sustained reliable corridor evidence without a door crossing", () => {
  for (const mode of [undefined, "preferred"] as const) {
    const s = setup(config(mode));
    assert.equal(s.enter().regionInference.regionId, "A");
    assert.equal(s.point(3000, 5, -1).regionInference.state, "EXIT_CANDIDATE");
    assert.equal(s.engine.getVehicleState("T")!.exitCrossing, null);
    assert.equal(s.point(4000, 5, -1).regionInference.regionId, "A");
    const exited = s.point(5000, 5, -1);
    assert.equal(exited.regionInference.regionId, null);
    assert.equal(exited.regionInference.state, "TRACKING_OUTSIDE");
    assert.equal(exited.positionSource, "RAW");
    s.engine.disable();
  }
});

test("named corridor connections and legacy corridor aliases both prove required door crossings", () => {
  for (const connection of ["corridor-main", "corridor"]) {
    const s = setup(config("required", connection));
    s.point(0, 3, -1); s.point(1000, 3, 0.6); s.point(2000, 3, 1); s.point(3000, 3, 2);
    assert.equal(s.engine.getVehicleState("T")!.activeRegionId, "A");
    s.point(4000, 3, 0.6);
    assert.equal(s.point(5000, 3, -0.6).regionInference.state, "EXIT_CANDIDATE");
    assert.equal(s.engine.getVehicleState("T")!.exitCrossing?.doorId, "door-0");
    s.point(6000, 3, -1);
    assert.equal(s.point(7000, 3, -1).regionInference.regionId, null);
    s.engine.disable();
  }
});

test("a different named corridor cannot satisfy the required door connection", () => {
  const value = config("required", "corridor-other");
  const s = setup({ ...value, regions: [...value.regions,
    { ...value.regions[0], id: "corridor-other", polygon: [pair(20, -3), pair(30, -3), pair(30, 0), pair(20, 0)] },
  ] });
  s.point(0, 3, -1); s.point(1000, 3, 0.6); s.point(2000, 3, 1); s.point(3000, 3, 2);
  assert.equal(s.engine.getVehicleState("T")!.crossing, null);
  assert.equal(s.engine.getVehicleState("T")!.activeRegionId, null);
  s.engine.disable();
});

test("required doors still block a wall exit even with sustained reliable corridor data", () => {
  const s = setup(config("required"));
  s.point(0, 3, -1); s.point(1000, 3, 0.6); s.point(2000, 3, 1); s.point(3000, 3, 2);
  for (const t of [4000, 5000, 6000, 7000]) assert.equal(s.point(t, 5, -1).regionInference.regionId, "A");
  s.engine.disable();
});

test("a corridor spike, wall-band points, rejected packets and timers do not complete a preferred exit", () => {
  const s = setup(); s.enter();
  s.point(3000, 5, -1); s.tick(5000);
  assert.equal(s.engine.getVehicleState("T")!.exitConfirmationCount, 1);
  s.point(5100, 5, -1, 0.1);
  assert.equal(s.engine.getVehicleState("T")!.exitConfirmationCount, 1);
  s.point(5500, 3, 3);
  assert.equal(s.engine.getVehicleState("T")!.exitConfirmationCount, 0);
  for (const t of [6500, 7500, 8500]) assert.equal(s.point(t, 5, -0.1).regionInference.regionId, "A");
  s.engine.disable();
});

test("corridor evidence restarts after a long gap instead of releasing on one new packet", () => {
  const s = setup(); s.enter();
  s.point(3000, 5, -1); s.point(4000, 5, -1);
  assert.equal(s.point(9000, 5, -1).regionInference.regionId, "A");
  assert.equal(s.engine.getVehicleState("T")!.exitConfirmationCount, 1);
  s.point(10000, 5, -1);
  assert.equal(s.point(11000, 5, -1).regionInference.regionId, null);
  s.engine.disable();
});
