import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tagActivityPresentation, PASSIVE_TAG_COLOR } from "../src/features/tracking/services/tagActivityPresentation";
import { buildTagQuickList } from "../src/features/tracking/services/tagQuickList";
import { TagInformationPanelContent } from "../src/features/tracking/components/TagInformationPanel";
import { SseTrackingGateway } from "../src/features/tracking/services/TrackingGateway";
import { presencePosition } from "../src/server/tracking/tagPresenceRuntime";
import { TagPresenceService } from "../src/server/tracking/TagPresenceService";
import { useIpsStore } from "../src/app/store/useIpsStore";
import { TAG_LIVE_TIMEOUT_MS, type PositionMessage, type TrackedTag } from "../src/features/tracking/types/tracking.types";

const now = Date.parse("2026-10-15T12:00:00.000Z");
const tag = (overrides: Partial<TrackedTag> = {}): TrackedTag => ({
  id: "T", name: "Sedye", color: "#00a896", status: "active", x: 2, y: 3, timestamp: now, mapId: "map-a", ...overrides,
});
const room = { enabled: true, state: "IN_REGION", regionId: "room-a", measurementKind: "measured" as const };

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
