import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_POSITION_ANIMATION_CONFIG } from "../src/features/tracking/config/positionAnimationConfig";
import {
  PositionAnimationController,
  type PositionRenderer,
} from "../src/features/tracking/services/PositionAnimationController";
import { inDisplayArea, segmentInDisplayArea } from "../src/features/tracking/services/displayArea";

function controller(overrides: Partial<typeof DEFAULT_POSITION_ANIMATION_CONFIG> = {}) {
  return new PositionAnimationController({
    ...DEFAULT_POSITION_ANIMATION_CONFIG,
    maximumVisualSpeedMetersPerSecond: 1_000,
    easing: "linear",
    ...overrides,
  });
}

function recorder() {
  const positions: { x: number; y: number; stale: boolean }[] = [];
  const renderer: PositionRenderer = {
    render: (x, y, stale) => positions.push({ x, y, stale }),
  };
  return { positions, renderer, latest: () => positions.at(-1)! };
}

const room03Center = { x: -1.013164, y: 2.285254 };
const room05Center = { x: 2.507731, y: -1.552673 };
const boxAround = (point: { x: number; y: number }, radius = 0.45) => [
  { x: point.x - radius, y: point.y - radius },
  { x: point.x + radius, y: point.y - radius },
  { x: point.x + radius, y: point.y + radius },
  { x: point.x - radius, y: point.y + radius },
];

test("valid REGION_CENTER changes use the existing spatial transition", () => {
  const animation = controller({ interpolationDelayMs: 0, regionTransitionDurationMs: 600 });
  animation.setDisplayArea([[{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 0, y: 2 }]]);
  const output = recorder();
  animation.ingest("T", { x: 0.5, y: 1, timestamp: 1_000, receivedAt: 1_000, positionSource: "REGION_CENTER", regionId: "A" });
  animation.attach("T", output.renderer);
  animation.ingest("T", { x: 2.5, y: 1, timestamp: 2_000, receivedAt: 2_000, positionSource: "REGION_CENTER", regionId: "B" });

  assert.equal(animation.getState("T")?.transitionKind, "region-center-route");
  animation.update(2_300);
  assert.equal(output.latest().x, 1.5);
  animation.update(2_600);
  assert.deepEqual([output.latest().x, output.latest().y], [2.5, 1]);
  assert.equal(animation.getState("T")?.transitionKind, null);
});

test("field room-03 to room-05 relocation fades, snaps, and finishes exactly at the target", () => {
  const polygons = [boxAround(room03Center), boxAround(room05Center)];
  assert.equal(inDisplayArea(room05Center, polygons), true);
  assert.equal(segmentInDisplayArea(room03Center, room05Center, polygons), false);
  const animation = controller({ interpolationDelayMs: 0, regionTransitionDurationMs: 600 });
  animation.setDisplayArea(polygons);
  const frames: { x: number; y: number; opacity: number }[] = [];
  animation.attach("T", { render: (x, y, _stale, opacity) => frames.push({ x, y, opacity }) });
  animation.ingest("T", { ...room03Center, timestamp: 1_000, receivedAt: 1_000, positionSource: "REGION_CENTER", regionId: "room-03" });
  animation.ingest("T", { ...room05Center, timestamp: 1_000, receivedAt: 2_000, measurementTimestamp: 1_000, positionSource: "REGION_CENTER", regionId: "room-05" });

  assert.equal(animation.getState("T")?.transitionKind, "non-routable-region-relocation");
  animation.update(2_200);
  assert.deepEqual([frames.at(-1)!.x, frames.at(-1)!.y], [room03Center.x, room03Center.y]);
  assert.ok(frames.at(-1)!.opacity < 1);
  animation.update(2_300);
  assert.deepEqual([frames.at(-1)!.x, frames.at(-1)!.y, frames.at(-1)!.opacity], [room05Center.x, room05Center.y, 0]);
  animation.update(2_600);
  assert.deepEqual([frames.at(-1)!.x, frames.at(-1)!.y, frames.at(-1)!.opacity], [room05Center.x, room05Center.y, 1]);
  assert.equal(animation.getState("T")?.transitionKind, null);
  assert.deepEqual(animation.getState("T")?.samples.map(({ x, y, regionId }) => ({ x, y, regionId })), [{ ...room05Center, regionId: "room-05" }]);
});

