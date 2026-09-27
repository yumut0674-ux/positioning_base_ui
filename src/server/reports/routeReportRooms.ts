import { mapService } from "@/src/server/maps/mapService";
import { loadRegionsConfigForMap } from "@/src/server/regionEngine/configLoader";

export interface RouteReportRoom {
  readonly mapId: string;
  readonly mapName: string;
  readonly roomId: string;
  readonly roomName: string;
}

export async function listRouteReportRooms(): Promise<readonly RouteReportRoom[]> {
  const catalog = await mapService.getCatalog();
  const maps = catalog.maps.filter(map => map.regionsConfigPath && map.status !== "disabled")
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const byMap = await Promise.all(maps.map(async map => {
    const config = await loadRegionsConfigForMap(map.id);
    return config.regions.map(region => ({
      mapId: map.id, mapName: map.displayName, roomId: region.id, roomName: region.name ?? region.id,
    }));
  }));
  return byMap.flat().sort((left, right) => left.mapName.localeCompare(right.mapName, "tr") || left.roomName.localeCompare(right.roomName, "tr"));
}
