import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { queryPostgres } from "../src/server/postgresClient";
import { AssistantManagementRepository } from "../src/server/assistant/assistantManagementRepository";

test("isolated PostgreSQL schema: migration, persisted settings, audit, literal search and Istanbul day counts", { skip: process.env.ASSISTANT_TEST_DB !== "1" }, async () => {
  const schema = `gekon_ai_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^gekon_ai_test_[a-f0-9]{32}$/);
  const query = (sql: string) => queryPostgres(`SET search_path TO ${schema}; ${sql}`, { timeoutMs: 10_000 });
  await queryPostgres(`CREATE SCHEMA ${schema};`, { timeoutMs: 10_000 });
  try {
    const repository = new AssistantManagementRepository(query);
    const original = await repository.settings(); assert.equal(original.enabled, true);
    const changed = await repository.updateSettings(false, original.version, "test-admin"); assert.equal(changed.enabled, false);
    assert.equal((await new AssistantManagementRepository(query).settings()).enabled, false);
    await assert.rejects(repository.updateSettings(true, original.version, "test-admin"), /başka bir oturumda/);
    const events = await query("SELECT count(*)::text AS count FROM assistant_setting_events;"); assert.equal(events[0].count, "1");
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (let index = 0; index < ids.length; index++) {
      await repository.begin({ id: ids[index], sessionKey: "test-only", question: index === 0 ? "O'Brien %_ <script> test" : "Test soru", mode: "history" });
      await repository.markAttempt(ids[index], index === 0 ? "local" : "gemini");
      await repository.finish(ids[index], { status: index === 2 ? "disabled" : "success", answer: "Test cevap", durationMs: 25 });
    }
    await query(`UPDATE assistant_requests SET created_at='2026-10-10T20:59:59Z' WHERE id='${ids[0]}'; UPDATE assistant_requests SET created_at='2026-10-10T21:00:00Z' WHERE id IN ('${ids[1]}','${ids[2]}');`);
    const summary = await repository.summary("2026-10-09", "2026-10-11", new Date("2026-10-11T12:00:00Z"));
    assert.deepEqual(summary.days.map(day => day.total), [0, 1, 2]); assert.equal(summary.today.total, 2); assert.equal(summary.totals.disabled, 1);
    const page = await repository.list({ from: "2026-10-10", to: "2026-10-11", search: "%_", provider: "", status: "", page: 1 });
    assert.equal(page.total, 1); assert.equal(page.items[0].id, ids[0]); assert.ok(!("answer" in page.items[0]));
    const detail = await repository.detail(ids[0]); assert.equal(detail.answer, "Test cevap"); assert.equal(detail.provider, "local");
    const missing = await repository.list({ from: "2026-10-10", to: "2026-10-11", search: "' OR TRUE; --", provider: "", status: "", page: 1 }); assert.equal(missing.total, 0);
  } finally { await queryPostgres(`DROP SCHEMA ${schema} CASCADE;`, { timeoutMs: 10_000 }); }
});