test("RAW to room-03 centre crosses a narrow map gap without sticking at the door", () => {
  const corridor = [{ x: 0, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 3 }, { x: 0, y: 3 }];
  const room = [{ x: -2, y: 1 }, { x: -0.02, y: 1 }, { x: -0.02, y: 3 }, { x: -2, y: 3 }];
  const raw = { x: 0, y: 2.317 };
  assert.equal(segmentInDisplayArea(raw, room03Center, [corridor, room]), false);

  const animation = controller({ interpolationDelayMs: 0, regionTransitionDurationMs: 600 });
  animation.setDisplayArea([corridor, room]);
  const frames: { x: number; y: number; opacity: number }[] = [];
  animation.attach("T", { render: (x, y, _stale, opacity) => frames.push({ x, y, opacity }) });
  animation.ingest("T", { ...raw, timestamp: 1_000, receivedAt: 1_000, positionSource: "RAW" });
  animation.ingest("T", { ...room03Center, timestamp: 2_000, receivedAt: 2_000,
    positionSource: "REGION_CENTER", regionId: "room-03" });

  assert.equal(animation.getState("T")?.transitionKind, "non-routable-region-relocation");
  animation.update(2_200);
  assert.deepEqual([frames.at(-1)!.x, frames.at(-1)!.y], [raw.x, raw.y]);
  animation.update(2_300);
  assert.deepEqual([frames.at(-1)!.x, frames.at(-1)!.y, frames.at(-1)!.opacity], [room03Center.x, room03Center.y, 0]);
  animation.update(2_600);
  assert.deepEqual([frames.at(-1)!.x, frames.at(-1)!.y, frames.at(-1)!.opacity], [room03Center.x, room03Center.y, 1]);
});

test("REGION_CENTER outside the display area cannot start a relocation", () => {
  const animation = controller({ interpolationDelayMs: 0 });
  animation.setDisplayArea([boxAround(room03Center)]);
  animation.ingest("T", { ...room03Center, timestamp: 1_000, receivedAt: 1_000, positionSource: "REGION_CENTER", regionId: "room-03" });
  animation.ingest("T", { ...room05Center, timestamp: 2_000, receivedAt: 2_000, positionSource: "REGION_CENTER", regionId: "room-05" });
  assert.deepEqual([animation.getState("T")?.renderedX, animation.getState("T")?.renderedY], [room03Center.x, room03Center.y]);
  assert.equal(animation.getState("T")?.transitionKind, null);
});

test("room centre to RAW corridor fades across a map gap and reaches the latest measurement without restarting", () => {
  const corridor = [{ x: 0, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 3 }, { x: 0, y: 3 }];
  const room = [{ x: -2, y: 1 }, { x: -0.02, y: 1 }, { x: -0.02, y: 3 }, { x: -2, y: 3 }];
  const animation = controller({ interpolationDelayMs: 0, regionTransitionDurationMs: 600 });
  animation.setDisplayArea([corridor, room]);
  const frames: { x: number; y: number; opacity: number }[] = [];
  animation.attach("T", { render: (x, y, _stale, opacity) => frames.push({ x, y, opacity }) });
  animation.ingest("T", { ...room03Center, timestamp: 1000, receivedAt: 1000, positionSource: "REGION_CENTER", regionId: "room-03" });
  animation.ingest("T", { x: 0.5, y: 2, timestamp: 2000, receivedAt: 2000, positionSource: "RAW" });
  animation.update(2200);
  assert.ok(frames.at(-1)!.opacity < 1);
  animation.ingest("T", { x: 0.6, y: 2, timestamp: 2250, receivedAt: 2250, positionSource: "RAW" });
  animation.update(2300);
  assert.deepEqual([frames.at(-1)!.x, frames.at(-1)!.y, frames.at(-1)!.opacity], [0.6, 2, 0]);
  animation.ingest("T", { x: 0.7, y: 2, timestamp: 2400, receivedAt: 2400, positionSource: "RAW" });
  animation.update(2600);
  animation.update(2700);
  assert.equal(animation.getState("T")?.transitionKind, null);
  assert.deepEqual([frames.at(-1)!.x, frames.at(-1)!.y, frames.at(-1)!.opacity], [0.7, 2, 1]);
  assert.ok(frames.every(point => inDisplayArea(point, [corridor, room])));
});

test("a disconnected target arriving after the hidden midpoint is reached even without another packet", () => {
  const start = { x: 0, y: 0 }, first = { x: 3, y: 0 }, latest = { x: 6, y: 0 };
  const polygons = [start, first, latest].map(point => boxAround(point));
  const animation = controller({ interpolationDelayMs: 0, regionTransitionDurationMs: 600 });
  animation.setDisplayArea(polygons);
  const frames: { x: number; y: number; opacity: number }[] = [];
  animation.attach("T", { render: (x, y, _stale, opacity) => frames.push({ x, y, opacity }) });
  animation.ingest("T", { ...start, timestamp: 1000, receivedAt: 1000 });
  animation.ingest("T", { ...first, timestamp: 2000, receivedAt: 2000 });
  animation.update(2300);
  animation.ingest("T", { ...latest, timestamp: 2400, receivedAt: 2400 });
  animation.update(2600); animation.update(2900); animation.update(3200);
  assert.deepEqual([frames.at(-1)!.x, frames.at(-1)!.y, frames.at(-1)!.opacity], [6, 0, 1]);
  assert.equal(animation.getState("T")?.transitionKind, null);
  assert.ok(frames.every(point => inDisplayArea(point, polygons)));
});

