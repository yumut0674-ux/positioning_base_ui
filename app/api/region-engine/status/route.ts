import { NextResponse } from "next/server";
import { regionEngineController } from "@/src/server/regionEngine/controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(regionEngineController.status(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { enabled?: unknown };
    if (typeof body.enabled !== "boolean" || Object.keys(body).some((field) => field !== "enabled")) {
      return NextResponse.json({ error: 'İstek gövdesi yalnızca boolean "enabled" alanını içermelidir' }, { status: 400 });
    }
    return NextResponse.json(await regionEngineController.setEnabled(body.enabled));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Region engine durumu değiştirilemedi";
    const status = message.includes("kullanımda") ? 409 : 503;
    return NextResponse.json({ error: message, ...regionEngineController.status() }, { status });
  }
}
