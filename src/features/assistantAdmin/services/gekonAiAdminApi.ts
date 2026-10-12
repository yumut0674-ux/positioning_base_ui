import type { AssistantAdminSettingsResponse, AssistantRequestFilters, AssistantRequestPage, AssistantRequestRecord, AssistantSummary } from "../types/assistantAdmin.types";

export class AssistantAdminApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}
const ROOT = "/api/admin/gekon-ai";
export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${ROOT}${path}`, {
    ...init, cache: "no-store", credentials: "same-origin", signal: init.signal ?? AbortSignal.timeout(20_000),
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const body = await response.json().catch(() => null) as (T & { error?: string; code?: string }) | null;
  if (!response.ok || body === null) throw new AssistantAdminApiError(body?.error ?? "Veriler yüklenemedi. Lütfen tekrar deneyin.", response.status, body?.code);
  return body;
}
export const fetchAdminSession = () => adminFetch<{ authenticated: boolean; configured: boolean }>("/session");
export const loginAdmin = (password: string) => adminFetch<{ authenticated: boolean; configured: boolean }>("/session", { method: "POST", body: JSON.stringify({ password }) });
export const logoutAdmin = () => adminFetch<{ authenticated: boolean; configured: boolean }>("/session", { method: "DELETE" });
export const fetchAdminSettings = (signal?: AbortSignal) => adminFetch<AssistantAdminSettingsResponse>("/settings", { signal });
export const saveAdminSettings = (input: { enabled: boolean; version: number }) => adminFetch<AssistantAdminSettingsResponse>("/settings", { method: "PATCH", body: JSON.stringify(input) });
export const fetchAssistantSummary = (from: string, to: string, signal?: AbortSignal) => adminFetch<AssistantSummary>(`/summary?${new URLSearchParams({ from, to })}`, { signal });
export const fetchAssistantRequests = (filters: AssistantRequestFilters, signal?: AbortSignal) => adminFetch<AssistantRequestPage>(`/requests?${new URLSearchParams({ ...filters, page: String(filters.page) })}`, { signal });
export const fetchAssistantRequest = (id: string, signal?: AbortSignal) => adminFetch<AssistantRequestRecord>(`/requests/${encodeURIComponent(id)}`, { signal });
