import { NextResponse } from "next/server";
import type { RegionsConfig } from "@/src/features/regions/types/region.types";
import { regionEngineController } from "@/src/server/regionEngine/controller";
import { logger } from "@/src/server/logger";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    const config = await request.json() as RegionsConfig;
    regionEngineController.reloadConfig(config);
    return NextResponse.json(regionEngineController.status());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Region config yeniden yüklenemedi";
    logger.error("region_engine.config_reload_failed", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
