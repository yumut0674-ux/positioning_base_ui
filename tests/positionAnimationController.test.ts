import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_POSITION_ANIMATION_CONFIG } from "../src/features/tracking/config/positionAnimationConfig";
import {
  PositionAnimationController,
  type PositionRenderer,
} from "../src/features/tracking/services/PositionAnimationController";

function controller(overrides: Partial<typeof DEFAULT_POSITION_ANIMATION_CONFIG> = {}) {
  return new PositionAnimationController({ ...DEFAULT_POSITION_ANIMATION_CONFIG, ...overrides });
}

function recorder() {
  const positions: { x: number; y: number; stale: boolean }[] = [];
  const renderer: PositionRenderer = {
    render: (x, y, stale) => positions.push({ x, y, stale }),
  };
  return { positions, renderer, latest: () => positions.at(-1)! };
}

test("retains a renderer attached before the tag's first position arrives", () => {
  const animation = controller({ interpolationDelayMs: 0 });
  const output = recorder();

  animation.attach("TAG-1", output.renderer);
  animation.ingest("TAG-1", { x: 1, y: 2, timestamp: 1_000, receivedAt: 1_000 });

  assert.deepEqual(output.latest(), { x: 1, y: 2, stale: false });

  animation.ingest("TAG-1", { x: 3, y: 4, timestamp: 2_000, receivedAt: 2_000 });
  animation.update(2_000);

  assert.deepEqual(output.latest(), { x: 3, y: 4, stale: false });
});

test("interpolates from message timestamps without restarting when irregular updates arrive", () => {
  const animation = controller({ interpolationDelayMs: 1_200 });
  const output = recorder();
  animation.ingest("TAG-1", { x: 0, y: 0, timestamp: 1_000, receivedAt: 1_000 });
  animation.attach("TAG-1", output.renderer);
  animation.ingest("TAG-1", { x: 1, y: 2, timestamp: 1_500, receivedAt: 1_500 });
  animation.update(2_450);
  assert.deepEqual(output.latest(), { x: 0.5, y: 1, stale: false });

  animation.ingest("TAG-1", { x: 3.8, y: 2, timestamp: 2_900, receivedAt: 2_900 });
  animation.update(2_700);
  assert.deepEqual(output.latest(), { x: 1, y: 2, stale: false });
});

test("a 1500 ms message gap remains a regular timestamp-based segment", () => {
  const animation = controller({ interpolationDelayMs: 0 });
  const output = recorder();
  animation.ingest("TAG-1", { x: 0, y: 0, timestamp: 1_000, receivedAt: 1_000 });
  animation.ingest("TAG-1", { x: 3, y: 0, timestamp: 2_500, receivedAt: 2_500 });
  animation.attach("TAG-1", output.renderer);
  animation.update(1_750);
  assert.equal(output.latest().x, 1.5);
});

test("out-of-order rendered samples and exact duplicates cannot move a tag backwards", () => {
  const animation = controller({ interpolationDelayMs: 0 });
  const output = recorder();
  animation.ingest("TAG-1", { x: 0, y: 0, timestamp: 1_000, receivedAt: 1_000 });
  animation.ingest("TAG-1", { x: 2, y: 0, timestamp: 2_000, receivedAt: 2_000 });
  animation.attach("TAG-1", output.renderer);
  animation.update(1_500);
  assert.equal(output.latest().x, 1);

  animation.ingest("TAG-1", { x: 0.2, y: 0, timestamp: 1_200, receivedAt: 2_100 });
  animation.ingest("TAG-1", { x: 2, y: 0, timestamp: 2_000, receivedAt: 2_200 });
  animation.update(1_600);
  assert.equal(output.latest().x, 1.2);
  assert.equal(animation.getState("TAG-1")?.samples.length, 2);
});

test("extrapolation is velocity based, capped, and then holds the last projected point", () => {
  const animation = controller({ interpolationDelayMs: 0, maximumExtrapolationMs: 250 });
  const output = recorder();
  animation.ingest("TAG-1", { x: 0, y: 0, timestamp: 1_000, receivedAt: 1_000 });
  animation.ingest("TAG-1", { x: 1, y: 0, timestamp: 1_500, receivedAt: 1_500 });
  animation.attach("TAG-1", output.renderer);
  animation.update(1_800);
  assert.equal(output.latest().x, 1.5);
  animation.update(3_000);
  assert.equal(output.latest().x, 1.5);
});

