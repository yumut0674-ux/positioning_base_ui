import assert from "node:assert/strict";
import test from "node:test";
import { AdaptivePositionFilter, DEFAULT_ADAPTIVE_POSITION_FILTER_CONFIG } from "../src/features/tracking/services/positionFilters";

const p = (x: number, y: number) => ({ x, y });

test("stationary UWB jitter stays inside the visual dead-band", () => {
  const filter = new AdaptivePositionFilter();
  filter.reset(p(5, 5), 1_000);

  const first = filter.next(p(5, 5), p(5.10, 4.93), 1_200);
  const second = filter.next(first, p(4.91, 5.08), 1_400);

  assert.deepEqual(first, p(5, 5));
  assert.deepEqual(second, p(5, 5));
});

test("normal movement follows the recent average more gently than individual measurements", () => {
  const filter = new AdaptivePositionFilter();
  const individual = new AdaptivePositionFilter({ ...DEFAULT_ADAPTIVE_POSITION_FILTER_CONFIG,
    measurementWindowMs: 0, maximumMeasurementSamples: 1 });
  filter.reset(p(0, 0), 1_000);
  individual.reset(p(0, 0), 1_000);

  const slow = filter.next(p(0, 0), p(0.5, 0), 2_000);
  const fast = filter.next(slow, p(2, 0), 3_000);
  const individualSlow = individual.next(p(0, 0), p(0.5, 0), 2_000);
  const individualFast = individual.next(individualSlow, p(2, 0), 3_000);

  assert.ok(slow.x > 0 && slow.x < individualSlow.x);
  assert.ok(fast.x > slow.x && fast.x < individualFast.x / 2);
  assert.ok(fast.x - slow.x > slow.x);
  assert.equal(slow.y, 0);
  assert.equal(fast.y, 0);
});

test("the display target averages accepted measurements in a three-second rolling window", () => {
  const filter = new AdaptivePositionFilter({ ...DEFAULT_ADAPTIVE_POSITION_FILTER_CONFIG,
    jitterRadiusMeters: 0, smoothingAlpha: 1, movingAlpha: 1, maximumSpeedMetersPerSecond: 1_000 });
  filter.reset(p(2, 4), 1_000);
  const first = filter.next(p(2, 4), p(6, 8), 2_000);
  assert.deepEqual(first, p(4, 6));
  const second = filter.next(first, p(10, 12), 3_000);
  assert.deepEqual(second, p(6, 8));
  const expired = filter.next(second, p(14, 16), 4_501);
  assert.deepEqual(expired, p(10, 12)); // The first measurement expired.
});

test("a repeated timestamp cannot overweight a measurement or keep moving the marker", () => {
  const filter = new AdaptivePositionFilter();
  filter.reset(p(0, 0), 1_000);
  const current = filter.next(p(0, 0), p(1, 0), 2_000);
  for (let repeat = 0; repeat < 10; repeat++) {
    assert.deepEqual(filter.next(current, p(1, 0), 2_000), current);
  }
  assert.deepEqual(filter.next(current, p(0.5, 0), 1_500), current);
});

test("averaging reduces side-to-side wobble during a steady corridor walk", () => {
  const averaged = new AdaptivePositionFilter();
  const individual = new AdaptivePositionFilter({ ...DEFAULT_ADAPTIVE_POSITION_FILTER_CONFIG,
    measurementWindowMs: 0, maximumMeasurementSamples: 1 });
  let averagedPoint = p(0, 0), individualPoint = p(0, 0);
  let averagedWobble = 0, individualWobble = 0;
  averaged.reset(averagedPoint, 1_000);
  individual.reset(individualPoint, 1_000);
  for (let step = 1; step <= 40; step++) {
    const measured = p(step * 0.1, step % 2 ? 0.4 : -0.4);
    const nextAverage = averaged.next(averagedPoint, measured, 1_000 + step * 200);
    const nextIndividual = individual.next(individualPoint, measured, 1_000 + step * 200);
    averagedWobble += Math.abs(nextAverage.y - averagedPoint.y);
    individualWobble += Math.abs(nextIndividual.y - individualPoint.y);
    averagedPoint = nextAverage;
    individualPoint = nextIndividual;
  }
  assert.ok(averagedWobble < individualWobble * 0.5);
  assert.ok(averagedPoint.x > 2, "averaging must still follow sustained movement");
});

test("the average has a bounded sample count and reset discards the old route", () => {
  const filter = new AdaptivePositionFilter({ ...DEFAULT_ADAPTIVE_POSITION_FILTER_CONFIG,
    maximumMeasurementSamples: 3, jitterRadiusMeters: 0, smoothingAlpha: 1, movingAlpha: 1,
    maximumSpeedMetersPerSecond: 1_000 });
  let current = p(0, 0);
  filter.reset(current, 1_000);
  for (let step = 1; step <= 6; step++) current = filter.next(current, p(step, step), 1_000 + step * 100);
  assert.deepEqual(current, p(5, 5));
  filter.reset(p(20, 20), 2_000);
  assert.deepEqual(filter.next(p(20, 20), p(22, 22), 2_100), p(21, 21));
});

test("a single impossible jump is held and a return to the route clears it", () => {
  const filter = new AdaptivePositionFilter();
  filter.reset(p(1, 1), 1_000);

  const spike = filter.next(p(1, 1), p(8, 8), 1_100);
  const recovered = filter.next(spike, p(1.08, 0.96), 1_200);

  assert.deepEqual(spike, p(1, 1));
  assert.deepEqual(recovered, p(1, 1));
});

test("two nearby fast measurements confirm real relocation without snapping", () => {
  const filter = new AdaptivePositionFilter();
  filter.reset(p(0, 0), 1_000);

  const held = filter.next(p(0, 0), p(5, 0), 1_100);
  const confirmed = filter.next(held, p(5.4, 0.2), 1_200);

  assert.deepEqual(held, p(0, 0));
  assert.ok(confirmed.x > 1 && confirmed.x < 2);
  assert.ok(confirmed.y > 0 && confirmed.y < 0.2);
});

test("long measurement gaps are accepted as unknown movement, not rejected as spikes", () => {
  const filter = new AdaptivePositionFilter();
  filter.reset(p(0, 0), 1_000);

  const result = filter.next(p(0, 0), p(5, 0), 4_000);

  assert.ok(result.x > 1 && result.x < 2);
});
