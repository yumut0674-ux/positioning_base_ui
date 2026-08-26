import assert from "node:assert/strict";
import test from "node:test";
import {
  createTagSimulator,
  getRandomDelay,
  resolveSimulationEndpoint,
  readSimulatorIntervals,
} from "../test_api/simulate_tags.js";

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

test("next timer is created only after the whole send completes and never accumulates", async () => {
  const pendingFetches = [];
  const timers = [];
  const cleared = [];
  let activeFetches = 0;
  let maximumActiveFetches = 0;
  const fetchImplementation = () => {
    activeFetches += 1;
    maximumActiveFetches = Math.max(maximumActiveFetches, activeFetches);
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
  assert.equal(timers.length, 0);
  pendingFetches.splice(0).forEach((resolve) => resolve());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 777);
  assert.equal(maximumActiveFetches, 4);

  timers[0].callback();
  assert.equal(pendingFetches.length, 4);
  assert.equal(timers.length, 1);
  simulator.stop();
  assert.equal(cleared.length, 0);
});
