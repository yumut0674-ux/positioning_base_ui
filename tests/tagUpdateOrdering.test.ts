import assert from "node:assert/strict";
import test from "node:test";
import { useIpsStore } from "../src/app/store/useIpsStore";
import { roomDecisionLabel } from "../src/features/tracking/services/roomDecisionLabel";
import { shouldAcceptTagUpdate } from "../src/features/tracking/services/tagUpdateOrdering";
import { TAG_LIVE_TIMEOUT_MS, type TrackedTag } from "../src/features/tracking/types/tracking.types";

const measurementTime = Date.parse("2026-09-21T09:49:30.025Z");
const published = (offsetMs: number) => new Date(measurementTime + offsetMs).toISOString();

function tag(overrides: Partial<TrackedTag> = {}): TrackedTag {
  return {
    id: "TAG-006",
    name: "Tag 6",
    color: "#ffffff",
    status: "active",
    x: 12,
    y: 18,
    timestamp: measurementTime,
    mapId: "kat1-ortopedi",
    ...overrides,
  };
}

test("same measurement accepts only a strictly newer valid engine publication", () => {
  const raw = tag();
  const inferred = tag({
    publishedAt: published(3_000),
    positionSource: "REGION_CENTER",
    regionInference: { enabled: true, state: "INFERRED_IN_REGION", regionId: "room-06", regionName: "Oda 6", measurementKind: "estimated" },
  });
  assert.equal(shouldAcceptTagUpdate(raw, inferred), true);
  assert.equal(shouldAcceptTagUpdate(inferred, { ...inferred, publishedAt: published(3_000) }), false);
  assert.equal(shouldAcceptTagUpdate(inferred, { ...inferred, publishedAt: published(2_999) }), false);
  assert.equal(shouldAcceptTagUpdate(inferred, { ...inferred, publishedAt: "invalid" }), false);
  assert.equal(shouldAcceptTagUpdate(raw, { ...raw }), false);
  assert.equal(shouldAcceptTagUpdate(inferred, { ...inferred, timestamp: measurementTime - 1, publishedAt: published(9_000) }), false);
});

test("store shows inferred Room 6 and later LOCATION_LOST without changing measurement age", () => {
  const original = useIpsStore.getState();
  try {
    useIpsStore.setState({
      tags: {}, observedTags: {}, tagLocationEntries: {}, regionsConfigByMapId: {},
      activeMapId: "kat1-ortopedi", selectedTagId: "TAG-006",
    });
    const raw = tag();
    useIpsStore.getState().upsertTag(raw);
    const rawEntry = useIpsStore.getState().tagLocationEntries[raw.id];

    const inferred = tag({
      publishedAt: published(3_000),
      positionSource: "REGION_CENTER",
      regionInference: { enabled: true, state: "INFERRED_IN_REGION", regionId: "room-06", regionName: "Oda 6", measurementKind: "estimated" },
    });
    useIpsStore.getState().upsertTag(inferred);
    let stored = useIpsStore.getState().tags[raw.id];
    const inferredEntry = useIpsStore.getState().tagLocationEntries[raw.id];
    assert.equal(stored, inferred);
    assert.equal(stored.timestamp, measurementTime);
    assert.equal(roomDecisionLabel(stored), "Oda 6 · Tahmin edilen");
    assert.notEqual(inferredEntry, rawEntry);

    const inferredHeartbeat = { ...inferred, publishedAt: published(3_500) };
    useIpsStore.getState().upsertTag(inferredHeartbeat);
    assert.equal(useIpsStore.getState().tagLocationEntries[raw.id], inferredEntry);

    const lost = tag({
      publishedAt: published(4_000),
      regionInference: { enabled: true, state: "LOCATION_LOST", regionId: null, lastKnownRegionId: "room-06", measurementKind: "uncertain" },
    });
    useIpsStore.getState().upsertTag(lost);
    stored = useIpsStore.getState().tags[raw.id];
    assert.equal(stored, lost);
    assert.equal(stored.timestamp, measurementTime);
    assert.equal(roomDecisionLabel(stored), "Belirsiz · son bilinen konum");
    assert.notEqual(useIpsStore.getState().tagLocationEntries[raw.id], inferredEntry);

    useIpsStore.getState().upsertTag({ ...lost, publishedAt: published(3_999), x: 99 });
    assert.equal(useIpsStore.getState().tags[raw.id], lost);
    useIpsStore.getState().upsertTag({ ...lost, timestamp: measurementTime - 1, publishedAt: published(20_000), mapId: "old-floor" });
    assert.equal(useIpsStore.getState().tags[raw.id], lost);
    assert.equal(useIpsStore.getState().activeMapId, "kat1-ortopedi");

    useIpsStore.getState().refreshTagActivity(measurementTime + TAG_LIVE_TIMEOUT_MS + 1);
    assert.equal(useIpsStore.getState().tags[raw.id].status, "offline");
    assert.equal(useIpsStore.getState().tags[raw.id].timestamp, measurementTime);
  } finally {
    useIpsStore.setState(original, true);
  }
});
