import { readFile, writeFile } from "node:fs/promises";
import { createAffineTransform } from "../src/features/regions/services/affineTransform";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import type { RegionsConfig, RegionDefinition, LargeAreaDefinition } from "../src/features/regions/types/region.types";

// Wall centre lines measured from the 3840 × 2160 floor plan, left to right.
const walls = [134.5, 646, 1164, 1682, 2200, 2718, 3236, 3705.5];
const physicalTop = 93.5;
const corridorWall = 678;
const file = "config/maps/necmettin-yogun-bakim/regions.json";
const config = JSON.parse(await readFile(file, "utf8")) as RegionsConfig;
if ((config.regions.length || config.largeAreas?.length) && !process.argv.includes("--replace-existing")) {
  throw new Error("Review existing geometry before regenerating with --replace-existing.");
}
const transform = createAffineTransform(config.map.calibration.points);
const map = JSON.parse(await readFile("config/maps/necmettin-yogun-bakim/map.json", "utf8"));
const extendedTop = physicalTop - 3 * map.calibration.pixelsPerMeter;
const halfGap = 0.05 * map.calibration.pixelsPerMeter;
const pair = (x: number, y: number) => ({ pixel: { x, y }, world: transform({ x, y }) });
const colors = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#ca8a04", "#059669", "#0891b2"];
const rooms: RegionDefinition[] = Array.from({ length: 7 }, (_, index) => {
  const number = index + 1;
  const left = walls[6 - index];
  const right = walls[7 - index];
  const centreX = (left + right) / 2;
  const regionLeft = left + (index < 6 ? halfGap : 0);
  const regionRight = right - (index > 0 ? halfGap : 0);
  return {
    id: `room-0${number}`, name: `Oda ${number}`, kind: "room", color: colors[index],
    polygon: [pair(regionLeft, extendedTop), pair(regionRight, extendedTop), pair(regionRight, corridorWall), pair(regionLeft, corridorWall)],
    roomCenter: pair(centreX, (physicalTop + corridorWall) / 2),
    entrances: [{
      id: `room-0${number}-corridor-door`, label: "Koridor kapısı",
      ...pair(centreX, corridorWall), widthMeters: 1.5,
      inwardNormal: { x: -1, y: 0 }, connectsTo: "corridor-main",
    }],
  };
});
const corridor: RegionDefinition = {
  id: "corridor-main", name: "Koridor", kind: "corridor", color: "#64748b",
  polygon: [[134.5, 678], [3705.5, 678], [3705.5, 1322], [2826, 1322],
    [2826, 2066], [1597, 2066], [1597, 1322], [134.5, 1322]].map(([x, y]) => pair(x, y)),
  roomCenter: null, entrances: [],
};
const areaId = "intensive-care-area";
// Gate depth is 0.5 m on each side of the wall; its opening follows the plan.
const gateDepth = 0.5 * map.calibration.pixelsPerMeter;
const rect = (left: number, top: number, right: number, bottom: number) =>
  [pair(left, top), pair(right, top), pair(right, bottom), pair(left, bottom)];
const area: LargeAreaDefinition = {
  id: areaId, name: "Yoğun Bakım", color: "#6c4bc2",
  polygon: rect(walls[0], extendedTop, walls[7], 2066),
  gates: [
    { id: "intensive-care-left-gate", name: "Sol koridor giriş / çıkış kapısı", areaId,
      role: "bidirectional", waitMs: 30_000,
      polygon: rect(walls[0] - gateDepth, 910, walls[0] + gateDepth, 1120) },
    { id: "intensive-care-right-gate", name: "Sağ koridor giriş / çıkış kapısı", areaId,
      role: "bidirectional", waitMs: 30_000,
      polygon: rect(walls[7] - gateDepth, 910, walls[7] + gateDepth, 1120) },
  ],
};
const updated = { ...config, regions: [corridor, ...rooms], largeAreas: [area] };
const compiled = compileRegionsConfig(updated);
if (compiled.regions.length !== 7 || compiled.warnings?.length) throw new Error(JSON.stringify(compiled.warnings));
await writeFile(file, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
console.log("Configured 7 separated intensive-care rooms, their corridor and 2 area gates.");
