import assert from "node:assert/strict";
import test from "node:test";
import catalogJson from "../config/maps/catalog.json";
import mapJson from "../config/maps/necmettin-servis/map.json";
import { mapCatalogSchema, mapDetailsSchema } from "../src/server/maps/map.validation";
import { groupMapCatalog, isSelectableMap, resolveInitialMapId, shouldShowLiveTracking } from "../src/features/map/services/mapSelection";
import { useIpsStore } from "../src/app/store/useIpsStore";
import type { TrackedTag } from "../src/features/tracking/types/tracking.types";
import type { TagPresenceState } from "../src/features/tracking/types/tagPresence.types";
import { DEFAULT_SYSTEM_SETTINGS } from "../src/features/settings/types/settings.types";

const catalog = mapCatalogSchema.parse(catalogJson);
const liveMap = mapDetailsSchema.parse(mapJson);

test("default selection survives empty or obsolete browser storage", () => {
  assert.equal(resolveInitialMapId(catalog, null), catalog.defaultMapId);
  assert.equal(resolveInitialMapId(catalog, "silinmis-harita"), catalog.defaultMapId);
  assert.equal(resolveInitialMapId(catalog, "kat1-ornek-birim"), catalog.defaultMapId);
  assert.equal(resolveInitialMapId(catalog, "kat1-ortopedi"), "necmettin-servis");
  assert.equal(resolveInitialMapId(catalog, "spor-koridor"), "necmettin-servis");
  assert.equal(resolveInitialMapId(catalog, "necmettin-servis"), "necmettin-servis");
  assert.equal(resolveInitialMapId(catalog, "necmettin-yogun-bakim"), "necmettin-yogun-bakim");
});

test("catalog groups floors and keeps planned units visible but disabled", () => {
  const groups = groupMapCatalog(catalog.maps);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].buildingId, "ana-bina");
  assert.deepEqual(groups[0].floors.map((floor) => floor.floorLabel), ["Servis", "Yoğun Bakım", "Kat 1", "Kat 2"]);
  const planned = catalog.maps.find((entry) => entry.id === "kat1-ornek-birim");
  assert.ok(planned);
  assert.equal(isSelectableMap(planned), false);
});

test("live coordinates are authorized only for the catalog live map", () => {
  assert.equal(shouldShowLiveTracking(catalog, liveMap), true);
  assert.equal(shouldShowLiveTracking(catalog, { ...liveMap, id: "kat2-onizleme", liveTrackingEnabled: false }), false);
  assert.equal(shouldShowLiveTracking(catalog, { ...liveMap, id: "kat2-onizleme", liveTrackingEnabled: true }), false);
});

test("quick tracking selection waits for the requested map before focusing", () => {
  const original = useIpsStore.getState();
  useIpsStore.setState({ activeMapId: "kat2-onizleme", readyMapId: "kat2-onizleme", pendingTagFocusId: null, selectedTagId: null, mapFocusRequest: 7, mapFocusScale: null });
  try {
    useIpsStore.getState().selectTagOnMap("TAG-007", catalog.liveTrackingMapId);
    let state = useIpsStore.getState();
    assert.equal(state.activeMapId, catalog.liveTrackingMapId);
    assert.equal(state.pendingTagFocusId, "TAG-007");
    assert.equal(state.mapFocusRequest, 7);
    assert.equal(state.mapFocusScale, 0.5);
    useIpsStore.getState().markMapReady(catalog.liveTrackingMapId);
    state = useIpsStore.getState();
    assert.equal(state.pendingTagFocusId, null);
    assert.equal(state.readyMapId, catalog.liveTrackingMapId);
    assert.equal(state.mapFocusRequest, 8);
  } finally {
    useIpsStore.setState({
      activeMapId: original.activeMapId,
      readyMapId: original.readyMapId,
      pendingTagFocusId: original.pendingTagFocusId,
      selectedTagId: original.selectedTagId,
      followSelectedTagMap: original.followSelectedTagMap,
      recentTagIds: original.recentTagIds,
      mapFocusRequest: original.mapFocusRequest,
      mapFocusScale: original.mapFocusScale,
    });
  }
});

const browseTag = (timestamp: number, mapId = "map-a", id = "SELECTED"): TrackedTag => ({
  id, name: id, x: timestamp, y: 2, timestamp, mapId, color: "#fff", status: "active",
});
const presenceRow = (tag: TrackedTag, revision: number): TagPresenceState => ({
  tagCode: tag.id, revision, raw: tag, lastRawMeasuredAt: tag.timestamp, lastRawReceivedAt: tag.timestamp,
  lastObservedLocation: { mapId: tag.mapId ?? null, mapName: null, floorLabel: null, regionId: null, regionName: null, kind: "unknown" },
  hasCurrentRoomAssignment: false, hiddenForNoData: false, hiddenSince: null,
});
function startMapBrowseScenario() {
  useIpsStore.setState({ tags: { SELECTED: browseTag(1_000) }, observedTags: {}, tagPresenceById: {},
    tagLocationEntries: {}, selectedTagId: null, followSelectedTagMap: true, activeMapId: "map-a", readyMapId: "map-a",
    presenceEpoch: "browse-test", pendingTagFocusId: null, mapTransitionNotice: null });
  useIpsStore.getState().selectTag("SELECTED");
  useIpsStore.getState().setActiveMapId("map-b");
  useIpsStore.getState().markMapReady("map-b");
}

