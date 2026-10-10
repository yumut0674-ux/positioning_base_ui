import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { CoordinateTransformService } from "../src/features/map/services/CoordinateTransformService";
import type { MapDetails } from "../src/server/maps/map.types";
import type { CoordinatePair, RegionsConfig } from "../src/features/regions/types/region.types";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";

const mapFile = "config/maps/necmettin-servis/map.json";
const regionsFile = "config/maps/necmettin-servis/regions.json";
const map = JSON.parse(await readFile(mapFile, "utf8")) as MapDetails;
const config = JSON.parse(await readFile(regionsFile, "utf8")) as RegionsConfig;
const source = JSON.parse(await readFile("config/maps/necmettin-servis/source.floorplan.json", "utf8"));
const calibration = source.map.exportCalibration;
const pixelsPerMeter = 100 / calibration.centimetersPerPixel;
// This selected point is expressed in the unrotated CAD/export coordinates.
const selectedOrigin = { x: 1.85, y: 14.25 };
const newCalibration = {
  worldOrigin: { x: 0, y: 0 },
  canvasOrigin: {
    x: calibration.originPixel.x + (selectedOrigin.x - source.map.worldOrigin.x) * pixelsPerMeter,
    y: calibration.originPixel.y - (selectedOrigin.y - source.map.worldOrigin.y) * pixelsPerMeter,
  },
  pixelsPerMeter, invertYAxis: true, rotationDegrees: 90,
};
const oldTransform = new CoordinateTransformService(map.calibration);
const transform = new CoordinateTransformService(newCalibration);
const pair = (point: CoordinatePair): CoordinatePair => ({ ...point, world: transform.canvasToWorld(point.pixel) });
const vector = (normal: { x: number; y: number }) => {
  const start = oldTransform.worldToCanvas({ x: 0, y: 0 });
  const end = oldTransform.worldToCanvas(normal);
  const from = transform.canvasToWorld(start);
  const to = transform.canvasToWorld(end);
  const x = to.x - from.x, y = to.y - from.y, length = Math.hypot(x, y);
  return { x: Math.abs(x) < 1e-12 ? 0 : x / length, y: Math.abs(y) < 1e-12 ? 0 : y / length };
};
const updatedMap: MapDetails = { ...map, calibration: newCalibration,
  world: { widthMeters: map.image.height / pixelsPerMeter, heightMeters: map.image.width / pixelsPerMeter },
  updatedAt: new Date().toISOString(),
};
const updatedConfig: RegionsConfig = { ...config,
  map: { ...config.map, calibration: { type: "affine", points: [
    { id: "origin", world: { x: 0, y: 0 }, pixel: transform.worldToCanvas({ x: 0, y: 0 }) },
    { id: "x-axis", world: { x: 1, y: 0 }, pixel: transform.worldToCanvas({ x: 1, y: 0 }) },
    { id: "y-axis", world: { x: 0, y: 1 }, pixel: transform.worldToCanvas({ x: 0, y: 1 }) },
  ] } },
  regions: config.regions.map(region => ({ ...region, polygon: region.polygon.map(pair),
    roomCenter: region.roomCenter ? pair(region.roomCenter) : null,
    entrances: region.entrances.map(door => ({ ...door, ...pair(door),
      ...(door.inwardNormal ? { inwardNormal: vector(door.inwardNormal) } : {}) })),
  })),
  largeAreas: config.largeAreas?.map(area => ({ ...area, polygon: area.polygon.map(pair),
    gates: area.gates.map(gate => ({ ...gate, polygon: gate.polygon.map(pair) })),
  })),
};
const compiled = compileRegionsConfig(updatedConfig);
assert.equal(compiled.regions.length, config.regions.filter(region => region.kind === "room").length);
assert.deepEqual(compiled.warnings, []);
// Verify that every editable shape and marker stays at the same image pixel.
const pixels = (value: RegionsConfig) => value.regions.flatMap(region => [
  ...region.polygon.map(point => point.pixel), ...(region.roomCenter ? [region.roomCenter.pixel] : []),
  ...region.entrances.map(point => point.pixel),
]).concat((value.largeAreas ?? []).flatMap(area => [
  ...area.polygon.map(point => point.pixel), ...area.gates.flatMap(gate => gate.polygon.map(point => point.pixel)),
]));
assert.deepEqual(pixels(updatedConfig), pixels(config));
await writeFile(mapFile, `${JSON.stringify(updatedMap, null, 2)}\n`, "utf8");
await writeFile(regionsFile, `${JSON.stringify(updatedConfig, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ selectedOrigin, calibration: newCalibration, rooms: compiled.regions.length,
  gates: compiled.largeAreas.reduce((count, area) => count + area.gates.length, 0) }, null, 2));
