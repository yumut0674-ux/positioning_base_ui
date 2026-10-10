import type { SessionSeed, TestPlan, TestSession } from "./roomTestModel";

export interface TestSummary { id: string; name: string; createdAt: string; status: string; tagCodes: string[]; visits: number; version: number }
export class TestApiError extends Error { constructor(message: string, public readonly status: number) { super(message); } }
export async function testApi<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/room-tests${url}`, { cache: "no-store", headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000) });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new TestApiError(payload.error ?? "Test servisine ulaşılamadı.", response.status);
  return payload;
}
export async function fetchTestPlan() {
  const startWall = Date.now(), startMono = performance.now();
  const result = await testApi<{ plan: TestPlan; serverTime: string }>("/plans");
  const duration = performance.now() - startMono;
  const clockSample: SessionSeed["clockSample"] = { measuredAt: new Date(startWall + duration).toISOString(),
    offsetMs: Math.round(Date.parse(result.serverTime) - startWall - duration / 2), uncertaintyMs: Math.ceil(duration / 2) };
  return { ...result, clockSample };
}
export const fetchTestHistory = (offset = 0, search = "") => testApi<{ items: TestSummary[]; nextOffset: number | null; serverTime: string }>(`?offset=${offset}&search=${encodeURIComponent(search)}`);
export const fetchTest = (id: string) => testApi<{ session: TestSession }>(`/${encodeURIComponent(id)}`);

export function downloadTest(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
