import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cleanRegionsConfig } from "../app/api/regions/route";
import { DEFAULT_REGIONS_CONFIG } from "../src/features/regions/config/defaultRegionsConfig";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import { RegionPositionEngine } from "../src/server/regionEngine/RegionPositionEngine";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import type { ProcessedPosition } from "../src/server/regionEngine/types";
import { scenarioConfig } from "../test_api/room_scenarios.js";

const epoch = Date.parse("2026-10-13T00:00:00Z");
function setup(overrides: RegionsConfig["engine"] = {}) {
  const base = scenarioConfig() as RegionsConfig;
  const far = base.regions[1];
  const config: RegionsConfig = { ...base, engine: { ...base.engine, maximumStepDistanceMeters: 10, relocationConfirmationCount: 2, ...overrides },
    regions: [...base.regions, { ...far, id: "C", name: "Far room", entrances: [],
      polygon: far.polygon.map(pair => ({ pixel: { ...pair.pixel, x: pair.pixel.x + 12 }, world: { ...pair.world, x: pair.world.x + 12 } })),
      roomCenter: { pixel: { ...far.roomCenter!.pixel, x: far.roomCenter!.pixel.x + 12 }, world: { ...far.roomCenter!.world, x: far.roomCenter!.world.x + 12 } },
    }] };
  let clock = epoch;
  const published: ProcessedPosition[] = [];
  const engine = new RegionPositionEngine(p => published.push(p), 250, () => clock, false);
  engine.enable(compileRegionsConfig(config));
  return { config, engine, published,
    point(t: number, x: number, y = -3, tagCode = "T", quality = 1, deliveredAt = t) {
      clock = epoch + deliveredAt;
      return engine.ingest({ tagCode, x, y, quality, mapId: config.map.mapId, timestamp: new Date(epoch + t).toISOString() });
    },
    tick(t: number) { clock = epoch + t; engine.tick(); return published.at(-1); },
    state(tag = "T") { return engine.getVehicleState(tag)!; },
    enter() { this.point(0, 3, 3); this.point(1000, 3, 3); return this.point(2000, 3, 3)!; },
  };
}
const codes = (p: ProcessedPosition | undefined) => p?.decisionTrace?.reasons.map(reason => reason.code) ?? [];
const step = (p: ProcessedPosition | undefined) => p?.decisionTrace?.evidence?.stepDistance;

test("existing maps and the new-map template enable 10 metres and 2 relocation measurements", () => {
  for (const map of ["spor-koridor", "kat1-ortopedi", "necmettin-yogun-bakim", "necmettin-servis"]) {
    const config = JSON.parse(readFileSync(new URL(`../config/maps/${map}/regions.json`, import.meta.url), "utf8")) as RegionsConfig;
    const compiled = compileRegionsConfig(config);
    assert.equal(compiled.rules.maximumStepDistanceMeters, 10, map);
    assert.equal(compiled.rules.relocationConfirmationCount, 2, map);
    assert.equal(cleanRegionsConfig(config).engine!.maximumStepDistanceMeters, 10);
    assert.ok(compiled.regions.every(room => room.settings.maximumStepDistanceMeters === 10));
  }
  assert.equal(DEFAULT_REGIONS_CONFIG.engine!.maximumStepDistanceMeters, 10);
  const fallback = JSON.parse(readFileSync(new URL("../config/regions.json", import.meta.url), "utf8")) as RegionsConfig;
  assert.equal(compileRegionsConfig(fallback).rules.maximumStepDistanceMeters, 10);
  assert.equal(compileRegionsConfig(scenarioConfig() as RegionsConfig).rules.maximumStepDistanceMeters, 0);
});

test("distance rejection is independent of speed and preserves accepted timing, history and cadence", () => {
  const s = setup(); s.point(0, 0); const cadence = s.state().cadence;
  const rejected = s.point(6000, 20)!;
  assert.equal(rejected.decisionTrace?.eventType, "MEASUREMENT_REJECTED");
  assert.deepEqual(codes(rejected), ["MEASUREMENT_REJECTED_BY_DISTANCE"]);
  assert.equal(step(rejected)?.distanceMeters, 20);
  assert.equal(step(rejected)?.maximumDistanceMeters, 10);
  assert.equal(step(rejected)?.reference.x, 0);
  assert.equal(step(rejected)?.candidateCount, 1);
  assert.equal(s.state().lastRawPosition.x, 0);
  assert.equal(s.state().lastRawDataTimestamp, epoch);
  assert.equal(s.state().lastSeenRawDataTimestamp, epoch + 6000);
  assert.equal(s.state().cadence, cadence);
  assert.equal(s.state().history.length, 1);
});

