import { NextResponse } from "next/server";
import { projectDecisionSummary, roomDecisions } from "@/src/server/location/roomDecisionRepository";
import { logger } from "@/src/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { readonly params: Promise<{ readonly decisionId: string }> }): Promise<Response> {
  const decisionId = (await params).decisionId;
  if (!decisionId || decisionId.length > 200) return NextResponse.json({ error: { code: "INVALID_DECISION_ID", message: "Karar kimliği geçersiz." } }, { status: 400 });
  try {
    const payload = await roomDecisions.detail(decisionId);
    if (!payload) return NextResponse.json({ error: { code: "DECISION_NOT_FOUND", message: "Karar kaydı bulunamadı." } }, { status: 404 });
    return NextResponse.json({ item: { ...projectDecisionSummary(payload), payload, decisionTrace: payload.decisionTrace } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("room_decisions.detail_failed", error, { decisionId });
    return NextResponse.json({ error: { code: "ROOM_DECISION_UNAVAILABLE", message: "Karar ayrıntısı şu anda yüklenemiyor." } }, { status: 503 });
  }
}
