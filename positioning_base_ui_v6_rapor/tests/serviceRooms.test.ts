import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cleanRegionsConfig } from "../app/api/regions/route";
import { createAffineTransform } from "../src/features/regions/services/affineTransform";
import { CoordinateTransformService } from "../src/features/map/services/CoordinateTransformService";
import { resolveGlobalSettings } from "../src/features/regions/config/regionInferenceSettings";
import type { GlobalRegionEngineSettings, RegionsConfig } from "../src/features/regions/types/region.types";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import { crossesDoor, pointInPolygon, wallDistance } from "../src/server/regionEngine/geometry";
import { RegionPositionEngine } from "../src/server/regionEngine/RegionPositionEngine";
import { AreaTransitionEngine, type AreaTransitionEvent } from "../src/server/regionEngine/AreaTransitionEngine";

const config = JSON.parse(readFileSync("config/maps/necmettin-servis/regions.json", "utf8")) as RegionsConfig;
const source = JSON.parse(readFileSync("config/maps/necmettin-servis/source.floorplan.json", "utf8"));
const cleanedConfig = cleanRegionsConfig(config, "necmettin-servis");
const compiled = compileRegionsConfig(cleanedConfig);
const rooms = config.regions.filter(region => region.kind === "room");
const transform = createAffineTransform(config.map.calibration.points);
const map = JSON.parse(readFileSync("config/maps/necmettin-servis/map.json", "utf8"));
const motorTransform = new CoordinateTransformService(map.calibration);
const sourceTransform = new CoordinateTransformService({
  worldOrigin: source.map.worldOrigin, canvasOrigin: source.map.exportCalibration.originPixel,
  pixelsPerMeter: 100 / source.map.exportCalibration.centimetersPerPixel,
  invertYAxis: true, rotationDegrees: 0,
});
const cadToMotor = (point: { x: number; y: number }) => motorTransform.canvasToWorld(sourceTransform.worldToCanvas(point));
const motorToCad = (point: { x: number; y: number }) => sourceTransform.canvasToWorld(motorTransform.worldToCanvas(point));
const cadRooms = compiled.regions.map(room => {
  const polygon = room.polygon.map(motorToCad);
  return { ...room, polygon, bounds: {
    minX: Math.min(...polygon.map(point => point.x)), maxX: Math.max(...polygon.map(point => point.x)),
    minY: Math.min(...polygon.map(point => point.y)), maxY: Math.max(...polygon.map(point => point.y)),
  } };
});
const epoch = Date.parse("2026-10-09T12:00:00Z");
const serviceThresholds = {
  entryEvidenceDurationMs: 2000, exitEvidenceDurationMs: 1500,
  entryConfirmationCount: 5, exitConfirmationCount: 3,
  maximumSpeedMetersPerSecond: 3, maximumStepDistanceMeters: 10,
} as const;

function assertServiceThresholds(settings: Pick<GlobalRegionEngineSettings, keyof typeof serviceThresholds>, label: string) {
  for (const key of Object.keys(serviceThresholds) as (keyof typeof serviceThresholds)[]) {
    assert.equal(settings[key], serviceThresholds[key], `${label}/${key}`);
  }
}

const SILENT_ENTRY_M = 1.3;

