import { NextResponse } from "next/server";
import { roomDecisions } from "@/src/server/location/roomDecisionRepository";
import { defaultDecisionRange, roomDecisionQuerySchema } from "@/src/server/location/roomDecision.validation";
import { logger } from "@/src/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const defaults = defaultDecisionRange();
  const values = Object.fromEntries(url.searchParams.entries());
  const parsed = roomDecisionQuerySchema.safeParse({ ...values, from: values.from ?? defaults.from, to: values.to ?? defaults.to });
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_QUERY", message: "Karar kaydı filtreleri geçersiz.", issues: parsed.error.issues } }, { status: 400 });
  try {
    return NextResponse.json(await roomDecisions.list(parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("room_decisions.list_failed", error);
    return NextResponse.json({ error: { code: "ROOM_DECISIONS_UNAVAILABLE", message: "Karar kayıtları şu anda yüklenemiyor." } }, { status: 503 });
  }
}
