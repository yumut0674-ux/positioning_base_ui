import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TagPresenceService } from "../src/server/tracking/TagPresenceService";
import { useIpsStore } from "../src/app/store/useIpsStore";
import { MapDisplayFilter, type MapTagDisplay } from "../src/features/tracking/services/MapDisplayFilter";
import { bindMapDisplayTracking } from "../src/features/tracking/services/bindMapDisplayTracking";
import { PositionAnimationController } from "../src/features/tracking/services/PositionAnimationController";
import { DEFAULT_POSITION_ANIMATION_CONFIG } from "../src/features/tracking/config/positionAnimationConfig";
import { DEFAULT_REGIONS_CONFIG } from "../src/features/regions/config/defaultRegionsConfig";
import { TagInformationPanelContent } from "../src/features/tracking/components/TagInformationPanel";
import { TagLastSeen } from "../src/features/tracking/components/TagLastSeen";
import { AppSidebar } from "../src/app/components/AppSidebar";
import type { RegionsConfig } from "../src/features/regions/types/region.types";

function fixture() {
  const mapId = DEFAULT_REGIONS_CONFIG.map.mapId;
  let now = Date.now();
  const service = new TagPresenceService(() => now);
  const raw = { id: "T", x: 2, y: 2, timestamp: now, mapId };
  service.observeRaw(raw, { mapId, mapName: "1. Kat", floorLabel: "1. Kat", regionId: "A", regionName: "Oda 103", kind: "room" });
  const region = { id: "corridor", name: "Koridor", kind: "corridor" as const, color: "#ffffff", roomCenter: null, entrances: [],
    polygon: [[0, 0], [5, 0], [5, 5], [0, 5]].map(([x, y]) => ({ world: { x, y }, pixel: { x, y } })) };
  const config: RegionsConfig = { ...DEFAULT_REGIONS_CONFIG, regions: [region] };
  return { service, raw, config, advance: () => { now += 60_001; service.tick(); }, now: () => now };
}

test("presence versions reject delayed events; a new server epoch restores its own state", () => {
  const original = useIpsStore.getState();
  try {
    const f = fixture();
    useIpsStore.setState({ tags: {}, observedTags: {}, tagPresenceById: {}, tagLocationEntries: {}, selectedTagId: null });
    useIpsStore.getState().applyTagPresenceSnapshot(f.service.snapshot());
    const first = f.service.get("T")!;
    f.advance(); const hidden = f.service.get("T")!;
    useIpsStore.getState().applyTagPresenceUpdate({ epoch: f.service.epoch, serverNow: f.now(), state: hidden });
    useIpsStore.getState().applyTagPresenceUpdate({ epoch: f.service.epoch, serverNow: f.now(), state: first });
    assert.equal(useIpsStore.getState().tagPresenceById.T.hiddenForNoData, true);
    useIpsStore.getState().applyTagPresenceUpdate({ epoch: "another-server", serverNow: f.now(), state: first });
    assert.equal(useIpsStore.getState().tagPresenceById.T.hiddenForNoData, true);
    useIpsStore.getState().applyTagPresenceSnapshot({ ...f.service.snapshot(), epoch: "new-server", states: [{ ...hidden, revision: 1 }] });
    assert.equal(useIpsStore.getState().presenceEpoch, "new-server");
    assert.equal(useIpsStore.getState().tags.T.name, "T");
  } finally { useIpsStore.setState(original, true); }
});