test("distance equality passes, an excess fails, and a sub-threshold point still obeys speed", () => {
  const equal = setup(); equal.point(0, 0);
  assert.equal(equal.point(3000, 10)?.decisionTrace?.eventType, "MEASUREMENT_ACCEPTED");
  const above = setup(); above.point(0, 0);
  assert.ok(codes(above.point(3000, 10.0001)).includes("MEASUREMENT_REJECTED_BY_DISTANCE"));
  const fast = setup(); fast.point(0, 0);
  assert.deepEqual(codes(fast.point(10, 1)), ["MEASUREMENT_REJECTED_BY_SPEED"]);
  assert.equal(fast.state().distanceFilter.reference?.x, 0);
});

test("both violated filters are logged, while a long gap never exempts the distance limit", () => {
  const fast = setup(); fast.point(0, 0);
  assert.deepEqual(codes(fast.point(1000, 20)), ["MEASUREMENT_REJECTED_BY_DISTANCE", "MEASUREMENT_REJECTED_BY_SPEED"]);
  const gap = setup(); gap.point(0, 0);
  assert.deepEqual(codes(gap.point(40000, 20)), ["MEASUREMENT_REJECTED_BY_DISTANCE"]);
  assert.equal(gap.state().distanceFilter.reference?.x, 0);
  assert.equal(gap.state().lastRawDataTimestamp, epoch);
});

test("two coherent distant samples reset only the reference, and subsequent samples must reprove the room", () => {
  const s = setup({ maximumSpeedMetersPerSecond: 20 }); s.enter();
  const oldSupport = s.state().lastSupportAt;
  const beforeHistory = s.state().history.length;
  const first = s.point(4000, 21, 3)!;
  assert.equal(first.regionInference.regionId, "A");
  assert.equal(s.state().history.length, beforeHistory);
  assert.equal(s.state().roomSwitchCandidate, null);
  const reset = s.point(5500, 21.2, 3)!;
  assert.equal(step(reset)?.candidateCount, 2);
  assert.equal(step(reset)?.candidateDurationMs, 1500);
  assert.equal(step(reset)?.referenceReset, true);
  assert.equal(step(reset)?.usedAsRoomEvidence, false);
  assert.ok(codes(reset).includes("DISTANCE_REFERENCE_REESTABLISHED"));
  assert.equal(reset.decisionTrace?.eventType, "MEASUREMENT_REJECTED");
  assert.equal(reset.regionInference.state, "LOCATION_LOST");
  assert.equal(reset.regionInference.regionId, null);
  assert.equal(reset.regionInference.lastKnownRegionId, "A");
  assert.equal(reset.regionInference.measurementKind, "uncertain");
  assert.equal(s.state().distanceFilter.reference?.x, 21.2);
  assert.equal(s.state().lastRawDataTimestamp, epoch + 2000);
  assert.equal(s.state().lastSupportAt, oldSupport);
  assert.equal(s.state().history.length, 0);
  assert.equal(s.state().insideConfirmationCount, 0);
  assert.equal(s.state().exitConfirmationCount, 0);
  assert.equal(s.state().reliableRaw, null);
  assert.equal(s.state().lastReliableLocation, null);
  assert.equal(s.state().silentDoorCandidate, null);
  s.tick(5750);
  const next = s.point(6500, 21.3, 3)!;
  assert.equal(next.regionInference.state, "ENTRY_CANDIDATE");
  assert.equal(s.state().history.length, 1);
  assert.equal(s.state().insideConfirmationCount, 1);
  assert.equal(s.state().crossing, null);
  s.point(7500, 21.3, 3);
  const confirmed = s.point(9500, 21.3, 3)!;
  assert.equal(confirmed.regionInference.regionId, "C");
  assert.equal(confirmed.regionInference.state, "IN_REGION");
  assert.ok(s.published.every(p => p.decisionTrace?.eventType !== "ROOM_TRANSITIONED"));
});

