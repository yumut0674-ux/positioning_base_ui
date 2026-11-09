import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AreaExitObserver } from "../src/server/notifications/AreaExitObserver";
import { NotificationRepository, projectNotification } from "../src/server/notifications/notificationRepository";
import { NotificationCheckpointFile, NotificationRuntime } from "../src/server/notifications/notificationRuntime";
import { listAnalysisLogs } from "../src/server/notifications/analysisLogs";
import { decodeDecisionCursor } from "../src/server/location/roomDecisionRepository";
import { DEFAULT_SYSTEM_SETTINGS, systemSettingsSchema } from "../src/features/settings/types/settings.types";
import { DEFAULT_REGIONS_CONFIG } from "../src/features/regions/config/defaultRegionsConfig";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import type { TrackedTag } from "../src/features/tracking/types/tracking.types";
import type { DecisionLogListResponse } from "../src/features/decisionLogs/types/decisionLog.types";
import type { AreaExitNotification } from "../src/features/notifications/notification.types";

const epoch = Date.parse("2026-10-23T09:00:00Z");
const settings = DEFAULT_SYSTEM_SETTINGS.notifications;
const config: RegionsConfig = { ...DEFAULT_REGIONS_CONFIG, map: { ...DEFAULT_REGIONS_CONFIG.map, mapId: "test-map" },
  regions: [], largeAreas: [{ id: "ward", name: "Servis", color: "#000", polygon: [], gates: [] }] };
const names = new Map([["TAG-1", "Pompa"]]);
const outside: TrackedTag = { id: "TAG-1", name: "Pompa", mapId: "test-map", x: 500, y: 500, timestamp: epoch, color: "", status: "active",
  regionInference: { enabled: true, state: "TRACKING_OUTSIDE", regionId: null, outsideArea: true, leftAreaAt: new Date(epoch).toISOString() } };
const inside: TrackedTag = { ...outside, regionInference: { enabled: true, state: "IN_REGION", regionId: "room", regionName: "Oda 1", measurementKind: "measured" } };
function observe(observer: AreaExitObserver, tag = outside, at = epoch, enabled = true) { observer.observe(tag, config, enabled, at); }

test("waits exactly five seconds, uses the engine result/time/area and latches once per exit", () => {
  const observer = new AreaExitObserver();
  const unchanged = structuredClone(outside);
  observe(observer);
  observer.tick(epoch + 4999, settings, names); assert.equal(observer.pendingItems().length, 0);
  observer.tick(epoch + 5000, settings, names);
  const [item] = observer.pendingItems();
  assert.equal(item.exitedAt, outside.regionInference!.leftAreaAt);
  assert.equal(item.createdAt, new Date(epoch + 5000).toISOString());
  assert.equal(item.areaName, "Servis"); assert.equal(item.timeSource, "engine"); assert.equal(item.tagName, "Pompa");
  assert.equal(item.displayDurationMs, 10_000);
  observer.acknowledge([item.id]);
  for (const offset of [6000, 60_000, 90_000]) { observe(observer, outside, epoch + offset); observer.tick(epoch + offset, settings, names); }
  assert.equal(observer.pendingItems().length, 0);
  assert.deepEqual(outside, unchanged, "the observer cannot change the published decision");
});

test("quick return cancels the deadline and a later exit can notify again", () => {
  const observer = new AreaExitObserver(); observe(observer);
  observe(observer, inside, epoch + 4999); observer.tick(epoch + 10_000, settings, names);
  assert.equal(observer.pendingItems().length, 0);
  const next = { ...outside, regionInference: { ...outside.regionInference!, leftAreaAt: new Date(epoch + 11_000).toISOString() } };
  observe(observer, next, epoch + 11_000); observer.tick(epoch + 16_000, settings, names);
  assert.equal(observer.pendingItems().length, 1);
  observe(observer, inside, epoch + 17_000);
  observe(observer, { ...next, regionInference: { ...next.regionInference, leftAreaAt: new Date(epoch + 18_000).toISOString() } }, epoch + 18_000);
  observer.tick(epoch + 23_000, settings, names); assert.equal(observer.pendingItems().length, 2);
});

