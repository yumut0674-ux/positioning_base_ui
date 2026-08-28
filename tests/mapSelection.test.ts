import assert from "node:assert/strict";
import test from "node:test";
import catalogJson from "../config/maps/catalog.json";
import mapJson from "../config/maps/kat1-ortopedi/map.json";
import { mapCatalogSchema, mapDetailsSchema } from "../src/server/maps/map.validation";
import { groupMapCatalog, isSelectableMap, resolveInitialMapId, shouldShowLiveTracking } from "../src/features/map/services/mapSelection";
import { useIpsStore } from "../src/app/store/useIpsStore";

const catalog = mapCatalogSchema.parse(catalogJson);
const liveMap = mapDetailsSchema.parse(mapJson);

test("default selection survives empty or obsolete browser storage", () => {
  assert.equal(resolveInitialMapId(catalog, null), catalog.defaultMapId);
  assert.equal(resolveInitialMapId(catalog, "silinmis-harita"), catalog.defaultMapId);
  assert.equal(resolveInitialMapId(catalog, "kat1-ornek-birim"), catalog.defaultMapId);
  assert.equal(resolveInitialMapId(catalog, "kat1-ortopedi"), "kat1-ortopedi");
});

test("catalog groups floors and keeps planned units visible but disabled", () => {
  const groups = groupMapCatalog(catalog.maps);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].floors.map((floor) => floor.floorLabel), ["Kat 1", "Kat 2"]);
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
      recentTagIds: original.recentTagIds,
      mapFocusRequest: original.mapFocusRequest,
      mapFocusScale: original.mapFocusScale,
    });
  }
});