test("returning to the accepted location cancels the distant candidate", () => {
  const s = setup(); s.point(0, 0); s.point(2000, 20);
  assert.equal(s.point(3000, .5)?.decisionTrace?.eventType, "MEASUREMENT_ACCEPTED");
  assert.equal(s.state().distanceFilter.reference?.x, .5);
  assert.equal(step(s.point(4500, 20))?.candidateCount, 1);
});

test("two rapid samples do not reset before minimum duration and timers never confirm candidates", () => {
  const s = setup(); s.point(0, 0); s.point(4000, 20);
  assert.equal(step(s.point(4100, 20.1))?.referenceReset, false);
  assert.equal(step(s.point(4500, 20.2))?.referenceReset, false);
  s.tick(5500);
  assert.equal(s.state().distanceFilter.reference?.x, 0);
  const confirmed = s.point(5500, 20.3);
  assert.equal(step(confirmed)?.referenceReset, true);
  assert.equal(step(confirmed)?.candidateCount, 2);
});

test("duplicates and out-of-order packets after rejection neither count nor erase the valid candidate", () => {
  const s = setup(); s.point(0, 0); s.point(4000, 20);
  const count = s.published.length;
  assert.equal(s.point(4000, 20.2), undefined);
  assert.equal(s.point(3000, 20.2), undefined);
  assert.equal(s.published.length, count);
  assert.equal(step(s.point(5500, 20.2))?.referenceReset, true);
});

