import { readFile, writeFile } from "node:fs/promises";
import { CoordinateTransformService } from "../src/features/map/services/CoordinateTransformService";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import type { RegionsConfig, RegionDefinition, LargeAreaDefinition } from "../src/features/regions/types/region.types";

const file = "config/maps/necmettin-servis/regions.json";
const config = JSON.parse(await readFile(file, "utf8")) as RegionsConfig;
const reference = JSON.parse(await readFile("config/maps/necmettin-yogun-bakim/regions.json", "utf8")) as RegionsConfig;
const map = JSON.parse(await readFile("config/maps/necmettin-servis/map.json", "utf8"));
const source = JSON.parse(await readFile("config/maps/necmettin-servis/source.floorplan.json", "utf8"));
const updateFronts = process.argv.includes("--update-fronts");
if ((config.regions.length || config.largeAreas?.length) && !updateFronts && !process.argv.includes("--replace-existing")) {
  throw new Error("Review existing geometry before regenerating with --replace-existing.");
}
const roomTemplates = reference.regions.filter(region => region.kind === "room");
const areaTemplate = reference.largeAreas?.[0];
if (!roomTemplates.length || !areaTemplate?.gates.length) throw new Error("Intensive-care reference rooms and area gates are required.");
const transform = new CoordinateTransformService(map.calibration);
const sourceTransform = new CoordinateTransformService({
  worldOrigin: source.map.worldOrigin, canvasOrigin: source.map.exportCalibration.originPixel,
  pixelsPerMeter: 100 / source.map.exportCalibration.centimetersPerPixel,
  invertYAxis: true, rotationDegrees: 0,
});
const pair = (x: number, y: number) => {
  const pixel = sourceTransform.worldToCanvas({ x, y });
  return { pixel, world: transform.canvasToWorld(pixel) };
};
const normal = (direction: number) => {
  const from = pair(0, 0).world, to = pair(0, direction).world;
  const x = to.x - from.x, y = to.y - from.y, length = Math.hypot(x, y);
  return { x: Math.abs(x) < 1e-12 ? 0 : x / length, y: Math.abs(y) < 1e-12 ? 0 : y / length };
};

// CAD metre coordinates measured from the October 9 export. The five
// bathroom pairs repeat every 8.4 m; room 10's last bay is 20 cm narrower.
const bathroomCentres = [5.9537725292536, 14.3537725292536, 22.7537725292536, 31.1537725292536, 39.5537725292536];
const leftWall = 1.4537725292536;
const topWalls = [leftWall, ...Array.from({ length: 9 }, (_, i) => bathroomCentres[0] + i * 4.2), 43.5537725292536];
const bottomWalls = [...topWalls.slice(0, 10), 43.7537725292536];
const topRear = 22.68890959210326;
const bottomRear = 2.2389095921034;
const topFront = 15.28890959210326;
const bottomFront = 9.6889095921034;
const rearExtension = 3;
const halfGap = 0.05;
const doorCorridorOffset = 0.1;
const bottomBays = [0, 1, 2, 3, 6, 7, 8, 9];
// Labels follow the image: top row left to right, then bottom row left to right.
const roomNames = ["Dr Odası", "201", "202", "203", "204", "205", "206", "207", "208", "209",
  "217", "216", "215", "214", "213", "212", "211", "210"];
const rooms: RegionDefinition[] = [];

function room(number: number, bay: number, top: boolean): RegionDefinition {
  const template = structuredClone(roomTemplates[(number - 1) % roomTemplates.length]);
  const walls = top ? topWalls : bottomWalls;
  const neighbourOnLeft = top ? bay > 0 : bottomBays.includes(bay - 1);
  const neighbourOnRight = top ? bay < 9 : bottomBays.includes(bay + 1);
  const left = walls[bay] + (neighbourOnLeft ? halfGap : 0);
  const right = walls[bay + 1] - (neighbourOnRight ? halfGap : 0);
  const centre = bathroomCentres[Math.floor(bay / 2)];
  const bathroomLeft = centre - 2.225;
  const bathroomRight = centre + 2.225;
  const front = top ? topFront : bottomFront;
  const direction = top ? 1 : -1;
  const bathroomFront = front - direction;
  const shaftEnd = front + direction * 0.5;
  const rear = top ? topRear + rearExtension : bottomRear - rearExtension;
  // Complete the corridor recess up to the bathroom tips; the utility shaft
  // and the gap between neighbouring rooms remain outside the room.
  const boundary: [number, number][] = bay % 2 === 0
    ? [[left, bathroomFront], [centre - 0.25, bathroomFront],
      [centre - 0.25, shaftEnd], [right, shaftEnd]]
    : [[left, shaftEnd], [centre + 0.25, shaftEnd], [centre + 0.25, bathroomFront],
      [right, bathroomFront]];
  boundary.push([right, rear], [left, rear]);
  const id = `room-${String(number).padStart(2, "0")}`;
  const doorwayX = bay % 2 === 0 ? (left + bathroomLeft) / 2 : (bathroomRight + right) / 2;
  const doorwayTemplate = template.entrances[0];
  if (!doorwayTemplate) throw new Error(`${template.name}: reference corridor door is missing`);
  return {
    ...template, id, name: roomNames[number - 1],
    inference: { ...template.inference, coverage: "silent", silentEntryMaxDistanceMeters: 1 },
    polygon: boundary.map(([x, y]) => pair(x, y)),
    roomCenter: pair((walls[bay] + walls[bay + 1]) / 2, top ? (topRear + 17.08890959210326) / 2 : (bottomRear + 7.8889095921034) / 2),
    entrances: [{ ...doorwayTemplate, id: `${id}-corridor-door`, ...pair(doorwayX, bathroomFront - direction * doorCorridorOffset),
      inwardNormal: normal(direction), connectsTo: "corridor-main", approachDepthMeters: 1.3 }],
  };
}
for (let bay = 0; bay < 10; bay++) rooms.push(room(bay + 1, bay, true));
for (const [index, bay] of bottomBays.entries()) rooms.push(room(index + 11, bay, false));

