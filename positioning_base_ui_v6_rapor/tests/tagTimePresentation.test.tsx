import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TagInformationPanelContent } from "../src/features/tracking/components/TagInformationPanel";
import { TagLastSeen } from "../src/features/tracking/components/TagLastSeen";
import { formatLocationDuration } from "../src/features/tracking/services/tagPanelState";
import { lastDataAgeLabel, lastObservedLocationLabel, tagLocationLabel } from "../src/features/tracking/services/tagPresencePresentation";
import { roomDecisionLabel } from "../src/features/tracking/services/roomDecisionLabel";
import type { TagPresenceState } from "../src/features/tracking/types/tagPresence.types";
import type { AreaExitReadStatus } from "../src/features/tracking/types/areaExit.types";
import type { TrackedTag } from "../src/features/tracking/types/tracking.types";

const exitedAt = "2026-11-02T22:29:41Z";
const receivedAt = Date.parse("2026-11-02T22:30:00Z");
const gateName = "Sağ koridor giriş / çıkış kapısı";
const expectedExit = `Yoğun Bakım alanından çıktı (${gateName}) · 03.11.2026 01:29:41`;
const tag: TrackedTag = { id: "T", name: "Pacemaker 1", mapId: "icu", x: 2, y: 3, timestamp: receivedAt,
  color: "#00a896", status: "offline" };
const presence: TagPresenceState = { tagCode: tag.id, revision: 1, raw: tag, lastRawMeasuredAt: receivedAt,
  lastRawReceivedAt: receivedAt, hiddenForNoData: true, hiddenSince: receivedAt + 60000,
  hasCurrentRoomAssignment: false, lastObservedLocation: { mapId: "icu", mapName: "Yoğun Bakım",
    floorLabel: null, regionId: null, regionName: "Koridor", kind: "corridor" } };
const exitStatus: AreaExitReadStatus = { tagCode: tag.id, publishedAt: "2026-11-02T22:30:05Z", exit: {
  tagCode: tag.id, mapId: "icu", areaName: "Yoğun Bakım", gateName, exitedAt,
  publishedAt: "2026-11-02T22:30:05Z", decisionId: "exit-1" } };

test("elapsed durations switch to days exactly at 24 hours and retain the remaining hours/minutes", () => {
  const start = 1000;
  for (const [seconds, expected] of [
    [-1, "0 dk 0 sn"], [0, "0 dk 0 sn"], [59, "0 dk 59 sn"], [3600, "1 sa 0 dk"],
    [86399, "23 sa 59 dk"], [86400, "1 gün 0 sa 0 dk"], [86460, "1 gün 0 sa 1 dk"],
    [172800, "2 gün 0 sa 0 dk"], [431820, "4 gün 23 sa 57 dk"],
  ] as const) {
    assert.equal(formatLocationDuration(start, start + seconds * 1000), expected);
  }
});

test("historical exits use the original exit date in Istanbul and leave presence/archive data unchanged", () => {
  const before = JSON.stringify({ presence, exitStatus });
  assert.equal(lastObservedLocationLabel(presence, exitStatus), expectedExit);
  assert.equal(lastDataAgeLabel(presence, receivedAt + 431820000), "4 gün 23 sa 57 dk önce");
  assert.equal(lastObservedLocationLabel(presence, exitStatus, false), "Yoğun Bakım · Koridor");
  assert.equal(lastObservedLocationLabel(presence, { ...exitStatus, exit: null }), "Yoğun Bakım · Koridor");
  assert.equal(JSON.stringify({ presence, exitStatus }), before);
});

test("live exit dates are UI-only and do not change the shared decision label or the engine output", () => {
  const liveTag: TrackedTag = { ...tag, regionInference: { enabled: true, state: "TRACKING_OUTSIDE", regionId: null,
    outsideArea: true, leftAreaAt: exitedAt, leftAreaGate: gateName } };
  const before = JSON.stringify(liveTag);
  const decisionText = roomDecisionLabel(liveTag);
  assert.equal(decisionText, `Alan alanından çıktı (${gateName}) · 01:29:41`);
  assert.equal(tagLocationLabel(liveTag), `Alan alanından çıktı (${gateName}) · 03.11.2026 01:29:41`);
  assert.equal(roomDecisionLabel(liveTag), decisionText);
  assert.equal(JSON.stringify(liveTag), before);
  assert.equal(tagLocationLabel(tag), roomDecisionLabel(tag));
  assert.equal(tagLocationLabel({ ...liveTag, mapId: null }), "Kat belirlenemedi");
});

test("missing or invalid exit timestamps keep the event readable without invalid dates or invented times", () => {
  for (const timestamp of [undefined, "", "invalid"]) {
    const liveTag: TrackedTag = { ...tag, regionInference: { enabled: true, state: "TRACKING_OUTSIDE", regionId: null,
      outsideArea: true, leftAreaAt: timestamp, leftAreaGate: null } };
    assert.equal(tagLocationLabel(liveTag), "Alan alanından çıktı");
  }
});

test("desktop/mobile quick list and selected details show dated exits, days, and omit the internal explanation", () => {
  const now = receivedAt + 431820000;
  for (const variant of ["desktop", "mobile"] as const) for (const hidden of [false, true]) {
    const state = { ...presence, hiddenForNoData: hidden };
    const html = renderToStaticMarkup(createElement(TagInformationPanelContent, {
      selectedTag: tag, locationAddress: "Belirsiz", locationDuration: "Bu alanda 1 dk", tags: [tag],
      recentTagIds: [], onSelectTag() {}, onOpenHistory() {}, onShowMap() {}, variant, now,
      presenceById: { T: state }, areaExitByTag: { T: exitStatus },
    }));
    const list = html.match(/<div class="tag-switcher-list"[^>]*>([\s\S]*?)<\/div>/)![1];
    const details = html.match(/<section class="tag-details"[^>]*>([\s\S]*?)<\/section>/)![1];
    assert.ok(list.includes(expectedExit), `${variant}: quick list exit date`);
    assert.ok(details.includes(expectedExit), `${variant}: selected exit date`);
    assert.match(list, /has-last-location/);
    assert.doesNotMatch(html, /Güncel veri ve geçerli oda kararı olmadığı için haritada gizli/);
    if (hidden) {
      assert.match(details, /4 gün 23 sa 57 dk önce/);
      assert.match(details, /Güvenilir değil/);
      assert.doesNotMatch(details, /Bu alanda/);
      if (variant === "mobile") assert.match(details, /disabled=""[^>]*>[\s\S]*?Haritada göster/);
    }
  }
  const html = renderToStaticMarkup(createElement(TagLastSeen, { presence, now }));
  assert.match(html, /4 gün 23 sa 57 dk önce/);
});