test("low or non-finite quality breaks candidate continuity and cannot extend accepted validity", () => {
  for (const quality of [.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const s = setup(); s.point(0, 0); s.point(4000, 20);
    const bad = s.point(5500, 20.1, -3, "T", quality);
    assert.ok(codes(bad).includes("MEASUREMENT_REJECTED_BY_QUALITY"));
    assert.equal(step(bad)?.candidateCount, 0);
    assert.equal(s.state().lastRawDataTimestamp, epoch);
    assert.equal(step(s.point(7000, 20.2))?.candidateCount, 1);
    assert.equal(step(s.point(8500, 20.3))?.referenceReset, true);
  }
});

test("stale measurements break the candidate and do not infer a room or refresh its support", () => {
  const s = setup(); s.point(0, 0); s.point(4000, 20);
  const stale = s.point(5500, 20.1, -3, "T", 1, 20000);
  assert.ok(codes(stale).includes("MEASUREMENT_REJECTED_AS_STALE"));
  assert.equal(step(stale)?.candidateCount, 0);
  assert.equal(s.state().lastSupportAt, epoch);
  assert.equal(step(s.point(21000, 20.2))?.candidateCount, 1);
});

test("a speed violation between candidate points restarts the candidate even if the cluster radius passes", () => {
  const s = setup(); s.point(0, 0); s.point(4000, 20);
  assert.equal(step(s.point(4001, 20.8))?.candidateCount, 1);
  assert.equal(step(s.point(5501, 20.8))?.referenceReset, true);
});

test("cluster drift, excessive gaps and total window expiry restart verification", () => {
  const drift = setup(); drift.point(0, 0); drift.point(4000, 20);
  assert.equal(step(drift.point(5500, 21.1))?.candidateCount, 1);
  assert.equal(step(drift.point(7000, 21.2))?.referenceReset, true);
  const gap = setup(); gap.point(0, 0); gap.point(4000, 20); gap.tick(6001);
  assert.equal(step(gap.point(6500, 20.1))?.candidateCount, 1);
  const window = setup({ relocationCandidateWindowMs: 1500 }); window.point(0, 0); window.point(4000, 20);
  assert.equal(step(window.point(6000, 20.1))?.candidateCount, 1);
  const boundary = setup(); boundary.point(0, 0); boundary.point(4000, 20);
  assert.equal(step(boundary.point(6000, 21))?.referenceReset, true);
});

test("distance-rejected room and corridor samples cannot create silent-door or room-switch evidence", () => {
  const s = setup();
  const silent: RegionsConfig = { ...s.config, regions: s.config.regions.map(room => ({ ...room, coverage: "silent",
    inference: { silentEntryMaxDistanceMeters: 1.5 } })) };
  s.engine.reload(compileRegionsConfig(silent)); s.enter();
  s.point(4000, 21, 3);
  assert.equal(s.state().roomSwitchCandidate, null);
  assert.deepEqual(s.state().lastReliableLocation, { kind: "room", regionId: "A" });
  s.point(5500, 21, -1);
  assert.equal(s.state().silentDoorCandidate, null);
  s.tick(10000);
  assert.notEqual(s.state().activeRegionId, "C");
  assert.equal(s.state().lastRawDataTimestamp, epoch + 2000);
});

test("continuous rejects age the accepted location to lost without adding evidence", () => {
  const s = setup(); s.point(0, 0); s.point(4000, 20);
  s.point(5500, 30); s.point(7000, 20); s.tick(40000);
  assert.equal(s.state().state, "LOCATION_LOST");
  assert.equal(s.state().lastRawDataTimestamp, epoch);
  assert.equal(s.state().history.length, 1);
});

test("tag removal, configuration reload and separate tags establish independent references", () => {
  const s = setup(); s.point(0, 0); s.point(1000, 20); s.point(1000, 30, -3, "U");
  assert.equal(s.state("U").distanceFilter.reference?.x, 30);
  assert.equal(s.state().distanceFilter.reference?.x, 0);
  s.engine.removeVehicle("T");
  assert.equal(s.point(2000, 40)?.decisionTrace?.eventType, "MEASUREMENT_ACCEPTED");
  s.point(4000, 60); s.engine.reload(compileRegionsConfig(s.config));
  assert.equal(s.state().distanceFilter.reference, null);
  assert.equal(s.point(5500, 80)?.decisionTrace?.eventType, "MEASUREMENT_ACCEPTED");
  assert.equal(s.state().history.length, 1);
  s.engine.disable(); s.engine.enable(compileRegionsConfig(s.config));
  assert.equal(s.point(7000, 100)?.decisionTrace?.eventType, "MEASUREMENT_ACCEPTED");
});

test("setting zero restores the existing speed/freshness/quality pipeline", () => {
  const s = setup({ maximumStepDistanceMeters: 0, maximumSpeedMetersPerSecond: 20 });
  s.point(0, 0);
  assert.equal(s.point(2000, 20)?.decisionTrace?.eventType, "MEASUREMENT_ACCEPTED");
  assert.equal(s.state().lastRawPosition.x, 20);
  assert.equal(step(s.published.at(-1)), undefined);
  assert.ok(codes(s.point(3000, 20, -3, "T", .1)).includes("MEASUREMENT_REJECTED_BY_QUALITY"));
});

test("configuration enforces finite map-wide parameters and keeps the filter in API round trips", () => {
  const base = setup().config;
  const valid = cleanRegionsConfig(base);
  assert.equal(valid.engine?.maximumStepDistanceMeters, 10);
  assert.equal(valid.engine?.relocationConfirmationCount, 2);
  for (const value of [-1, 101, NaN, Infinity, "10", null]) {
    assert.throws(() => compileRegionsConfig({ ...base, engine: { ...base.engine, maximumStepDistanceMeters: value } } as RegionsConfig));
  }
  for (const value of [0, 1, 2.5, Infinity]) {
    assert.throws(() => compileRegionsConfig({ ...base, engine: { ...base.engine, relocationConfirmationCount: value } }));
  }
  assert.throws(() => compileRegionsConfig({ ...base, engine: { ...base.engine, relocationClusterRadiusMeters: 11 } }), /yarıçapı/);
  assert.throws(() => compileRegionsConfig({ ...base, engine: { ...base.engine, relocationCandidateWindowMs: 1000 } }), /penceresini/);
  const badOverride = { ...base, regions: base.regions.map(room => ({ ...room, inference: { maximumStepDistanceMeters: 50 } })) };
  assert.throws(() => compileRegionsConfig(badOverride as RegionsConfig), /global/);
  assert.throws(() => cleanRegionsConfig(badOverride), /bilinmeyen alan/);
});
