import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cleanRegionsConfig } from "../app/api/regions/route";
import { createAffineTransform } from "../src/features/regions/services/affineTransform";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import { AreaTransitionEngine, type AreaTransitionEvent } from "../src/server/regionEngine/AreaTransitionEngine";

const config = JSON.parse(readFileSync("config/maps/necmettin-yogun-bakim/regions.json", "utf8")) as RegionsConfig;
const rooms = config.regions.filter((room) => room.kind === "room");
const transform = createAffineTransform(config.map.calibration.points);
const physicalWalls = [134.5, 646, 1164, 1682, 2200, 2718, 3236, 3705.5];

test("intensive care loads seven rooms without engine warnings and survives editor validation", () => {
  const compiled = compileRegionsConfig(cleanRegionsConfig(config, "necmettin-yogun-bakim"));
  assert.equal(compiled.regions.length, 7);
  assert.equal(compiled.corridors.length, 1);
  assert.deepEqual(compiled.warnings, []);
  assert.equal(compiled.rules.exitConfirmationCount, 2);
  assert.deepEqual(rooms.map((room) => room.name), Array.from({ length: 7 }, (_, i) => `Oda ${i + 1}`));
});

test("room centres remain in physical rooms while regions extend three metres behind the rear wall", () => {
  for (const [index, room] of rooms.entries()) {
    const minX = Math.min(...room.polygon.map((pair) => pair.pixel.x));
    const maxX = Math.max(...room.polygon.map((pair) => pair.pixel.x));
    const minY = Math.min(...room.polygon.map((pair) => pair.pixel.y));
    const maxY = Math.max(...room.polygon.map((pair) => pair.pixel.y));
    assert.equal(maxY, 678);
    assert.ok(minY < 0, `${room.name}: extension must be allowed outside the image`);
    const physicalRear = transform({ x: minX, y: 93.5 });
    const extendedRear = transform({ x: minX, y: minY });
    assert.ok(Math.abs(physicalRear.x - extendedRear.x - 3) < 1e-8);
    assert.ok(Math.abs(physicalRear.y - extendedRear.y) < 1e-8);
    assert.equal(room.roomCenter!.pixel.x, (physicalWalls[6 - index] + physicalWalls[7 - index]) / 2);
    assert.ok(room.roomCenter!.pixel.x > minX && room.roomCenter!.pixel.x < maxX);
    assert.equal(room.roomCenter!.pixel.y, (93.5 + 678) / 2);
    for (const pair of [...room.polygon, room.roomCenter!, ...room.entrances]) {
      const expected = transform(pair.pixel);
      assert.ok(Math.abs(expected.x - pair.world.x) < 1e-8);
      assert.ok(Math.abs(expected.y - pair.world.y) < 1e-8);
    }
  }
});

test("each corridor door is centred in the physical front wall and opens 1.5 metres inward", () => {
  for (const room of rooms) {
    assert.equal(room.entrances.length, 1);
    const door = room.entrances[0];
    assert.equal(door.pixel.x, room.roomCenter!.pixel.x);
    assert.equal(door.pixel.y, 678);
    assert.equal(door.widthMeters, 1.5);
    assert.equal(door.connectsTo, "corridor-main");
    assert.deepEqual(door.inwardNormal, { x: -1, y: 0 });
    assert.ok(room.roomCenter!.world.x < door.world.x);
    assert.ok(Math.abs(room.roomCenter!.world.y - door.world.y) < 1e-8);
  }
});

test("neighbouring room areas have a ten centimetre gap along the full extended wall", () => {
  for (let index = 1; index < rooms.length; index++) {
    const rightRoom = rooms[index - 1];
    const leftRoom = rooms[index];
    assert.ok(rightRoom.roomCenter!.pixel.x > leftRoom.roomCenter!.pixel.x);
    const leftEdge = Math.max(...leftRoom.polygon.map((pair) => pair.world.y));
    const rightEdge = Math.min(...rightRoom.polygon.map((pair) => pair.world.y));
    assert.ok(Math.abs(rightEdge - leftEdge - 0.1) < 1e-8);
    const sharedWall = physicalWalls[7 - index];
    const physical = transform({ x: sharedWall, y: 678 }).y;
    assert.ok(Math.abs(physical - leftEdge - 0.05) < 1e-8);
    assert.ok(Math.abs(rightEdge - physical - 0.05) < 1e-8);
  }
});

test("both corridor end gates record observed area entry and exit", () => {
  const compiled = compileRegionsConfig(cleanRegionsConfig(config, "necmettin-yogun-bakim"));
  assert.equal(compiled.largeAreas.length, 1);
  assert.equal(compiled.largeAreas[0].name, "Yoğun Bakım");
  assert.equal(compiled.largeAreas[0].gates.length, 2);
  const base = Date.parse("2026-10-08T13:00:00Z");
  for (const [index, gate] of config.largeAreas![0].gates.entries()) {
    assert.equal(gate.role, "bidirectional");
    const edge = index === 0 ? physicalWalls[0] : physicalWalls[7];
    const direction = index === 0 ? 1 : -1;
    const worldPerPixel = transform({ x: edge + 1, y: 1015 }).y - transform({ x: edge, y: 1015 }).y;
    const events: AreaTransitionEvent[] = [];
    const engine = new AreaTransitionEngine(new Map([[config.map.mapId, compiled]]), event => events.push(event));
    const send = (seconds: number, distance: number) => {
      const point = transform({ x: edge + direction * distance / worldPerPixel, y: 1015 });
      engine.ingest({ tagCode: `GATE-${index}`, mapId: config.map.mapId, ...point, quality: 0.9,
        timestamp: new Date(base + seconds * 1000).toISOString() }, base + seconds * 1000);
    };
    send(0, -1); send(1, 0); send(2, 1); send(3, 1.5);
    send(4, 0); send(5, -1); send(6, -1.5);
    assert.deepEqual(events.map(event => event.type), ["AREA_ENTERED", "AREA_EXITED_OBSERVED"]);
    assert.ok(events.every(event => event.gateId === gate.id));
  }
});
