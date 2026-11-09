import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TagInformationPanel, TagInformationPanelContent } from "../src/features/tracking/components/TagInformationPanel";
import { useIpsStore } from "../src/app/store/useIpsStore";
import { roomDecisionLabel } from "../src/features/tracking/services/roomDecisionLabel";
import type { TrackedTag } from "../src/features/tracking/types/tracking.types";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import serviceConfigJson from "../config/maps/necmettin-servis/regions.json";
import intensiveCareConfigJson from "../config/maps/necmettin-yogun-bakim/regions.json";
import { resolveLocation } from "../src/features/map/services/LocationResolverService";
import { MAP_FLOOR_PLAN } from "../src/features/map/config/mapConfig";
import { DEFAULT_REGIONS_CONFIG } from "../src/features/regions/config/defaultRegionsConfig";

const point = (x: number, y: number) => ({ pixel: { x, y }, world: { x, y } });
const regionsConfig = {
  ...DEFAULT_REGIONS_CONFIG,
  regions: [{
    id: "test-room",
    name: "Test Odası",
    color: "#00a896",
    polygon: [point(5, 14), point(14, 14), point(14, 21), point(5, 21)],
    roomCenter: point(9, 17),
    entrances: [],
  }],
};

function renderSelectedTag(x: number, y: number) {
  const tag = {
    id: "TAG-TEST",
    name: "Test Sedyesi",
    color: "#00a896",
    status: "active" as const,
    timestamp: Date.now(),
    x,
    y,
  };
  return renderToStaticMarkup(createElement(TagInformationPanelContent, {
    selectedTag: tag,
    locationAddress: resolveLocation(x, y, MAP_FLOOR_PLAN.id, regionsConfig),
    locationDuration: "Bu alanda 18 dk 42 sn",
    tags: [tag],
    recentTagIds: [tag.id],
    onSelectTag: () => {},
    onOpenHistory: () => {},
  }));
}

test("selected tracking-label panel presents a defined region instead of X/Y coordinates", () => {
  const html = renderSelectedTag(9, 17);

  assert.match(html, /KONUM ADRESİ/);
  assert.match(html, /Test Odası/);
  assert.match(html, /Konum adresi: Test Odası/);
  assert.match(html, /Takip Etiketleri/);
  assert.match(html, /Son görüntülenenler/i);
  assert.match(html, /Bu alanda 18 dk 42 sn/);
  assert.doesNotMatch(html, /Hareket kuyruğu|Kuyruk süresi/);
  assert.doesNotMatch(html, /X KONUMU|Y KONUMU|metre/);
  assert.doesNotMatch(html, /Son hareketlilik|SON 30 SN|Son hareket sinyali/);
});

test("selected tracking-label panel identifies a location outside configured areas", () => {
  const html = renderSelectedTag(0, 0);

  assert.match(html, /Tanımlı alan dışında/);
  assert.doesNotMatch(html, /X KONUMU|Y KONUMU|metre/);
});

test("mobile tracking-label panel includes the map reveal action without technical coordinates", () => {
  const tag = {
    id: "TAG-MOBILE",
    name: "Mobil Test Tag",
    color: "#00a896",
    status: "active" as const,
    timestamp: Date.now(),
    x: 9,
    y: 17,
  };
  const html = renderToStaticMarkup(createElement(TagInformationPanelContent, {
    selectedTag: tag,
    locationAddress: resolveLocation(tag.x, tag.y, MAP_FLOOR_PLAN.id, regionsConfig),
    locationDuration: "Bu alanda 2 dk 10 sn",
    tags: [tag],
    recentTagIds: [],
    onSelectTag: () => {},
    onOpenHistory: () => {},
    variant: "mobile",
    onShowMap: () => {},
  }));

  assert.match(html, /Haritada göster/);
  assert.match(html, /Rota geçmişini aç/);
  assert.doesNotMatch(html, /Tag hareket kuyruğunu aç veya kapat/);
  assert.doesNotMatch(html, /X KONUMU|Y KONUMU|metre/);
});

