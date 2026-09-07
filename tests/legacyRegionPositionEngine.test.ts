import assert from "node:assert/strict";
import test from "node:test";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import { LegacyRegionPositionEngine as RegionPositionEngine } from "../src/server/regionEngine/LegacyRegionPositionEngine";
import type { ProcessedPosition } from "../src/server/regionEngine/types";

const BASE_TIME = Date.parse("2026-07-21T12:00:00.000Z");

function regionsConfig(overrides: RegionsConfig["engine"] = {}): RegionsConfig {
  const pair = (x: number, y: number) => ({ pixel: { x, y }, world: { x, y } });
  return {
    engine: { entryConfirmationCount: 2, exitConfirmationCount: 2, exitMarginMeters: 0.5, ...overrides },
    map: {
      source: "system", mapId: "test", image: "/test.png", widthPx: 100, heightPx: 100,
      calibration: { type: "affine", points: [] },
    },
    regions: [{
      id: "room-a", name: "Room A", color: "#00a896",
      polygon: [pair(0, 0), pair(10, 0), pair(10, 10), pair(0, 10)],
      roomCenter: pair(5, 5), entrances: [],
    }],
  };
}

function raw(tagCode: string, x: number, y: number, offset = 0) {
  return { tagCode, x, y, timestamp: new Date(BASE_TIME + offset).toISOString() };
}

test("disabled engine does not process or mutate raw positions", () => {
  const published: ProcessedPosition[] = [];
  const engine = new RegionPositionEngine((position) => published.push(position), 1_000);
  const input = raw("vehicle-1", 2.25, 3.75);
  assert.equal(engine.ingest(input), undefined);
  assert.deepEqual(input, raw("vehicle-1", 2.25, 3.75));
  assert.equal(published.length, 0);
});

test("outside, entry, inferred pinning and confirmed exit preserve the expected coordinates", () => {
  let now = BASE_TIME;
  const published: ProcessedPosition[] = [];
  const engine = new RegionPositionEngine((position) => published.push(position), 1_000, () => now);
  engine.enable(compileRegionsConfig(regionsConfig()));
  try {
    assert.deepEqual(engine.ingest(raw("vehicle-1", 12, 3))?.positionSource, "RAW");
    assert.deepEqual(engine.ingest(raw("vehicle-1", 2, 3, 100))?.positionSource, "RAW");
    const entered = engine.ingest(raw("vehicle-1", 3, 4, 200));
    assert.deepEqual([entered?.x, entered?.y, entered?.positionSource], [5, 5, "REGION_CENTER"]);
    assert.deepEqual([entered?.rawPosition?.x, entered?.rawPosition?.y], [3, 4]);

    now += 1_500;
    engine.tick();
    const inferred = published.at(-1)!;
    assert.equal(inferred.regionInference.state, "INFERRED_IN_REGION");
    assert.deepEqual([inferred.x, inferred.y], [5, 5]);
    assert.equal(inferred.timestamp, new Date(now).toISOString());

    const marginProtected = engine.ingest(raw("vehicle-1", 10.2, 4, 1_600));
    assert.equal(marginProtected?.positionSource, "REGION_CENTER");
    const firstExit = engine.ingest(raw("vehicle-1", 11, 4, 1_700));
    assert.equal(firstExit?.regionInference.state, "EXIT_CANDIDATE");
    assert.deepEqual([firstExit?.x, firstExit?.y], [5, 5]);
    const exited = engine.ingest(raw("vehicle-1", 11.5, 4, 1_800));
    assert.deepEqual([exited?.x, exited?.y, exited?.positionSource], [11.5, 4, "RAW"]);
  } finally {
    engine.disable();
  }
});

test("one scheduler handles multiple vehicles and disable clears all state", () => {
  let now = BASE_TIME;
  const published: ProcessedPosition[] = [];
  const engine = new RegionPositionEngine((position) => published.push(position), 1_000, () => now);
  engine.enable(compileRegionsConfig(regionsConfig({ entryConfirmationCount: 1 })));
  engine.ingest(raw("vehicle-1", 1, 1));
  engine.ingest(raw("vehicle-2", 9, 9));
  assert.equal(engine.getStatus(3000, 3001).vehiclesInRegions, 2);
  now += 1_500;
  engine.tick();
  assert.equal(published.filter((item) => item.regionInference.state === "INFERRED_IN_REGION").length, 2);
  engine.disable();
  assert.deepEqual(engine.getStatus(3000, 3001), {
    enabled: false, rawPort: 3000, processedPort: 3001,
    activeVehicleCount: 0, vehiclesInRegions: 0, configLoaded: false,
  });
  assert.equal(engine.getVehicleState("vehicle-1"), undefined);
});

test("center-less regions are skipped and invalid rule config is rejected", () => {
  const base = regionsConfig();
  const centerless: RegionsConfig = { ...base, regions: [{ ...base.regions[0], roomCenter: null }] };
  assert.equal(compileRegionsConfig(centerless).regions.length, 0);
  assert.throws(() => compileRegionsConfig(regionsConfig({ exitConfirmationCount: 0 })), /exitConfirmationCount/);
});

