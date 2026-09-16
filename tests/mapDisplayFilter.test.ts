import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MapDisplayFilter, type MapTagDisplay } from "../src/features/tracking/services/MapDisplayFilter";
import { inDisplayArea, segmentInDisplayArea } from "../src/features/tracking/services/displayArea";
import { PositionAnimationController } from "../src/features/tracking/services/PositionAnimationController";
import { DEFAULT_POSITION_ANIMATION_CONFIG } from "../src/features/tracking/config/positionAnimationConfig";
import { resolveMapDisplayConfig } from "../src/features/tracking/config/mapDisplayConfig";
import { bindMapDisplayTracking } from "../src/features/tracking/services/bindMapDisplayTracking";
import { useIpsStore } from "../src/app/store/useIpsStore";
import { DEFAULT_REGIONS_CONFIG } from "../src/features/regions/config/defaultRegionsConfig";
import { TagInformationPanelContent } from "../src/features/tracking/components/TagInformationPanel";
import type { TrackedTag } from "../src/features/tracking/types/tracking.types";

const p = (x: number, y: number) => ({ x, y });
const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
const elbow = [p(0, 0), p(6, 0), p(6, 2), p(2, 2), p(2, 6), p(0, 6)];
const tag = (x: number, y: number, timestamp: number, id = "A"): TrackedTag => ({
  id, name: id, color: "#ffffff", status: "active", x, y, timestamp,
});