const serviceConfig = serviceConfigJson as unknown as RegionsConfig;
const intensiveCareConfig = intensiveCareConfigJson as unknown as RegionsConfig;
const configsByMapId = {
  [serviceConfig.map.mapId]: serviceConfig,
  [intensiveCareConfig.map.mapId]: intensiveCareConfig,
};

function exitedTag(id: string, mapId: string, now: number, roomId = "room-07"): TrackedTag {
  return {
    id, name: id, mapId, x: 0, y: 0, color: "#00a896", status: "active", timestamp: now,
    regionInference: {
      enabled: true, state: "TRACKING_OUTSIDE", regionId: null,
      exitedRegionId: roomId, exitedAt: new Date(now - 5_000).toISOString(), measurementKind: "measured",
    },
  };
}

test("desktop and mobile lists resolve each floor's room numbers independently of tag selection", () => {
  const now = Date.parse("2026-10-27T08:41:10Z");
  const serviceTag = exitedTag("SERVICE", serviceConfig.map.mapId, now);
  const serviceTag9 = exitedTag("SERVICE9", serviceConfig.map.mapId, now, "room-09");
  const intensiveTag = exitedTag("ICU", intensiveCareConfig.map.mapId, now);
  const tags = [serviceTag, serviceTag9, intensiveTag];
  for (const variant of ["desktop", "mobile"] as const) {
    for (const selectedTag of [undefined, serviceTag, intensiveTag]) {
      const html = renderToStaticMarkup(createElement(TagInformationPanelContent, {
        tags, selectedTag, variant, now, recentTagIds: [], locationDuration: "",
        regionsConfig: selectedTag ? configsByMapId[selectedTag.mapId!] : null,
        regionsConfigByMapId: configsByMapId, onSelectTag() {}, onOpenHistory() {},
      }));
      const rows = [...html.matchAll(/<button\b[^>]*role="option"[\s\S]*?<\/button>/g)].map(match => match[0]);
      assert.equal(rows.length, 3);
      for (const [id, roomName] of [["SERVICE", "206"], ["SERVICE9", "208"], ["ICU", "Oda 7"]]) {
        const row = rows.find(row => row.includes(`<code>${id}</code>`));
        assert.ok(row?.includes(`çıktığı oda: ${roomName} (11:41:05)`), `${variant}, selected ${selectedTag?.id}: ${id}`);
        assert.doesNotMatch(row!, /room-0[79]/);
      }
    }
  }
});

test("the connected panel supplies room lists even when no tag is selected", () => {
  // React's server renderer reads Zustand's initial snapshot rather than its live state.
  const initial = useIpsStore.getInitialState();
  const original = { ...initial };
  try {
    const tag = exitedTag("SERVICE", serviceConfig.map.mapId, Date.now());
    Object.assign(initial, {
      tags: { [tag.id]: tag }, observedTags: {}, tagDefinitions: {}, tagPresenceById: {}, areaExitByTag: {},
      selectedTagId: null, recentTagIds: [], regionsConfigByMapId: configsByMapId,
    });
    const html = renderToStaticMarkup(createElement(TagInformationPanel, { onOpenHistory() {} }));
    assert.match(html, /çıktığı oda: 206/);
    assert.doesNotMatch(html, /room-07/);
  } finally { Object.assign(initial, original); }
});

test("room labels reject another floor's config and expire recent exits using the supplied clock", () => {
  const now = Date.parse("2026-10-27T08:41:10Z");
  const tag = exitedTag("SERVICE", serviceConfig.map.mapId, now);
  assert.doesNotMatch(roomDecisionLabel(tag, intensiveCareConfig, now), /Oda 7/);
  assert.match(roomDecisionLabel(tag, serviceConfig, now), /çıktığı oda: 206/);
  const html = renderToStaticMarkup(createElement(TagInformationPanelContent, {
    tags: [tag], now: now + 60_001, recentTagIds: [], locationDuration: "",
    regionsConfigByMapId: configsByMapId, onSelectTag() {}, onOpenHistory() {},
  }));
  assert.match(html, /Ölçülen · koridor/);
  assert.doesNotMatch(html, /çıktığı oda/);
});
