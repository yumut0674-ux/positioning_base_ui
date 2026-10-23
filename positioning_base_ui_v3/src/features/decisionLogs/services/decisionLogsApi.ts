import type { DecisionLogDetail, DecisionLogFilters, DecisionLogListResponse, DecisionLogSummary } from "../types/decisionLog.types";

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; } catch { return null; }
}

export async function fetchDecisionLogs(filters: DecisionLogFilters, signal?: AbortSignal): Promise<DecisionLogListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
  const response = await fetch(`/api/room-decisions?${params}`, { cache: "no-store", headers: { Accept: "application/json" }, signal });
  const body = await responseJson(response) as DecisionLogListResponse & { error?: { message?: string } };
  if (!response.ok) throw new Error(body?.error?.message ?? "Karar kayıtları yüklenemedi.");
  return body;
}

export async function fetchDecisionLogDetail(decisionId: string, signal?: AbortSignal): Promise<DecisionLogDetail> {
  const response = await fetch(`/api/room-decisions/${encodeURIComponent(decisionId)}`, { cache: "no-store", headers: { Accept: "application/json" }, signal });
  const body = await responseJson(response) as { item?: DecisionLogDetail; error?: { message?: string } };
  if (!response.ok || !body.item) throw new Error(body?.error?.message ?? "Karar ayrıntısı yüklenemedi.");
  return body.item;
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join("|") : value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function decisionLogsCsv(items: readonly DecisionLogSummary[]): string {
  const columns = ["decisionId","tagCode","measuredAt","publishedAt","mapId","eventType","previousState","nextState","regionId","candidateRegionId","measurementKind","confidence","rawX","rawY","doorId","doorDistanceMeters","reasonCodes","engineVersion","configVersion"] as const;
  return [columns.join(","), ...items.map(item => columns.map(column => csvCell(item[column])).join(","))].join("\r\n");
}

export function downloadDecisionLogs(items: readonly DecisionLogSummary[], format: "json" | "csv"): void {
  const content = format === "json" ? JSON.stringify(items, null, 2) : decisionLogsCsv(items);
  const blob = new Blob([format === "csv" ? `\uFEFF${content}` : content], { type: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `oda-karar-kayitlari-${new Date().toISOString().replaceAll(":", "-")}.${format}`; anchor.click(); URL.revokeObjectURL(url);
}
