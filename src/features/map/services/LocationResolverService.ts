import {
  LOCATION_ZONE_FALLBACK_LABEL,
  LOCATION_ZONES,
  type LocationZone,
  type LocationZonePoint,
} from "@/src/features/map/config/locationZones";

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

function contains(zone: LocationZone, x: number, y: number): boolean {
  if ("polygon" in zone) return isInsidePolygon(x, y, zone.polygon);
  return x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY;
}

export function resolveLocation(
  x: number,
  y: number,
  floorPlanId: string,
  zones: readonly LocationZone[] = LOCATION_ZONES,
): string {
  const matchingZone = zones
    .filter((zone) => zone.floorPlanId === floorPlanId)
    .sort((left, right) => left.priority - right.priority)
    .find((zone) => contains(zone, x, y));

  return matchingZone?.label ?? LOCATION_ZONE_FALLBACK_LABEL;
}
