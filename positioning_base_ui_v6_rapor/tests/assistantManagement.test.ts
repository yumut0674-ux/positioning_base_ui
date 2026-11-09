import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ASSISTANT_UNAVAILABLE_MESSAGE } from "../src/features/assistant/services/assistantAvailability";
import { istanbulDate, shiftDate, type AssistantSettings } from "../src/features/assistantAdmin/types/assistantAdmin.types";
import { AssistantManagementRepository, type BeginAssistantRequest, type FinishAssistantRequest } from "../src/server/assistant/assistantManagementRepository";
import { AssistantExecutionError, runManagedAssistantRequest } from "../src/server/assistant/assistantRequestService";
import { ADMIN_COOKIE, createAdminSession, requireAssistantAdmin, requireSameOrigin, validAdminPassword } from "../src/server/assistant/assistantAdminAuth";
import { parseDateRange, parseRequestFilters } from "../src/server/assistant/assistantAdminHttp";

const settings = (enabled = true): AssistantSettings => ({ enabled, version: 0, updatedAt: "2026-10-11T00:00:00Z", updatedBy: null, recordingStartedAt: "2026-10-11T00:00:00Z" });
class MemoryRepository {
  current = settings();
  inputs: BeginAssistantRequest[] = [];
  results: FinishAssistantRequest[] = [];
  attempts: string[] = [];
  async begin(input: BeginAssistantRequest) { this.inputs.push(input); }
  async settings() { return this.current; }
  async markAttempt(_id: string, provider: string) { this.attempts.push(provider); }
  async finish(_id: string, result: FinishAssistantRequest) { this.results.push(result); }
}
const input = (): BeginAssistantRequest => ({ id: randomUUID(), sessionKey: "test-session", question: "Test sorusu", mode: "live" });

