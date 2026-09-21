import assert from "node:assert/strict";
import test from "node:test";
import { useIpsStore } from "../src/app/store/useIpsStore";
import { buildLocationTimeline, routeDistanceByMap, segmentRouteByMap } from "../src/features/map/services/RouteTimelineService";
import { ZoneMapResolver } from "../src/server/maps/zoneMapResolver";
import { REGION_ENGINE_CONTROLLER_REVISION, RegionEngineController } from "../src/server/regionEngine/controller";
import type { TrackingPosition } from "../src/server/trackingBuffer";
import { cleanRegionsConfig, getMapRegions } from "../app/api/regions/route";
import { DEFAULT_REGIONS_CONFIG } from "../src/features/regions/config/defaultRegionsConfig";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import { compileRegionsConfig, regionsConfigPathForMap } from "../src/server/regionEngine/configLoader";
import { RegionPositionEngine, ROOM_ENGINE_VERSION } from "../src/server/regionEngine/RegionPositionEngine";
import { trackingBuffer } from "../src/server/trackingBuffer";
import { SseTrackingGateway } from "../src/features/tracking/services/TrackingGateway";
import type { MapRepository } from "../src/server/maps/mapRepository";
import type { MapCatalog, MapDetails } from "../src/server/maps/map.types";
import { scenarioConfig } from "../test_api/room_scenarios.js";

const catalog: MapCatalog = {
  version: 1, defaultMapId: "map-a", liveTrackingMapId: "map-a",
  maps: ["a", "b"].map((suffix, index) => ({
    id: `map-${suffix}`, buildingId: "building", buildingName: "Bina", floorId: `floor-${suffix}`,
    floorLevel: index + 1, floorLabel: `Kat ${index + 1}`, unitId: `unit-${suffix}`, unitName: `Birim ${suffix}`,
    displayName: `Map ${suffix.toUpperCase()}`, status: "active" as const, liveTrackingEnabled: true,
    trackingZoneIds: [`zone-${suffix}`], sortOrder: index, configPath: `map-${suffix}/map.json`, regionsConfigPath: `map-${suffix}/regions.json`,
  })),
};

const repository: MapRepository = {
  readCatalog: async () => catalog,
  readMapDetails: async () => ({}) as MapDetails,
};

test("zone resolver maps only catalog zone ids and leaves null/unknown unresolved", async () => {
  const resolver = new ZoneMapResolver(repository, 60_000, () => 1_000);
  assert.deepEqual(await resolver.resolve("zone-a"), { mapId: "map-a", resolved: true });
  assert.deepEqual(await resolver.resolve("zone-b"), { mapId: "map-b", resolved: true });
  assert.deepEqual(await resolver.resolve(null), { mapId: null, resolved: false });
  assert.deepEqual(await resolver.resolve("missing"), { mapId: null, resolved: false });
});

test("route segments split on every map transition and never add cross-floor distance", () => {
  const points = [
    { tagId: "T", x: 0, y: 0, timestamp: "2026-01-01T00:00:00Z", mapId: "map-a" },
    { tagId: "T", x: 3, y: 4, timestamp: "2026-01-01T00:00:01Z", mapId: "map-a" },
    { tagId: "T", x: 3, y: 4, timestamp: "2026-01-01T00:00:02Z", mapId: "map-b" },
    { tagId: "T", x: 6, y: 8, timestamp: "2026-01-01T00:00:03Z", mapId: "map-b" },
    { tagId: "T", x: 9, y: 9, timestamp: "2026-01-01T00:00:04Z", mapId: null },
  ];
  assert.deepEqual(segmentRouteByMap(points).map((segment) => [segment.mapId, segment.positions.length]), [["map-a", 2], ["map-b", 2], [null, 1]]);
  assert.equal(routeDistanceByMap(points), 10);
  const timeline = buildLocationTimeline(points.slice(0, 4), "", null);
  assert.equal(timeline.length, 2);
  assert.deepEqual(timeline.map((stay) => stay.mapId), ["map-a", "map-b"]);
  assert.equal(timeline[1].isMapTransition, true);
});

