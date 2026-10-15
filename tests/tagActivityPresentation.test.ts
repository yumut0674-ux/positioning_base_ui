import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tagActivityPresentation, PASSIVE_TAG_COLOR } from "../src/features/tracking/services/tagActivityPresentation";
import { buildTagQuickList, withLatestTagObservation } from "../src/features/tracking/services/tagQuickList";
import { mapTrackingTags } from "../src/features/tracking/services/mapTrackingTags";
import { TagInformationPanelContent } from "../src/features/tracking/components/TagInformationPanel";
import { SseTrackingGateway } from "../src/features/tracking/services/TrackingGateway";
import { installGlobalTagPresenceRuntime, presencePosition, TagPresenceRuntime } from "../src/server/tracking/tagPresenceRuntime";
import { TagPresenceService } from "../src/server/tracking/TagPresenceService";
import { useIpsStore } from "../src/app/store/useIpsStore";
import { TAG_LIVE_TIMEOUT_MS, type PositionMessage, type TrackedTag } from "../src/features/tracking/types/tracking.types";
import type { TrackingPosition } from "../src/server/trackingBuffer";

const now = Date.parse("2026-10-15T12:00:00.000Z");
const tag = (overrides: Partial<TrackedTag> = {}): TrackedTag => ({
  id: "T", name: "Sedye", color: "#00a896", status: "active", x: 2, y: 3, timestamp: now, mapId: "map-a", ...overrides,
});
const room = { enabled: true, state: "IN_REGION", regionId: "room-a", measurementKind: "measured" as const };

test("presence hot reload updates motion conversion without losing observations or subscribers", async () => {
  const host = process as NodeJS.Process & { __uwbTagPresenceRuntime?: TagPresenceRuntime };
  const original = host.__uwbTagPresenceRuntime;
  const runtime = new TagPresenceRuntime();
  const service = runtime.service, epoch = service.epoch;
  const at = Date.now() - 2000;
  const position: TrackingPosition = { tagCode: "PRESENCE-MOTION-HMR", x: 2, y: 3, mapId: null,
    timestamp: new Date(at).toISOString(), motionLabel: "stationary" };
  let events = 0;
  const unsubscribe = service.subscribe(() => events++);
  try {
    const legacy = Object.create(TagPresenceRuntime.prototype) as TagPresenceRuntime;
    legacy.observeRaw = async value => {
      service.observeRaw({ id: value.tagCode, x: value.x, y: value.y, timestamp: Date.parse(value.timestamp), mapId: value.mapId },
        { mapId: null, mapName: null, floorLabel: null, regionId: null, regionName: null, kind: "unknown" });
    };
    Object.setPrototypeOf(runtime, legacy);
    await runtime.observeRaw(position);
    assert.equal(service.get(position.tagCode)!.raw.motionLabel, undefined);
    host.__uwbTagPresenceRuntime = runtime;
    assert.equal(installGlobalTagPresenceRuntime(), runtime);
    await runtime.observeRaw({ ...position, timestamp: new Date(at + 1000).toISOString() });
    assert.equal(runtime.service, service); assert.equal(service.epoch, epoch);
    assert.equal(service.get(position.tagCode)!.raw.motionLabel, "stationary");
    assert.equal(events, 2);
  } finally { unsubscribe(); host.__uwbTagPresenceRuntime = original; }
});

test("fresh measurements label moving as Hareketli and every other motion as Sabit", () => {
  for (const motionLabel of ["moving", "stationary", "unknown", undefined] as const) {
    const presentation = tagActivityPresentation(tag({ motionLabel }), undefined, now);
    assert.equal(presentation.label, motionLabel === "moving" ? "Hareketli" : "Sabit");
    assert.equal(presentation.isLiveColor, motionLabel === "moving");
    assert.equal(presentation.color, motionLabel === "moving" ? "#00a896" : PASSIVE_TAG_COLOR);
  }
});

test("raw data timeout makes a tag Pasif even if its last motion was moving", () => {
  const moving = tag({ motionLabel: "moving" });
  assert.equal(tagActivityPresentation(moving, undefined, now + TAG_LIVE_TIMEOUT_MS).label, "Hareketli");
  const stale = tagActivityPresentation(moving, undefined, now + TAG_LIVE_TIMEOUT_MS + 1);
  assert.equal(stale.label, "Pasif");
  assert.equal(stale.isLiveColor, false);
  assert.equal(tagActivityPresentation(tag({ timestamp: 0 }), undefined, now).label, "Pasif");
  assert.equal(tagActivityPresentation(undefined, undefined, now).label, "Pasif");
  const heartbeat = tag({ timestamp: now + 60_000, publishedAt: new Date(now + 60_000).toISOString(), lastRawDataTimestamp: new Date(now).toISOString() });
  assert.equal(tagActivityPresentation(heartbeat, undefined, now + 60_000).label, "Pasif");
});