const corridorRight = 49.6537725292536;
const upper: [number, number][] = [[leftWall, topFront - 1],
  [topWalls[10], topFront - 1], [topWalls[10], topFront], [corridorRight, topFront]];
const lower: [number, number][] = [[leftWall, bottomFront + 1], [bottomWalls[4], bottomFront + 1]];
// The central corridor continues between and below the unnumbered service
// rooms. Follow their outer walls instead of assigning them to 214 or 213.
lower.push([bottomWalls[4], 8.68890959210326],
  [21.7537725292536, 8.68890959210326], [21.7537725292536, 3.6889095921034],
  [bottomWalls[4], 3.6889095921034], [bottomWalls[4], bottomRear],
  [bottomWalls[6], bottomRear], [bottomWalls[6], 5.23890959210326],
  [23.7537725292536, 5.23890959210326], [23.7537725292536, 8.68890959210326],
  [bottomWalls[6], 8.68890959210326], [bottomWalls[6], bottomFront + 1]);
// Follow the one-metre step next to 210 before reaching the end wall.
lower.push([bottomWalls[10], bottomFront + 1], [bottomWalls[10], bottomFront - 1],
  [corridorRight, bottomFront - 1]);
const corridor: RegionDefinition = {
  ...structuredClone(reference.regions.find(region => region.kind === "corridor")!),
  id: "corridor-main", name: "Koridor", kind: "corridor",
  polygon: [...upper, ...lower.reverse()].map(([x, y]) => pair(x, y)), roomCenter: null, entrances: [],
};
const rect = (left: number, bottom: number, right: number, top: number) =>
  [pair(left, bottom), pair(right, bottom), pair(right, top), pair(left, top)];
const areaId = "service-area";
const area: LargeAreaDefinition = {
  ...structuredClone(areaTemplate), id: areaId, name: "Servis",
  polygon: rect(leftWall, bottomRear - rearExtension, 53.80434695230774, topRear + rearExtension),
  // These are the two door frames on the left of the service CAD plan.
  // Each gate extends 0.5 m to either side of the external wall.
  gates: [14.3889095890564, 12.38890958789062].map((bottom, index) => ({
    ...structuredClone(areaTemplate.gates[index % areaTemplate.gates.length]),
    id: `service-left-${index === 0 ? "upper" : "lower"}-gate`,
    name: `Sol ${index === 0 ? "üst" : "alt"} koridor giriş / çıkış kapısı`, areaId,
    polygon: rect(leftWall - 0.5, bottom, leftWall + 0.5, bottom + 0.8),
  })),
};
const generated: RegionsConfig = { ...config,
  engine: { ...structuredClone(reference.engine), entryEvidenceDurationMs: 2000, exitEvidenceDurationMs: 1500,
    entryConfirmationCount: 5, maximumSpeedMetersPerSecond: 3, maximumStepDistanceMeters: 10 },
  mapDisplay: structuredClone(reference.mapDisplay),
  positionAnimation: structuredClone(reference.positionAnimation), areaTracking: structuredClone(reference.areaTracking),
  regions: [corridor, ...rooms], largeAreas: [area],
};
// Updating existing geometry must not regenerate manually edited gates,
// room centres, names or inference settings. Door positions are projected
// ten centimetres outside the new front along their existing inward normal, retaining their
// lateral position. Repeating this update does not move a door again.
const updated: RegionsConfig = updateFronts ? { ...config, regions: config.regions.map(region => {
  if (region.id === corridor.id) return { ...region, polygon: corridor.polygon };
  const target = rooms.find(room => room.id === region.id);
  if (!target) throw new Error(`Unknown service region: ${region.id}`);
  return { ...region, polygon: target.polygon, entrances: region.entrances.map(door => {
    if (door.connectsTo !== corridor.id && door.connectsTo !== "corridor") return door;
    const n = door.inwardNormal;
    if (!n || Math.hypot(n.x, n.y) < 0.001) throw new Error(`${region.name}: door normal is required`);
    const length = Math.hypot(n.x, n.y), nx = n.x / length, ny = n.y / length;
    const front = target.entrances[0].world;
    const depth = (door.world.x - front.x) * nx + (door.world.y - front.y) * ny;
    if (Math.abs(depth) < 1e-9) return door;
    const world = { x: door.world.x - nx * depth, y: door.world.y - ny * depth };
    return { ...door, pixel: transform.worldToCanvas(world), world };
  }) };
}) } : generated;
const compiled = compileRegionsConfig(updated);
if (compiled.regions.length !== 18 || compiled.corridors.length !== 1 || compiled.warnings?.length) throw new Error(JSON.stringify(compiled.warnings));
await writeFile(file, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
console.log(`${updateFronts ? "Updated" : "Configured"} 18 service room fronts and doors at the bathroom tips, their corridor and ${updated.largeAreas?.flatMap(area => area.gates).length ?? 0} area gates.`);
