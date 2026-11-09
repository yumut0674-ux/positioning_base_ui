import { readFile } from "node:fs/promises";
import { mapService } from "@/src/server/maps/mapService";
import { regionsConfigPathForMap } from "@/src/server/regionEngine/configLoader";
import type { RegionsConfig } from "@/src/features/regions/types/region.types";
import { systemPlan } from "@/src/features/roomTests/services/roomTestModel";
import { requireAdmin, testError, testResponse } from "@/src/server/roomTests/roomTestHttp";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const catalog = await mapService.getCatalog();
    const entries = await Promise.all(catalog.maps.filter(entry => entry.regionsConfigPath && entry.status === "active").map(async entry => ({
      entry, config: JSON.parse(await readFile(regionsConfigPathForMap(entry.id), "utf8")) as RegionsConfig,
    })));
    return testResponse({ plan: systemPlan(entries), serverTime: new Date().toISOString() });
  } catch (error) { return testError(error); }
}
