import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fixture from "./fixtures/pacemaker2-exit-20261023.json";
import savedConfig from "../config/maps/necmettin-yogun-bakim/regions.json";
import savedCatalog from "../config/maps/catalog.json";
import { useIpsStore } from "../src/app/store/useIpsStore";
import { TagPresenceService } from "../src/server/tracking/TagPresenceService";
import { presencePosition } from "../src/server/tracking/tagPresenceRuntime";
import { resolveLastObservedLocation } from "../src/server/tracking/lastObservedLocation";
import { TagInformationPanelContent } from "../src/features/tracking/components/TagInformationPanel";
import { buildTagQuickList } from "../src/features/tracking/services/tagQuickList";
import { roomDecisionLabel } from "../src/features/tracking/services/roomDecisionLabel";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import type { MapCatalog } from "../src/server/maps/map.types";
import type { ProcessedPosition } from "../src/server/regionEngine/types";
import type { PersistedTagObservation } from "../src/features/tracking/types/tagPresence.types";

import { AreaExitReader } from "../src/server/tracking/areaExitReader";

// These six observations/decisions are copied from the source workbook, not calculated here.
const config = savedConfig as unknown as RegionsConfig;
const catalog = savedCatalog as MapCatalog;
const map = catalog.maps.find(item => item.id === config.map.mapId)!;
const expectedExit = "Yoğun Bakım alanından çıktı (Ameliyathane giriş / çıkış kapısı) · 23.10.2026 18:50:46";
const lastRecord = fixture.records.at(-1)!;
const lastMeasuredAt = Date.parse(lastRecord.raw.timestamp);

