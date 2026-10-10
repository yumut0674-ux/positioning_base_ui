import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cleanRegionsConfig } from "../app/api/regions/route";
import { createAffineTransform } from "../src/features/regions/services/affineTransform";
import { CoordinateTransformService } from "../src/features/map/services/CoordinateTransformService";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import { pointInPolygon } from "../src/server/regionEngine/geometry";
import { RegionPositionEngine } from "../src/server/regionEngine/RegionPositionEngine";
import { AreaTransitionEngine, type AreaTransitionEvent } from "../src/server/regionEngine/AreaTransitionEngine";

const config = JSON.parse(readFileSync("config/maps/necmettin-servis/regions.json", "utf8")) as RegionsConfig;
const reference = JSON.parse(readFileSync("config/maps/necmettin-yogun-bakim/regions.json", "utf8")) as RegionsConfig;
const source = JSON.parse(readFileSync("config/maps/necmettin-servis/source.floorplan.json", "utf8"));
const compiled = compileRegionsConfig(cleanRegionsConfig(config, "necmettin-servis"));
const referenceCompiled = compileRegionsConfig(reference);
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

test("Servis has 18 rooms, one corridor and intensive-care motor, room and door settings", () => {
  assert.equal(compiled.regions.length, 18);
  assert.equal(compiled.corridors.length, 1);
  assert.deepEqual(compiled.warnings, []);
  assert.deepEqual(config.engine, reference.engine);
  assert.deepEqual(config.positionAnimation, reference.positionAnimation);
  assert.deepEqual(config.mapDisplay, reference.mapDisplay);
  assert.deepEqual(compiled.areaTracking, referenceCompiled.areaTracking);
  assert.deepEqual(rooms.map(room => room.name), Array.from({ length: 18 }, (_, index) => `Oda ${index + 1}`));
  for (const [index, room] of compiled.regions.entries()) {
    const template = referenceCompiled.regions[index % referenceCompiled.regions.length];
    assert.deepEqual(room.settings, template.settings);
    assert.equal(room.entrances.length, 1);
    assert.equal(room.entrances[0].widthMeters, template.entrances[0].widthMeters);
    assert.equal(room.entrances[0].connectsTo, "corridor-main");
    assert.deepEqual(room.entrances[0].settings, template.entrances[0].settings);
  }
});

test("room numbering follows the Servis CAD labels and all coordinates use Servis calibration", () => {
  for (const room of rooms) {
    const label = source.objects.find((object: { type: string; text?: string }) => object.type === "text" && object.text === room.name);
    assert.ok(label, room.name);
    const compiledRoom = compiled.regions.find(region => region.id === room.id)!;
    assert.ok(pointInPolygon(cadToMotor(label.position), compiledRoom), `${room.name}: CAD label must be in its own room`);
    assert.ok(pointInPolygon(room.roomCenter!.world, compiledRoom));
  }
  for (const region of [...config.regions, ...config.largeAreas!]) {
    const points = "entrances" in region ? [...region.polygon, ...(region.roomCenter ? [region.roomCenter] : []), ...region.entrances]
      : [...region.polygon, ...region.gates.flatMap(gate => gate.polygon)];
    for (const point of points) {
      const world = transform(point.pixel);
      assert.ok(Math.abs(world.x - point.world.x) < 1e-8);
      assert.ok(Math.abs(world.y - point.world.y) < 1e-8);
    }
  }
});

test("rooms extend three metres behind their rear walls and adjacent rooms have a ten centimetre gap", () => {
  for (const [index, room] of cadRooms.entries()) {
    if (index < 10) assert.ok(Math.abs(room.bounds.maxY - 22.68890959210326 - 3) < 1e-8);
    else assert.ok(Math.abs(2.2389095921034 - room.bounds.minY - 3) < 1e-8);
  }
  for (const row of [cadRooms.slice(0, 10), cadRooms.slice(10)]) {
    for (let index = 1; index < row.length; index++) {
      const gap = row[index].bounds.minX - row[index - 1].bounds.maxX;
      // Oda 14 and 15 are separated by the central service/corridor block.
      if (row[index].id === "room-15") assert.ok(gap > 8);
      else assert.ok(Math.abs(gap - 0.1) < 1e-8);
    }
  }
});

