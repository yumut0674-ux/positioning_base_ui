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
import type { RegionDefinition } from "../src/features/regions/types/region.types";
import { roomDecisionLabel } from "../src/features/tracking/services/roomDecisionLabel";

const p = (x: number, y: number) => ({ x, y });
const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
const elbow = [p(0, 0), p(6, 0), p(6, 2), p(2, 2), p(2, 6), p(0, 6)];
const tag = (x: number, y: number, timestamp: number, id = "A"): TrackedTag => ({
  id, name: id, color: "#ffffff", status: "active", x, y, timestamp, mapId: DEFAULT_REGIONS_CONFIG.map.mapId,
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

test("one outside measurement followed by silence hides at the deadline and re-entry keeps the last rendered point", () => {
  const f = fixture();
  f.filter.ingest(tag(1, 1, 1_000));
  f.filter.ingest(tag(11, 1, 1_001));
  f.advance(2_999);
  assert.equal(f.displays().A.visible, true);
  f.advance(3_000);
  assert.equal(f.displays().A.visible, false);
  assert.equal(f.animation.getState("A")?.renderedX, 1);
  f.filter.ingest(tag(9, 9, 3_000));
  assert.equal(f.displays().A.visible, true);
  assert.equal(f.animation.getState("A")?.renderedX, 1);
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

test("unsafe L corridor animation holds instead of snapping; queued motion stays inside", () => {
  const f = fixture();
  f.filter.configure([elbow], 2_000);
  const rendered: { x: number; y: number }[] = [];
  f.animation.attach("A", { render: (x, y) => { rendered.push(p(x, y)); } });
  f.filter.ingest(tag(1, 5, 1_000));
  f.filter.ingest(tag(5, 1, 2_000), true);
  assert.equal(f.animation.getState("A")?.renderedX, 1);
  f.filter.ingest(tag(6, 1, 2_100));
  for (let time = 2_000; time <= 4_000; time += 10) f.animation.update(time);
  assert.ok(rendered.every((point) => inDisplayArea(point, [elbow])));
  f.filter.configure([[p(4, 0), p(6, 0), p(6, 2), p(4, 2)]], 2_000);
  for (let time = 4_000; time < 5_000; time += 10) f.animation.update(time);
  assert.ok(f.animation.getState("A")!.samples.every((sample) => sample.x >= 4));
  f.filter.dispose();
});

test("RAW map presentation suppresses jitter and requires confirmation for a sudden jump", () => {
  const f = fixture();
  f.filter.ingest(tag(5, 5, 1_000), true);

  f.filter.ingest(tag(5.10, 4.93, 1_100), true);
  assert.deepEqual(f.displays().A.position, p(5, 5));

  f.filter.ingest(tag(9, 9, 1_200), true);
  assert.deepEqual(f.displays().A.position, p(5, 5));

  f.filter.ingest(tag(9.2, 9.1, 1_300), true);
  assert.ok(f.displays().A.position!.x > 5.5);
  assert.ok(f.displays().A.position!.x < 6.3);
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
    polygon: [p(4, 4), p(10, 4), p(10, 10), p(4, 10)].map(pair), roomCenter: pair(p(5, 5)), entrances: [] },
    { id: "corridor-main", name: "Koridor", color: "#ffffff", polygon: [p(0, 0), p(10, 0), p(10, 3), p(0, 3)].map(pair), roomCenter: null, entrances: [] }] };
  try {
    useIpsStore.setState({ tags: {}, observedTags: {}, tagLocationEntries: {}, regionsConfig: config, regionsConfigByMapId: { [config.map.mapId]: config }, activeMapId: config.map.mapId });
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
    assert.equal(f.displays().A, undefined);
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

const corridor = [p(0, 0), p(10, 0), p(10, 2), p(0, 2)];
const roomA = [p(2, 2), p(4, 2), p(4, 5), p(2, 5)];
const roomB = [p(6, 2), p(8, 2), p(8, 5), p(6, 5)];

test("engine display includes stationary raw tags before any room decision and follows new observations", () => {
  const original = useIpsStore.getState();
  const f = fixture((mapTagDisplays) => useIpsStore.setState({ mapTagDisplays }));
  const pair = (world: { x: number; y: number }) => ({ world, pixel: world });
  const config = { ...DEFAULT_REGIONS_CONFIG, regions: [{ id: "corridor-main", name: "Koridor", kind: "corridor" as const,
    color: "#fff", polygon: square.map(pair), roomCenter: null, entrances: [] }] };
  let unbind: (() => void) | undefined;
  try {
    useIpsStore.setState({ tags: {}, observedTags: {}, tagPresenceById: {}, tagLocationEntries: {}, selectedTagId: null,
      activeMapId: config.map.mapId, regionsConfig: config, regionsConfigByMapId: { [config.map.mapId]: config } });
    unbind = bindMapDisplayTracking(f.filter, true);
    useIpsStore.getState().observeTag({ ...tag(2, 2, 1000), motionLabel: "stationary" });
    assert.equal(f.displays().A?.visible, true);
    assert.deepEqual(f.displays().A.position, p(2, 2));
    f.advance(2000);
    useIpsStore.getState().observeTag({ ...tag(2.1, 2, 2000), motionLabel: "stationary" });
    assert.equal(f.animation.getState("A")?.samples.at(-1)?.timestamp, 2000);
    useIpsStore.getState().observeTag({ ...tag(3, 3, 2000, "OTHER"), motionLabel: "stationary", mapId: "other-map" });
    useIpsStore.getState().observeTag({ ...tag(3, 3, 2000, "UNRESOLVED"), motionLabel: "stationary", mapId: null });
    assert.equal(f.displays().OTHER, undefined); assert.equal(f.displays().UNRESOLVED, undefined);
    assert.deepEqual(useIpsStore.getState().tags, {});
    assert.deepEqual(useIpsStore.getState().tagLocationEntries, {});
  } finally { unbind?.(); f.filter.dispose(); useIpsStore.setState(original, true); }
});

test("corridor markers do not require motion metadata or a room-engine publication", () => {
  const original = useIpsStore.getState();
  const f = fixture((mapTagDisplays) => useIpsStore.setState({ mapTagDisplays }));
  const pair = (world: { x: number; y: number }) => ({ world, pixel: world });
  const config = { ...DEFAULT_REGIONS_CONFIG, regions: [{ id: "corridor-main", name: "Koridor", kind: "corridor" as const,
    color: "#fff", polygon: square.map(pair), roomCenter: null, entrances: [] }] };
  let unbind: (() => void) | undefined;
  try {
    useIpsStore.setState({ tags: {}, observedTags: {}, tagPresenceById: {}, tagLocationEntries: {}, selectedTagId: null,
      activeMapId: config.map.mapId, regionsConfig: config, regionsConfigByMapId: { [config.map.mapId]: config } });
    unbind = bindMapDisplayTracking(f.filter, true);
    for (const [index, motionLabel] of [undefined, "unknown", "stationary", "moving"].entries()) {
      const id = `RAW-${index}`;
      useIpsStore.getState().observeTag({ ...tag(2 + index, 2, 1000, id), motionLabel: motionLabel as TrackedTag["motionLabel"] });
      assert.equal(f.displays()[id]?.visible, true, `raw motion: ${motionLabel}`);
      let rendered: { x: number; y: number } | undefined;
      const detach = f.animation.attach(id, { render: (x, y) => { rendered = p(x, y); } });
      assert.deepEqual(rendered, p(2 + index, 2));
      detach();
    }
    assert.deepEqual(useIpsStore.getState().tags, {});
    assert.deepEqual(useIpsStore.getState().tagLocationEntries, {});
  } finally { unbind?.(); f.filter.dispose(); useIpsStore.setState(original, true); }
});

test("stationary display keeps assigned rooms and accepts a delayed room decision after a raw fallback", () => {
  const original = useIpsStore.getState();
  const f = fixture((mapTagDisplays) => useIpsStore.setState({ mapTagDisplays }));
  const pair = (world: { x: number; y: number }) => ({ world, pixel: world });
  const config = { ...DEFAULT_REGIONS_CONFIG, regions: [
    { id: "corridor-main", name: "Koridor", kind: "corridor" as const, color: "#fff", polygon: corridor.map(pair), roomCenter: null, entrances: [] },
    { id: "room-a", name: "Oda A", kind: "room" as const, color: "#fff", polygon: roomA.map(pair), roomCenter: pair(p(3, 3.5)), entrances: [] },
    { id: "room-b", name: "Oda B", kind: "room" as const, color: "#fff", polygon: roomB.map(pair), roomCenter: pair(p(7, 3.5)), entrances: [] },
  ] };
  let unbind: (() => void) | undefined;
  try {
    useIpsStore.setState({ tags: {}, observedTags: {}, tagPresenceById: {}, tagLocationEntries: {}, selectedTagId: null,
      activeMapId: config.map.mapId, regionsConfig: config, regionsConfigByMapId: { [config.map.mapId]: config } });
    unbind = bindMapDisplayTracking(f.filter, true);
    const raw = { ...tag(7, 3.5, 2000), motionLabel: "stationary" as const };
    useIpsStore.getState().observeTag(raw);
    assert.equal(f.displays().A?.visible, true);
    assert.ok(inDisplayArea(f.displays().A.position!, [corridor]));
    const assigned = { ...tag(3, 3.5, 1000), positionSource: "REGION_CENTER" as const, publishedAt: new Date(2500).toISOString(),
      regionInference: { enabled: true, state: "IN_REGION", regionId: "room-a" } };
    useIpsStore.getState().upsertTag(assigned);
    assert.deepEqual(f.displays().A.position, p(3, 3.5));
    useIpsStore.getState().observeTag({ ...raw, timestamp: 3000, x: 100, y: 100 });
    assert.deepEqual(f.displays().A.position, p(3, 3.5));
    const lost = { ...assigned, publishedAt: new Date(4000).toISOString(),
      regionInference: { enabled: true, state: "LOCATION_LOST", regionId: null, lastKnownRegionId: "room-a" } };
    useIpsStore.getState().upsertTag(lost);
    useIpsStore.getState().observeTag({ ...raw, timestamp: 4000 });
    assert.equal(f.displays().A.visible, true);
    assert.ok(inDisplayArea(f.displays().A.position!, [corridor]));
    assert.equal(useIpsStore.getState().tags.A, lost);
    assert.equal(f.animation.getState("A")?.samples.at(-1)?.regionId, null);
  } finally { unbind?.(); f.filter.dispose(); useIpsStore.setState(original, true); }
});

test("new stationary packets refresh map animation freshness while retaining the assigned room centre", () => {
  const original = useIpsStore.getState();
  const f = fixture((mapTagDisplays) => useIpsStore.setState({ mapTagDisplays }));
  const pair = (world: { x: number; y: number }) => ({ world, pixel: world });
  const config = { ...DEFAULT_REGIONS_CONFIG, regions: [{ id: "room", name: "Oda", kind: "room" as const,
    color: "#fff", polygon: square.map(pair), roomCenter: pair(p(5, 5)), entrances: [] }] };
  let unbind: (() => void) | undefined;
  try {
    const processed = { ...tag(5, 5, 1000), positionSource: "REGION_CENTER" as const,
      regionInference: { enabled: true, state: "IN_REGION", regionId: "room" } };
    useIpsStore.setState({ tags: { A: processed }, observedTags: {}, tagPresenceById: {}, tagLocationEntries: {}, selectedTagId: null,
      activeMapId: config.map.mapId, regionsConfig: config, regionsConfigByMapId: { [config.map.mapId]: config } });
    unbind = bindMapDisplayTracking(f.filter, true);
    for (const at of [11000, 21000, 31000]) {
      f.advance(at);
      useIpsStore.getState().observeTag({ ...tag(9, 9, at), motionLabel: "stationary" });
      f.animation.update(at);
      const state = f.animation.getState("A")!;
      assert.equal(state.samples.at(-1)!.timestamp, at);
      assert.equal(state.stale, false);
      assert.deepEqual(f.displays().A.position, p(5, 5));
      assert.equal(useIpsStore.getState().tags.A, processed);
    }
  } finally { unbind?.(); f.filter.dispose(); useIpsStore.setState(original, true); }
});

function roomPermissionFixture() {
  const f = fixture();
  const pair = (world: { x: number; y: number }) => ({ world, pixel: world });
  const regions: RegionDefinition[] = [
    { id: "corridor-main", name: "Koridor", kind: "corridor", polygon: corridor.map(pair), roomCenter: null, color: "#fff", entrances: [] },
    { id: "room-a", name: "Oda A", kind: "room", polygon: roomA.map(pair), roomCenter: pair(p(3, 3.5)), color: "#fff", entrances: [] },
    { id: "room-b", name: "Oda B", kind: "room", polygon: roomB.map(pair), roomCenter: pair(p(7, 3.5)), color: "#fff", entrances: [] },
  ];
  f.filter.configure([corridor, roomA, roomB], 2_000, DEFAULT_REGIONS_CONFIG.map.mapId, regions);
  return f;
}

test("raw room coordinates and entry candidates stay in the corridor until an engine assignment", () => {
  const f = roomPermissionFixture();
  const raw = tag(3, 3.5, 1_000);
  f.filter.ingest(raw, true);
  assert.equal(f.displays().A.visible, true);
  assert.equal(inDisplayArea(f.displays().A.position!, [corridor]), true);
  assert.equal(inDisplayArea(f.displays().A.position!, [roomA]), false);
  assert.deepEqual(raw, tag(3, 3.5, 1_000));
  f.advance(2_000);
  f.filter.ingest({ ...tag(3.2, 4, 2_000), regionInference: {
    enabled: true, state: "ENTRY_CANDIDATE", regionId: null, candidateRegionId: "room-a", measurementKind: "uncertain",
  } }, true);
  for (let now = 2_000; now < 5_000; now += 16) {
    f.animation.update(now);
    const state = f.animation.getState("A")!;
    assert.equal(inDisplayArea(p(state.renderedX, state.renderedY), [corridor]), true);
    assert.ok(state.samples.every(sample => inDisplayArea(sample, [corridor])));
  }
  f.filter.dispose();
});

test("confirmed and inferred engine assignments permit only the assigned room", () => {
  for (const state of ["IN_REGION", "INFERRED_IN_REGION", "EXIT_CANDIDATE"]) {
    const f = roomPermissionFixture();
    f.filter.ingest({ ...tag(3, 3.5, 1_000), positionSource: "REGION_CENTER",
      regionInference: { enabled: true, state, regionId: "room-a" } });
    assert.deepEqual(f.displays().A.position, p(3, 3.5));
    assert.deepEqual([f.animation.getState("A")!.renderedX, f.animation.getState("A")!.renderedY], [3, 3.5]);
    f.advance(2_000);
    // Leaving the centre still cannot authorize a different room.
    f.filter.ingest({ ...tag(5, 1.9, 2_000), regionInference: { enabled: true, state, regionId: "room-a" } });
    f.advance(3_000);
    f.filter.ingest({ ...tag(9, 1.9, 3_000), regionInference: { enabled: true, state, regionId: "room-a" } });
    for (let now = 3_000; now < 7_000; now += 16) {
      f.animation.update(now);
      const position = f.animation.getState("A")!;
      assert.equal(inDisplayArea(p(position.renderedX, position.renderedY), [roomB]), false);
    }
    f.filter.dispose();
  }
});

test("corridor animation cannot take a shortcut through an unassigned room at a bend", () => {
  const f = fixture();
  const otherRoom = [p(2, 2), p(6, 2), p(6, 6), p(2, 6)];
  const pair = (world: { x: number; y: number }) => ({ world, pixel: world });
  f.filter.configure([elbow, otherRoom], 2_000, DEFAULT_REGIONS_CONFIG.map.mapId, [
    { id: "corridor-bend", name: "Koridor", kind: "corridor", polygon: elbow.map(pair), roomCenter: null, color: "#fff", entrances: [] },
    { id: "room", name: "Oda", kind: "room", polygon: otherRoom.map(pair), roomCenter: pair(p(4, 4)), color: "#fff", entrances: [] },
  ]);
  assert.equal(segmentInDisplayArea(p(1, 5), p(5, 1), [elbow, otherRoom]), true);
  f.filter.ingest(tag(1, 5, 1_000), true);
  f.advance(2_000);
  f.filter.ingest(tag(5, 1, 2_000), true);
  assert.equal(f.animation.getState("A")!.transitionKind, "non-routable-region-relocation");
  for (let now = 2_000; now <= 4_000; now += 16) {
    f.animation.update(now);
    const position = f.animation.getState("A")!;
    assert.equal(inDisplayArea(p(position.renderedX, position.renderedY), [elbow]), true);
  }
  assert.deepEqual([f.animation.getState("A")!.renderedX, f.animation.getState("A")!.renderedY], [5, 1]);
  f.filter.dispose();
});

test("unassigned raw room coordinates do not produce a room label in the tag panel", () => {
  const pair = (world: { x: number; y: number }) => ({ world, pixel: world });
  const room: RegionDefinition = { id: "room-a", name: "Oda A", kind: "room", polygon: roomA.map(pair), roomCenter: pair(p(3, 3.5)), color: "#fff", entrances: [] };
  const hallway: RegionDefinition = { id: "corridor-main", name: "Koridor", kind: "corridor", polygon: corridor.map(pair), roomCenter: null, color: "#fff", entrances: [] };
  const config = { ...DEFAULT_REGIONS_CONFIG, regions: [room, hallway] };
  const point = p(3, 3.5);
  assert.equal(roomDecisionLabel(tag(point.x, point.y, 1_000), config), "Ölçülen · koridor");
  assert.equal(roomDecisionLabel({ ...tag(point.x, point.y, 1_000), regionInference: {
    enabled: true, state: "TRACKING_OUTSIDE", regionId: null, regionName: room.name,
  } }, config), "Ölçülen · koridor");
});

test("room-only maps cannot display an unassigned tag inside a room", () => {
  const f = fixture();
  const pair = (world: { x: number; y: number }) => ({ world, pixel: world });
  f.filter.configure([roomA], 2_000, DEFAULT_REGIONS_CONFIG.map.mapId, [
    { id: "room-a", name: "Oda A", kind: "room", polygon: roomA.map(pair), roomCenter: pair(p(3, 3.5)), color: "#fff", entrances: [] },
  ]);
  f.filter.ingest(tag(3, 3.5, 1_000));
  assert.equal(f.displays().A.visible, false);
  assert.equal(f.animation.getState("A"), undefined);
  f.filter.dispose();
});

test("revoking a room clears old room frames immediately even with animation disabled", () => {
  for (const enabled of [true, false]) {
    for (const state of ["TRACKING_OUTSIDE", "ENTRY_CANDIDATE", "LOCATION_LOST"]) {
      const f = roomPermissionFixture();
      f.animation.setConfig({ ...DEFAULT_POSITION_ANIMATION_CONFIG, enabled });
      f.filter.ingest({ ...tag(3, 3.5, 1_000), positionSource: "REGION_CENTER",
        regionInference: { enabled: true, state: "IN_REGION", regionId: "room-a" } });
      f.advance(2_000);
      const raw = { x: 3, y: 3.7, timestamp: new Date(1_000).toISOString() };
      f.filter.ingest({ ...tag(3, 3.5, 1_000), publishedAt: new Date(2_000).toISOString(),
        positionSource: "REGION_CENTER", rawPosition: raw,
        regionInference: { enabled: true, state, regionId: null, lastKnownRegionId: "room-a", candidateRegionId: "room-b" } });
      assert.equal(inDisplayArea(f.displays().A.position!, [corridor]), true);
      const position = f.animation.getState("A")!;
      assert.equal(inDisplayArea(p(position.renderedX, position.renderedY), [corridor]), true);
      assert.ok(position.samples.every(sample => inDisplayArea(sample, [corridor])));
      assert.equal(position.samples.at(-1)!.positionSource, "RAW");
      assert.equal(position.relocationSequence, 1);
      for (let now = 2_000; now < 9_000; now += 16) {
        f.animation.update(now);
        const frame = f.animation.getState("A")!;
        assert.equal(inDisplayArea(p(frame.renderedX, frame.renderedY), [corridor]), true);
      }
      assert.equal(f.animation.getState("A")!.stale, enabled);
      f.filter.dispose();
    }
  }
});

test("revoking an assignment cancels a pending room transition before it enters the room", () => {
  const f = roomPermissionFixture();
  f.filter.ingest(tag(3, 1, 1_000), true);
  f.advance(2_000);
  f.filter.ingest({ ...tag(3, 3.5, 2_000), positionSource: "REGION_CENTER",
    regionInference: { enabled: true, state: "INFERRED_IN_REGION", regionId: "room-a" } });
  assert.equal(f.animation.getState("A")!.transitionKind, "region-center-route");
  f.advance(2_100);
  f.filter.ingest({ ...tag(3, 1.2, 2_100), regionInference: { enabled: true, state: "TRACKING_OUTSIDE", regionId: null } }, true);
  assert.equal(f.animation.getState("A")!.transitionKind, null);
  for (let now = 2_100; now < 7_000; now += 16) {
    f.animation.update(now);
    const position = f.animation.getState("A")!;
    assert.equal(inDisplayArea(p(position.renderedX, position.renderedY), [corridor]), true);
  }
  f.filter.dispose();
});

test("a jump into a disconnected valid region updates the target without teleporting the marker", () => {
  const f = fixture();
  f.filter.configure([square, square.map(({ x, y }) => p(x + 20, y))], 2_000);
  f.filter.ingest(tag(5, 5, 1_000), true);
  f.filter.ingest(tag(25, 5, 2_000), true);
  assert.deepEqual(f.displays().A, { visible: true, position: p(25, 5) });
  assert.equal(f.animation.getState("A")?.renderedX, 5);
  assert.ok(f.animation.getState("A")?.samples.some((sample) => sample.x === 25));
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

test("newer synthetic decisions for one measurement do not add physical route samples", () => {
  const f = fixture();
  f.filter.ingest(tag(1, 1, 3_000));
  const initialSamples = f.animation.getState("A")!.samples.length;
  f.advance(10_000);
  f.filter.ingest({ ...tag(1, 1, 3_000), publishedAt: new Date(10_000).toISOString(),
    regionInference: { enabled: true, state: "INFERRED_IN_REGION", regionId: "room-06", measurementKind: "estimated" } });
  f.filter.ingest({ ...tag(1, 1, 3_000), publishedAt: new Date(11_000).toISOString(),
    regionInference: { enabled: true, state: "LOCATION_LOST", regionId: null, measurementKind: "uncertain" } });
  assert.equal(f.animation.getState("A")!.samples.length, initialSamples);
  assert.equal(f.animation.getState("A")!.stale, true);
  f.filter.dispose();
});

test("hidden tag stays in the list with visibility explanation and real activity", () => {
  const outside = { ...tag(15, 15, 1_000), motionLabel: "moving" as const };
  const html = renderToStaticMarkup(createElement(TagInformationPanelContent, {
    tags: [outside], selectedTag: outside, locationAddress: "Tanımlı alan dışında", now: 1_000,
    recentTagIds: [], locationDuration: "", onSelectTag: () => {}, onOpenHistory: () => {},
    mapTagDisplays: { A: { visible: false, reason: "outside" } },
  }));
  assert.match(html, /Alan dışında · haritada gizli/);
  assert.match(html, /HAREKETLİ/);
  assert.match(html, /role="option"/);
});

test("tag panel renders the accepted inferred Room 6 decision", () => {
  const inferred = { ...tag(8, -1, 3_000), publishedAt: new Date(6_000).toISOString(),
    positionSource: "REGION_CENTER" as const,
    regionInference: { enabled: true, state: "INFERRED_IN_REGION", regionId: "room-06", regionName: "Oda 6", measurementKind: "estimated" as const } };
  const html = renderToStaticMarkup(createElement(TagInformationPanelContent, {
    tags: [inferred], selectedTag: inferred, recentTagIds: [], locationAddress: "Oda 6 · Tahmin edilen", locationDuration: "Bu alanda 0 dk 3 sn",
    onSelectTag: () => {}, onOpenHistory: () => {},
  }));
  assert.match(html, /Oda 6 · Tahmin edilen/);
  assert.match(html, /KONUM ADRESİ/);
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

test("panel target and marker converge after a non-routable direct room transition", () => {
  const from = p(-1.013164, 2.285254);
  const to = p(2.507731, -1.552673);
  const box = (point: { x: number; y: number }) => [p(point.x - .45, point.y - .45), p(point.x + .45, point.y - .45), p(point.x + .45, point.y + .45), p(point.x - .45, point.y + .45)];
  const f = fixture();
  f.filter.configure([box(from), box(to)], 2_000);
  const measuredAt = 1_000;
  f.filter.ingest({ ...tag(from.x, from.y, measuredAt), publishedAt: new Date(1_100).toISOString(), positionSource: "REGION_CENTER",
    regionInference: { enabled: true, state: "INFERRED_IN_REGION", regionId: "room-03", regionName: "Oda 3" } });
  f.advance(2_000);
  f.filter.ingest({ ...tag(to.x, to.y, measuredAt), publishedAt: new Date(1_200).toISOString(), positionSource: "REGION_CENTER",
    regionInference: { enabled: true, state: "ROOM_TRANSITIONED", regionId: "room-05", regionName: "Oda 5" } });

  assert.deepEqual(f.displays().A.position, to); // panel/store projection already targets Oda 5
  assert.equal(f.animation.getState("A")?.transitionKind, "non-routable-region-relocation");
  assert.deepEqual([f.animation.getState("A")?.renderedX, f.animation.getState("A")?.renderedY], [from.x, from.y]);
  f.animation.update(2_400);
  assert.deepEqual([f.animation.getState("A")?.renderedX, f.animation.getState("A")?.renderedY], [to.x, to.y]);
  f.animation.update(2_800);
  assert.equal(f.animation.getState("A")?.transitionKind, null);
  assert.deepEqual([f.animation.getState("A")?.renderedX, f.animation.getState("A")?.renderedY], [to.x, to.y]);
  f.filter.dispose();
});