test("disabled requests persist the question but never invoke either answer source", async () => {
  for (const provider of ["local", "gemini"] as const) {
    const repository = new MemoryRepository(); repository.current = settings(false);
    let calls = 0;
    const result = await runManagedAssistantRequest(input(), provider, repository, async () => { calls++; return { answer: "must not run", model: "test" }; });
    assert.deepEqual(result, { available: false, answer: ASSISTANT_UNAVAILABLE_MESSAGE });
    assert.equal(calls, 0); assert.equal(repository.attempts.length, 0); assert.equal(repository.inputs.length, 1);
    assert.equal(repository.results[0].status, "disabled"); assert.equal(repository.results[0].answer, ASSISTANT_UNAVAILABLE_MESSAGE);
  }
});
test("both successful sources record the actual question and answer once", async () => {
  for (const provider of ["local", "gemini"] as const) {
    const repository = new MemoryRepository();
    const result = await runManagedAssistantRequest(input(), provider, repository, async () => ({ answer: "Doğrulanmış cevap", model: "test" }));
    assert.equal(result.available, true); assert.deepEqual(repository.attempts, [provider]);
    assert.equal(repository.results.length, 1); assert.equal(repository.results[0].answer, "Doğrulanmış cevap"); assert.equal(repository.results[0].status, "success");
  }
});
test("verified conversation subject survives the managed local response", async () => {
  const repository = new MemoryRepository();
  const result = await runManagedAssistantRequest(input(), "local", repository, async () => ({
    answer: "Doğrulanmış cevap", model: "verified-location", locationSubject: "PERSON-007",
  }));
  assert.ok(result.available);
  assert.equal(result.locationSubject, "PERSON-007");
  assert.equal(repository.results[0].answer, result.answer);
});
test("disabling during generation suppresses the produced answer and preserves the provider attempt", async () => {
  const repository = new MemoryRepository();
  const result = await runManagedAssistantRequest(input(), "gemini", repository, async () => { repository.current = settings(false); return { answer: "Never display this", model: "test" }; });
  assert.equal(result.answer, ASSISTANT_UNAVAILABLE_MESSAGE); assert.deepEqual(repository.attempts, ["gemini"]);
  assert.equal(repository.results[0].status, "disabled"); assert.equal(repository.results[0].errorCode, "DISABLED_DURING_REQUEST");
});
test("technical failures keep detail in the record and return the same message", async () => {
  for (const code of ["UPSTREAM_TIMEOUT", "PROVIDER_QUOTA_EXCEEDED", "INVALID_UPSTREAM_RESPONSE", "LOCATION_SERVICE_ERROR"]) {
    const repository = new MemoryRepository();
    const result = await runManagedAssistantRequest(input(), "gemini", repository, async () => { throw new AssistantExecutionError(code, "Yönetici detayı", 502); });
    assert.equal(result.available, false); assert.equal(result.answer, ASSISTANT_UNAVAILABLE_MESSAGE);
    assert.equal(repository.results[0].errorCode, code); assert.equal(repository.results[0].errorSummary, "Yönetici detayı"); assert.equal(repository.results[0].upstreamStatus, 502);
  }
});
test("storage failures fail closed and a hung answer source has a finite deadline", async () => {
  const repository = new MemoryRepository(); let calls = 0;
  repository.settings = async () => { throw new Error("Storage unavailable"); };
  assert.equal((await runManagedAssistantRequest(input(), "gemini", repository, async () => { calls++; return { answer: "test", model: "test" }; })).answer, ASSISTANT_UNAVAILABLE_MESSAGE);
  assert.equal(calls, 0); assert.equal(repository.results[0].status, "error");
  const hanging = new MemoryRepository();
  assert.equal((await runManagedAssistantRequest(input(), "local", hanging, () => new Promise(() => {}), Date.now, 5)).available, false);
  assert.equal(hanging.results[0].errorCode, "REQUEST_TIMEOUT");
});
test("a failed initial log never starts AI generation; a failed completion never leaks the answer", async () => {
  const beginFailure = new MemoryRepository(); beginFailure.begin = async () => { throw new Error("No database"); };
  let calls = 0;
  const execute = async () => { calls++; return { answer: "Private answer", model: "test" }; };
  assert.equal((await runManagedAssistantRequest(input(), "local", beginFailure, execute)).available, false); assert.equal(calls, 0);
  const finishFailure = new MemoryRepository(); finishFailure.finish = async () => { throw new Error("No database"); };
  assert.equal((await runManagedAssistantRequest(input(), "local", finishFailure, execute)).answer, ASSISTANT_UNAVAILABLE_MESSAGE);
});
test("Istanbul dates correctly cross UTC midnight and month boundaries", () => {
  assert.equal(istanbulDate(new Date("2026-10-10T20:59:59Z")), "2026-10-10");
  assert.equal(istanbulDate(new Date("2026-10-10T21:00:00Z")), "2026-10-11");
  assert.equal(shiftDate("2026-10-01", -1), "2026-09-30");
});
test("filter validation rejects impossible dates, unbounded ranges and invalid statuses", () => {
  assert.throws(() => parseDateRange(new URLSearchParams({ from: "2026-02-30", to: "2026-03-01" })));
  assert.throws(() => parseDateRange(new URLSearchParams({ from: "2026-01-01", to: "2026-12-31" })));
  assert.throws(() => parseDateRange(new URLSearchParams({ from: "2026-10-12", to: "2026-10-11" })));
  assert.throws(() => parseRequestFilters(new URLSearchParams({ status: "unknown" })));
  assert.throws(() => parseRequestFilters(new URLSearchParams({ page: "0" })));
});
test("SQL input is literal and summary fills zero-usage days without inflating totals", async () => {
  const queries: string[] = [];
  const repository = new AssistantManagementRepository(async sql => {
    queries.push(sql);
    if (sql.includes("'today'")) return [{ payload: JSON.stringify({ today: { total: 0 }, totals: { total: 1 }, days: [{ date: "2026-10-10", total: 1, success: 1, error: 0, disabled: 0, pending: 0, interrupted: 0 }] }) }];
    if (sql.includes("'items'")) return [{ payload: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 25 }) }];
    return [];
  });
  const malicious = "' OR TRUE; -- %_\\";
  await repository.list({ from: "2026-10-10", to: "2026-10-11", status: "", provider: "", search: malicious, page: 1 });
  assert.ok(!queries.some(sql => sql.includes(malicious))); assert.match(queries.at(-1)!, /strpos\(lower\(question\)/);
  const summary = await repository.summary("2026-10-09", "2026-10-11", new Date("2026-10-11T12:00:00Z"));
  assert.deepEqual(summary.days.map(day => day.total), [0, 1, 0]); assert.equal(summary.totals.total, 1);
});
test("management requires a signed, unexpired session even on the admin hostname", () => {
  const previous = process.env.GEKON_AI_ADMIN_PASSWORD;
  process.env.GEKON_AI_ADMIN_PASSWORD = "test-management-password-32-chars";
  try {
    const now = Date.now(); const token = createAdminSession(now);
    const makeRequest = (host: string, value = token) => new Request(`http://${host}/api/admin/gekon-ai/settings`, { headers: { cookie: `${ADMIN_COOKIE}=${value}` } });
    assert.equal(requireAssistantAdmin(makeRequest("localhost"), now), "gekon-ai-admin");
    assert.throws(() => requireAssistantAdmin(new Request("http://localhost/api/admin/gekon-ai/settings"), now));
    assert.throws(() => requireAssistantAdmin(makeRequest("neu-demo.gekon.com.tr"), now));
    assert.throws(() => requireAssistantAdmin(makeRequest("localhost", `${token}x`), now));
    assert.throws(() => requireAssistantAdmin(makeRequest("localhost"), now + 9 * 60 * 60 * 1000));
    assert.equal(validAdminPassword("incorrect"), false); assert.equal(validAdminPassword(process.env.GEKON_AI_ADMIN_PASSWORD), true);
    process.env.GEKON_AI_ADMIN_PASSWORD = "changed-management-password-32-chars";
    assert.throws(() => requireAssistantAdmin(makeRequest("localhost"), now));
    process.env.GEKON_AI_ADMIN_PASSWORD = "";
    assert.throws(() => requireAssistantAdmin(makeRequest("localhost"), now));
  } finally { if (previous === undefined) delete process.env.GEKON_AI_ADMIN_PASSWORD; else process.env.GEKON_AI_ADMIN_PASSWORD = previous; }
});
test("settings mutations reject missing or cross-site origins", () => {
  const request = (origin?: string) => new Request("http://localhost:3000/api/admin/gekon-ai/settings", { headers: origin ? { origin } : {} });
  assert.doesNotThrow(() => requireSameOrigin(request("http://localhost:3000")));
  assert.throws(() => requireSameOrigin(request())); assert.throws(() => requireSameOrigin(request("https://untrusted.example")));
});
