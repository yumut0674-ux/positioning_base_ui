import type { MapCatalog, MapCatalogEntry, MapDetails } from "@/src/server/maps/map.types";

export const ACTIVE_MAP_STORAGE_KEY = "gekon.ips.active-map";

export interface MapSelectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isSelectableMap(entry: MapCatalogEntry): boolean {
  return Boolean(entry.configPath) && (entry.status === "active" || entry.status === "preview");
}

export function resolveInitialMapId(catalog: MapCatalog, storedMapId: string | null): string {
  const storedEntry = storedMapId ? catalog.maps.find((entry) => entry.id === storedMapId) : undefined;
  return storedEntry && isSelectableMap(storedEntry) ? storedEntry.id : catalog.defaultMapId;
}

export function shouldShowLiveTracking(catalog: MapCatalog, map: MapDetails | undefined): boolean {
  return Boolean(map && map.id === catalog.liveTrackingMapId && map.liveTrackingEnabled);
}

export function readStoredMapId(storage: MapSelectionStorage): string | null {
  try {
    return storage.getItem(ACTIVE_MAP_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistActiveMapId(storage: MapSelectionStorage, mapId: string): void {
  try {
    storage.setItem(ACTIVE_MAP_STORAGE_KEY, mapId);
  } catch {
    // Storage can be unavailable in privacy modes; map selection still works in memory.
  }
}

export interface MapGroup {
  readonly buildingId: string;
  readonly buildingName: string;
  readonly floors: readonly {
    readonly floorId: string;
    readonly floorLevel: number;
    readonly floorLabel: string;
    readonly maps: readonly MapCatalogEntry[];
  }[];
}

export function groupMapCatalog(entries: readonly MapCatalogEntry[]): readonly MapGroup[] {
  const buildings = new Map<string, { name: string; floors: Map<string, { level: number; label: string; maps: MapCatalogEntry[] }> }>();
  for (const entry of [...entries].sort((left, right) => left.sortOrder - right.sortOrder)) {
    const building = buildings.get(entry.buildingId) ?? { name: entry.buildingName, floors: new Map() };
    const floor = building.floors.get(entry.floorId) ?? { level: entry.floorLevel, label: entry.floorLabel, maps: [] };
    floor.maps.push(entry);
    building.floors.set(entry.floorId, floor);
    buildings.set(entry.buildingId, building);
  }
  return [...buildings.entries()].map(([buildingId, building]) => ({
    buildingId,
    buildingName: building.name,
    floors: [...building.floors.entries()]
      .sort(([, left], [, right]) => left.level - right.level)
      .map(([floorId, floor]) => ({ floorId, floorLevel: floor.level, floorLabel: floor.label, maps: floor.maps })),
  }));
}
