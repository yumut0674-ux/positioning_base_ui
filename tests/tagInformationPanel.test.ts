import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TagInformationPanelContent } from "../src/features/tracking/components/TagInformationPanel";
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
  assert.doesNotMatch(html, /X KONUMU|Y KONUMU|metre/);
});