test("store follows only the selected tag across maps and rejects delayed old-floor packets", () => {
  const original = useIpsStore.getState();
  try {
    useIpsStore.setState({ tags: {}, observedTags: {}, activeMapId: "map-a", selectedTagId: "SELECTED" });
    const base = { name: "Tag", color: "#fff", status: "active" as const, x: 5, y: 5 };
    useIpsStore.getState().upsertTag({ ...base, id: "OTHER", timestamp: 1_000, mapId: "map-b" });
    assert.equal(useIpsStore.getState().activeMapId, "map-a");
    useIpsStore.getState().upsertTag({ ...base, id: "SELECTED", timestamp: 2_000, mapId: "map-b" });
    assert.equal(useIpsStore.getState().activeMapId, "map-b");
    useIpsStore.getState().upsertTag({ ...base, id: "SELECTED", timestamp: 1_500, mapId: "map-a" });
    assert.equal(useIpsStore.getState().tags.SELECTED.mapId, "map-b");
    assert.equal(useIpsStore.getState().activeMapId, "map-b");
  } finally { useIpsStore.setState(original, true); }
});

test("region engine manager isolates maps, clears the old map and rejects a delayed floor switch", () => {
  const controller = new RegionEngineController();
  const ingestedA: TrackingPosition[] = [];
  const ingestedB: TrackingPosition[] = [];
  const removedA: string[] = [];
  const fakeEngine = (ingested: TrackingPosition[], removed: string[]) => ({
    ingest: (position: TrackingPosition) => { ingested.push(position); },
    removeVehicle: (tagCode: string) => { removed.push(tagCode); },
  });
  const internal = controller as unknown as {
    enabled: boolean;
    engines: Map<string, { engine: ReturnType<typeof fakeEngine>; warnings: readonly string[] }>;
  };
  internal.enabled = true;
  internal.engines.set("map-a", { engine: fakeEngine(ingestedA, removedA), warnings: [] });
  internal.engines.set("map-b", { engine: fakeEngine(ingestedB, []), warnings: [] });
  const position = (tagCode: string, mapId: string, timestamp: string): TrackingPosition => ({
    tagCode, mapId, timestamp, x: 5, y: 5, sourceZoneId: `zone-${mapId.at(-1)}`, sourceZoneName: mapId,
  });
  controller.ingest(position("TAG-1", "map-a", "2026-01-01T00:00:00Z"));
  controller.ingest(position("TAG-2", "map-b", "2026-01-01T00:00:00Z"));
  controller.ingest(position("TAG-1", "map-b", "2026-01-01T00:00:02Z"));
  controller.ingest(position("TAG-1", "map-a", "2026-01-01T00:00:01Z"));
  assert.deepEqual(ingestedA.map((item) => item.tagCode), ["TAG-1"]);
  assert.deepEqual(ingestedB.map((item) => item.tagCode), ["TAG-2", "TAG-1"]);
  assert.deepEqual(removedA, ["TAG-1"]);
});

test("runtime controller installs only RegionPositionEngine and exposes the active engine version", () => {
  const controller=new RegionEngineController();
  const internal=controller as unknown as {
    install:(mapId:string,config:ReturnType<typeof compileRegionsConfig>)=>void;
    engines:Map<string,{engine:RegionPositionEngine;warnings:readonly string[]}>;
  };
  internal.install("simulation-reference",compileRegionsConfig(scenarioConfig() as RegionsConfig));
  try {
    assert.ok(internal.engines.get("simulation-reference")!.engine instanceof RegionPositionEngine);
    assert.equal(controller.status().engineVersion,ROOM_ENGINE_VERSION);
    assert.equal(controller.status().controllerRevision,REGION_ENGINE_CONTROLLER_REVISION);
    assert.equal(controller.status().regionEngineListenerCount,1);
    assert.equal(controller.status().maps?.["simulation-reference"]?.engineVersion,ROOM_ENGINE_VERSION);
    assert.equal(trackingBuffer.listenerCount("position"),1);
  } finally {internal.engines.get("simulation-reference")!.engine.disable();}
});

test("hot reload retires a stale global controller and retains exactly one tracking listener", async () => {
  const stale=globalThis.__uwbRegionEngineControllerRegistration!;
  globalThis.__uwbRegionEngineControllerRegistration={...stale,version:ROOM_ENGINE_VERSION,revision:"stale-controller-revision"};
  const hotModule=await import(`${new URL("../src/server/regionEngine/controller.ts",import.meta.url).href}?hot-reload=${Date.now()}`);
  const current=globalThis.__uwbRegionEngineControllerRegistration!;
  assert.notEqual(current.controller,stale.controller);
  assert.equal(stale.controller.isDisposed(),true);
  assert.equal(current.version,ROOM_ENGINE_VERSION);
  assert.equal(current.revision,REGION_ENGINE_CONTROLLER_REVISION);
  assert.equal(current.controller.status().engineVersion,ROOM_ENGINE_VERSION);
  assert.equal(trackingBuffer.listenerCount("position"),1);
  assert.equal(hotModule.installGlobalRegionEngineController(),current.controller);
  assert.equal(trackingBuffer.listenerCount("position"),1);
});