test("Pacemaker 2: replay actual 18:50 workbook records through the store and desktop/mobile components", async context => {
  const originalStore = useIpsStore.getState();
  const untouchedRecords = JSON.stringify(fixture.records);
  context.after(() => {
    useIpsStore.setState(originalStore, true);
    assert.equal(JSON.stringify(fixture.records), untouchedRecords, "Replay must not mutate recorded engine outputs");
  });
  useIpsStore.setState({ tags: {}, observedTags: {}, tagPresenceById: {}, tagLocationEntries: {},
    selectedTagId: null, followSelectedTagMap: false,
    tagDefinitions: { [fixture.tagCode]: { id: fixture.tagCode, displayName: fixture.tagName, status: "active" } },
    regionsConfig: config, regionsConfigByMapId: { [map.id]: config } });

  let now = Date.parse(fixture.records[0].decision.publishedAt);
  const service = new TagPresenceService(() => now);
  service.setEngineEnabled(true);
  service.configureMap(map.id, new Set(config.regions.filter(region => region.kind !== "corridor").map(region => region.id)));

  let archived = fixture.records[0].decision as ProcessedPosition;
  const reader = new AreaExitReader(async () => [{ tag_code: fixture.tagCode, payload: JSON.stringify(archived) }], () => []);

  function ingest(index: number) {
    const record = fixture.records[index];
    archived = record.decision as ProcessedPosition;
    now = Date.parse(record.decision.publishedAt);
    const raw = presencePosition(record.raw);
    assert.equal(service.observeRaw(raw, resolveLastObservedLocation(raw, map, config)), true);
    service.observeDecision(presencePosition(record.decision as ProcessedPosition));
  }

  async function renderBoth(current: TagPresenceService, options: { outside: boolean; hidden: boolean; passive?: boolean; corridor?: boolean }) {
    useIpsStore.getState().applyAreaExitSnapshot(await reader.read([fixture.tagCode], new Date(now).toISOString()));
    useIpsStore.getState().applyTagPresenceSnapshot(current.snapshot());
    const state = useIpsStore.getState();
    const tags = buildTagQuickList(state.tagDefinitions, state.tags, state.observedTags);
    const selected = tags.find(tag => tag.id === fixture.tagCode)!;
    const presence = state.tagPresenceById[fixture.tagCode];
    assert.equal(presence.hiddenForNoData, options.hidden);
    for (const variant of ["desktop", "mobile"] as const) {
      const html = renderToStaticMarkup(createElement(TagInformationPanelContent, {
        tags, selectedTag: selected, recentTagIds: [], onSelectTag() {}, onOpenHistory() {}, onShowMap() {},
        regionsConfig: config, catalog, presenceById: state.tagPresenceById, areaExitByTag: state.areaExitByTag, now,
        variant, locationAddress: roomDecisionLabel(selected, config, now), locationDuration: "",
      }));
      const list = html.match(/<div class="tag-switcher-list"[^>]*>([\s\S]*?)<\/div>/)?.[1];
      const details = html.match(/<section class="tag-details"[^>]*>([\s\S]*?)<\/section>/)?.[1];
      assert.ok(list, `${variant}: list must render`);
      assert.ok(details, `${variant}: selected tag details must render`);
      assert.match(list, /Pacemaker 2/);
      if (options.outside) {
        assert.ok(list.includes(expectedExit), `${variant}: list must preserve gate and original exit time`);
        assert.ok(details.includes(expectedExit), `${variant}: details must preserve the same exit`);
        assert.doesNotMatch(list + details, /Oda belirlenemedi|Henüz veri alınmadı/);
      } else {
        assert.doesNotMatch(list + details, /alanından çıktı/);
        if (options.corridor !== false) assert.match(list, /Ölçülen · koridor/);
      }
      if (options.passive) assert.match(list, /PASİF/);
      if (options.hidden) {
        assert.match(list, /Güvenilir değil/);
        assert.doesNotMatch(details, /Güncel veri ve geçerli oda kararı olmadığı için haritada gizli/);
        if (variant === "mobile") assert.match(details, /disabled=""[^>]*>[\s\S]*?Haritada göster/);
      }
    }
  }

  await context.test("18:50:45 — before the exit, the interface still shows corridor", async () => {
    ingest(0); ingest(1);
    await renderBoth(service, { outside: false, hidden: false });
  });
  await context.test("18:50:46.305 — first recorded exit appears with gate and correct clock", async () => {
    ingest(2);
    assert.equal(service.get(fixture.tagCode)!.processed!.regionInference!.leftAreaAt, "2026-10-23T15:50:46.305Z");
    await renderBoth(service, { outside: true, hidden: false });
  });
  await context.test("18:50:50.301 — later measurements retain the original 18:50:46 exit time", async () => {
    ingest(3); ingest(4); ingest(5);
    await renderBoth(service, { outside: true, hidden: false });
  });

  const { tagCode, raw, lastRawMeasuredAt, lastRawReceivedAt, lastObservedLocation } = service.get(fixture.tagCode)!;
  const persisted: PersistedTagObservation = JSON.parse(JSON.stringify({ tagCode, raw, lastRawMeasuredAt, lastRawReceivedAt, lastObservedLocation }));
  assert.equal(persisted.raw.x, lastRecord.raw.x);
  assert.equal(persisted.raw.y, lastRecord.raw.y);

  await context.test("18:51:00 — passive status does not erase the exit", async () => {
    now = lastMeasuredAt + 10_001; service.tick();
    await renderBoth(service, { outside: true, hidden: false, passive: true });
  });
  await context.test("18:51:50 — no-data hiding does not replace the exit with unknown room", async () => {
    now = lastMeasuredAt + 60_001; service.tick();
    assert.equal(service.get(fixture.tagCode)!.lastRawMeasuredAt, lastMeasuredAt);
    await renderBoth(service, { outside: true, hidden: true, passive: true });
  });
  await context.test("restart while fresh preserves v4 display; archived exit is shown on the passive transition", async () => {
    now = lastMeasuredAt + 5_000;
    const restored = new TagPresenceService(() => now);
    restored.restore([persisted]);
    assert.equal(restored.get(fixture.tagCode)!.processed, undefined);
    await renderBoth(restored, { outside: false, hidden: false, corridor: false });
    now = lastMeasuredAt + 10001; restored.tick();
    await renderBoth(restored, { outside: true, hidden: false, passive: true });
  });
  await context.test("19:35 — restart after a long data gap still shows the recorded exit", async () => {
    now = Date.parse("2026-10-23T19:35:00+03:00");
    const restored = new TagPresenceService(() => now);
    restored.restore([persisted]);
    assert.equal(restored.get(fixture.tagCode)!.lastRawMeasuredAt, lastMeasuredAt);
    await renderBoth(restored, { outside: true, hidden: true, passive: true });
  });
  await context.test("legacy snapshot — reading the existing archived decision restores the same exit text", async () => {
    const restored = new TagPresenceService(() => now);
    restored.restore([persisted]);
    await renderBoth(restored, { outside: true, hidden: true, passive: true });
  });
});