test("confirmed room decisions keep the live color independently of motion and raw data freshness", () => {
  for (const state of ["IN_REGION", "INFERRED_IN_REGION", "EXIT_CANDIDATE", "ROOM_TRANSITIONED"]) {
    const assigned = tag({ motionLabel: "stationary", regionInference: { ...room, state, uncertainAfter: new Date(now + 60_000).toISOString() } });
    assert.equal(tagActivityPresentation(assigned, undefined, now).label, "Sabit");
    assert.equal(tagActivityPresentation(assigned, undefined, now).isLiveColor, true);
    assert.equal(tagActivityPresentation(assigned, undefined, now + 30_000).label, "Pasif");
    assert.equal(tagActivityPresentation(assigned, undefined, now + 30_000).isLiveColor, true);
    assert.equal(tagActivityPresentation(assigned, undefined, now + 60_000).isLiveColor, false);
  }
  for (const state of ["ENTRY_CANDIDATE", "LOCATION_LOST", "TRACKING_OUTSIDE"]) {
    assert.equal(tagActivityPresentation(tag({ regionInference: { ...room, state } }), undefined, now).isLiveColor, false);
  }
});

test("motion survives presence conversion, snapshot hydration and browser SSE delivery", () => {
  const position = presencePosition({ tagCode: "T", x: 2, y: 3, timestamp: new Date(now).toISOString(), motionLabel: "moving" });
  assert.equal(position.motionLabel, "moving");
  const presenceService = new TagPresenceService(() => now);
  presenceService.observeRaw(position, { mapId: null, mapName: null, floorLabel: null, regionId: null, regionName: null, kind: "unknown" });
  const original = useIpsStore.getState();
  const originalEventSource = globalThis.EventSource;
  let listener: EventListener | undefined;
  let closed = false;
  globalThis.EventSource = class {
    addEventListener(_name: string, handler: EventListener) { listener = handler; }
    close() { closed = true; }
  } as unknown as typeof EventSource;
  try {
    useIpsStore.setState({ tags: {}, observedTags: {}, tagPresenceById: {}, selectedTagId: null });
    useIpsStore.getState().applyTagPresenceSnapshot(presenceService.snapshot());
    assert.equal(useIpsStore.getState().tags.T.motionLabel, "moving");
    assert.equal(useIpsStore.getState().observedTags.T.motionLabel, "moving");
    let received: PositionMessage | undefined;
    const disconnect = new SseTrackingGateway().connect(position => { received = position; });
    listener!(new MessageEvent("position", { data: JSON.stringify({ tagCode: "T", x: 2, y: 3, timestamp: new Date(now).toISOString(), motionLabel: "stationary" }) }));
    assert.equal(received?.motionLabel, "stationary");
    disconnect();
    assert.equal(closed, true);
  } finally {
    globalThis.EventSource = originalEventSource;
    useIpsStore.setState(original, true);
  }
});

test("latest raw motion takes precedence over an older processed decision", () => {
  const raw = tag({ motionLabel: "stationary" });
  const processed = tag({ motionLabel: "moving", timestamp: now - 1_000, regionInference: room });
  const list = buildTagQuickList({}, { T: processed }, { T: raw });
  assert.equal(list[0].motionLabel, "stationary");
  assert.equal(list[0].regionInference, room);
  const service = new TagPresenceService(() => now);
  service.observeRaw(raw, { mapId: null, mapName: null, floorLabel: null, regionId: null, regionName: null, kind: "unknown" });
  assert.equal(tagActivityPresentation(processed, service.get("T"), now).label, "Sabit");
});

test("successive stationary packets refresh room-tag data without changing its decision or centre", () => {
  const decision = { ...room, validUntil: new Date(now + 3000).toISOString(), uncertainAfter: new Date(now + 60_000).toISOString() };
  const processed = tag({ timestamp: now - 1000, motionLabel: "moving", status: "offline", pdop: 10,
    positionSource: "REGION_CENTER", publishedAt: new Date(now - 500).toISOString(), regionInference: decision });
  const tracked = { T: processed };
  for (const offset of [0, 10000, 20000]) {
    const raw = tag({ timestamp: now + offset, receivedAt: new Date(now + offset).toISOString(),
      x: 4 + offset / 10000, y: 8, pdop: 2 + offset / 10000, motionLabel: "stationary" });
    for (const view of [mapTrackingTags(tracked, { T: raw }, true).T, buildTagQuickList({}, tracked, { T: raw })[0]]) {
      assert.equal(view.timestamp, raw.timestamp);
      assert.equal(view.lastRawDataTimestamp, new Date(raw.timestamp).toISOString());
      assert.equal(view.receivedAt, raw.receivedAt);
      assert.equal(view.motionLabel, "stationary"); assert.equal(view.status, "active");
      assert.equal(view.pdop, raw.pdop);
      assert.deepEqual([view.rawPosition?.x, view.rawPosition?.y], [raw.x, raw.y]);
      assert.deepEqual([view.x, view.y], [processed.x, processed.y]);
      assert.equal(view.regionInference, decision);
      assert.equal(tagActivityPresentation(view, undefined, raw.timestamp).label, "Sabit");
    }
  }
  assert.equal(tracked.T, processed); assert.equal(processed.timestamp, now - 1000);
});

