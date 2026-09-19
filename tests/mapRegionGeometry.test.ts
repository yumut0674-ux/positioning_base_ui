import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import type { CoordinatePair, RegionDefinition, RegionsConfig } from "../src/features/regions/types/region.types";

const activeConfigPath = path.join(process.cwd(), "config", "regions.json");
const mapConfigPath = path.join(process.cwd(), "config", "maps", "spor-koridor", "regions.json");
const archivedConfigPath = path.join(process.cwd(), "config", "maps", "kat1-ortopedi", "regions.json");
const previousSportsConfigPath = path.join(process.cwd(), "config", "maps", "spor-koridor", "regions-v1.json");
const config = JSON.parse(readFileSync(activeConfigPath, "utf8")) as RegionsConfig;
const mapConfig = JSON.parse(readFileSync(mapConfigPath, "utf8")) as RegionsConfig;
const archivedConfig = JSON.parse(readFileSync(archivedConfigPath, "utf8")) as RegionsConfig;
const previousSportsConfig = JSON.parse(readFileSync(previousSportsConfigPath, "utf8")) as RegionsConfig;
const PIXEL_METERS = 0.008804;
const ORIGIN = { x: 812.16, y: 1735.14 };
const EPSILON = 0.000002;

function expectedWorld(pair: CoordinatePair) {
  return {
    x: (pair.pixel.x - ORIGIN.x) * PIXEL_METERS,
    y: (ORIGIN.y - pair.pixel.y) * PIXEL_METERS,
  };
}

function assertCalibrated(pair: CoordinatePair, label: string) {
  const expected = expectedWorld(pair);
  assert.ok(Math.abs(pair.world.x - expected.x) <= EPSILON, `${label}: x kalibrasyonu uyuşmuyor`);
  assert.ok(Math.abs(pair.world.y - expected.y) <= EPSILON, `${label}: y kalibrasyonu uyuşmuyor`);
  assert.ok(pair.pixel.x >= 0 && pair.pixel.x <= 3840, `${label}: x harita dışında`);
  assert.ok(pair.pixel.y >= 0 && pair.pixel.y <= 2160, `${label}: y harita dışında`);
}

function bounds(region: RegionDefinition) {
  const xs = region.polygon.map((pair) => pair.pixel.x);
  const ys = region.polygon.map((pair) => pair.pixel.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

test("sports corridor uses the supplied scale and origin while previous plans remain archived", () => {
  assert.equal(config.map.mapId, "spor-koridor");
  assert.deepEqual(mapConfig, config);
  assert.equal(archivedConfig.map.mapId, "kat1-ortopedi");
  assert.equal(previousSportsConfig.map.mapId, "spor-koridor");
  assert.ok(archivedConfig.regions.length > 0);
  assert.ok(previousSportsConfig.regions.length > 0);

  const corridors = config.regions.filter((region) => region.kind === "corridor");
  const rooms = config.regions.filter((region) => region.kind === "room");
  assert.equal(corridors.length, 1);
  assert.deepEqual(rooms.map((room) => room.name), ["Oda 1", "Oda 2", "Oda 3", "Oda 4", "Oda 5", "Oda 6", "Oda 7"]);

  const compiled = compileRegionsConfig(config);
  assert.equal(compiled.regions.length, 7);
  assert.deepEqual(compiled.warnings, []);
});

test("all polygons, centres and doors use 1 px = 0.8804 cm and the supplied canvas origin", () => {
  for (const region of config.regions) {
    region.polygon.forEach((pair, index) => assertCalibrated(pair, `${region.id}/polygon-${index}`));
    assert.ok(region.roomCenter, `${region.id}: merkez eksik`);
    assertCalibrated(region.roomCenter!, `${region.id}/center`);
    const area = bounds(region);
    assert.ok(region.roomCenter!.pixel.x > area.minX && region.roomCenter!.pixel.x < area.maxX, `${region.id}: merkez x sınır dışında`);
    assert.ok(region.roomCenter!.pixel.y > area.minY && region.roomCenter!.pixel.y < area.maxY, `${region.id}: merkez y sınır dışında`);
    region.entrances.forEach((entrance) => assertCalibrated(entrance, `${region.id}/${entrance.id}`));
  }
});

test("every concrete room is silent and has an editable required door on each wall", () => {
  const rooms = config.regions.filter((region) => region.kind === "room");
  for (const room of rooms) {
    assert.equal(room.coverage, "silent");
    assert.equal(room.inference?.doorDefaults?.evidenceMode, "required");
    assert.equal(room.entrances.length, 4, `${room.id}: dört duvar kapısı bekleniyor`);
    assert.deepEqual(room.entrances.map((door) => door.label), [
      "Kuzey duvarı kapısı",
      "Doğu duvarı kapısı",
      "Güney duvarı kapısı",
      "Batı duvarı kapısı",
    ]);
    for (const entrance of room.entrances) {
      assert.equal(entrance.connectsTo, "corridor-main");
      assert.equal(entrance.widthMeters, 1.2);
      assert.ok(entrance.inwardNormal);
    }
  }
});

test("concrete room interiors do not overlap", () => {
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
});
