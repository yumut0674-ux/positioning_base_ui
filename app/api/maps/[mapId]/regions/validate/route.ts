import { NextResponse } from "next/server";
import { cleanRegionsConfig } from "@/app/api/regions/route";
import { compileRegionsConfig } from "@/src/server/regionEngine/configLoader";
import { mapIdSchema } from "@/src/server/maps/map.validation";
import { mapService } from "@/src/server/maps/mapService";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ mapId: string }> }) {
  const mapId = (await params).mapId;
  if (!mapIdSchema.safeParse(mapId).success) return NextResponse.json({ valid: false, warnings: [], error: "Harita seçimi geçersiz." }, { status: 400 });
  try {
    const catalog = await mapService.getCatalog();
    const entry = catalog.maps.find((map) => map.id === mapId);
    if (!entry) return NextResponse.json({ valid: false, warnings: [], error: "İstenen harita bulunamadı." }, { status: 404 });
    if (!entry.regionsConfigPath) return NextResponse.json({ valid: false, warnings: [], error: "Bu harita için region config bulunmuyor." }, { status: 409 });
    const compiled = compileRegionsConfig(cleanRegionsConfig(await request.json(), mapId));
    return NextResponse.json({ valid: true, warnings: compiled.warnings, configVersion: compiled.version });
  } catch (error) {
    return NextResponse.json({ valid: false, warnings: [], error: error instanceof Error ? error.message : "Config doğrulanamadı" }, { status: 400 });
  }
}
