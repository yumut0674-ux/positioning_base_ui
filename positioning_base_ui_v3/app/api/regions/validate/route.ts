import { NextResponse } from "next/server";
import { cleanRegionsConfig } from "../route";
import { compileRegionsConfig } from "@/src/server/regionEngine/configLoader";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try { const compiled = compileRegionsConfig(cleanRegionsConfig(await request.json()));
    return NextResponse.json({ valid: true, warnings: compiled.warnings, configVersion: compiled.version,
      effectiveSettings: compiled.regions.map(region => ({ regionId: region.id, settings: region.settings,
        doors: region.entrances.map(door => ({ doorId: door.id, settings: door.settings })) })) }); }
  catch (error) { return NextResponse.json({ valid: false, warnings: [], error: error instanceof Error ? error.message : "Config doğrulanamadı" }, { status: 400 }); }
}