function fixture(publish?: (value: Record<string, MapTagDisplay>) => void) {
  let now = 1_000, nextId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let displays: Record<string, MapTagDisplay> = {};
  const animation = new PositionAnimationController({ ...DEFAULT_POSITION_ANIMATION_CONFIG, interpolationDelayMs: 500 });
  const filter = new MapDisplayFilter(animation, (value) => { displays = value; publish?.(value); }, {
    now: () => now,
    setTimeout: (fn, delay) => {
      const id = ++nextId;
      timers.set(id, { at: now + delay, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id) => { timers.delete(id as unknown as number); },
  });
  filter.configure([square], 2_000);
  return { animation, filter, timers, displays: () => displays, advance: (time: number) => {
    now = time;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
  } };
}

test("short outside spike holds last valid point, rejects the sample, and resumes inside", () => {
  const f = fixture();
  f.filter.ingest(tag(2, 2, 1_000));
  f.advance(1_100);
  f.filter.ingest(tag(20, 20, 1_100));
  assert.deepEqual(f.displays().A.position, p(2, 2));
  assert.equal(f.displays().A.visible, true);
  assert.deepEqual(f.animation.getState("A")?.samples.map(({ x, y }) => ({ x, y })), [p(2, 2)]);
  f.advance(3_099);
  f.filter.ingest(tag(4, 4, 3_099));
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.displays().A.position, p(4, 4));
  f.filter.dispose();
});

test("one outside measurement followed by silence hides at the deadline and re-entry snaps", () => {
  const f = fixture();
  f.filter.ingest(tag(1, 1, 1_000));
  f.filter.ingest(tag(11, 1, 1_001));
  f.advance(2_999);
  assert.equal(f.displays().A.visible, true);
  f.advance(3_000);
  assert.equal(f.displays().A.visible, false);
  assert.equal(f.animation.getState("A"), undefined);
  f.filter.ingest(tag(9, 9, 3_000));
  assert.equal(f.displays().A.visible, true);
  assert.equal(f.animation.getState("A")?.renderedX, 9);
  assert.equal(f.animation.getState("A")?.samples.length, 1);
  f.filter.dispose();
});

test("continuous outside, duplicate, old and synthetic publications do not extend the deadline", () => {
  const f = fixture();
  f.filter.ingest(tag(1, 1, 1_000));
  f.filter.ingest(tag(11, 1, 1_100));
  f.advance(2_000);
  f.filter.ingest(tag(12, 1, 2_000));
  f.filter.ingest(tag(1, 1, 1_900)); // delayed inside packet must not cancel timeout
  f.filter.ingest(tag(12, 1, 2_000));
  f.filter.ingest({ ...tag(12, 1, 2_000), publishedAt: new Date(2_800).toISOString() });
  f.advance(3_000);
  assert.equal(f.displays().A.visible, false);
  assert.equal(f.timers.size, 0);
  f.filter.dispose();
});

test("initial outside position is hidden; tags and their deadlines are independent", () => {
  const f = fixture();
  f.filter.ingest(tag(-1, 0, 1_000));
  f.filter.ingest(tag(5, 5, 1_000, "B"));
  assert.equal(f.displays().A.visible, false);
  assert.equal(f.animation.getState("A"), undefined);
  f.filter.ingest(tag(0, 0, 1_001));
  f.filter.ingest(tag(-1, 0, 1_002));
  f.advance(1_500);
  f.filter.ingest(tag(15, 5, 1_500, "B"));
  f.advance(3_000);
  assert.equal(f.displays().A.visible, false);
  assert.equal(f.displays().B.visible, true);
  f.advance(3_500);
  assert.equal(f.displays().B.visible, false);
  f.filter.dispose();
});

test("boundaries, adjacent/overlapping polygons, narrow gaps and L corridors", () => {
  for (const point of [p(0, 0), p(10, 10), p(5, 0), p(0, 5)]) assert.equal(inDisplayArea(point, [square]), true);
  assert.equal(inDisplayArea(p(2, 2), []), false);
  assert.equal(segmentInDisplayArea(p(1, 5), p(5, 1), [elbow]), false);
  assert.equal(segmentInDisplayArea(p(0, 0), p(6, 0), [elbow]), true);
  const right = square.map(({ x, y }) => p(x + 10, y));
  assert.equal(segmentInDisplayArea(p(1, 5), p(19, 5), [square, right]), true);
  assert.equal(segmentInDisplayArea(p(1, 5), p(19, 5), [square, right.map(({ x, y }) => p(x - 1, y))]), true);
  assert.equal(segmentInDisplayArea(p(1, 5), p(19, 5), [square, right.map(({ x, y }) => p(x + 0.00001, y))]), false);
});

test("unsafe L corridor animation snaps; queued motion and extrapolation stay inside", () => {
  const f = fixture();
  f.filter.configure([elbow], 2_000);
  const rendered: { x: number; y: number }[] = [];
  f.animation.attach("A", { render: (x, y) => { rendered.push(p(x, y)); } });
  f.filter.ingest(tag(1, 5, 1_000));
  f.filter.ingest(tag(5, 1, 2_000), true);
  assert.equal(f.animation.getState("A")?.renderedX, 5);
  f.filter.ingest(tag(6, 1, 2_100));
  for (let time = 2_000; time <= 4_000; time += 10) f.animation.update(time);
  assert.ok(rendered.every((point) => inDisplayArea(point, [elbow])));
  f.filter.configure([[p(4, 0), p(6, 0), p(6, 2), p(4, 2)]], 2_000);
  for (let time = 4_000; time < 5_000; time += 10) f.animation.update(time);
  assert.ok(f.animation.getState("A")!.samples.every((sample) => sample.x >= 4));
  f.filter.dispose();
});

test("configuration re-evaluates immediately, preserves an outside deadline and cleans up", () => {
  const f = fixture();
  f.filter.ingest(tag(1, 1, 1_000));
  f.filter.ingest(tag(11, 1, 1_100));
  f.advance(2_000);
  f.filter.configure([square], 1_500);
  f.advance(2_500);
  assert.equal(f.displays().A.visible, false);
  f.filter.configure([square.map(({ x, y }) => p(x + 5, y))], 2_000);
  assert.equal(f.displays().A.visible, true);
  f.filter.configure([], 2_000);
  assert.equal(f.displays().A.reason, "no-regions");
  assert.equal(f.displays().A.visible, false);
  f.filter.configure([square], 2_000);
  assert.equal(f.displays().A.visible, false); // previous hold point was invalidated
  f.filter.ingest(tag(1, 1, 3_000));
  f.filter.ingest(tag(11, 1, 3_100));
  f.filter.retain(new Set());
  assert.deepEqual(f.displays(), {});
  assert.equal(f.timers.size, 0);
  assert.equal(f.animation.getState("A"), undefined);
  f.filter.dispose();
});

test("store binding switches RAW/engine coordinates and maps without modifying measurements or room entries", () => {
  const original = useIpsStore.getState();
  const f = fixture((mapTagDisplays) => useIpsStore.setState({ mapTagDisplays }));
  const pair = (world: { x: number; y: number }) => ({ world, pixel: world });
  const config = { ...DEFAULT_REGIONS_CONFIG, regions: [{ id: "room", name: "Room", color: "#ffffff",
    polygon: square.map(pair), roomCenter: pair(p(5, 5)), entrances: [] }] };
  try {
    useIpsStore.setState({ tags: {}, observedTags: {}, tagLocationEntries: {}, regionsConfig: config, activeMapId: config.map.mapId });
    const raw = tag(20, 20, 1_000);
    const processed = { ...tag(5, 5, 1_000), positionSource: "REGION_CENTER" as const,
      regionInference: { enabled: true, state: "IN_REGION", regionId: "room" } };
    useIpsStore.getState().observeTag(raw);
    useIpsStore.getState().upsertTag(processed);
    const entries = useIpsStore.getState().tagLocationEntries;
    let unbind = bindMapDisplayTracking(f.filter, true);
    assert.equal(f.displays().A.visible, true); // RAW is outside, engine centre wins
    assert.deepEqual(f.displays().A.position, p(5, 5));
    unbind();
    unbind = bindMapDisplayTracking(f.filter, false);
    f.advance(3_000);
    assert.equal(f.displays().A.visible, false);
    assert.equal(useIpsStore.getState().tags.A, processed);
    assert.equal(useIpsStore.getState().observedTags.A, raw);
    assert.equal(useIpsStore.getState().tagLocationEntries, entries);
    useIpsStore.getState().observeTag(tag(3, 3, 3_001));
    assert.equal(f.displays().A.visible, true);
    useIpsStore.getState().setActiveMapId("other-map");
    assert.equal(f.displays().A.visible, false);
    useIpsStore.getState().setActiveMapId(config.map.mapId);
    assert.equal(f.displays().A.visible, true);
    useIpsStore.getState().setRegionsConfig({ ...config, regions: [] });
    assert.equal(f.displays().A.reason, "no-regions");
    useIpsStore.getState().refreshTagActivity(20_000);
    assert.equal(useIpsStore.getState().observedTags.A.status, "offline");
    assert.equal(useIpsStore.getState().observedTags.A.timestamp, 3_001);
    unbind();
  } finally { f.filter.dispose(); useIpsStore.setState(original, true); }
});

test("a jump into another valid region remains visible and bypasses a gap without an animation", () => {
  const f = fixture();
  f.filter.configure([square, square.map(({ x, y }) => p(x + 20, y))], 2_000);
  f.filter.ingest(tag(5, 5, 1_000), true);
  f.filter.ingest(tag(25, 5, 2_000), true);
  assert.deepEqual(f.displays().A, { visible: true, position: p(25, 5) });
  assert.equal(f.animation.getState("A")?.renderedX, 25);
  assert.equal(f.timers.size, 0);
  f.filter.dispose();
});

test("disabled animation still times out and synthetic RAW publications retain measurement age", () => {
  const f = fixture();
  f.animation.setConfig({ ...DEFAULT_POSITION_ANIMATION_CONFIG, enabled: false });
  f.filter.ingest(tag(1, 1, 1_000));
  f.filter.ingest(tag(11, 1, 1_100));
  f.advance(3_000);
  assert.equal(f.displays().A.visible, false);
  f.filter.ingest(tag(1, 1, 3_000));
  f.advance(10_000);
  f.filter.ingest({ ...tag(1, 1, 3_000), publishedAt: new Date(10_000).toISOString() });
  assert.equal(f.animation.getState("A")?.stale, true);
  f.filter.dispose();
  assert.equal(f.timers.size, 0);
  assert.equal(f.animation.getState("A"), undefined);
});

test("hidden tag stays in the list with visibility explanation and real activity", () => {
  const html = renderToStaticMarkup(createElement(TagInformationPanelContent, {
    tags: [tag(15, 15, 1_000)], recentTagIds: [], locationDuration: "", onSelectTag: () => {}, onOpenHistory: () => {},
    mapTagDisplays: { A: { visible: false, reason: "outside" } },
  }));
  assert.match(html, /Alan dışında · haritada gizli/);
  assert.match(html, /CANLI/);
  assert.match(html, /role="option"/);
});

test("display wait configuration defaults to 2000 ms and validates persisted values", () => {
  assert.deepEqual(resolveMapDisplayConfig(undefined), { outsideHoldMs: 2_000 });
  assert.deepEqual(resolveMapDisplayConfig({ outsideHoldMs: 0 }), { outsideHoldMs: 0 });
  assert.deepEqual(resolveMapDisplayConfig({ outsideHoldMs: 5_000 }), { outsideHoldMs: 5_000 });
  for (const outsideHoldMs of [-1, 1.5, Infinity, "2000", 3_600_001]) assert.throws(() => resolveMapDisplayConfig({ outsideHoldMs }));
});

test("hiding and reopening the tag layer retains the validated position until tag cleanup", () => {
  const f = fixture();
  f.filter.ingest(tag(5, 5, 1_000));
  f.animation.update(50_000); // no attached renderer while a layer is hidden
  let rendered: { x: number; y: number } | undefined;
  const detach = f.animation.attach("A", { render: (x, y) => { rendered = p(x, y); } });
  assert.deepEqual(rendered, p(5, 5));
  detach();
  f.filter.retain(new Set());
  assert.equal(f.animation.getState("A"), undefined);
  f.filter.dispose();
});
