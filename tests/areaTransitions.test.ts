import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rmdir, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_REGIONS_CONFIG } from "../src/features/regions/config/defaultRegionsConfig";
import type { AreaGateDefinition, RegionsConfig } from "../src/features/regions/types/region.types";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import { AreaTransitionEngine, type AreaTransitionEvent } from "../src/server/regionEngine/AreaTransitionEngine";
import { AreaTransitionRepository } from "../src/server/regionEngine/areaTransitionRepository";
import { queryPostgres } from "../src/server/postgresClient";
import { cleanRegionsConfig, persistRegionsConfig } from "../app/api/regions/route";
import { parseSourceHealthPayload } from "../app/api/tracking/ingest/route";
import { AREA_EVENT_LABELS, AREA_EVENT_TYPES } from "../src/features/decisionLogs/services/areaEventLabels";
import { EMPTY_AREA_VISIBILITY, areaVisibilityKey, isAreaVisible, isGateVisible, readAreaVisibility, toggleAreaVisibility, visibleSelection } from "../src/features/regions/services/areaEditorVisibility";

const point = (x: number, y: number) => ({ pixel: { x, y }, world: { x, y } });
const rect = (x1: number, y1: number, x2: number, y2: number) => [point(x1, y1), point(x2, y1), point(x2, y2), point(x1, y2)];
function fixture(mapId = "map-a", secondGate = false): RegionsConfig {
  const gates: AreaGateDefinition[] = [
    { id: `entry-${mapId}`, name: "Giriş", areaId: `area-${mapId}`, role: "entry", waitMs: 30_000, polygon: rect(-1, 4, 1, 6) },
    { id: `exit-${mapId}`, name: "Çıkış", areaId: `area-${mapId}`, role: "exit", waitMs: 30_000, polygon: rect(9, 4, 11, 6) },
  ];
  if (secondGate) gates.push({ id: `entry2-${mapId}`, name: "Diğer giriş", areaId: `area-${mapId}`, role: "bidirectional", waitMs: 30_000, polygon: rect(4, -1, 6, 1) });
  return { ...DEFAULT_REGIONS_CONFIG, map: { ...DEFAULT_REGIONS_CONFIG.map, mapId }, regions: [],
    areaTracking: { minimumQuality: 0.5, confirmationCount: 2, confirmationWindowMs: 10_000, maximumSpeedMetersPerSecond: 20 },
    largeAreas: [{ id: `area-${mapId}`, name: `Alan ${mapId}`, color: "#6c4bc2", polygon: rect(0, 0, 10, 10), gates }] };
}
const base = Date.parse("2026-01-01T00:00:00.000Z");
function harness(secondGate = false) {
  const configs = new Map([["map-a", compileRegionsConfig(fixture("map-a", secondGate))], ["map-b", compileRegionsConfig(fixture("map-b"))]]);
  const events: AreaTransitionEvent[] = [];
  const engine = new AreaTransitionEngine(configs, event => events.push(event));
  const send = (seconds: number, x: number, y: number, mapId = "map-a", tagCode = "T", quality = 0.9) =>
    engine.ingest({ tagCode, mapId, x, y, quality, timestamp: new Date(base + seconds * 1000).toISOString() }, base + seconds * 1000);
  const enter = () => { send(0, 0.5, 5); send(1, 2, 5); send(2, 3, 5); };
  return { configs, engine, events, send, enter };
}

