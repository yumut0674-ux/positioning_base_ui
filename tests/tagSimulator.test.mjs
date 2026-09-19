import assert from "node:assert/strict";
import test from "node:test";
import {
  createTagMovement,
  createTagSimulator,
  getRandomDelay,
  readLiveSimulationOptions,
  resolveSimulationEndpoint,
  readSimulatorIntervals,
} from "../test_api/simulate_tags.js";

test("live room simulation CLI options are deterministic and validated", () => {
  assert.deepEqual(readLiveSimulationOptions(["--scenario", "all", "--seed", "42"]), { scenario: "all", seed: 42, mapId: "spor-koridor", zoneId: "zone-a", zoneName: "Spor Koridoru" });
  assert.deepEqual(readLiveSimulationOptions([]), { scenario: "all", seed: 42, mapId: "spor-koridor", zoneId: "zone-a", zoneName: "Spor Koridoru" });
  assert.deepEqual(readLiveSimulationOptions(["--scenario", "multi-floor", "--map", "kat1-ortopedi", "--zone-id", "zone-b", "--zone-name", "Kat B"]), { scenario: "multi-floor", seed: 42, mapId: "kat1-ortopedi", zoneId: "zone-b", zoneName: "Kat B" });
  assert.throws(() => readLiveSimulationOptions(["--scenario", "unknown"]), /Geçersiz canlı senaryo/);
  assert.throws(() => readLiveSimulationOptions(["--seed", "4.2"]), /Geçersiz seed/);
});

test("random simulator delays stay within inclusive limits", () => {
  for (let index = 0; index < 5_000; index += 1) {
    const delay = getRandomDelay(500, 1_500);
    assert.ok(delay >= 500 && delay <= 1_500);
  }
});

test("interval environment validation falls back for non-numeric values and rejects inverted bounds", () => {
  assert.deepEqual(readSimulatorIntervals({
    SIMULATOR_MIN_INTERVAL_MS: "not-a-number",
    SIMULATOR_MAX_INTERVAL_MS: "also-bad",
  }), { minMs: 1_000, maxMs: 1_000 });
  assert.deepEqual(readSimulatorIntervals({
    SIMULATOR_MIN_INTERVAL_MS: "0",
    SIMULATOR_MAX_INTERVAL_MS: "",
  }), { minMs: 1_000, maxMs: 1_000 });
  assert.throws(() => readSimulatorIntervals({
    SIMULATOR_MIN_INTERVAL_MS: "1200",
    SIMULATOR_MAX_INTERVAL_MS: "800",
  }), /küçük olamaz/);
});

test("default simulator cadence is fixed at one update per second", () => {
  assert.deepEqual(readSimulatorIntervals({}), { minMs: 1_000, maxMs: 1_000 });
  assert.equal(getRandomDelay(1_000, 1_000), 1_000);
});

test("simulation endpoint selection distinguishes local and public destinations", () => {
  assert.equal(resolveSimulationEndpoint("1"), "http://127.0.0.1:3000/api/tracking/ingest");
  assert.equal(resolveSimulationEndpoint("public"), "https://neu-demo.gekon.com.tr/api/tracking/ingest");
  assert.equal(resolveSimulationEndpoint("2", {
    PUBLIC_TRACKING_INGEST_URL: "https://staging.example.com/api/tracking/ingest",
  }), "https://staging.example.com/api/tracking/ingest");
  assert.throws(() => resolveSimulationEndpoint("3"), /Geçerli bir seçenek/);
});

test("tags follow the corridor, visit a room centre, then stay there for 2–20 seconds", () => {
  let currentTime = new Date("2026-08-28T08:00:00.000Z");
  const movement = createTagMovement({
    tag: { tagId: "TAG-TEST", position: { x: 11.9, y: 10 }, direction: 1 },
    roomCenters: [{ x: 11.6, y: 20, portalPath: [{x:11.9,y:20},{x:11.75,y:20},{x:11.6,y:20}] }],
    random: () => 0,
    now: () => currentTime,
  });

  assert.deepEqual(movement.next(), { x: 11.9, y: 10 });
  currentTime = new Date("2026-08-28T08:00:10.000Z");
  const enRoute = movement.next();
  assert.equal(enRoute.x, 11.9);
  assert.ok(enRoute.y > 10 && enRoute.y < 20);

  currentTime = new Date("2026-08-28T08:00:12.000Z");
  assert.deepEqual(movement.next(), { x: 11.9, y: 20 });
  currentTime = new Date("2026-08-28T08:00:13.000Z");
  assert.deepEqual(movement.next(), { x: 11.6, y: 20 });
  const waitingState = movement.getState();
  assert.equal(waitingState.isWaitingInRoom, true);
  assert.equal(waitingState.roomWaitUntil - currentTime.getTime(), 2_000);

  currentTime = new Date("2026-08-28T08:00:14.999Z");
  assert.deepEqual(movement.next(), { x: 11.6, y: 20 });
  currentTime = new Date("2026-08-28T08:00:15.000Z");
  const returning = movement.next();
  assert.equal(returning.y, 20);
  assert.ok(returning.x > 11.6 && returning.x < 11.9);
});

