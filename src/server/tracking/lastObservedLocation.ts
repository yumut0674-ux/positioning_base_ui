import type { PositionMessage } from "../../features/tracking/types/tracking.types";
import type { LastObservedLocation } from "../../features/tracking/types/tagPresence.types";
import type { RegionsConfig } from "../../features/regions/types/region.types";
import type { MapCatalogEntry } from "../maps/map.types";
import { isInsidePolygon } from "../../features/map/services/LocationResolverService";
import { isCorridorRegion } from "../../features/tracking/services/roomDisplayPolicy";

export function resolveLastObservedLocation(raw: PositionMessage, map?: MapCatalogEntry, config?: RegionsConfig): LastObservedLocation {
  const matches = config && config.map.mapId === raw.mapId ? config.regions.filter(region =>
    isInsidePolygon(raw.x, raw.y, region.polygon.map(pair => pair.world))) : [];
  const rooms = matches.filter(region => !isCorridorRegion(region));
  const region = rooms.length === 1 ? rooms[0] : rooms.length === 0 ? matches.find(isCorridorRegion) : undefined;
  return {
    mapId: raw.mapId ?? null, mapName: map?.displayName ?? null, floorLabel: map?.floorLabel ?? null,
    regionId: region?.id ?? null, regionName: region?.name ?? null,
    kind: region ? isCorridorRegion(region) ? "corridor" : "room" : "unknown",
  };
}