test("REGION_CENTER uses one controlled transition, ignores repeats, and never extrapolates", () => {
  const animation = controller({
    interpolationDelayMs: 0,
    regionTransitionDurationMs: 500,
    stalePositionTimeoutMs: 10_000,
  });
  const output = recorder();
  animation.ingest("TAG-1", { x: 0, y: 0, timestamp: 1_000, receivedAt: 1_000, positionSource: "RAW" });
  animation.attach("TAG-1", output.renderer);
  animation.ingest("TAG-1", {
    x: 10, y: 0, timestamp: 2_000, receivedAt: 2_000,
    positionSource: "REGION_CENTER", regionId: "room-a",
  });
  animation.update(2_250);
  assert.equal(output.latest().x, 5);

  animation.ingest("TAG-1", {
    x: 10, y: 0, timestamp: 2_250, receivedAt: 2_250,
    positionSource: "REGION_CENTER", regionId: "room-a",
  });
  animation.update(2_375);
  assert.equal(output.latest().x, 7.5);
  animation.update(2_500);
  assert.equal(output.latest().x, 10);
  animation.update(5_000);
  assert.equal(output.latest().x, 10);
});

test("RAW after REGION_CENTER transitions back once, then resumes buffered movement", () => {
  const animation = controller({ interpolationDelayMs: 0, regionTransitionDurationMs: 500 });
  const output = recorder();
  animation.ingest("TAG-1", {
    x: 5, y: 5, timestamp: 1_000, receivedAt: 1_000,
    positionSource: "REGION_CENTER", regionId: "room-a",
  });
  animation.attach("TAG-1", output.renderer);
  animation.ingest("TAG-1", { x: 6, y: 5, timestamp: 2_000, receivedAt: 2_000, positionSource: "RAW" });
  animation.update(2_250);
  assert.equal(output.latest().x, 5.5);
  animation.update(2_500);
  assert.equal(output.latest().x, 6);

  animation.ingest("TAG-1", { x: 7, y: 5, timestamp: 3_000, receivedAt: 3_000, positionSource: "RAW" });
  animation.update(2_750);
  assert.equal(output.latest().x, 6.75);
});

test("disabled animation applies the newest value immediately and needs no update loop", () => {
  const animation = controller({ enabled: false });
  const output = recorder();
  animation.ingest("TAG-1", { x: 1, y: 2, timestamp: 1_000, receivedAt: 1_000 });
  animation.attach("TAG-1", output.renderer);
  animation.ingest("TAG-1", { x: 4, y: 8, timestamp: 2_000, receivedAt: 2_000 });
  assert.deepEqual(output.latest(), { x: 4, y: 8, stale: false });
});

test("teleports and overlong segments use a short controlled transition", () => {
  const animation = controller({
    interpolationDelayMs: 0,
    teleportAnimationDurationMs: 300,
  });
  const output = recorder();
  animation.ingest("TAG-1", { x: 0, y: 0, timestamp: 1_000, receivedAt: 1_000 });
  animation.attach("TAG-1", output.renderer);
  animation.ingest("TAG-1", { x: 10, y: 0, timestamp: 1_500, receivedAt: 1_500 });
  animation.update(1_650);
  assert.equal(output.latest().x, 5);
  animation.update(1_800);
  assert.equal(output.latest().x, 10);

  animation.ingest("TAG-1", { x: 11, y: 0, timestamp: 5_000, receivedAt: 5_000 });
  animation.update(5_150);
  assert.equal(output.latest().x, 10.5);
  animation.update(5_300);
  assert.equal(output.latest().x, 11);
});

test("receivedAt is the timestamp fallback", () => {
  const animation = controller({ interpolationDelayMs: 0 });
  animation.ingest("TAG-1", { x: 1, y: 1, receivedAt: 4_321 });
  assert.equal(animation.getState("TAG-1")?.samples[0].timestamp, 4_321);
});

test("tags have independent buffers and stale state follows the configured timeout", () => {
  const animation = controller({ interpolationDelayMs: 0, stalePositionTimeoutMs: 4_000 });
  const first = recorder();
  const second = recorder();
  animation.ingest("TAG-1", { x: 0, y: 0, timestamp: 1_000, receivedAt: 1_000 });
  animation.ingest("TAG-2", { x: 10, y: 10, timestamp: 3_000, receivedAt: 3_000 });
  animation.attach("TAG-1", first.renderer);
  animation.attach("TAG-2", second.renderer);
  animation.update(5_500);
  assert.equal(animation.getState("TAG-1")?.stale, true);
  assert.equal(animation.getState("TAG-2")?.stale, false);
  assert.notEqual(first.latest().x, second.latest().x);
});

test("buffer size is bounded", () => {
  const animation = controller({
    interpolationDelayMs: 10_000,
    maximumBufferSize: 3,
    teleportDistanceMeters: 100,
  });
  for (let index = 0; index < 8; index += 1) {
    animation.ingest("TAG-1", {
      x: index,
      y: 0,
      timestamp: 1_000 + index * 500,
      receivedAt: 1_000 + index * 500,
    });
  }
  assert.equal(animation.getState("TAG-1")?.samples.length, 3);
});
