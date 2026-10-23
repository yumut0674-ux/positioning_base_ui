import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { CoordinateTransformService } from "../../features/map/services/CoordinateTransformService";
import { mapService, MapRequestError } from "../maps/mapService";
import type { MapDetails } from "../maps/map.types";
import type { RenderedHistoryMap, RoutePoint, RoutePointsHistoryData } from "./location.types";

const MAX_IMAGE_SIDE = 3840;
const MAX_IMAGE_PIXELS = 8_294_400;
type Point = { readonly x: number; readonly y: number };

let nativeSharp: typeof import("sharp") | undefined;
function loadSharp(): typeof import("sharp") {
  // Sharp's native CommonJS loader must run in Node, outside Vinext's ESM transforms.
  const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));
  return nativeSharp ??= nodeRequire("sharp") as typeof import("sharp");
}

function imageSize(map: MapDetails) {
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(map.image.width, map.image.height), Math.sqrt(MAX_IMAGE_PIXELS / (map.image.width * map.image.height)));
  return { width: Math.max(1, Math.floor(map.image.width * scale)), height: Math.max(1, Math.floor(map.image.height * scale)) };
}

async function readFloorPlan(map: MapDetails): Promise<Buffer> {
  // Only configured local raster assets can be read; no client-supplied paths or URLs.
  const publicDirectory = path.resolve(process.cwd(), "public");
  if (!/^\/maps\/[a-z0-9-]+\/[a-z0-9.-]+\.(png|jpe?g|webp)$/i.test(map.image.url)) throw new Error("HISTORY_MAP_IMAGE_INVALID");
  const file = path.resolve(publicDirectory, `.${map.image.url}`);
  if (!file.startsWith(publicDirectory + path.sep)) throw new Error("HISTORY_MAP_IMAGE_INVALID");
  return readFile(file);
}

function svgPoint(point: Point): string { return `${point.x.toFixed(2)},${point.y.toFixed(2)}`; }

/** Split the route before drawing so different floors, tags and signal gaps are never joined. */
export function historyMapSegments(points: readonly RoutePoint[], mapId: string): readonly (readonly RoutePoint[])[] {
  const segments: RoutePoint[][] = [];
  let previous: RoutePoint | undefined;
  for (const point of points) {
    if (point.mapId === mapId) {
      if (!previous || previous.mapId !== mapId || previous.tagCode !== point.tagCode
        || Date.parse(point.observedAt) - Date.parse(previous.observedAt) > 300_000) segments.push([]);
      segments.at(-1)!.push(point);
    }
    previous = point;
  }
  return segments;
}

function overlaySvg(map: MapDetails, segments: readonly (readonly Point[])[], showRoute: boolean, selected = false): Buffer {
  const size = imageSize(map);
  const transform = new CoordinateTransformService(map.calibration);
  const projected = segments.map(segment => segment.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).map(p => transform.worldToCanvas(p)));
  const points = projected.flat();
  const lines = showRoute ? projected.filter(segment => segment.length > 1).map(segment => `<polyline points="${segment.map(svgPoint).join(" ")}" fill="none" stroke="${selected ? "#00a896" : "#3578e5"}" stroke-width="${selected ? 5 : 3.5}" stroke-linecap="round" stroke-linejoin="round"/>`).join("") : "";
  const dots = points.map(point => `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${selected ? 3.2 : 2.8}" fill="white" stroke="#00a896" stroke-width="1.3"/>`).join("");
  const marker = (point: Point | undefined, color: string) => point ? `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="8" fill="${color}" stroke="white" stroke-width="2"/>` : "";
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${map.image.width} ${map.image.height}">${lines}${dots}${marker(points[0], "#13a875")}${marker(points.at(-1), "#e65353")}</svg>`);
}

export async function renderHistoryMap(map: MapDetails, segments: readonly (readonly Point[])[], showRoute: boolean, floorPlan?: Buffer): Promise<Buffer> {
  const sharp = loadSharp();
  const size = imageSize(map);
  const floor = await sharp(floorPlan ?? await readFloorPlan(map)).resize(size.width, size.height, { fit: "fill" }).flatten({ background: "#e7f0f4" }).toBuffer();
  const overlay = await sharp(overlaySvg(map, segments, showRoute)).resize(size.width, size.height).png().toBuffer();
  return sharp(floor).composite([{ input: overlay }]).webp({ quality: 88, effort: 2 }).toBuffer();
}

export async function renderHistoryMaps(data: RoutePointsHistoryData): Promise<readonly RenderedHistoryMap[]> {
  const maps: RenderedHistoryMap[] = [];
  const mapIds = [...new Set(data.points.flatMap(point => point.mapId ? [point.mapId] : []))];
  if (mapIds.length > 16) throw new Error("HISTORY_MAP_LIMIT_EXCEEDED");
  // Bound peak native memory by rendering floors in sequence.
  for (const mapId of mapIds) {
    let map: MapDetails;
    try { map = await mapService.getMapDetails(mapId); }
    catch (error) {
      if (error instanceof MapRequestError && [400, 404, 409].includes(error.status)) continue;
      throw error;
    }
    const image = await renderHistoryMap(map, historyMapSegments(data.points, mapId), !data.zoneTimeline);
    maps.push({ map, imageDataUrl: `data:image/webp;base64,${image.toString("base64")}` });
  }
  return maps;
}

export async function renderHistorySelection(map: MapDetails, points: readonly Point[], showRoute: boolean): Promise<Buffer> {
  const sharp = loadSharp();
  const size = imageSize(map);
  return sharp(overlaySvg(map, [points], showRoute, true)).resize(size.width, size.height).png().toBuffer();
}