test("Servis has 21 silent rooms with 1.3 m door proximity, configured door geometry and its own entry/exit thresholds", () => {
  assert.equal(compiled.regions.length, 21);
  assert.equal(compiled.corridors.length, 1);
  assert.deepEqual(compiled.warnings, []);
  assertServiceThresholds(resolveGlobalSettings(config.engine), "Servis");
  assertServiceThresholds(compiled.rules, "Servis/compiled");
  assert.deepEqual(cleanedConfig.positionAnimation, config.positionAnimation);
  assert.deepEqual(cleanedConfig.mapDisplay, config.mapDisplay);
  assert.deepEqual(rooms.map(room => room.name), ["Dr Odası", "201", "202", "203", "204", "205", "206", "207", "208", "209",
    "217", "216", "215", "214", "213", "212", "211", "210", "Hemşire Bankosu", "Personel Odası", "Derslik"]);
  for (const room of compiled.regions) {
    assertServiceThresholds(room.settings, room.name ?? room.id);
    assert.equal(room.settings.coverage, "silent");
    // 13 Ekim: kapı sinyal kaybı mesafesi sahada 1 m'den 1,3 m'ye çıkarıldı (config).
    assert.equal(room.settings.silentEntryMaxDistanceMeters, SILENT_ENTRY_M);
    assert.equal(room.entrances.length, room.id === "room-21" ? 2 : 1);
    for (const door of room.entrances) {
      const configuredDoor = config.regions.find(candidate => candidate.id === room.id)?.entrances.find(candidate => candidate.id === door.id);
      assert.ok(configuredDoor, room.name);
      assert.equal(door.widthMeters, configuredDoor.widthMeters);
      assert.equal(door.connectsTo, "corridor-main");
      assert.equal(door.approachDepthMeters, configuredDoor.approachDepthMeters ?? 2);
      assert.equal(door.settings.enabled, true);
      assert.equal(door.settings.direction, "bidirectional");
      assert.equal(door.settings.evidenceMode, "preferred");
    }
  }
});

test("each Servis door retains its signal-loss threshold (1.3 m) independently of nearby doors", () => {
  for (const room of compiled.regions) {
    for (const distance of [SILENT_ENTRY_M - 0.01, SILENT_ENTRY_M + 0.01]) {
      let now = epoch;
      const published: ReturnType<RegionPositionEngine["ingest"]>[] = [];
      const engine = new RegionPositionEngine(position => published.push(position), 250, () => now, false);
      engine.enable({ ...compiled, regions: compiled.regions.map(candidate => candidate.id === room.id ? candidate : {
        ...candidate, settings: { ...candidate.settings, silentEntryMaxDistanceMeters: 0 },
      }) });
      const door = room.entrances[0];
      const point = { x: door.x - door.inwardNormal!.x * distance,
        y: door.y - door.inwardNormal!.y * distance };
      assert.ok(pointInPolygon(point, compiled.corridors[0]), room.name);
      try {
        const measured = engine.ingest({ tagCode: room.id, ...point, quality: 1,
          timestamp: new Date(now).toISOString() })!;
        assert.equal(measured.regionInference.regionId, null, room.name);
        now = epoch + 8001;
        engine.tick();
        const decision = published.at(-1)!;
        if (distance < SILENT_ENTRY_M) {
          assert.equal(decision.regionInference.regionId, room.id, room.name);
          assert.equal(decision.regionInference.state, "INFERRED_IN_REGION", room.name);
          assert.equal(decision.regionInference.measurementKind, "estimated", room.name);
        } else {
          assert.equal(decision.regionInference.regionId, null, room.name);
          assert.equal(decision.regionInference.state, "LOCATION_LOST", room.name);
        }
      } finally { engine.disable(); }
    }
  }
});

test("door proximity (1.3 m) prevents inference in the corridor between opposing moved doors", () => {
  for (const room of compiled.regions) {
    for (const distance of [1, SILENT_ENTRY_M - 0.01, SILENT_ENTRY_M + 0.01, 2, 2.01]) {
      let now = epoch;
      const published: ReturnType<RegionPositionEngine["ingest"]>[] = [];
      const engine = new RegionPositionEngine(position => published.push(position), 250, () => now, false);
      engine.enable(compiled);
      const door = room.entrances[0];
      const point = { x: door.x - door.inwardNormal!.x * distance, y: door.y - door.inwardNormal!.y * distance };
      // These samples beyond this door's 1.3 m limit also remain beyond
      // the opposing door's limit in the updated corridor.
      const expectedRegionId = distance < SILENT_ENTRY_M ? room.id : null;
      try {
        assert.ok(pointInPolygon(point, compiled.corridors[0]), room.name);
        engine.ingest({ tagCode: room.id, ...point, quality: 1, timestamp: new Date(now).toISOString() });
        now = epoch + 8001;
        engine.tick();
        const decision = published.at(-1)!;
        assert.equal(decision.regionInference.regionId, expectedRegionId, `${room.name}: ${distance} m`);
        assert.equal(decision.regionInference.state, expectedRegionId ? "INFERRED_IN_REGION" : "LOCATION_LOST");
      } finally { engine.disable(); }
    }
  }
});