test("manual map selection clears the selected tag while raw and processed data stay live", () => {
  const original = useIpsStore.getState();
  try {
    startMapBrowseScenario();
    assert.equal(useIpsStore.getState().selectedTagId, null);
    const focusRequest = useIpsStore.getState().mapFocusRequest;
    for (const timestamp of [2_000, 3_000, 4_000]) {
      useIpsStore.getState().upsertTag(browseTag(timestamp));
      useIpsStore.getState().upsertTag({ ...browseTag(timestamp), publishedAt: new Date(timestamp + 100).toISOString(),
        regionInference: { enabled: true, state: "IN_REGION", regionId: "room-a" } });
      const state = useIpsStore.getState();
      assert.equal(state.activeMapId, "map-b");
      assert.equal(state.selectedTagId, null);
      assert.equal(state.tags.SELECTED.timestamp, timestamp);
      assert.equal(state.tags.SELECTED.regionInference?.regionId, "room-a");
      assert.equal(state.readyMapId, "map-b");
      assert.equal(state.pendingTagFocusId, null);
      assert.equal(state.mapFocusRequest, focusRequest);
      assert.equal(state.mapTransitionNotice, null);
    }
  } finally { useIpsStore.setState(original, true); }
});

test("presence updates and reconnect snapshots cannot override a manually chosen map", () => {
  const original = useIpsStore.getState();
  try {
    startMapBrowseScenario();
    for (const row of [presenceRow(browseTag(2_000, "map-a", "OTHER"), 1), presenceRow(browseTag(3_000), 2)]) {
      useIpsStore.getState().applyTagPresenceUpdate({ epoch: "browse-test", serverNow: row.lastRawReceivedAt, state: row });
      assert.equal(useIpsStore.getState().activeMapId, "map-b");
    }
    const reconnected = presenceRow(browseTag(4_000), 1);
    useIpsStore.getState().applyTagPresenceSnapshot({ epoch: "new-browse-test", serverNow: 4_000,
      settings: DEFAULT_SYSTEM_SETTINGS, states: [reconnected], warning: null });
    const next = presenceRow(browseTag(5_000), 2);
    useIpsStore.getState().applyTagPresenceUpdate({ epoch: "new-browse-test", serverNow: 5_000, state: next });
    const state = useIpsStore.getState();
    assert.equal(state.activeMapId, "map-b");
    assert.equal(state.selectedTagId, null);
    assert.equal(state.tags.SELECTED.timestamp, 5_000);
    assert.equal(state.followSelectedTagMap, false);
  } finally { useIpsStore.setState(original, true); }
});

test("tag floor changes respect manual browsing until an explicit show-on-map action resumes following", () => {
  const original = useIpsStore.getState();
  try {
    startMapBrowseScenario();
    useIpsStore.getState().upsertTag(browseTag(2_000, "map-c"));
    assert.equal(useIpsStore.getState().activeMapId, "map-b");
    assert.equal(useIpsStore.getState().tags.SELECTED.mapId, "map-c");
    const row = presenceRow(browseTag(3_000, "map-c"), 1);
    useIpsStore.getState().applyTagPresenceUpdate({ epoch: "browse-test", serverNow: 3_000, state: row });
    assert.equal(useIpsStore.getState().activeMapId, "map-b");
    useIpsStore.getState().selectTagOnMap("SELECTED", "map-c");
    assert.equal(useIpsStore.getState().activeMapId, "map-c");
    assert.equal(useIpsStore.getState().followSelectedTagMap, true);
    useIpsStore.getState().upsertTag(browseTag(4_000, "map-a"));
    assert.equal(useIpsStore.getState().activeMapId, "map-a");
    const next = presenceRow(browseTag(5_000, "map-c"), 2);
    useIpsStore.getState().applyTagPresenceUpdate({ epoch: "browse-test", serverNow: 5_000, state: next });
    assert.equal(useIpsStore.getState().activeMapId, "map-c");
  } finally { useIpsStore.setState(original, true); }
});

test("explicit tag selection can resume map following after browsing another map", () => {
  const original = useIpsStore.getState();
  try {
    for (const action of ["selectTag", "selectTagAndFocus"] as const) {
      startMapBrowseScenario();
      useIpsStore.getState()[action]("SELECTED");
      assert.equal(useIpsStore.getState().selectedTagId, "SELECTED");
      assert.equal(useIpsStore.getState().followSelectedTagMap, true);
      useIpsStore.getState().upsertTag(browseTag(2_000, "map-c"));
      assert.equal(useIpsStore.getState().activeMapId, "map-c");
    }
  } finally { useIpsStore.setState(original, true); }
});

test("selecting the current map keeps selection, while changing maps clears pending tag focus", () => {
  const original = useIpsStore.getState();
  try {
    useIpsStore.setState({ activeMapId: "map-a", selectedTagId: "SELECTED", followSelectedTagMap: true,
      pendingTagFocusId: "SELECTED", tags: { SELECTED: browseTag(1_000) }, recentTagIds: ["SELECTED"] });
    useIpsStore.getState().setActiveMapId("map-a");
    assert.equal(useIpsStore.getState().selectedTagId, "SELECTED");
    assert.equal(useIpsStore.getState().followSelectedTagMap, true);
    useIpsStore.getState().setActiveMapId("map-b");
    const state = useIpsStore.getState();
    assert.equal(state.selectedTagId, null);
    assert.equal(state.pendingTagFocusId, null);
    assert.equal(state.followSelectedTagMap, false);
    assert.ok(state.tags.SELECTED);
    assert.deepEqual(state.recentTagIds, ["SELECTED"]);
  } finally { useIpsStore.setState(original, true); }
});
