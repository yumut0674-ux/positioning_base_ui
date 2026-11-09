import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/pacemaker2-exit-20261023.json";
import { TagPresenceService } from "../src/server/tracking/TagPresenceService";
import { presencePosition } from "../src/server/tracking/tagPresenceRuntime";
import { PassiveAreaExitLookup } from "../src/features/tracking/services/passiveAreaExitLookup";
import { lastObservedLocationLabel, visibleAreaExit } from "../src/features/tracking/services/tagPresencePresentation";
import { useIpsStore } from "../src/app/store/useIpsStore";
import type { ProcessedPosition } from "../src/server/regionEngine/types";

const recorded = fixture.records.at(-1)!;
const tag = fixture.tagCode;
const measuredAt = Date.parse(recorded.raw.timestamp);
const location = { mapId: recorded.raw.mapId, mapName: "Yoğun Bakım", floorLabel: null,
  regionId: null, regionName: null, kind: "unknown" as const };

test("Pacemaker's existing live exit is displayed after passive/no-data transitions without an archive request", () => {
  let now = Date.parse(recorded.decision.publishedAt);
  const service = new TagPresenceService(() => now);
  service.observeRaw(presencePosition(recorded.raw), location);
  service.observeDecision(presencePosition(recorded.decision as ProcessedPosition));
  const lookup = new PassiveAreaExitLookup();
  const raw = structuredClone(service.get(tag)!.raw);
  for (const elapsed of [0, 10_001, 60_001, 3600_000]) {
    now = measuredAt + elapsed;
    service.tick();
    const presence = service.get(tag)!;
    assert.deepEqual(lookup.select({ [tag]: presence }, now), []);
    assert.match(lastObservedLocationLabel(presence), /Yoğun Bakım alanından çıktı.*Ameliyathane.*18:50:46/);
    assert.deepEqual(presence.raw, raw);
    assert.equal(presence.lastRawMeasuredAt, measuredAt);
  }
  const state = service.get(tag)!;
  assert.equal(visibleAreaExit({ ...state, raw: { ...state.raw, mapId: null },
    processed: { ...state.processed!, mapId: null } }, undefined), undefined);
});

test("an old restored tag without a live decision requests history once on becoming passive, never every four seconds", () => {
  let now = measuredAt + 5000;
  const service = new TagPresenceService(() => now);
  service.restore([{ tagCode: tag, raw: presencePosition(recorded.raw), lastRawMeasuredAt: measuredAt,
    lastRawReceivedAt: Date.parse(recorded.raw.receivedAt), lastObservedLocation: location }]);
  const lookup = new PassiveAreaExitLookup();
  assert.deepEqual(lookup.select({ [tag]: service.get(tag)! }, now), []);
  now = measuredAt + 10001; service.tick();
  const requests = lookup.select({ [tag]: service.get(tag)! }, now);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].tagCode, tag);
  assert.equal(lookup.isCurrent(service.get(tag), requests[0], now), true);
  for (let i = 1; i <= 100; i++) {
    now += 4000; service.tick();
    assert.deepEqual(lookup.select({ [tag]: service.get(tag)! }, now), [], "remaining passive must not generate another request");
  }
  service.observeRaw({ ...presencePosition(recorded.raw), timestamp: now, receivedAt: new Date(now).toISOString() }, location);
  assert.deepEqual(lookup.select({ [tag]: service.get(tag)! }, now), []);
  assert.equal(lookup.isCurrent(service.get(tag), requests[0], now), false, "late archive reply must not replace fresh data");
  now += 10001; service.tick();
  assert.equal(lookup.select({ [tag]: service.get(tag)! }, now).length, 1, "a separate passive episode may request once again");
});

test("a cold start with an already passive tag requests once; a live exit arriving during that lookup makes the reply obsolete", () => {
  const now = measuredAt + 90000;
  const service = new TagPresenceService(() => now);
  service.observeRaw(presencePosition(recorded.raw), location);
  const lookup = new PassiveAreaExitLookup();
  const requests = lookup.select({ [tag]: service.get(tag)! }, now);
  assert.equal(requests.length, 1);
  service.observeDecision(presencePosition(recorded.decision as ProcessedPosition));
  assert.equal(lookup.isCurrent(service.get(tag), requests[0], now), false);
  assert.deepEqual(lookup.select({ [tag]: service.get(tag)! }, now), []);
  assert.ok(visibleAreaExit(service.get(tag), undefined));
});

test("a passive tag with a valid room assignment does not request exit history", () => {
  const now = measuredAt + 90000;
  const service = new TagPresenceService(() => now);
  service.setEngineEnabled(true); service.configureMap(location.mapId, new Set(["room-07"]));
  service.observeRaw(presencePosition(recorded.raw), location);
  service.observeDecision({ ...presencePosition(recorded.decision as ProcessedPosition), regionInference: {
    enabled: true, state: "INFERRED_IN_REGION", regionId: "room-07", uncertainAfter: new Date(now + 60000).toISOString(),
  } });
  assert.equal(service.get(tag)!.hasCurrentRoomAssignment, true);
  assert.deepEqual(new PassiveAreaExitLookup().select({ [tag]: service.get(tag)! }, now), []);
});

test("independent one-time replies merge by tag even when received out of order", () => {
  const original = useIpsStore.getState();
  try {
    useIpsStore.setState({ areaExitByTag: {}, areaExitReadAt: 0, areaExitReadAtByTag: {} });
    const before = useIpsStore.getState();
    before.applyAreaExitSnapshot({ serverNow: 2000, byTag: { B: { tagCode: "B", publishedAt: null, exit: null } } });
    before.applyAreaExitSnapshot({ serverNow: 1000, byTag: { A: { tagCode: "A", publishedAt: null, exit: null } } });
    assert.deepEqual(Object.keys(useIpsStore.getState().areaExitByTag).sort(), ["A", "B"]);
    before.applyAreaExitSnapshot({ serverNow: 999, byTag: { B: { tagCode: "B", publishedAt: "outdated", exit: null } } });
    assert.equal(useIpsStore.getState().areaExitByTag.B.publishedAt, null);
    for (const key of ["tags", "observedTags", "tagPresenceById", "mapTagDisplays", "tagLocationEntries"] as const)
      assert.equal(useIpsStore.getState()[key], before[key]);
  } finally { useIpsStore.setState(original, true); }
});