test("normal entry and observed exit use raw gate and inside/outside evidence", () => {
  const h = harness(); h.enter();
  assert.deepEqual(h.events.map(event => event.type), ["AREA_ENTERED"]);
  h.send(3, 9.5, 5); h.send(4, 12, 5); h.send(5, 13, 5);
  assert.deepEqual(h.events.map(event => event.type), ["AREA_ENTERED", "AREA_EXITED_OBSERVED"]);
  assert.equal(h.events[1].gateId, "exit-map-a"); assert.equal(h.events[1].observed, true);
});
test("exit gate dropout becomes estimated after 30 seconds, with separate measurement and decision times", () => {
  const h = harness(); h.enter(); h.send(3, 9.5, 5);
  h.engine.noteSourceHealth("map-a", true, base + 32_000);
  h.engine.tick(base + 32_999); assert.equal(h.events.length, 1);
  h.engine.tick(base + 33_000);
  assert.equal(h.events[1].type, "AREA_EXITED_ESTIMATED");
  assert.equal(h.events[1].lastMeasuredAt, new Date(base + 3000).toISOString());
  assert.equal(h.events[1].decidedAt, new Date(base + 33_000).toISOString());
});
test("return within wait cancels exit; room or inside dropout never creates an exit", () => {
  const h = harness(); h.enter(); h.send(3, 9.5, 5); h.send(10, 4, 5); h.engine.noteSourceHealth("map-a", true, base + 50_000); h.engine.tick(base + 50_000);
  assert.equal(h.events.length, 1);
  const second = harness(); second.enter(); second.engine.noteSourceHealth("map-a", true, base + 50_000); second.engine.tick(base + 50_000);
  assert.equal(second.events.length, 1);
});
test("late, duplicate, implausible and low quality packets cannot confirm a transition", () => {
  const h = harness(); h.send(0, 0.5, 5); h.send(1, 2, 5, "map-a", "T", 0.1); h.send(1, 2, 5);
  h.send(1, 3, 5); h.send(0.5, 3, 5); assert.equal(h.events.length, 0);
  h.send(2, 3, 5); assert.equal(h.events.length, 1);
  h.send(3, 9.5, 5, "map-a", "T", 0.1); h.engine.noteSourceHealth("map-a", true, base + 40_000); h.engine.tick(base + 40_000);
  assert.equal(h.events.length, 1);
});
test("multiple gates and floor handoff share a transition id", () => {
  const h = harness(true); h.send(0, 5, 0.5); h.send(1, 5, 2); h.send(2, 5, 3);
  assert.equal(h.events[0].gateId, "entry2-map-a");
  h.send(3, 3, 3, "map-b"); h.send(4, 4, 3, "map-b");
  assert.deepEqual(h.events.map(event => event.type), ["AREA_ENTERED", "AREA_ENTERED", "AREA_EXITED_FLOOR_INFERRED"]);
  assert.equal(h.events[1].transitionId, h.events[2].transitionId);
  assert.equal(h.events[1].observed, true); assert.equal(h.events[2].observed, false);
  assert.equal(h.events[2].gateId, null);
  assert.equal(AREA_EVENT_LABELS[h.events[2].type], "Alandan çıktı — kat değişiminden çıkarıldı");
  assert.ok(AREA_EVENT_TYPES.includes(h.events[2].type));
});
test("restart preserves pending exit, idempotent event identity and global outage guard", () => {
  const h = harness(); h.enter(); h.send(3, 9.5, 5);
  const recovered: AreaTransitionEvent[] = [];
  const engine = new AreaTransitionEngine(h.configs, event => recovered.push(event)); engine.restore(h.engine.snapshot());
  engine.tick(base + 40_000); assert.equal(recovered.length, 0);
  engine.noteSourceHealth("map-a", true, base + 40_000); engine.tick(base + 40_000);
  assert.equal(recovered[0].type, "AREA_EXITED_ESTIMATED");
  assert.equal(engine.snapshot().find(state => state.tagCode === "T" && state.mapId === "map-a")?.inside, false);
  assert.equal(recovered[0].id, (() => { h.engine.noteSourceHealth("map-a", true, base + 40_000); h.engine.tick(base + 40_000); return h.events[1].id; })());
});
test("another map staying live does not turn a failed map's pending gates into mass exits", () => {
  const h = harness(); h.enter(); h.send(3, 9.5, 5);
  h.send(40, 30, 30, "map-b", "OTHER"); h.engine.noteSourceHealth("map-b", true, base + 40_000); h.engine.tick(base + 40_000);
  assert.equal(h.events.length, 1);
  h.send(41, 30, 30, "map-a", "OTHER"); h.engine.tick(base + 41_000);
  assert.equal(h.events.length, 1);
  h.engine.noteSourceHealth("map-a", true, base + 41_000); h.engine.tick(base + 41_000);
  assert.equal(h.events[1].type, "AREA_EXITED_ESTIMATED");
});
test("single tag needs independent healthy heartbeat; unknown and outage keep a visible pending reason", () => {
  const h = harness(); h.enter(); h.send(3, 9.5, 5);
  h.engine.tick(base + 33_000);
  assert.equal(h.events.length, 1);
  assert.match(h.engine.diagnostics(base + 33_000).pendingExits[0].reason, /bilinmiyor/);
  h.engine.noteSourceHealth("map-a", false, base + 33_000);
  h.engine.tick(base + 33_000);
  assert.equal(h.events.length, 1);
  assert.match(h.engine.diagnostics(base + 33_000).pendingExits[0].reason, /kesintisi/);
  h.engine.noteSourceHealth("map-a", true, base + 34_000);
  h.engine.tick(base + 34_000);
  assert.equal(h.events[1].type, "AREA_EXITED_ESTIMATED");
});
test("a stale healthy signal never authorizes mass estimated exits", () => {
  const h = harness();
  for (let i = 0; i < 30; i++) {
    h.send(0, .5, 5, "map-a", `T${i}`); h.send(1, 2, 5, "map-a", `T${i}`); h.send(2, 3, 5, "map-a", `T${i}`); h.send(3, 9.5, 5, "map-a", `T${i}`);
  }
  h.engine.noteSourceHealth("map-a", true, base + 10_000);
  h.engine.tick(base + 40_000);
  assert.equal(h.events.length, 30);
  assert.equal(h.engine.diagnostics(base + 40_000).pendingExits.length, 30);
  assert.equal(h.engine.diagnostics(base + 40_000).sourceHealth["map-a"], "unknown");
});
test("outside confirmation after a long gap is estimated, while timely gate evidence is observed", () => {
  const late = harness(); late.enter(); late.send(3, 9.5, 5);
  late.send(3600, 12, 5); late.send(3601, 13, 5);
  assert.equal(late.events[1].type, "AREA_EXITED_ESTIMATED");
  assert.equal(late.events[1].observed, false);
  late.send(2, 12, 5); late.send(3601, 13, 5);
  assert.equal(late.events.length, 2);
  const timely = harness(); timely.enter(); timely.send(3, 9.5, 5); timely.send(4, 12, 5); timely.send(5, 13, 5);
  assert.equal(timely.events[1].type, "AREA_EXITED_OBSERVED");
});
test("source health payload validates freshness independently of positions", () => {
  assert.deepEqual(parseSourceHealthPayload({ type: "source_health", zone_id: "floor-1", status: "healthy", timestamp: new Date(base).toISOString() }, base), { zoneId: "floor-1", healthy: true });
  assert.throws(() => parseSourceHealthPayload({ type: "source_health", zone_id: "floor-1", status: "healthy", timestamp: new Date(base).toISOString() }, base + 16_000), /güncel değil/);
  assert.throws(() => parseSourceHealthPayload({ type: "source_health", zone_id: "floor-1", status: "maybe", timestamp: new Date(base).toISOString() }, base), /Geçersiz/);
});
test("legacy config works and invalid area association is rejected", () => {
  assert.equal(compileRegionsConfig(DEFAULT_REGIONS_CONFIG).largeAreas.length, 0);
  assert.equal(cleanRegionsConfig(DEFAULT_REGIONS_CONFIG).largeAreas?.length, 0);
  const config = fixture();
  assert.throws(() => compileRegionsConfig({ ...config, largeAreas: config.largeAreas!.map(area => ({ ...area, gates: area.gates.map(gate => ({ ...gate, areaId: "missing" })) })) }), /bağlantısı/);
  assert.throws(() => cleanRegionsConfig({ ...config, largeAreas: config.largeAreas!.map(area => ({ ...area, gates: area.gates.map(gate => ({ ...gate, role: "teleport" })) })) }), /rolü/);
  assert.throws(() => cleanRegionsConfig({ ...config, largeAreas: [{ ...config.largeAreas![0], unexpected: true }] }), /bilinmeyen alan/);
});
test("area state and events use persisted JSON and idempotent event insertion", async () => {
  const statements: string[] = [];
  const directory = await mkdtemp(path.join(tmpdir(), "uwb-area-spool-"));
  try {
    const repository = new AreaTransitionRepository(async sql => { statements.push(sql); return []; }, { spoolDir: directory, automaticFlush: false, batchSize: 2 });
    const h = harness(); h.enter();
    repository.saveState(h.engine.snapshot()[0]); repository.saveState({ ...h.engine.snapshot()[0], revision: 99 });
    repository.saveEvent(h.events[0], h.engine.snapshot()[0]); repository.saveEvent(h.events[0], h.engine.snapshot()[0]);
    assert.equal(repository.status().queuedStates, 1); assert.equal(repository.status().queuedEvents, 1);
    assert.equal(repository.status().coalescedStateWrites, 1);
    assert.deepEqual(await repository.restore(), []);
    assert.equal(repository.status().pendingWrites, 0);
    assert.ok(statements.some(sql => sql.includes("CREATE TABLE IF NOT EXISTS tag_area_states")));
    assert.ok(statements.some(sql => sql.includes("ADD COLUMN IF NOT EXISTS revision")));
    assert.ok(statements.some(sql => sql.includes("ON CONFLICT(tag_code,map_id,area_id) DO UPDATE")));
    assert.ok(statements.some(sql => sql.includes("ON CONFLICT(id) DO NOTHING")));
    assert.ok(statements.some(sql => sql.includes("BEGIN;") && sql.indexOf("INSERT INTO tag_area_events") < sql.indexOf("INSERT INTO tag_area_states")));
    repository.stop();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("DB outage preserves bounded batches and durable event files for restart and retry", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "uwb-area-retry-"));
  try {
    const h = harness(); h.enter();
    let down = true; const statements: string[] = [];
    const query = async (sql: string) => { if (down) throw new Error("database offline"); statements.push(sql); return []; };
    const first = new AreaTransitionRepository(query, { spoolDir: directory, automaticFlush: false, batchSize: 2, maxPendingEvents: 2, maxPendingStates: 1 });
    for (let i = 0; i < 100; i++) first.saveState({ ...h.engine.snapshot()[0], revision: i });
    first.saveState({ ...h.engine.snapshot()[0], revision: 1 });
    assert.throws(() => first.saveState({ ...h.engine.snapshot()[0], tagCode: "OTHER" }), /kuyruğu dolu/);
    first.saveEvent(h.events[0], h.engine.snapshot()[0]);
    first.saveEvent({ ...h.events[0], id: "second" }, h.engine.snapshot()[0]);
    assert.equal(first.status().queuedStates, 1); assert.equal(first.status().queuedEvents, 2);
    assert.equal(first.status().coalescedStateWrites, 100);
    assert.throws(() => first.saveEvent({ ...h.events[0], id: "third" }), /kuyruğu dolu/);
    assert.equal(first.status().rejectedWrites, 2); assert.equal(first.status().droppedRecords, 0);
    await first.flush(); assert.match(first.status().error ?? "", /offline/);
    assert.equal(first.status().queuedEvents, 2); first.stop();
    down = false;
    const restarted = new AreaTransitionRepository(query, { spoolDir: directory, automaticFlush: false, batchSize: 2 });
    await restarted.restore();
    assert.equal(restarted.status().pendingWrites, 0);
    assert.ok(statements.some(sql => sql.includes("revision) VALUES") && sql.includes(",99)")));
    assert.ok(statements.some(sql => (sql.match(/INSERT INTO tag_area_events/g) ?? []).length === 2));
    restarted.saveEvent(h.events[0], h.engine.snapshot()[0]); await restarted.flush();
    assert.ok(statements.at(-1)?.includes("ON CONFLICT(id) DO NOTHING"));
    restarted.stop();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("a full durable event queue rolls back the engine transition until it can be persisted", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "uwb-area-backpressure-"));
  try {
    const repository = new AreaTransitionRepository(async () => [], { spoolDir: directory, automaticFlush: false, maxPendingEvents: 1 });
    const configs = new Map([["map-a", compileRegionsConfig(fixture())]]);
    const engine = new AreaTransitionEngine(configs, (event, state) => repository.saveEvent(event, state),
      state => repository.saveState(state), count => repository.ensureEventCapacity(count));
    const send = (second: number, x: number) => engine.ingest({ tagCode: "BACKPRESSURE", mapId: "map-a", x, y: 5, quality: .9,
      timestamp: new Date(base + second * 1000).toISOString() }, base + second * 1000);
    send(0, .5); send(1, 2); send(2, 3); send(3, 9.5);
    engine.noteSourceHealth("map-a", true, base + 33_000);
    assert.throws(() => engine.tick(base + 33_000), /kuyruğu dolu/);
    assert.equal(engine.snapshot()[0].inside, true);
    assert.equal(engine.snapshot()[0].pendingGateId, "exit-map-a");
    await repository.flush();
    engine.tick(base + 34_000);
    assert.equal(engine.snapshot()[0].inside, false);
    assert.equal(repository.status().queuedEvents, 1);
    repository.stop();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("floor handoff reserves both linked event slots before changing either area", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "uwb-area-handoff-capacity-"));
  try {
    const repository = new AreaTransitionRepository(async () => [], { spoolDir: directory, automaticFlush: false, maxPendingEvents: 1 });
    const configs = new Map([["map-a", compileRegionsConfig(fixture("map-a"))], ["map-b", compileRegionsConfig(fixture("map-b"))]]);
    const engine = new AreaTransitionEngine(configs, (event, state) => repository.saveEvent(event, state),
      state => repository.saveState(state), count => repository.ensureEventCapacity(count));
    const send = (second: number, x: number, mapId: string) => engine.ingest({ tagCode: "HANDOFF", mapId, x, y: 5, quality: .9,
      timestamp: new Date(base + second * 1000).toISOString() }, base + second * 1000);
    send(0, .5, "map-a"); send(1, 2, "map-a"); send(2, 3, "map-a"); await repository.flush();
    send(3, 3, "map-b");
    assert.throws(() => send(4, 4, "map-b"), /kuyruğu dolu/);
    assert.equal(engine.snapshot().find(state => state.mapId === "map-a")?.inside, true);
    assert.equal(engine.snapshot().find(state => state.mapId === "map-b")?.inside, false);
    assert.equal(repository.status().queuedEvents, 0);
    repository.stop();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("PostgreSQL commits an event and its final state, restores them, and deduplicates replay", { skip: process.env.AREA_DATABASE_TEST !== "1" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "uwb-area-postgres-"));
  const tagCode = `TEST-AREA-${randomUUID()}`;
  const h = harness(); h.enter();
  const state = { ...h.engine.snapshot()[0], tagCode, revision: 7, inside: false };
  const event = { ...h.events[0], id: randomUUID(), tagCode };
  const sqlTag = `'${tagCode}'`;
  try {
    const first = new AreaTransitionRepository(queryPostgres, { spoolDir: directory, automaticFlush: false });
    await first.restore(); first.saveEvent(event, state); first.saveState(state); await first.flush();
    assert.equal(first.status().pendingWrites, 0); assert.equal(first.status().error, null);
    const stored = await queryPostgres(`SELECT (SELECT count(*) FROM tag_area_events WHERE tag_code=${sqlTag}) AS events, (SELECT state->>'inside' FROM tag_area_states WHERE tag_code=${sqlTag}) AS inside, (SELECT revision FROM tag_area_states WHERE tag_code=${sqlTag}) AS revision`);
    assert.equal(stored[0].events, "1"); assert.equal(stored[0].inside, "false"); assert.equal(stored[0].revision, "7");
    const restarted = new AreaTransitionRepository(queryPostgres, { spoolDir: directory, automaticFlush: false });
    assert.equal((await restarted.restore()).find(item => item.tagCode === tagCode)?.inside, false);
    restarted.saveEvent(event, state); await restarted.flush();
    const replayed = await queryPostgres(`SELECT count(*) AS events FROM tag_area_events WHERE tag_code=${sqlTag}`);
    assert.equal(replayed[0].events, "1");
    first.stop(); restarted.stop();
  } finally {
    await queryPostgres(`DELETE FROM tag_area_events WHERE tag_code=${sqlTag}; DELETE FROM tag_area_states WHERE tag_code=${sqlTag};`);
    await rm(directory, { recursive: true, force: true });
  }
});
test("area configuration survives the validated API save and file reload", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "uwb-area-config-"));
  const target = path.join(directory, "regions.json");
  try {
    const saved = await persistRegionsConfig(fixture(), target, "map-a");
    const reloaded = JSON.parse(await readFile(target, "utf8")) as RegionsConfig;
    assert.equal(saved.compiled.largeAreas[0].gates[1].waitMs, 30_000);
    assert.equal(compileRegionsConfig(reloaded).largeAreas[0].gates[1].id, "exit-map-a");
  } finally { await unlink(target).catch(() => undefined); await rmdir(directory); }
});
test("editor visibility is per map, independent per item and keeps hidden items recoverable", () => {
  const a = toggleAreaVisibility(EMPTY_AREA_VISIBILITY, "gate", "gate-1");
  assert.equal(isAreaVisible(a, "area-1"), true); assert.equal(isGateVisible(a, "area-1", "gate-1"), false);
  const b = toggleAreaVisibility(a, "area", "area-1");
  assert.equal(isGateVisible(b, "area-1", "gate-2"), false);
  const c = toggleAreaVisibility(b, "all"); assert.equal(isAreaVisible(c, "area-2"), false);
  const restored = toggleAreaVisibility(toggleAreaVisibility(c, "all"), "area", "area-1");
  assert.equal(isGateVisible(restored, "area-1", "gate-2"), true);
  assert.deepEqual(visibleSelection(a, "area-1", "gate-1"), { areaId: null, gateId: null });
  assert.deepEqual(visibleSelection(c, "area-2", null), { areaId: null, gateId: null });
  assert.deepEqual(visibleSelection(restored, "area-1", "gate-2"), { areaId: "area-1", gateId: "gate-2" });
  const storage = { getItem: (key: string) => key === areaVisibilityKey("map-a") ? JSON.stringify(a) : null };
  assert.deepEqual(readAreaVisibility("map-a", storage), a);
  assert.deepEqual(readAreaVisibility("map-b", storage), EMPTY_AREA_VISIBILITY);
});
