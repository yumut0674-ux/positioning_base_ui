import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { resolveUiMode } from "@/src/app/uiMode";
import { TestError } from "@/src/features/roomTests/services/roomTestModel";

export function requireAdmin(request: Request) {
  if (resolveUiMode(request.headers.get("host") ?? new URL(request.url).host) !== "admin") throw new TestError("Bu panel admin arayüzünde kullanılabilir.", 403);
}
export async function readBody(request: Request): Promise<unknown> {
  const contents = await request.text();
  if (Buffer.byteLength(contents) > 5 * 1024 * 1024) throw new TestError("Dosya en fazla 5 MB olabilir.", 413);
  try { return JSON.parse(contents); } catch { throw new TestError("Geçersiz JSON içeriği."); }
}
export function testResponse(body: unknown) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
export function testError(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join(" ") }, { status: 400 });
  if (error instanceof TestError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Test kayıt servisine ulaşılamadı. Yerel kaydınız korunuyor; tekrar deneyin." }, { status: 503 });
}