test("a new position tick aborts unfinished response waits instead of skipping the send", () => {
  const pendingFetches = [];
  const timers = [];
  const cleared = [];
  const requestSignals = [];
  let activeFetches = 0;
  let maximumActiveFetches = 0;
  const fetchImplementation = (_, options) => {
    activeFetches += 1;
    maximumActiveFetches = Math.max(maximumActiveFetches, activeFetches);
    requestSignals.push(options.signal);
    return new Promise((resolve) => pendingFetches.push(() => {
      activeFetches -= 1;
      resolve({ ok: true });
    }));
  };
  const simulator = createTagSimulator({
    minDelayMs: 500,
    maxDelayMs: 1_500,
    fetchImplementation,
    randomDelay: () => 777,
    setTimeoutImplementation: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeoutImplementation: (timer) => cleared.push(timer),
    logger: { log() {}, error() {} },
  });

  simulator.start();
  assert.equal(pendingFetches.length, 4);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 777);

  timers[0].callback();
  assert.equal(pendingFetches.length, 8);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delay, 777);
  assert.equal(maximumActiveFetches, 8);
  assert.ok(requestSignals.slice(0, 4).every((signal) => signal.aborted));
  assert.ok(requestSignals.slice(4).every((signal) => !signal.aborted));

  simulator.stop();
  assert.deepEqual(cleared, [2]);
  assert.equal(requestSignals.length, 8);
  assert.ok(requestSignals.every((signal) => signal.aborted));
});

test("stalled HTTP responses never suppress later one-second position ticks", () => {
  const timers = [];
  const requests = [];
  const errors = [];
  const simulator = createTagSimulator({
    fetchImplementation: (_, options) => {
      requests.push(options);
      return new Promise(() => {});
    },
    randomDelay: () => 1_000,
    setTimeoutImplementation: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeoutImplementation() {},
    logger: { log() {}, error(message) { errors.push(message); } },
  });

  simulator.start();
  for (let index = 0; index < 5; index += 1) timers[index].callback();

  assert.equal(requests.length, 24);
  assert.equal(errors.length, 0);
  assert.ok(requests.slice(0, -4).every(({ signal }) => signal.aborted));
  assert.ok(requests.slice(-4).every(({ signal }) => !signal.aborted));
  simulator.stop();
  assert.ok(requests.every(({ signal }) => signal.aborted));
});

test("old centre-only room definitions cannot create a wall shortcut", () => {
  let currentTime = new Date("2026-09-01T00:00:00Z");
  const movement = createTagMovement({ tag: { tagId: "T", position: { x: 1.75, y: 10 }, direction: 1 }, roomCenters: [{x:7,y:20}], random:()=>0, now:()=>currentTime });
  for(let i=0;i<60;i++){currentTime=new Date(currentTime.getTime()+1000);movement.next();assert.equal(movement.getState().activeRoom,null);}
});

test("normal payload carries the zone contract and multi-floor output is deterministic", async () => {
  const bodies = [];
  let now = new Date("2026-07-24T11:30:15.123Z");
  const simulator = createTagSimulator({
    scenario: "multi-floor", seed: 7, now: () => now,
    fetchImplementation: async (_url, options) => { bodies.push(JSON.parse(options.body)); return { ok: true }; },
    logger: { log() {}, error() {} },
  });
  await simulator.sendNextTagUpdates();
  now = new Date(now.getTime() + 1_000);
  await simulator.sendNextTagUpdates();
  assert.equal(bodies.length, 8);
  assert.ok(bodies.slice(0, 4).every((body) => body.zone_id === "zone-a" && body.zone_name === "Spor Koridoru"));
  assert.ok(bodies.slice(4).every((body) => body.zone_id === "zone-b" && body.zone_name === "Ortopedi Katı"));
  assert.deepEqual(Object.keys(bodies[0]).sort(), ["tag_id", "timestamp", "type", "x", "y", "zone_id", "zone_name"]);
});

test("null and unknown zone scenarios emit explicit values", async () => {
  for (const [scenario, expected] of [["null-zone", null], ["unknown-zone", "unknown-zone"]]) {
    const bodies = [];
    const simulator = createTagSimulator({ scenario, seed: 1, fetchImplementation: async (_url, options) => { bodies.push(JSON.parse(options.body)); return { ok: true }; }, logger: { log() {}, error() {} } });
    await simulator.sendNextTagUpdates();
    assert.ok(bodies.every((body) => body.zone_id === expected));
  }
});

test("delayed old-floor and same-coordinate scenarios preserve explicit floor evidence", async () => {
  const delayed = [];
  let now = new Date("2026-07-24T11:30:15.000Z");
  const delayedSimulator = createTagSimulator({
    scenario: "delayed-old-floor-event", seed: 9, now: () => now,
    fetchImplementation: async (_url, options) => { delayed.push(JSON.parse(options.body)); return { ok: true }; },
    logger: { log() {}, error() {} },
  });
  await delayedSimulator.sendNextTagUpdates();
  now = new Date(now.getTime() + 1_000);
  await delayedSimulator.sendNextTagUpdates();
  now = new Date(now.getTime() + 1_000);
  await delayedSimulator.sendNextTagUpdates();
  assert.equal(delayed[0].zone_id, "zone-a");
  assert.equal(delayed[4].zone_id, "zone-b");
  assert.equal(delayed[8].zone_id, "zone-a");
  assert.ok(Date.parse(delayed[8].timestamp) < Date.parse(delayed[4].timestamp));

  const sameCoordinate = [];
  const sameCoordinateSimulator = createTagSimulator({
    scenario: "same-coordinate-different-floor", seed: 9,
    fetchImplementation: async (_url, options) => { sameCoordinate.push(JSON.parse(options.body)); return { ok: true }; },
    logger: { log() {}, error() {} },
  });
  await sameCoordinateSimulator.sendNextTagUpdates();
  await sameCoordinateSimulator.sendNextTagUpdates();
  assert.deepEqual([sameCoordinate[0].x, sameCoordinate[0].y], [5, 5]);
  assert.deepEqual([sameCoordinate[4].x, sameCoordinate[4].y], [5, 5]);
  assert.notEqual(sameCoordinate[0].zone_id, sameCoordinate[4].zone_id);
});
