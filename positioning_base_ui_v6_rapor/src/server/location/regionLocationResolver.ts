import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { resolveLocation } from "@/src/features/map/services/LocationResolverService";
import type { RegionsConfig } from "@/src/features/regions/types/region.types";

const cache = new Map<string, { config: RegionsConfig; modifiedAt: number }>();
let catalogCache: { modifiedAt: number; names: Map<string, string> } | undefined;

export function resolveConfiguredMapName(mapId: string | null | undefined): string | null {
  if (!mapId) return null;
  try {
    const file = path.join(process.cwd(), "config", "maps", "catalog.json");
    const modifiedAt = statSync(file).mtimeMs;
    if (!catalogCache || catalogCache.modifiedAt !== modifiedAt) {
      const catalog = JSON.parse(readFileSync(file, "utf8")) as { maps: { id: string; displayName: string }[] };
      catalogCache = { modifiedAt, names: new Map(catalog.maps.map(map => [map.id, map.displayName])) };
    }
    return catalogCache.names.get(mapId) ?? null;
  } catch { return null; }
}

function readRegionsConfig(mapId: string): RegionsConfig | null {
  try {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(mapId)) return null;
    const configPath = path.resolve(process.cwd(), "config", "maps", mapId, "regions.json");
    const modifiedAt = statSync(configPath).mtimeMs;
    const cached = cache.get(mapId);
    if (cached?.modifiedAt === modifiedAt) return cached.config;
    const config = JSON.parse(readFileSync(configPath, "utf8")) as RegionsConfig;
    if (config.map.mapId !== mapId) return null;
    cache.set(mapId, { config, modifiedAt });
    return config;
  } catch {
    return null;
  }
}

/** Resolves names from the saved Regions panel configuration, never from a static area list. */
export function resolveConfiguredLocation(x: number, y: number, floorPlanId: string): string {
  return resolveLocation(x, y, floorPlanId, readRegionsConfig(floorPlanId));
}