test("hot replacement restores an enabled controller only after retirement completes", async () => {
  const stale=globalThis.__uwbRegionEngineControllerRegistration!;
  (stale.controller as unknown as {enabled:boolean}).enabled=true;
  globalThis.__uwbRegionEngineControllerRegistration={...stale,version:ROOM_ENGINE_VERSION,revision:"enabled-stale-revision"};
  await import(`${new URL("../src/server/regionEngine/controller.ts",import.meta.url).href}?enabled-hot-reload=${Date.now()}`);
  const current=globalThis.__uwbRegionEngineControllerRegistration!;
  for(let attempt=0;attempt<100&&!current.controller.isEnabled();attempt++)await new Promise(resolve=>setTimeout(resolve,20));
  try {
    assert.notEqual(current.controller,stale.controller);assert.equal(stale.controller.isDisposed(),true);
    assert.equal(current.controller.isEnabled(),true);assert.equal(current.controller.status().maps?.["spor-koridor"]?.configLoaded,true);
    assert.equal(current.revision,REGION_ENGINE_CONTROLLER_REVISION);assert.equal(trackingBuffer.listenerCount("position"),1);
  } finally {await current.controller.dispose();}
});

test("controller reload applies a UI-compiled config to the existing map engine without installing a parallel engine", () => {
  const controller=new RegionEngineController();const reloads:ReturnType<typeof compileRegionsConfig>[]=[];
  const existing={reload:(config:ReturnType<typeof compileRegionsConfig>)=>reloads.push(config)} as unknown as RegionPositionEngine;
  const internal=controller as unknown as {enabled:boolean;engines:Map<string,{engine:RegionPositionEngine;warnings:readonly string[]}>};
  internal.enabled=true;internal.engines.set("simulation-reference",{engine:existing,warnings:[]});
  const compiled=compileRegionsConfig(scenarioConfig() as RegionsConfig);controller.reloadCompiledConfig(compiled,"simulation-reference");
  assert.deepEqual(reloads,[compiled]);assert.equal(internal.engines.size,1);assert.equal(internal.engines.get("simulation-reference")!.engine,existing);
});

test("map-specific region config rejects URL/config mismatches and path traversal", async () => {
  assert.throws(() => cleanRegionsConfig(DEFAULT_REGIONS_CONFIG, "map-a"), /eşleşmiyor/);
  assert.throws(() => regionsConfigPathForMap("../secret"), /INVALID_MAP_ID/);
  assert.equal((await getMapRegions("../secret")).status, 400);
});

test("browser SSE gateway preserves map and source-zone fields", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
  let listener: ((event: { data: string }) => void) | undefined;
  let closed = false;
  class FakeEventSource {
    public constructor(url: string) { void url; }
    public addEventListener(_name: string, eventListener: EventListener) { listener = eventListener as unknown as (event: { data: string }) => void; }
    public close() { closed = true; }
  }
  Object.defineProperty(globalThis, "EventSource", { configurable: true, value: FakeEventSource });
  try {
    let received: unknown;
    const disconnect = new SseTrackingGateway("/stream").connect((position) => { received = position; });
    listener?.({ data: JSON.stringify({ tagCode: "TAG-1", x: 1, y: 2, timestamp: "2026-01-01T00:00:00Z", mapId: "map-b", sourceZoneId: "zone-b", sourceZoneName: "Zone B" }) });
    assert.deepEqual(received && { mapId: (received as { mapId: unknown }).mapId, sourceZoneId: (received as { sourceZoneId: unknown }).sourceZoneId, sourceZoneName: (received as { sourceZoneName: unknown }).sourceZoneName }, { mapId: "map-b", sourceZoneId: "zone-b", sourceZoneName: "Zone B" });
    disconnect();
    assert.equal(closed, true);
  } finally {
    if (original) Object.defineProperty(globalThis, "EventSource", original);
    else delete (globalThis as { EventSource?: unknown }).EventSource;
  }
});