test("both raw and processed display bindings hide tags, clear animation/trails and recover without an old path", () => {
  const original = useIpsStore.getState();
  try {
    for (const engineEnabled of [false, true]) {
      const f = fixture();
      useIpsStore.setState({ tags: {}, observedTags: {}, tagPresenceById: {}, tagLocationEntries: {}, selectedTagId: null,
        activeMapId: f.raw.mapId, regionsConfig: f.config, regionsConfigByMapId: { [f.raw.mapId]: f.config } });
      useIpsStore.getState().applyTagPresenceSnapshot(f.service.snapshot());
      if (engineEnabled) useIpsStore.setState(state => ({ tags: { T: { ...state.tags.T,
        regionInference: { enabled: true, state: "TRACKING_OUTSIDE", regionId: null } } } }));
      const animation = new PositionAnimationController(DEFAULT_POSITION_ANIMATION_CONFIG);
      let displays: Record<string, MapTagDisplay> = {};
      const filter = new MapDisplayFilter(animation, next => { displays = next; useIpsStore.setState({ mapTagDisplays: next }); });
      const unsubscribe = bindMapDisplayTracking(filter, engineEnabled);
      assert.equal(displays.T.visible, true);
      assert.ok(animation.getState("T"));
      f.advance();
      // Preserve a processed candidate; its later heartbeat cannot override the presence policy.
      useIpsStore.getState().applyTagPresenceUpdate({ epoch: f.service.epoch, serverNow: f.now(), state: f.service.get("T")! });
      assert.equal(displays.T?.visible ?? false, false);
      assert.equal(animation.getState("T"), undefined);
      assert.ok(useIpsStore.getState().tags.T);
      f.service.observeRaw({ ...f.raw, timestamp: f.now(), x: 3 }, f.service.get("T")!.lastObservedLocation);
      useIpsStore.getState().applyTagPresenceUpdate({ epoch: f.service.epoch, serverNow: f.now(), state: f.service.get("T")! });
      if (engineEnabled) useIpsStore.setState(state => ({ tags: { T: { ...state.tags.T,
        regionInference: { enabled: true, state: "TRACKING_OUTSIDE", regionId: null } } } }));
      assert.equal(displays.T.visible, true);
      assert.equal(animation.getState("T")?.samples.length, 1);
      unsubscribe(); filter.dispose();
    }
  } finally { useIpsStore.setState(original, true); }
});

test("stale tag stays selectable with historical place, unreliable badge and disabled map action on mobile", () => {
  const f = fixture(); f.advance();
  const presence = f.service.get("T")!;
  const tag = { ...f.raw, name: "Ekipman A", color: "#00a896", status: "offline" as const };
  const html = renderToStaticMarkup(createElement(TagInformationPanelContent, {
    selectedTag: tag, locationAddress: "Belirsiz", locationDuration: "Bu alanda 1 dk",
    tags: [tag], recentTagIds: [], onSelectTag: () => {}, onOpenHistory: () => {},
    variant: "mobile", onShowMap: () => {}, presenceById: { T: presence }, now: f.now(),
  }));
  assert.match(html, /1. Kat · Oda 103/);
  assert.match(html, /Güvenilir değil/);
  assert.match(html, /SON GÖRÜLDÜĞÜ YER/);
  assert.match(html, /Haritada gizli/);
  assert.match(html, /disabled=""[^>]*>[\s\S]*?Haritada göster/);
  assert.doesNotMatch(html, /BU ALANDA|Bu alanda/);
  const management = renderToStaticMarkup(createElement(TagLastSeen, { presence, now: f.now() }));
  assert.match(management, /1. Kat · Oda 103/);
  assert.match(management, /Güvenilir değil/);
  assert.match(renderToStaticMarkup(createElement(TagLastSeen, { now: f.now() })), /Henüz veri alınmadı/);
});

test("settings navigation exposes the admin panel and stays absent from demo navigation", () => {
  const props = { activeView: "settings" as const, collapsed: true, mobileOpen: false, onMobileClose: () => {}, onViewChange: () => {} };
  const admin = renderToStaticMarkup(createElement(AppSidebar, { ...props, mode: "admin" }));
  assert.match(admin, /class="active"[^>]*aria-label="Ayarlar"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(AppSidebar, { ...props, mode: "demo" })), /aria-label="Ayarlar"/);
});
