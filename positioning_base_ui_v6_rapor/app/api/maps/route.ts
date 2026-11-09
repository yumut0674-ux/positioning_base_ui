import { NextResponse } from "next/server";
import { mapService } from "@/src/server/maps/mapService";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await mapService.getCatalog());
  } catch {
    return NextResponse.json(
      { error: { code: "MAP_CATALOG_UNAVAILABLE", message: "Harita kataloğu şu anda yüklenemiyor." } },
      { status: 503 },
    );
  }
}
