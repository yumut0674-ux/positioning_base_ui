import { NextResponse } from "next/server";
import { areaTransitions } from "@/src/server/regionEngine/areaTransitionRepository";
import { AREA_EVENT_TYPES } from "@/src/features/decisionLogs/services/areaEventLabels";
import type { AreaEventType } from "@/src/server/regionEngine/AreaTransitionEngine";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? undefined, to = params.get("to") ?? undefined;
  if ((from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to))))
    return NextResponse.json({ error: "Tarih aralığı geçersiz" }, { status: 400 });
  const type = params.get("type") ?? undefined;
  if (type && !AREA_EVENT_TYPES.includes(type as AreaEventType))
    return NextResponse.json({ error: "Olay türü geçersiz" }, { status: 400 });
  const limit = Number(params.get("limit") ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return NextResponse.json({ error: "Limit geçersiz" }, { status: 400 });
  try {
    const items = await areaTransitions.list({ tagCode: params.get("tagCode") ?? undefined, mapId: params.get("mapId") ?? undefined,
      areaId: params.get("areaId") ?? undefined, type, from, to, limit });
    return NextResponse.json({ items });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Alan olayları okunamadı" }, { status: 500 }); }
}
