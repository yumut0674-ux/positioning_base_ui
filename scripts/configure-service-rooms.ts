import { readFile, writeFile } from "node:fs/promises";
import { CoordinateTransformService } from "../src/features/map/services/CoordinateTransformService";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import type { RegionsConfig, RegionDefinition, LargeAreaDefinition } from "../src/features/regions/types/region.types";

const file = "config/maps/necmettin-servis/regions.json";
const config = JSON.parse(await readFile(file, "utf8")) as RegionsConfig;
const reference = JSON.parse(await readFile("config/maps/necmettin-yogun-bakim/regions.json", "utf8")) as RegionsConfig;
const map = JSON.parse(await readFile("config/maps/necmettin-servis/map.json", "utf8"));
if ((config.regions.length || config.largeAreas?.length) && !process.argv.includes("--replace-existing")) {
  throw new Error("Review existing geometry before regenerating with --replace-existing.");
}
const roomTemplates = reference.regions.filter(region => region.kind === "room");
const areaTemplate = reference.largeAreas?.[0];
if (!roomTemplates.length || !areaTemplate?.gates.length) throw new Error("Intensive-care reference rooms and area gates are required.");
const transform = new CoordinateTransformService(map.calibration);
const pair = (x: number, y: number) => ({ world: { x, y }, pixel: transform.worldToCanvas({ x, y }) });

// World metre coordinates measured from the October 9 CAD export. The five
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
const bottomBays = [0, 1, 2, 3, 6, 7, 8, 9];
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
  // Include each room's bathroom wing, keeping the utility shaft outside.
  const boundary: [number, number][] = bay % 2 === 0
    ? [[left, front], [bathroomLeft, front], [bathroomLeft, bathroomFront],
      [centre - 0.25, bathroomFront], [centre - 0.25, shaftEnd], [right, shaftEnd]]
    : [[left, shaftEnd], [centre + 0.25, shaftEnd], [centre + 0.25, bathroomFront],
      [bathroomRight, bathroomFront], [bathroomRight, front], [right, front]];
  boundary.push([right, rear], [left, rear]);
  const id = `room-${String(number).padStart(2, "0")}`;
  const doorwayX = bay % 2 === 0 ? (left + bathroomLeft) / 2 : (bathroomRight + right) / 2;
  const doorwayTemplate = template.entrances[0];
  if (!doorwayTemplate) throw new Error(`${template.name}: reference corridor door is missing`);
  return {
    ...template, id, name: `Oda ${number}`,
    polygon: boundary.map(([x, y]) => pair(x, y)),
    roomCenter: pair((walls[bay] + walls[bay + 1]) / 2, top ? (topRear + 17.08890959210326) / 2 : (bottomRear + 7.8889095921034) / 2),
    entrances: [{ ...doorwayTemplate, id: `${id}-corridor-door`, ...pair(doorwayX, front),
      inwardNormal: { x: 0, y: direction }, connectsTo: "corridor-main" }],
  };
}
for (let bay = 0; bay < 10; bay++) rooms.push(room(bay + 1, bay, true));
for (const [index, bay] of bottomBays.entries()) rooms.push(room(index + 11, bay, false));

const corridorRight = 49.6537725292536;
const upper: [number, number][] = [[leftWall, topFront]];
for (const centre of bathroomCentres) upper.push(
  [centre - 2.225, topFront], [centre - 2.225, topFront - 1],
  [centre + 2.225, topFront - 1], [centre + 2.225, topFront],
);
upper.push([corridorRight, topFront]);
const lower: [number, number][] = [[leftWall, bottomFront]];
for (const centre of bathroomCentres.slice(0, 2)) lower.push(
  [centre - 2.225, bottomFront], [centre - 2.225, bottomFront + 1],
  [centre + 2.225, bottomFront + 1], [centre + 2.225, bottomFront],
);
// The central corridor continues between and below the unnumbered service
// rooms. Follow their outer walls instead of assigning them to Oda 14 or 15.
lower.push([bottomWalls[4], bottomFront], [bottomWalls[4], 8.68890959210326],
  [21.7537725292536, 8.68890959210326], [21.7537725292536, 3.6889095921034],
  [bottomWalls[4], 3.6889095921034], [bottomWalls[4], bottomRear],
  [bottomWalls[6], bottomRear], [bottomWalls[6], 5.23890959210326],
  [23.7537725292536, 5.23890959210326], [23.7537725292536, 8.68890959210326],
  [bottomWalls[6], 8.68890959210326], [bottomWalls[6], bottomFront]);
for (const centre of bathroomCentres.slice(3)) lower.push(
  [centre - 2.225, bottomFront], [centre - 2.225, bottomFront + 1],
  [centre + 2.225, bottomFront + 1], [centre + 2.225, bottomFront],
);
// Follow the one-metre step next to Oda 18 before reaching the end wall.
lower.push([bottomWalls[10], bottomFront], [bottomWalls[10], bottomFront - 1],
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
const updated: RegionsConfig = { ...config,
  engine: structuredClone(reference.engine), mapDisplay: structuredClone(reference.mapDisplay),
  positionAnimation: structuredClone(reference.positionAnimation), areaTracking: structuredClone(reference.areaTracking),
  regions: [corridor, ...rooms], largeAreas: [area],
};
const compiled = compileRegionsConfig(updated);
if (compiled.regions.length !== 18 || compiled.corridors.length !== 1 || compiled.warnings?.length) throw new Error(JSON.stringify(compiled.warnings));
await writeFile(file, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
console.log("Configured 18 service rooms, their corridor and 2 area gates with intensive-care settings.");
