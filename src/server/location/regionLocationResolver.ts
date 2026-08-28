import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { resolveLocation } from "@/src/features/map/services/LocationResolverService";
import type { RegionsConfig } from "@/src/features/regions/types/region.types";

const configPath = path.join(process.cwd(), "config", "regions.json");

let cachedConfig: RegionsConfig | null = null;
let cachedModifiedAt = -1;

function readRegionsConfig(): RegionsConfig | null {
  try {
    const modifiedAt = statSync(configPath).mtimeMs;
    if (modifiedAt !== cachedModifiedAt) {
      cachedConfig = JSON.parse(readFileSync(configPath, "utf8")) as RegionsConfig;
      cachedModifiedAt = modifiedAt;
    }
    return cachedConfig;
  } catch {
    cachedConfig = null;
    cachedModifiedAt = -1;
    return null;
  }
}

/** Resolves names from the saved Regions panel configuration, never from a static area list. */
export function resolveConfiguredLocation(x: number, y: number, floorPlanId: string): string {
  return resolveLocation(x, y, floorPlanId, readRegionsConfig());
}