test("existing Servis CAD labels and all 21 room centres retain their calibration", () => {
  for (const room of rooms) {
    const compiledRoom = compiled.regions.find(region => region.id === room.id)!;
    // The original CAD export predates the three rooms added in v4.2.
    if (Number(room.id.slice(5)) <= 18) {
      const label = source.objects.find((object: { type: string; text?: string }) => object.type === "text" && object.text === room.name);
      assert.ok(label, room.name);
      assert.ok(pointInPolygon(cadToMotor(label.position), compiledRoom), `${room.name}: CAD label must be in its own room`);
    }
    assert.ok(pointInPolygon(room.roomCenter!.world, compiledRoom));
  }
  for (const region of [...config.regions, ...config.largeAreas!]) {
    const points = "entrances" in region ? [...region.polygon, ...(region.roomCenter ? [region.roomCenter] : []), ...region.entrances]
      : region.polygon;
    for (const point of points) {
      const world = transform(point.pixel);
      assert.ok(Math.abs(world.x - point.world.x) < 1e-8);
      assert.ok(Math.abs(world.y - point.world.y) < 1e-8);
    }
  }
  // The edited gate stores world coordinates to millimetres and pixels to 0.01 px.
  for (const point of config.largeAreas!.flatMap(area => area.gates.flatMap(gate => gate.polygon))) {
    const world = transform(point.pixel);
    assert.ok(Math.abs(world.x - point.world.x) < 0.0005);
    assert.ok(Math.abs(world.y - point.world.y) < 0.0005);
  }
});

test("updated rooms retain their rear extensions and adjacent rows remain separate", () => {
  for (const [index, room] of cadRooms.entries()) {
    if (index < 10) assert.ok(Math.abs(room.bounds.maxY - 22.68890959210326 - 3) < 0.000001, room.name);
    else assert.ok(Math.abs(2.2389095921034 - room.bounds.minY - 3) < 0.000001, room.name);
  }
  for (const row of [cadRooms.slice(0, 10), cadRooms.slice(10)].map(row => row.sort((a, b) => a.bounds.minX - b.bounds.minX))) {
    for (let index = 1; index < row.length; index++) {
      const gap = row[index].bounds.minX - row[index - 1].bounds.maxX;
      assert.ok(gap >= -0.000001, `${row[index - 1].name}/${row[index].name}: room interiors must remain separate`);
    }
  }
});

test("updated door normals point into their rooms and all room and corridor interiors remain separate", () => {
  const corridor = compiled.corridors[0];
  for (const [index, room] of compiled.regions.entries()) {
    const top = index < 10;
    for (const door of room.entrances) {
      assert.deepEqual(door.inwardNormal, { x: top ? -1 : 1, y: 0 });
      const expectedWallDistance = room.id === "room-19" ? 0 : 0.1;
      assert.ok(Math.abs(wallDistance(door, room) - expectedWallDistance) < 0.000001, room.name);
      const inside = { x: door.x + door.inwardNormal.x * 0.4, y: door.y };
      const outside = { x: door.x - door.inwardNormal.x * 0.4, y: door.y };
      assert.ok(pointInPolygon(inside, room), `${room.name}/${door.id}: normal points inside`);
      assert.equal(pointInPolygon(outside, room), false, `${room.name}/${door.id}: approach stays outside`);
      assert.equal(crossesDoor(outside, inside, room, true, "corridor-main", epoch)?.doorId, door.id);
      assert.equal(crossesDoor(inside, outside, room, false, "corridor-main", epoch)?.doorId, door.id);
    }
  }
  // Sample the full extended area; no traversable interior belongs to two regions.
  const regions = [...compiled.regions, corridor];
  for (let x = 1.6; x < 49.7; x += 0.37) for (let y = -0.6; y < 25.7; y += 0.41) {
    const inside = regions.filter(region => pointInPolygon(cadToMotor({ x, y }), region));
    assert.ok(inside.length <= 1, `overlap at ${x}, ${y}: ${inside.map(region => region.id).join(", ")}`);
  }
});

