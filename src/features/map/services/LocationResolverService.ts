import type { RegionsConfig } from "@/src/features/regions/types/region.types";

export const LOCATION_ZONE_FALLBACK_LABEL = "Tanımlı alan dışında";

interface LocationZonePoint {
  readonly x: number;
  readonly y: number;
}

function isPointOnSegment(point: LocationZonePoint, start: LocationZonePoint, end: LocationZonePoint): boolean {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 1e-9) return false;
  const dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
  const squaredLength = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot >= 0 && dot <= squaredLength;
}

function isInsidePolygon(x: number, y: number, polygon: readonly LocationZonePoint[]): boolean {
  if (polygon.length < 3) return false;
  const point = { x, y };
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const start = polygon[previous];
    const end = polygon[index];
    if (isPointOnSegment(point, start, end)) return true;
    const crossesRay = (start.y > y) !== (end.y > y)
      && x < ((end.x - start.x) * (y - start.y)) / (end.y - start.y) + start.x;
    if (crossesRay) inside = !inside;
  }
  return inside;
}

export function resolveLocation(
  x: number,
  y: number,
  floorPlanId: string,
  config: RegionsConfig | null | undefined = null,
): string {
  if (!config || config.map.mapId !== floorPlanId) return LOCATION_ZONE_FALLBACK_LABEL;
  const matchingZone = config.regions.find((region) => isInsidePolygon(
    x,
    y,
    region.polygon.map((point) => point.world),
  ));

  return matchingZone?.name ?? LOCATION_ZONE_FALLBACK_LABEL;
}
