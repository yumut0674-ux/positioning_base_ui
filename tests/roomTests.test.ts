import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { applyAction, createSession, exportSession, importPlan, planSchema, projectSession, recordedMs, type SessionSeed, type TestAction, type TestPlan } from "../src/features/roomTests/services/roomTestModel";
import { RoomTestRepository } from "../src/server/roomTests/roomTestRepository";
import { requireAdmin } from "../src/server/roomTests/roomTestHttp";
import { datasetDir } from "../tools/room-benchmark/importer";

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 10, 9, 0, seconds)).toISOString();
const plan: TestPlan = { source: "system", building: "Test binası", floors: [
  { id: "floor-1", mapId: "map-1", name: "Kat 1", areas: [{ id: "room-01", name: "Oda 1", type: "room", connectsTo: "corridor-1" }, { id: "room-02", name: "Oda 2", type: "room" }, { id: "corridor-1", name: "Koridor", type: "corridor" }] },
  { id: "floor-2", mapId: "map-2", name: "Kat 2", areas: [{ id: "room-01", name: "Üst kat oda", type: "room" }] },
] };
const seed = (): SessionSeed => ({ id: `test-${randomUUID()}`, name: "Test", tagCodes: ["TAG-A"], tagVerified: true, plan: structuredClone(plan), mode: "floor", route: [], createdAt: at(0) });
const action = (type: TestAction["type"], seconds: number, extra: Partial<TestAction> = {}): TestAction => ({ id: randomUUID(), type, at: at(seconds), ...extra });
const select = (areaId: string, seconds: number, mapId = "map-1") => action("select", seconds, { location: { mapId, areaId } });

test("room handoff is atomic, and undo restores the entire previous visit without deleting audit events", () => {
  let session = createSession(seed());
  session = applyAction(session, action("start", 0)); session = applyAction(session, select("room-01", 1));
  const transition = select("room-02", 5); session = applyAction(session, transition);
  let state = projectSession(session);
  assert.equal(state.visits[0].exitedAt, state.visits[1].enteredAt); assert.equal(state.visits[0].durationSeconds, 4);
  session = applyAction(session, action("undo", 6, { targetId: transition.id })); state = projectSession(session);
  assert.equal(state.visits.length, 1); assert.equal(state.active?.areaId, "room-01"); assert.equal(state.active?.exitedAt, null);
  assert.equal(session.events.length, 4); assert.equal(session.revision, 2);
});

test("pause closes the active visit and excludes waiting time from both recording time and benchmark truth", () => {
  let session = createSession(seed());
  for (const entry of [action("start", 0), select("room-01", 1), action("pause", 5), action("resume", 20), select("room-02", 21), action("complete", 30)]) session = applyAction(session, entry);
  assert.equal(recordedMs(session, Date.parse(at(60))), 15000);
  const state = projectSession(session); assert.equal(state.visits[0].exitedAt, at(5)); assert.equal(state.active, null);
  const output = exportSession(session, "benchmark") as { parts: { truth: { test: { from: string; to: string } } }[] };
  assert.equal(output.parts.length, 2); assert.equal(output.parts[0].truth.test.to, at(5)); assert.equal(output.parts[1].truth.test.from, at(21));
});

test("exported benchmark part ids can be used by the existing CLI without accepting path traversal", () => {
  let session = createSession(seed());
  for (const entry of [action("start", 0), select("room-01", 1), action("complete", 5)]) session = applyAction(session, entry);
  const output = exportSession(session, "benchmark") as { parts: { truth: { testId: string } }[] };
  const id = output.parts[0].truth.testId;
  assert.ok(datasetDir(id).endsWith(id));
  assert.throws(() => datasetDir(`${id}/../outside`), /Geçersiz/);
  assert.throws(() => datasetDir(`${session.id}-part-0`), /Geçersiz/);
});

test("unknown intervals and repeated room ids across maps never merge into corridor truth", () => {
  let session = createSession(seed());
  for (const entry of [action("start", 0), select("room-01", 1), action("leave", 5), select("room-02", 10), select("room-01", 15, "map-2"), action("complete", 20)]) session = applyAction(session, entry);
  const output = exportSession(session, "benchmark") as { parts: { mapId: string; truth: { test: { from: string; to: string } } }[] };
  assert.equal(output.parts.length, 3); assert.equal(output.parts[0].truth.test.to, at(5)); assert.equal(output.parts[1].truth.test.from, at(10)); assert.equal(output.parts[2].mapId, "map-2");
  assert.equal(projectSession(session).visits[2].areaName, "Üst kat oda");
});

test("a repeated request is idempotent, different content with the same id and backwards clocks are rejected", () => {
  let session = createSession(seed()); const start = action("start", 1); session = applyAction(session, start);
  assert.equal(applyAction(session, start), session);
  assert.throws(() => applyAction(session, { ...start, at: at(2) }), /farklı içerik/);
  assert.throws(() => applyAction(session, select("room-01", 0)), /saati geriye/);
  assert.throws(() => applyAction(session, select("missing", 3)), /bulunamadı/);
  session = applyAction(session, select("room-01", 3));
  assert.throws(() => applyAction(session, select("room-01", 4)), /zaten aktif/);
  session = applyAction(session, action("pause", 5));
  assert.throws(() => applyAction(session, select("room-02", 6)), /mevcut kayıt durumunda/);
});

