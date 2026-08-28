import { NextResponse } from "next/server";
import { MapRequestError, mapService } from "@/src/server/maps/mapService";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly mapId: string }> },
) {
  try {
    return NextResponse.json(await mapService.getMapDetails((await params).mapId));
  } catch (error) {
    if (error instanceof MapRequestError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return NextResponse.json(
      { error: { code: "MAP_SERVICE_UNAVAILABLE", message: "Harita bilgisi şu anda yüklenemiyor." } },
      { status: 500 },
    );
  }
}
