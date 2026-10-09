import { readFileSync, writeFileSync } from 'node:fs';
import { RegionPositionEngine } from '../../src/server/regionEngine/RegionPositionEngine';
import { compileRegionsConfig } from '../../src/server/regionEngine/configLoader';
import { PositionAnimationController } from '../../src/features/tracking/services/PositionAnimationController';
import { MapDisplayFilter } from '../../src/features/tracking/services/MapDisplayFilter';
import { segmentInDisplayArea } from '../../src/features/tracking/services/displayArea';

const source = JSON.parse(readFileSync('config/maps/necmettin-yogun-bakim/regions.json', 'utf8'));
const rows = readFileSync('tools/room-benchmark/datasets/test-2a7fecc4-d625-4091-8b6c-a5a056302913/raw.jsonl', 'utf8').trim().split(/\r?\n/).map(JSON.parse as any);
const polygons = source.regions.map((r: any) => r.polygon.map((p: any) => p.world));
let now = Date.parse(rows[0].received_at), latest: any, displays: any = {};
const start = now;
const timers = new Map<number, { at: number; callback: () => void }>();
let timerId = 0;
const animation = new PositionAnimationController(source.positionAnimation);
const filter = new MapDisplayFilter(animation, d => { displays = d; }, {
  now: () => now,
  setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id as any; },
  clearTimeout: id => { timers.delete(id as any); },
});
filter.configure(polygons, source.mapDisplay.outsideHoldMs, source.map.mapId);
const engine = new RegionPositionEngine(p => {
  latest = p;
  filter.ingest({ ...p, id: p.tagCode, name: 'hasan', timestamp: Date.parse(p.timestamp), color: '#f00', status: 'active' } as any, p.positionSource !== 'REGION_CENTER');
}, 1000, () => now, false);
engine.enable(compileRegionsConfig(source));
let nextTick = Date.parse('2026-10-08T15:01:42.119Z');
let index = 0;
const snapshots: any[] = [];
for (now = start; now <= Date.parse('2026-10-08T15:05:21Z'); now += 16) {
  const frame = now;
  while (index < rows.length && Date.parse(rows[index].received_at) <= frame) {
    const row = rows[index++]; now = Date.parse(row.received_at);
    while (nextTick <= now) { const saved = now; now = nextTick; engine.tick(); nextTick += 1000; now = saved; }
    engine.ingest({ tagCode: row.tag_code, x: row.x, y: row.y, timestamp: row.created_at, receivedAt: row.received_at, mapId: row.map_id });
  }
  now = frame;
  while (nextTick <= now) { const saved = now; now = nextTick; engine.tick(); nextTick += 1000; now = saved; }
  for (const [id, t] of timers) if (t.at <= now) { timers.delete(id); t.callback(); }
  animation.update(now);
  if (latest && snapshots.length <= (now - start) / 1000) {
    const state = animation.getState(latest.tagCode);
    const rendered = state && { x: state.renderedX, y: state.renderedY };
    const display = displays[latest.tagCode];
    snapshots.push({ at: new Date(now).toISOString(), decisionState: latest.regionInference.state, roomId: latest.regionInference.regionId, decisionPosition: { x: latest.x, y: latest.y }, raw: { x: latest.rawPosition.x, y: latest.rawPosition.y }, rendered, visible: display?.visible, displayPosition: display?.position, transitionKind: state?.transitionKind, opacity: state?.visualOpacity, pathValid: rendered && display?.position && segmentInDisplayArea(rendered, display.position, polygons) });
  }
}
filter.dispose(); engine.disable();
writeFileSync('.codex-artifacts/video-analysis-20261008/ui-probe-results.json', JSON.stringify(snapshots, null, 2));
console.log(JSON.stringify(snapshots.filter(s => s.at >= '2026-10-08T15:04:30' && s.at <= '2026-10-08T15:05:10').filter((_, i) => i % 5 === 0), null, 2));