test("local events do not invent server receipt times and clock measurements survive exports", () => {
  const initial = seed(); initial.clockSample = { measuredAt: at(0), offsetMs: 3500, uncertaintyMs: 100 };
  const local = applyAction(createSession(initial), action("start", 0));
  assert.equal(local.events[0].receivedAt, null);
  const confirmed = applyAction(local, select("room-01", 1), at(3));
  assert.equal(confirmed.events[1].at, at(1)); assert.equal(confirmed.events[1].receivedAt, at(3));
  const output = exportSession(confirmed, "full") as { clockSample: unknown };
  assert.deepEqual(output.clockSample, initial.clockSample);
});

test("active visit exports retain the four fields and completed tests require explicit tag verification to score", () => {
  const initial = seed(); initial.tagVerified = false;
  let session = createSession(initial);
  for (const entry of [action("start", 0), select("room-01", 1)]) session = applyAction(session, entry);
  const rows = exportSession(session, "array") as Record<string, unknown>[];
  assert.deepEqual(Object.keys(rows[0]), ["room", "entered_at", "exited_at", "duration_seconds"]);
  assert.equal(rows[0].exited_at, null); assert.equal(rows[0].duration_seconds, null);
  assert.throws(() => exportSession(session, "benchmark"), /testi bitirin/);
  session = applyAction(session, action("complete", 10));
  let output = exportSession(session, "benchmark") as { parts: { truth: { groups: unknown[] } }[] }; assert.deepEqual(output.parts[0].truth.groups, []);
  session = applyAction(session, action("tags", 11, { tagCodes: ["TAG-B"], tagVerified: true, reason: "Saha doğrulaması" }));
  output = exportSession(session, "benchmark") as typeof output;
  assert.deepEqual(output.parts[0].truth.groups, [{ id: "rota-1", tagCodes: ["TAG-B"] }]); assert.equal(session.revision, 2);
});

test("page recovery stops observation at the last heartbeat, keeping unobserved time outside visits", () => {
  let session = createSession(seed());
  for (const entry of [action("start", 0), select("room-01", 1), action("recover", 5, { reason: "Sayfa kapandı" }), action("resume", 30)]) session = applyAction(session, entry);
  assert.equal(projectSession(session).active, null); assert.equal(projectSession(session).visits[0].exitedAt, at(5)); assert.equal(recordedMs(session, Date.parse(at(32))), 7000);
});

test("sequential routes advance and undo as one action, and reject an out-of-order step", () => {
  const initial = seed(); initial.mode = "route"; initial.route = [{ mapId: "map-1", areaId: "room-01" }, { mapId: "map-1", areaId: "room-02" }];
  let session = applyAction(createSession(initial), action("start", 0));
  assert.throws(() => applyAction(session, { ...select("room-02", 1), routeStep: 1 }), /rota adımı/);
  const first = { ...select("room-01", 1), routeStep: 0 }; session = applyAction(session, first);
  assert.equal(projectSession(session).routeProgress, 1);
  session = applyAction(session, action("undo", 2, { targetId: first.id })); assert.equal(projectSession(session).routeProgress, 0);
});

test("legacy plan imports remain detached, validate duplicate ids and invalid connections", () => {
  const imported = importPlan({ building: "Özel", floors: [{ id: "kat", name: "Kat", areas: [{ id: "oda5", name: "Oda 5", type: "room", connects_to: "koridor" }, { id: "koridor", name: "Koridor", type: "corridor" }] }] });
  assert.equal(imported.source, "custom"); assert.equal(imported.floors[0].mapId, "custom-kat"); assert.equal(imported.floors[0].areas[0].connectsTo, "koridor");
  assert.throws(() => planSchema.parse({ ...imported, floors: [imported.floors[0], imported.floors[0]] }), /benzersiz/);
  assert.throws(() => importPlan({ building: "Özel", floors: [{ id: "kat", name: "Kat", areas: [{ id: "oda5", name: "Oda", type: "room", connects_to: "missing" }] }] }), /bağlantı/);
  const initial = seed(); initial.plan = imported; let session = createSession(initial);
  session = applyAction(session, action("start", 0)); session = applyAction(session, action("complete", 1));
  assert.throws(() => exportSession(session, "benchmark"), /sistem haritası/);
});

test("repository atomically updates document and audit log, refuses competing versions and retries a lost response", async () => {
  let stored = createSession(seed()); const queries: string[] = [];
  const repository = new RoomTestRepository(async sql => {
    queries.push(sql);
    if (sql.startsWith("SELECT payload")) return [{ payload: JSON.stringify(stored) }];
    if (sql.startsWith("WITH changed")) {
      const start = sql.indexOf("SET payload='") + "SET payload='".length;
      const end = sql.indexOf("'::jsonb,version=", start);
      stored = JSON.parse(sql.slice(start, end).replaceAll("''", "'"));
      return [{ payload: JSON.stringify(stored) }];
    }
    return [];
  });
  const start = action("start", 1);
  await repository.act(stored.id, start, 0);
  assert.equal(stored.version, 1); assert.match(queries.find(sql => sql.startsWith("WITH changed"))!, /INSERT INTO room_test_actions/);
  const writes = queries.filter(sql => sql.startsWith("WITH changed")).length;
  const repeated = await repository.act(stored.id, start, 0); assert.equal(repeated.version, 1);
  assert.equal(queries.filter(sql => sql.startsWith("WITH changed")).length, writes);
  await assert.rejects(repository.act(stored.id, select("room-01", 2), 0), /başka bir sekmede/);
});

test("demo hosts cannot call the room test API while the existing admin/local modes can", () => {
  assert.throws(() => requireAdmin(new Request("http://neu-demo.gekon.com.tr/api/room-tests")), /admin/);
  requireAdmin(new Request("http://neu-admin.gekon.com.tr/api/room-tests")); requireAdmin(new Request("http://127.0.0.1:3010/api/room-tests"));
});