test("disabled tags, missing map configuration, unknown floors and data loss cannot create exits", () => {
  for (const mode of ["disabled", "missing-config", "no-map", "lost", "hidden"] as const) {
    const observer = new AreaExitObserver();
    const raw = { ...outside, regionInference: undefined };
    observer.observe(mode === "no-map" ? { ...raw, mapId: null } : mode === "lost" ? { ...inside, regionInference: { ...inside.regionInference!, state: "LOCATION_LOST", signalLost: true } } : raw,
      mode === "missing-config" ? undefined : config, mode !== "disabled", epoch, mode === "hidden");
    observer.tick(epoch + 6000, settings, names); assert.equal(observer.pendingItems().length, 0, mode);
  }
  const observer = new AreaExitObserver(); observe(observer); observe(observer, outside, epoch + 4000, false);
  observer.tick(epoch + 5000, settings, names); assert.equal(observer.pendingItems().length, 0);
});

test("fallback consumes the quick-list outside label without inventing an area or engine timestamp", () => {
  const observer = new AreaExitObserver();
  const tag = { ...outside, regionInference: undefined };
  observe(observer, tag); observer.tick(epoch + 5000, settings, names);
  const [item] = observer.pendingItems();
  assert.equal(item.sourceLabel, "Tanımlı alan dışında"); assert.equal(item.timeSource, "observed_result");
  assert.equal(item.areaName, undefined); assert.equal(item.exitedAt, new Date(epoch).toISOString());
  // Late authoritative output for the same episode must not make a second notification.
  observe(observer, { ...outside, regionInference: { ...outside.regionInference!, leftAreaAt: new Date(epoch + 1).toISOString() } }, epoch + 6000);
  observer.tick(epoch + 20_000, settings, names); assert.equal(observer.pendingItems().length, 1);
});

test("pending alarms adopt a changed delay and a restart preserves the latch and outbox", () => {
  const observer = new AreaExitObserver(); observe(observer);
  observer.tick(epoch + 6000, { ...settings, exitDelayMs: 10_000 }, names); assert.equal(observer.pendingItems().length, 0);
  observer.tick(epoch + 7000, { exitDelayMs: 0, displayDurationMs: 20_000 }, names);
  const restored = new AreaExitObserver(); restored.restore(observer.checkpoint());
  observe(restored, outside, epoch + 9000); restored.tick(epoch + 90_000, settings, names);
  assert.deepEqual(restored.pendingItems(), observer.pendingItems());
  const item = restored.pendingItems()[0]; restored.acknowledge([item.id]);
  const afterSave = new AreaExitObserver(); afterSave.restore(restored.checkpoint());
  observe(afterSave, outside, epoch + 100_000); afterSave.tick(epoch + 100_000, settings, names);
  assert.equal(afterSave.pendingItems().length, 0);
});

test("a data gap after a notification cannot re-arm the same outside episode", () => {
  const observer = new AreaExitObserver();
  const tag = { ...outside, regionInference: undefined };
  observe(observer, tag); observer.tick(epoch + 5000, settings, names);
  const [item] = observer.pendingItems(); observer.acknowledge([item.id]);
  observer.observe(tag, config, true, epoch + 70_000, true);
  observe(observer, tag, epoch + 71_000); observer.tick(epoch + 80_000, settings, names);
  assert.equal(observer.pendingItems().length, 0);
});

test("legacy settings gain defaults and notification durations reject invalid values", () => {
  const legacy = { version: 1, tracking: { noDataHideAfterMs: 60_000 } };
  assert.deepEqual(systemSettingsSchema.parse(legacy).notifications, settings);
  for (const [key, values] of [["exitDelayMs", [-1000, 1, 86_401_000, "5000"]], ["displayDurationMs", [0, -1, 1001, 86_401_000]]] as const) {
    for (const value of values) assert.equal(systemSettingsSchema.safeParse({ ...legacy, notifications: { ...settings, [key]: value } }).success, false);
  }
});

