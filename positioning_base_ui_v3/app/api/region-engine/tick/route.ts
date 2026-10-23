import { NextResponse } from "next/server";
import { regionEngineController } from "@/src/server/regionEngine/controller";

export const runtime = "nodejs";

export function POST() {
  regionEngineController.tick();
  return new NextResponse(null, { status: 204 });
}
