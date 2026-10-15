import { readFileSync, writeFileSync } from 'node:fs';
import { RegionPositionEngine } from '../src/server/regionEngine/RegionPositionEngine.ts';
import { compileRegionsConfig } from '../src/server/regionEngine/configLoader.ts';
import { pointInPolygon } from '../src/server/regionEngine/geometry.ts';
import { scenarioConfig } from '../test_api/room_scenarios.js';
import { mapTrackingTags } from '../src/features/tracking/services/mapTrackingTags.ts';
import { MapDisplayFilter } from '../src/features/tracking/services/MapDisplayFilter.ts';
import { PositionAnimationController } from '../src/features/tracking/services/PositionAnimationController.ts';
import { DEFAULT_POSITION_ANIMATION_CONFIG } from '../src/features/tracking/config/positionAnimationConfig.ts';
import { DEFAULT_REGIONS_CONFIG } from '../src/features/regions/config/defaultRegionsConfig.ts';
import { TagPresenceService } from '../src/server/tracking/TagPresenceService.ts';
import { useIpsStore } from '../src/app/store/useIpsStore.ts';
import { bindMapDisplayTracking } from '../src/features/tracking/services/bindMapDisplayTracking.ts';

const results = [];
const epoch = Date.parse('2026-10-15T00:00:00Z');
const pair = (x, y) => ({ world: { x, y }, pixel: { x, y } });
const corridor = { id: 'corridor-main', name: 'Koridor', kind: 'corridor', color: '#fff', roomCenter: null, entrances: [],
  polygon: [pair(0, -5), pair(20, -5), pair(20, 0), pair(0, 0)] };
const tracked = (p) => ({ ...p, id: p.tagCode ?? p.id, name: 'Audit tag', color: '#8495a9', status: 'active',
  timestamp: typeof p.timestamp === 'string' ? Date.parse(p.timestamp) : p.timestamp });

// A moving sample rejected by the real engine must not silently replace its accepted position.
{
  let now = epoch;
  const published = [];
  const config = { ...scenarioConfig(), regions: [...scenarioConfig().regions, corridor] };
  const engine = new RegionPositionEngine(p => published.push(p), 250, () => now, false);
  engine.enable(compileRegionsConfig(config));
  let filter;
  try {
    const raw = { tagCode: 'AUDIT-QUALITY', mapId: config.map.mapId, motionLabel: 'moving', x: 1, y: -2,
      quality: 1, timestamp: new Date(now).toISOString() };
    engine.ingest(raw);
    now += 1000;
    const rejected = { ...raw, x: 3, quality: 0, timestamp: new Date(now).toISOString() };
    engine.ingest(rejected);
    const decision = published.at(-1);
    const view = mapTrackingTags({ [raw.tagCode]: tracked(decision) }, { [raw.tagCode]: tracked(rejected) }, true)[raw.tagCode];
    let displays = {};
    const animation = new PositionAnimationController(DEFAULT_POSITION_ANIMATION_CONFIG);
    filter = new MapDisplayFilter(animation, value => { displays = value; });
    filter.configure(config.regions.map(r => r.polygon.map(p => p.world)), 2000, config.map.mapId, config.regions);
    filter.ingest(view);
    results.push({ name: 'rejected_moving_sample_reaches_display',
      engineEvent: decision.decisionTrace.eventType, engineAcceptedX: decision.x, rawRejectedX: rejected.x,
      displayX: displays[raw.tagCode]?.position?.x, visible: displays[raw.tagCode]?.visible,
      reproduced: decision.decisionTrace.eventType === 'MEASUREMENT_REJECTED' && displays[raw.tagCode]?.position?.x === rejected.x });
  } finally { filter?.dispose(); engine.disable(); }
}

// Receiving stationary data creates a gap in the engine's accepted measurement clock.
{
  let now = epoch;
  const published = [];
  const config = compileRegionsConfig(JSON.parse(readFileSync(new URL('../config/maps/necmettin-servis/regions.json', import.meta.url), 'utf8')));
  const region = config.regions[0], door = region.entrances[0];
  const point = { x: door.x - door.inwardNormal.x * 0.3, y: door.y - door.inwardNormal.y * 0.3 };
  if (!config.corridors.some(c => pointInPolygon(point, c))) throw new Error('Audit point must be in the configured corridor');
  const engine = new RegionPositionEngine(p => published.push(p), 250, () => now, false);
  engine.enable(config);
  try {
    const raw = { tagCode: 'AUDIT-STATIONARY-DOOR', mapId: 'necmettin-servis', ...point, quality: 1,
      timestamp: new Date(now).toISOString(), motionLabel: 'moving' };
    engine.ingest(raw);
    const before = published.at(-1).regionInference;
    for (let i = 1; i <= 6; i++) {
      now = epoch + i * 1000;
      engine.ingest({ ...raw, timestamp: new Date(now).toISOString(), motionLabel: 'stationary' });
      engine.tick();
    }
    const after = published.at(-1).regionInference;
    results.push({ name: 'stationary_corridor_becomes_inferred_room_on_timer',
      initialState: before.state, initialRoom: before.regionId, finalState: after.state, finalRoom: after.regionId,
      lastEngineMeasurementAt: published.at(-1).lastRawDataTimestamp,
      reproduced: before.regionId === null && after.regionId !== null && after.state === 'INFERRED_IN_REGION' });
  } finally { engine.disable(); }
}

// The raw and presence streams can arrive in a different order or reconnect independently.
{
  const original = useIpsStore.getState();
  let now = Date.now() - 61000;
  const service = new TagPresenceService(() => now);
  const mapId = DEFAULT_REGIONS_CONFIG.map.mapId;
  const raw = { id: 'AUDIT-RECOVERY', mapId, x: 2, y: -2, timestamp: now, receivedAt: new Date(now).toISOString(), motionLabel: 'stationary' };
  service.observeRaw(raw, { mapId, mapName: 'Audit', floorLabel: 'Audit', regionId: null, regionName: 'Koridor', kind: 'corridor' });
  now += 61000; service.tick();
  const config = { ...DEFAULT_REGIONS_CONFIG, regions: [corridor] };
  const animation = new PositionAnimationController(DEFAULT_POSITION_ANIMATION_CONFIG);
  let displays = {};
  const filter = new MapDisplayFilter(animation, value => { displays = value; useIpsStore.setState({ mapTagDisplays: value }); });
  let unbind;
  try {
    useIpsStore.setState({ tags: {}, observedTags: {}, tagPresenceById: {}, tagLocationEntries: {}, selectedTagId: null,
      activeMapId: mapId, regionsConfig: config, regionsConfigByMapId: { [mapId]: config } });
    useIpsStore.getState().applyTagPresenceSnapshot(service.snapshot());
    unbind = bindMapDisplayTracking(filter, true);
    useIpsStore.getState().observeTag(tracked({ ...raw, timestamp: now, receivedAt: new Date(now).toISOString(), x: 3 }));
    const state = useIpsStore.getState();
    results.push({ name: 'fresh_raw_packet_waits_for_presence_to_unhide',
      rawAgeMs: now - state.observedTags[raw.id].timestamp, oldPresenceHidden: state.tagPresenceById[raw.id].hiddenForNoData,
      display: displays[raw.id], reproduced: displays[raw.id]?.visible === false });
  } finally { unbind?.(); filter.dispose(); useIpsStore.setState(original, true); }
}

writeFileSync(new URL('./tracking-system-audit-probes.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
