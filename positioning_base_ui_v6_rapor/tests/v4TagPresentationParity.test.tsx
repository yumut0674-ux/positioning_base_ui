import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TagInformationPanelContent } from "../src/features/tracking/components/TagInformationPanel";
import { TagLastSeen } from "../src/features/tracking/components/TagLastSeen";
import { roomDecisionLabel } from "../src/features/tracking/services/roomDecisionLabel";
import type { TrackedTag, PositionMessage } from "../src/features/tracking/types/tracking.types";
import type { TagPresenceState } from "../src/features/tracking/types/tagPresence.types";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import type { MapCatalog } from "../src/server/maps/map.types";
import configJson from "../config/maps/necmettin-yogun-bakim/regions.json";
import catalogJson from "../config/maps/catalog.json";

const root = process.env.V4_REFERENCE_ROOT ?? path.resolve("../inceleme/v4-v5/kaynaklar/positioning_base_ui_v4");
const available = existsSync(path.join(root, "src/features/tracking/components/TagInformationPanel.tsx"));
const config = configJson as unknown as RegionsConfig;
const catalog = catalogJson as MapCatalog;
const now = Date.parse("2026-10-26T09:00:00Z");
// Ignore only the intentional v6 UI differences; all other v4 behavior must still match.
function normalizeUiChanges(html: string): string {
  return html.replace(/ has-last-location(?=")/g, "")
    .replace(/ · \d{2}\.\d{2}\.\d{4} (?=\d{2}:\d{2}:\d{2})/g, " · ")
    .replace('<p class="tag-hidden-explanation">Güncel veri ve geçerli oda kararı olmadığı için haritada gizli.</p>', "");
}
function referenceJsx(context: TestContext) {
  // Archived sources sit outside the active JSX configuration. Supply the classic runtime in this test process only.
  const host = globalThis as typeof globalThis & { React?: typeof React };
  const previous = host.React;
  host.React = React;
  context.after(() => { if (previous) host.React = previous; else Reflect.deleteProperty(host, "React"); });
}
const decision = (state: string, regionId: string | null, kind: "measured" | "estimated" | "uncertain" = "measured") => ({
  enabled: true, state, regionId, regionName: regionId ? "Oda 7" : null, measurementKind: kind,
});

test("all live tag presentations, including an already published exit, match v4 HTML on desktop/mobile", { skip: !available }, async context => {
  referenceJsx(context);
  const reference = await import(pathToFileURL(path.join(root, "src/features/tracking/components/TagInformationPanel.tsx")).href);
  const lastSeen = await import(pathToFileURL(path.join(root, "src/features/tracking/components/TagLastSeen.tsx")).href);
  const decisions: (PositionMessage["regionInference"] | undefined)[] = [
    undefined, decision("IN_REGION", "room-07"), decision("INFERRED_IN_REGION", "room-07", "estimated"),
    decision("ENTRY_CANDIDATE", null, "uncertain"), decision("TRACKING_OUTSIDE", null),
    decision("LOCATION_LOST", null, "uncertain"),
    { ...decision("TRACKING_OUTSIDE", null, "estimated"), outsideArea: true,
      leftAreaAt: new Date(now - 5000).toISOString(), leftAreaGate: "Ameliyathane giriş / çıkış kapısı" },
  ];
  for (const regionInference of decisions) {
    const raw: PositionMessage = { id: "T", mapId: config.map.mapId, x: 1.8, y: 10,
      timestamp: now - 1000, receivedAt: new Date(now - 1000).toISOString(), motionLabel: "moving" };
    const tag: TrackedTag = { ...raw, name: "Pacemaker 2", color: "#00a896", status: "active", regionInference, publishedAt: new Date(now).toISOString() };
    const presence: TagPresenceState = { tagCode: "T", revision: 1, raw, processed: tag, lastRawMeasuredAt: raw.timestamp,
      lastRawReceivedAt: raw.timestamp, lastObservedLocation: { mapId: raw.mapId!, mapName: "Yoğun Bakım", floorLabel: null,
        regionId: null, regionName: "Koridor", kind: "corridor" }, hasCurrentRoomAssignment: !!regionInference?.regionId, hiddenForNoData: false, hiddenSince: null };
    for (const variant of ["desktop", "mobile"] as const) {
      const props = { tags: [tag], selectedTag: tag, locationAddress: roomDecisionLabel(tag, config, now),
        locationDuration: "1 dk", recentTagIds: [], onSelectTag() {}, onOpenHistory() {}, onShowMap() {},
        variant, catalog, regionsConfig: config, presenceById: { T: presence }, now };
      assert.equal(normalizeUiChanges(renderToStaticMarkup(createElement(TagInformationPanelContent, props))),
        normalizeUiChanges(renderToStaticMarkup(createElement(reference.TagInformationPanelContent, props))), `${variant}: ${regionInference?.state ?? "raw"}`);
    }
    assert.equal(normalizeUiChanges(renderToStaticMarkup(createElement(TagLastSeen, { presence, now }))),
      normalizeUiChanges(renderToStaticMarkup(createElement(lastSeen.TagLastSeen, { presence, now }))));
  }
});

test("passive tags with no recorded exit preserve v4 last-location text, badges and map controls", { skip: !available }, async context => {
  referenceJsx(context);
  const reference = await import(pathToFileURL(path.join(root, "src/features/tracking/components/TagInformationPanel.tsx")).href);
  const lastSeen = await import(pathToFileURL(path.join(root, "src/features/tracking/components/TagLastSeen.tsx")).href);
  for (const elapsed of [20000, 90000]) for (const regionName of [null, "Koridor", "Oda 7"]) {
    const raw: PositionMessage = { id: "T", mapId: config.map.mapId, x: 1.8, y: 10,
      timestamp: now - elapsed, receivedAt: new Date(now - elapsed).toISOString() };
    const tag: TrackedTag = { ...raw, name: "Pacemaker 2", color: "#00a896", status: "offline" };
    const presence: TagPresenceState = { tagCode: "T", revision: 1, raw, lastRawMeasuredAt: raw.timestamp, lastRawReceivedAt: raw.timestamp,
      lastObservedLocation: { mapId: raw.mapId!, mapName: "Yoğun Bakım", floorLabel: null, regionId: regionName === "Oda 7" ? "room-07" : null,
        regionName, kind: regionName === "Oda 7" ? "room" : regionName ? "corridor" : "unknown" },
      hasCurrentRoomAssignment: false, hiddenForNoData: elapsed > 60000, hiddenSince: elapsed > 60000 ? now - 30000 : null };
    for (const variant of ["desktop", "mobile"] as const) {
      const props = { tags: [tag], selectedTag: tag, locationAddress: roomDecisionLabel(tag, config, now), locationDuration: "1 dk",
        recentTagIds: [], onSelectTag() {}, onOpenHistory() {}, onShowMap() {}, variant, catalog, regionsConfig: config,
        presenceById: { T: presence }, areaExitByTag: { T: { tagCode: "T", publishedAt: null, exit: null } }, now };
      assert.equal(normalizeUiChanges(renderToStaticMarkup(createElement(TagInformationPanelContent, props))),
        normalizeUiChanges(renderToStaticMarkup(createElement(reference.TagInformationPanelContent, props))), `${variant}: ${elapsed} ms / ${regionName}`);
    }
    assert.equal(renderToStaticMarkup(createElement(TagLastSeen, { presence, now })),
      renderToStaticMarkup(createElement(lastSeen.TagLastSeen, { presence, now })));
  }
});