test("bathroom wings stay with their rooms and the corridor excludes them and the utility shafts", () => {
  const corridor = compiled.corridors[0];
  for (const room of compiled.regions) {
    const top = Number(room.id.slice(-2)) <= 10;
    const door = room.entrances[0];
    assert.deepEqual(door.inwardNormal, { x: top ? -1 : 1, y: 0 });
    const direction = top ? 1 : -1;
    assert.ok(pointInPolygon({ x: door.x + door.inwardNormal.x * 0.4, y: door.y }, room));
    assert.ok(pointInPolygon({ x: door.x - door.inwardNormal.x * 0.4, y: door.y }, corridor));
    const cadRoom = cadRooms.find(candidate => candidate.id === room.id)!;
    const bathroom = cadToMotor({ x: (cadRoom.polygon[2].x + cadRoom.polygon[3].x) / 2,
      y: motorToCad(door).y - direction * 0.5 });
    assert.ok(pointInPolygon(bathroom, room), room.name);
    assert.equal(pointInPolygon(bathroom, corridor), false, room.name);
  }
  // Sample the full extended area; no traversable interior belongs to two regions.
  const regions = [...compiled.regions, corridor];
  for (let x = 1.6; x < 49.7; x += 0.37) for (let y = -0.6; y < 25.7; y += 0.41) {
    const inside = regions.filter(region => pointInPolygon(cadToMotor({ x, y }), region));
    assert.ok(inside.length <= 1, `overlap at ${x}, ${y}: ${inside.map(region => region.id).join(", ")}`);
  }
});

test("every Servis room confirms entry and releases back to the corridor with the intensive-care policy", () => {
  for (const room of compiled.regions) {
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
    const atCentre = (seconds: number) => {
      now = epoch + seconds * 1000;
      return engine.ingest({ tagCode: room.id, ...room.roomCenter, quality: 1,
        timestamp: new Date(now).toISOString() })!;
    };
    try {
      send(0, -1); send(1, 0.75); atCentre(2); atCentre(3);
      assert.equal(atCentre(4).regionInference.regionId, room.id, room.name);
      send(5, 0.75); send(6, -1); send(7, -1.5);
      assert.equal(send(8, -2).regionInference.regionId, null, room.name);
    } finally { engine.disable(); }
  }
});

test("configured Servis gates record area entry and observed exit using the intensive-care wait settings", () => {
  assert.equal(compiled.largeAreas.length, 1);
  assert.equal(compiled.largeAreas[0].name, "Servis");
  assert.ok(compiled.largeAreas[0].gates.length > 0);
  const edge = motorToCad(compiled.largeAreas[0].polygon[0]).x;
  for (const [index, gate] of compiled.largeAreas[0].gates.entries()) {
    assert.equal(gate.waitMs, referenceCompiled.largeAreas[0].gates[index % referenceCompiled.largeAreas[0].gates.length].waitMs);
    assert.equal(gate.role, "bidirectional");
    const events: AreaTransitionEvent[] = [];
    const engine = new AreaTransitionEngine(new Map([[config.map.mapId, compiled]]), event => events.push(event));
    const y = gate.polygon.reduce((sum, point) => sum + motorToCad(point).y, 0) / gate.polygon.length;
    const send = (seconds: number, distance: number) => engine.ingest({
      tagCode: `GATE-${index}`, mapId: config.map.mapId, ...cadToMotor({ x: edge + distance, y }), quality: 0.9,
      timestamp: new Date(epoch + seconds * 1000).toISOString(),
    }, epoch + seconds * 1000);
    send(0, -1); send(1, 0); send(2, 1); send(3, 1.5);
    send(4, 0); send(5, -1); send(6, -1.5);
    assert.deepEqual(events.map(event => event.type), ["AREA_ENTERED", "AREA_EXITED_OBSERVED"]);
    assert.ok(events.every(event => event.gateId === gate.id));
  }
});