test("reliable measurements in the completed recess confirm its room and exit through the moved door", () => {
  for (const room of compiled.regions) {
    let now = epoch;
    const engine = new RegionPositionEngine(() => undefined, 250, () => now, false);
    engine.enable(compiled);
    const door = room.entrances[0];
    const send = (second: number, distance: number) => {
      now = epoch + second * 1000;
      return engine.ingest({ tagCode: room.id, x: door.x + door.inwardNormal!.x * distance,
        y: door.y + door.inwardNormal!.y * distance, quality: 1, timestamp: new Date(now).toISOString() })!;
    };
    try {
      send(0, -1);
      for (let second = 1; second <= 4; second++) assert.equal(send(second, 0.6).regionInference.regionId, null, room.name);
      assert.equal(send(5, 0.6).regionInference.regionId, room.id, room.name);
      assert.equal(send(6, 0.4).regionInference.regionId, room.id, room.name);
      send(7, -1); send(8, -1.5);
      assert.equal(send(9, -2).regionInference.regionId, null, room.name);
    } finally { engine.disable(); }
  }
});

test("every Servis room requires both five reliable measurements and two seconds before confirming entry", () => {
  for (const room of compiled.regions) for (const times of [[1, 2, 3, 4, 5], [1, 1.4, 1.8, 2.2, 2.6, 3]]) {
    let now = epoch;
    const engine = new RegionPositionEngine(() => undefined, 250, () => now, false);
    engine.enable(compiled);
    const door = room.entrances[0];
    const send = (seconds: number, distance: number) => {
      now = epoch + seconds * 1000;
      return engine.ingest({ tagCode: room.id, x: door.x + door.inwardNormal!.x * distance,
        y: door.y + door.inwardNormal!.y * distance,
        quality: 1, timestamp: new Date(now).toISOString() })!;
    };
    const atInside = (seconds: number) => {
      now = epoch + seconds * 1000;
      return engine.ingest({ tagCode: room.id, x: door.x + door.inwardNormal!.x * 0.6,
        y: door.y + door.inwardNormal!.y * 0.6, quality: 1,
        timestamp: new Date(now).toISOString() })!;
    };
    try {
      send(0, -1);
      for (const second of times.slice(0, -1)) {
        assert.equal(atInside(second).regionInference.regionId, null, room.name);
      }
      assert.equal(atInside(times.at(-1)!).regionInference.regionId, room.id, room.name);
      send(6, 0.75); send(7, -1); send(8, -1.5);
      assert.equal(send(9, -2).regionInference.regionId, null, room.name);
    } finally { engine.disable(); }
  }
});

test("configured Servis gates record area entry and observed exit using their own wait settings", () => {
  assert.equal(compiled.largeAreas.length, 1);
  assert.equal(compiled.largeAreas[0].name, "Servis");
  assert.ok(compiled.largeAreas[0].gates.length > 0);
  const edge = motorToCad(compiled.largeAreas[0].polygon[0]).x;
  for (const [index, gate] of compiled.largeAreas[0].gates.entries()) {
    const configuredGate = config.largeAreas?.flatMap(area => area.gates).find(candidate => candidate.id === gate.id);
    assert.ok(configuredGate, gate.id);
    assert.equal(gate.waitMs, configuredGate.waitMs);
    assert.equal(gate.role, "bidirectional");
    const events: AreaTransitionEvent[] = [];
    const engine = new AreaTransitionEngine(new Map([[config.map.mapId, compiled]]), event => events.push(event));
    const y = gate.polygon.reduce((sum, point) => sum + motorToCad(point).y, 0) / gate.polygon.length;
    const send = (seconds: number, distance: number) => engine.ingest({
      tagCode: `GATE-${index}`, mapId: config.map.mapId, ...cadToMotor({ x: edge + distance, y }), quality: 0.9,
      timestamp: new Date(epoch + seconds * 1000).toISOString(),
    }, epoch + seconds * 1000);
    send(0, -2.5); send(1, 0); send(2, 1); send(3, 1.5);
    send(4, 0); send(5, -2); send(6, -2.5);
    assert.deepEqual(events.map(event => event.type), ["AREA_ENTERED", "AREA_EXITED_OBSERVED"]);
    assert.ok(events.every(event => event.gateId === gate.id));
  }
});
