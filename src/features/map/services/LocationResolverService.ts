import { LOCATION_ZONE_FALLBACK_LABEL, LOCATION_ZONES } from "@/src/features/map/config/locationZones";

export function resolveLocation(x: number, y: number, floorPlanId: string): string {
  const matchingZone = LOCATION_ZONES
    .filter((zone) => zone.floorPlanId === floorPlanId)
    .sort((left, right) => left.priority - right.priority)
    .find((zone) => x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY);

  return matchingZone?.label ?? LOCATION_ZONE_FALLBACK_LABEL;
}
