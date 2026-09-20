import assert from "node:assert/strict";
import test from "node:test";
import { AdaptivePositionFilter } from "../src/features/tracking/services/positionFilters";

const p = (x: number, y: number) => ({ x, y });

test("stationary UWB jitter stays inside the visual dead-band", () => {
  const filter = new AdaptivePositionFilter();
  filter.reset(p(5, 5), 1_000);

  const first = filter.next(p(5, 5), p(5.10, 4.93), 1_200);
  const second = filter.next(first, p(4.91, 5.08), 1_400);

  assert.deepEqual(first, p(5, 5));
  assert.deepEqual(second, p(5, 5));
});

test("normal movement is smoothed while larger real movement catches up faster", () => {
  const filter = new AdaptivePositionFilter();
  filter.reset(p(0, 0), 1_000);

  const slow = filter.next(p(0, 0), p(0.5, 0), 2_000);
  const fast = filter.next(slow, p(2, 0), 3_000);

  assert.ok(slow.x > 0.15 && slow.x < 0.3);
  assert.ok(fast.x > 1.2 && fast.x < 1.5);
  assert.equal(slow.y, 0);
  assert.equal(fast.y, 0);
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
  assert.ok(confirmed.x > 3 && confirmed.x < 5.4);
  assert.ok(confirmed.y > 0 && confirmed.y < 0.2);
});

test("long measurement gaps are accepted as unknown movement, not rejected as spikes", () => {
  const filter = new AdaptivePositionFilter();
  filter.reset(p(0, 0), 1_000);

  const result = filter.next(p(0, 0), p(5, 0), 4_000);

  assert.ok(result.x > 3 && result.x < 5);
});
