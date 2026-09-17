import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import type { CoordinatePair, RegionDefinition, RegionsConfig } from "../src/features/regions/types/region.types";

const configPath = path.join(process.cwd(), "config", "regions.json");
const mapConfigPath = path.join(process.cwd(), "config", "maps", "kat1-ortopedi", "regions.json");
const config = JSON.parse(readFileSync(configPath, "utf8")) as RegionsConfig;
const mapConfig = JSON.parse(readFileSync(mapConfigPath, "utf8")) as RegionsConfig;
const EPSILON = 0.0011;

function expectedWorld(pair: CoordinatePair) {
  return {
    x: pair.pixel.x / 30,
    y: (1314 - pair.pixel.y) / 30,
  };
}

function assertCalibrated(pair: CoordinatePair, label: string) {
  const expected = expectedWorld(pair);
  assert.ok(Math.abs(pair.world.x - expected.x) <= EPSILON, `${label}: x kalibrasyonu uyuşmuyor`);
  assert.ok(Math.abs(pair.world.y - expected.y) <= EPSILON, `${label}: y kalibrasyonu uyuşmuyor`);
  assert.ok(pair.pixel.x >= 0 && pair.pixel.x <= 714, `${label}: x harita dışında`);
  assert.ok(pair.pixel.y >= 0 && pair.pixel.y <= 1314, `${label}: y harita dışında`);
}

function bounds(region: RegionDefinition) {
  const xs = region.polygon.map((pair) => pair.pixel.x);
  const ys = region.polygon.map((pair) => pair.pixel.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

test("floor plan has two corridors and fourteen calibrated room regions", () => {
  const corridors = config.regions.filter((region) => region.kind === "corridor");
  const rooms = config.regions.filter((region) => region.kind === "room");
  assert.equal(corridors.length, 2);
  assert.equal(rooms.length, 14);
  assert.deepEqual(new Set(rooms.map((room) => room.name)), new Set(Array.from({ length: 14 }, (_, index) => `ODA ${String(index + 1).padStart(2, "0")}`)));
  assert.deepEqual(mapConfig.regions, config.regions);

  const compiled = compileRegionsConfig(config);
  assert.equal(compiled.regions.length, 14);
  assert.deepEqual(compiled.warnings, []);
});

test("all polygons, centres and doors use the 30 px/m lower-left calibration", () => {
  for (const region of config.regions) {
    region.polygon.forEach((pair, index) => assertCalibrated(pair, `${region.id}/polygon-${index}`));
    assert.ok(region.roomCenter, `${region.id}: merkez eksik`);
    assertCalibrated(region.roomCenter!, `${region.id}/center`);
    const area = bounds(region);
    assert.ok(region.roomCenter!.pixel.x > area.minX && region.roomCenter!.pixel.x < area.maxX, `${region.id}: merkez x sınır dışında`);
    assert.ok(region.roomCenter!.pixel.y > area.minY && region.roomCenter!.pixel.y < area.maxY, `${region.id}: merkez y sınır dışında`);
    for (const entrance of region.entrances) assertCalibrated(entrance, `${region.id}/${entrance.id}`);
  }
});

test("room interiors do not overlap and both corridor arms meet as a T", () => {
  const rooms = config.regions.filter((region) => region.kind === "room");
  for (let first = 0; first < rooms.length; first += 1) {
    for (let second = first + 1; second < rooms.length; second += 1) {
      const a = bounds(rooms[first]);
      const b = bounds(rooms[second]);
      const overlapWidth = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
      const overlapHeight = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
      assert.equal(overlapWidth * overlapHeight, 0, `${rooms[first].id} ile ${rooms[second].id} çakışıyor`);
    }
  }

  const horizontal = bounds(config.regions.find((region) => region.id === "corridor-horizontal")!);
  const vertical = bounds(config.regions.find((region) => region.id === "corridor-vertical")!);
  assert.equal(horizontal.maxY, vertical.minY);
  assert.ok(vertical.minX > horizontal.minX && vertical.maxX < horizontal.maxX);
});

test("every room has one doorway connected to the correct corridor", () => {
  const rooms = config.regions.filter((region) => region.kind === "room");
  for (const room of rooms) {
    assert.equal(room.entrances.length, 1, `${room.id}: tek kapı bekleniyor`);
    const entrance = room.entrances[0];
    const target = config.regions.find((region) => region.id === entrance.connectsTo);
    assert.equal(target?.kind, "corridor", `${room.id}: kapı koridora bağlı değil`);
    assert.equal(entrance.widthMeters, 1);
  }
});
