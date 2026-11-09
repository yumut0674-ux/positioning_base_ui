import { NextResponse } from "next/server";
import { z } from "zod";
import { istanbulDate, shiftDate, REQUEST_STATUSES, type AssistantRequestFilters } from "../../features/assistantAdmin/types/assistantAdmin.types";
import { AssistantAdminError } from "./assistantManagementRepository";
import { logger } from "../logger";

export const adminResponse = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
export function adminError(error: unknown): NextResponse {
  if (error instanceof AssistantAdminError) return adminResponse({ error: error.message, code: error.code }, error.status);
  if (error instanceof z.ZodError) return adminResponse({ error: "Alanları ve tarih aralığını kontrol edin.", code: "ADMIN_REQUEST_INVALID" }, 400);
  logger.error("assistant.admin_request_failed", new Error("Assistant management storage unavailable"));
  return adminResponse({ error: "Yönetim verileri yüklenemedi. Lütfen tekrar deneyin.", code: "ADMIN_STORAGE_UNAVAILABLE" }, 503);
}
export async function readAdminBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new AssistantAdminError("İstek gövdesi gerekli.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > 4096) { await reader.cancel(); throw new AssistantAdminError("İstek çok büyük.", 413); }
    chunks.push(next.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new AssistantAdminError("Geçersiz JSON içeriği."); }
}
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
});
export function parseDateRange(params: URLSearchParams): { from: string; to: string } {
  const today = istanbulDate();
  const from = dateSchema.parse(params.get("from") ?? shiftDate(today, -6));
  const to = dateSchema.parse(params.get("to") ?? today);
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days < 0 || days > 30) throw new AssistantAdminError("En fazla 31 günlük geçerli bir tarih aralığı seçin.");
  return { from, to };
}
export function parseRequestFilters(params: URLSearchParams): AssistantRequestFilters {
  return {
    ...parseDateRange(params),
    status: z.enum(["", ...REQUEST_STATUSES]).parse(params.get("status") ?? ""),
    provider: z.enum(["", "local", "gemini"]).parse(params.get("provider") ?? ""),
    search: z.string().trim().max(150).parse(params.get("search") ?? ""),
    page: z.coerce.number().int().min(1).max(4000).parse(params.get("page") ?? 1),
  };
}