test("a database outage retains a durable notification and episode before offering it to clients", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "exit-notification-"));
  const file = new NotificationCheckpointFile(path.join(directory, "checkpoint.json"));
  const repository = new NotificationRepository(async () => { throw new Error("offline"); });
  const runtime = new NotificationRuntime(repository, file);
  try {
    observe(runtime.observer); runtime.observer.tick(epoch + 5000, settings, names);
    assert.equal(runtime.pending().length, 0);
    await runtime.flush();
    assert.equal(runtime.pending().length, 1);
    assert.deepEqual((await file.read())?.pending, runtime.observer.pendingItems());
    assert.match(runtime.status()!, /yeniden deneniyor/);
    const restored = new AreaExitObserver(); restored.restore((await file.read())!);
    observe(restored, outside, epoch + 20_000); restored.tick(epoch + 20_000, settings, names);
    assert.equal(restored.pendingItems().length, 1);
    const statements: string[] = [];
    const recovered = new NotificationRuntime(new NotificationRepository(async sql => { statements.push(sql); return []; }), file);
    recovered.observer.restore((await file.read())!);
    await recovered.flush();
    assert.ok(statements.some(sql => sql.includes("INSERT INTO area_exit_notifications")));
    assert.equal(recovered.observer.pendingItems().length, 0);
    await recovered.flush();
    assert.equal((await file.read())?.pending.length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function notification(at = epoch + 5000): AreaExitNotification {
  const observer = new AreaExitObserver(); observe(observer); observer.tick(at, settings, names); return observer.pendingItems()[0];
}
test("repository writes idempotently to its own table and supports tag/map/area/time/cursor filters", async () => {
  const statements: string[] = [];
  const item = notification();
  const repository = new NotificationRepository(async sql => { statements.push(sql); return sql.includes("WITH filtered") ? [{ payload: JSON.stringify(item), total: "1" }] : []; });
  await repository.save([item]);
  assert.match(statements.at(-1)!, /ON CONFLICT\(notification_id\) DO NOTHING/);
  assert.doesNotMatch(statements.at(-1)!, /tag_room_decisions/);
  const page = await repository.list({ from: new Date(epoch).toISOString(), to: new Date(epoch + 60_000).toISOString(), limit: 100, eventType: "NOTIFICATION", tagCode: "TAG-1", mapId: "test-map", regionId: "ward", importantOnly: true });
  assert.equal(page.items[0].eventType, "NOTIFICATION"); assert.equal(page.items[0].notification?.areaName, "Servis");
  for (const text of ["tag_code ILIKE", "map_id=", "area_id=", "created_at>=", "created_at<="]) assert.ok(statements.at(-1)!.includes(text));
});

test("analyses combine and paginate notifications without changing room decisions", async () => {
  const alert = projectNotification(notification());
  const room = { ...alert, decisionId: "room-1", publishedAt: new Date(epoch + 4000).toISOString(), eventType: "ROOM_EXITED" as const, notification: undefined };
  const result = (items: typeof alert[]): DecisionLogListResponse => ({ items, nextCursor: null, metadata: { filteredCount: items.length, returnedCount: items.length, countAccuracy: "exact" } });
  let roomCalls = 0;
  const rooms = { list: async () => { roomCalls++; return result([room]); } }, alerts = { list: async () => result([alert]) };
  const filters = { from: new Date(epoch).toISOString(), to: new Date(epoch + 60_000).toISOString(), limit: 1 };
  const combined = await listAnalysisLogs(filters, rooms, alerts);
  assert.equal(combined.items[0].decisionId, alert.decisionId); assert.equal(combined.metadata.filteredCount, 2);
  assert.equal(decodeDecisionCursor(combined.nextCursor!)?.key, alert.decisionId);
  const filtered = await listAnalysisLogs({ ...filters, eventType: "NOTIFICATION" }, rooms, alerts);
  assert.equal(filtered.items[0].eventType, "NOTIFICATION"); assert.equal(roomCalls, 1);
});