test("RAW relocation across a concave corridor does not freeze and never draws an outside point", () => {
  const elbow = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 6 }, { x: 0, y: 6 }];
  const animation = controller({ interpolationDelayMs: 0, regionTransitionDurationMs: 600 });
  animation.setDisplayArea([elbow]);
  const frames: { x: number; y: number; opacity: number }[] = [];
  animation.attach("T", { render: (x, y, _stale, opacity) => frames.push({ x, y, opacity }) });
  animation.ingest("T", { x: 1, y: 5, timestamp: 1000, receivedAt: 1000 });
  animation.ingest("T", { x: 5, y: 1, timestamp: 2000, receivedAt: 2000 });
  animation.update(2300); animation.update(2600);
  assert.deepEqual([frames.at(-1)!.x, frames.at(-1)!.y, frames.at(-1)!.opacity], [5, 1, 1]);
  assert.ok(frames.every(point => inDisplayArea(point, [elbow])));
});

test("disabled animation relocates immediately across a map gap and still rejects an outside target", () => {
  const animation = controller({ enabled: false });
  animation.setDisplayArea([boxAround(room03Center), boxAround(room05Center)]);
  const output = recorder();
  animation.attach("T", output.renderer);
  animation.ingest("T", { ...room03Center, timestamp: 1000, receivedAt: 1000, positionSource: "REGION_CENTER", regionId: "room-03" });
  animation.ingest("T", { ...room05Center, timestamp: 2000, receivedAt: 2000, positionSource: "RAW" });
  assert.deepEqual([output.latest().x, output.latest().y], [room05Center.x, room05Center.y]);
  animation.ingest("T", { x: 100, y: 100, timestamp: 3000, receivedAt: 3000 });
  assert.deepEqual([output.latest().x, output.latest().y], [room05Center.x, room05Center.y]);
});

test("repeated publication at the same room centre does not restart relocation", () => {
  const animation = controller({ interpolationDelayMs: 0, regionTransitionDurationMs: 600 });
  animation.setDisplayArea([boxAround(room03Center), boxAround(room05Center)]);
  animation.ingest("T", { ...room03Center, timestamp: 1_000, receivedAt: 1_000, positionSource: "REGION_CENTER", regionId: "room-03" });
  animation.ingest("T", { ...room05Center, timestamp: 1_000, receivedAt: 2_000, positionSource: "REGION_CENTER", regionId: "room-05" });
  animation.update(2_200);
  animation.ingest("T", { ...room05Center, timestamp: 1_000, receivedAt: 2_250, measurementTimestamp: 1_000, positionSource: "REGION_CENTER", regionId: "room-05" });
  animation.update(2_300);
  assert.deepEqual([animation.getState("T")?.renderedX, animation.getState("T")?.renderedY], [room05Center.x, room05Center.y]);
  animation.update(2_600);
  assert.equal(animation.getState("T")?.transitionKind, null);
});

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
  assert.equal(output.latest().x, 1);
  assert.equal(animation.getState("TAG-1")?.samples.length, 2);
});

test("production speed limit prevents both large jumps and long-frame catch-up jumps", () => {
  const animation = new PositionAnimationController({
    ...DEFAULT_POSITION_ANIMATION_CONFIG,
    interpolationDelayMs: 0,
  });
  const output = recorder();
  animation.ingest("TAG-1", { x: 0, y: 0, timestamp: 1_000, receivedAt: 1_000 });
  animation.attach("TAG-1", output.renderer);
  animation.ingest("TAG-1", { x: 10, y: 0, timestamp: 1_500, receivedAt: 1_500 });

  animation.update(5_000);
  assert.ok(output.latest().x <= 0.120_001);

  let previous = output.latest().x;
  for (let time = 5_016; time <= 6_016; time += 16) {
    animation.update(time);
    assert.ok(output.latest().x - previous <= 1.2 * 0.016 + 1e-9);
    previous = output.latest().x;
  }
  assert.ok(output.latest().x < 1.4);
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

test("REGION_CENTER eases toward its exact centre, ignores repeats, and never extrapolates", () => {
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

test("RAW after REGION_CENTER changes without a wall-crossing route, then resumes buffered movement", () => {
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

test("synthetic centre heartbeats neither reset measurement age nor move a pinned tag", () => {
  const animation = controller({ stalePositionTimeoutMs: 1000 });
  animation.ingest("T", { x: 3, y: 3, timestamp: 1000, receivedAt: 1000, measurementTimestamp: 1000, positionSource: "REGION_CENTER", regionId: "A" });
  animation.ingest("T", { x: 3, y: 3, timestamp: 1000, receivedAt: 3000, measurementTimestamp: 1000, positionSource: "REGION_CENTER", regionId: "A" });
  assert.equal(animation.getState("T")?.stale, true);
  assert.deepEqual([animation.getState("T")?.renderedX, animation.getState("T")?.renderedY], [3, 3]);
  assert.equal(animation.getState("T")?.samples.length, 1);
});