test("stationary corridor data uses the newest coordinates and ignores delayed raw observations", () => {
  const processed = tag({ timestamp: now - 1000, x: 1, y: 1, status: "offline", pdop: 9,
    regionInference: { enabled: true, state: "TRACKING_OUTSIDE", regionId: null } });
  const raw = tag({ timestamp: now, x: 4, y: 5, pdop: 2, motionLabel: "stationary" });
  const view = withLatestTagObservation(processed, raw);
  assert.deepEqual([view.x, view.y], [4, 5]);
  assert.equal(view.timestamp, now); assert.equal(view.pdop, 2); assert.equal(view.status, "active");
  assert.equal(withLatestTagObservation(view, { ...raw, timestamp: now - 1, x: 99 }), view);
});

test("quick list includes all registered and discovered tags without adding fake map positions", () => {
  const original = useIpsStore.getState();
  try {
    useIpsStore.setState({
      tags: { T: tag({ name: "Eski isim" }) },
      observedTags: { U: tag({ id: "U", name: "Kayitsiz", timestamp: 1 }) },
      tagDefinitions: {
        T: { id: "T", displayName: "Kayitli", status: "active" },
        N: { id: "N", displayName: "Verisiz", status: "active" },
        P: { id: "P", displayName: "Devre disi", status: "inactive" },
      },
      tagPresenceById: {}, selectedTagId: "N", recentTagIds: [],
    });
    const state = useIpsStore.getState();
    const tags = buildTagQuickList(state.tagDefinitions, state.tags, state.observedTags);
    const render = () => renderToStaticMarkup(createElement(TagInformationPanelContent, {
      tags, selectedTag: tags.find(tag => tag.id === useIpsStore.getState().selectedTagId),
      locationAddress: "Henüz konum verisi alınmadı", locationDuration: "Henüz veri alınmadı",
      recentTagIds: [], onSelectTag: state.selectTag, onOpenHistory() {}, now,
    }));
    const html = render();
    for (const name of ["Kayitli", "Kayitsiz", "Verisiz", "Devre disi"]) assert.ok(html.includes(name));
    assert.equal((html.match(/role="option"/g) ?? []).length, 4);
    assert.match(html, /Henüz konum verisi alınmadı/);
    assert.deepEqual(Object.keys(useIpsStore.getState().tags), ["T"]);
    useIpsStore.getState().selectTag("N");
    assert.equal(useIpsStore.getState().selectedTagId, null);
    assert.match(render(), /Bir takip etiketi seçin/);
    useIpsStore.getState().selectTag("N");
    assert.equal(useIpsStore.getState().selectedTagId, "N");
    useIpsStore.getState().selectTagAndFocus("N");
    assert.equal(useIpsStore.getState().selectedTagId, null);
    assert.equal(useIpsStore.getState().pendingTagFocusId, null);
  } finally { useIpsStore.setState(original, true); }
});

test("quick rows and selected details display the same motion labels and room color", () => {
  for (const [current, label, active] of [
    [tag({ motionLabel: "moving" }), "HAREKETLİ", true],
    [tag({ motionLabel: "stationary" }), "SABİT", false],
    [tag({ motionLabel: "unknown", regionInference: room }), "SABİT", true],
    [tag({ timestamp: 1, motionLabel: "moving" }), "PASİF", false],
  ] as const) {
    const html = renderToStaticMarkup(createElement(TagInformationPanelContent, {
      selectedTag: current, tags: [current], recentTagIds: [], now,
      locationAddress: "Oda", locationDuration: "1 dk", onSelectTag() {}, onOpenHistory() {},
    }));
    assert.ok(html.includes(label));
    assert.ok(html.includes(`class="live-pill${active ? " is-active" : ""}"`));
    assert.ok(html.includes(`class="tag-switcher-status${active ? " is-active" : ""}"`));
    assert.doesNotMatch(html, /CANLI/);
  }
});
