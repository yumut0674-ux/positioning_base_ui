import { readFileSync, writeFileSync } from 'node:fs';
import { RegionPositionEngine } from '../../src/server/regionEngine/RegionPositionEngine';
import { compileRegionsConfig } from '../../src/server/regionEngine/configLoader';
import { pointInPolygon, wallDistance } from '../../src/server/regionEngine/geometry';

const dir = 'tools/room-benchmark/datasets/test-2a7fecc4-d625-4091-8b6c-a5a056302913';
const rows = readFileSync(`${dir}/raw.jsonl`, 'utf8').trim().split(/\r?\n/).map(JSON.parse as any);
const source = JSON.parse(readFileSync('config/maps/necmettin-yogun-bakim/regions.json', 'utf8'));
const truth = JSON.parse(readFileSync(`${dir}/truth.json`, 'utf8'));
const variants = [
  ['current', (c: any) => c],
  ['door_connection_only', (c: any) => { for (const r of c.regions) for (const d of r.entrances) d.connectsTo = 'corridor'; return c; }],
  ['explicit_preferred_policy_only', (c: any) => { for (const r of c.regions) for (const d of r.entrances) d.inference = { evidenceMode: 'preferred' }; return c; }],
  ['both', (c: any) => { for (const r of c.regions) for (const d of r.entrances) { d.connectsTo = 'corridor'; d.inference = { evidenceMode: 'preferred' }; } return c; }],
];
const results: any[] = [];
for (const [name, mutate] of variants as any[]) {
  const config = compileRegionsConfig(mutate(structuredClone(source)));
  let now = Date.parse(truth.test.from) - 30000;
  const events: any[] = [];
  const engine = new RegionPositionEngine(p => events.push(p), 1000, () => now, false);
  engine.enable(config);
  let tick = now + 1000;
  for (const row of rows) {
    const delivered = Date.parse(row.received_at);
    while (tick <= delivered) { now = tick; engine.tick(); tick += 1000; }
    now = delivered;
    engine.ingest({ tagCode: row.tag_code, x: row.x, y: row.y, timestamp: row.created_at, receivedAt: row.received_at, mapId: row.map_id });
  }
  engine.disable();
  const transitions = events.filter((p, i) => !i || p.regionInference.state !== events[i - 1].regionInference.state || p.regionInference.regionId !== events[i - 1].regionInference.regionId).map(p => ({ at: p.publishedAt, state: p.regionInference.state, roomId: p.regionInference.regionId, reasons: p.regionInference.reasons }));
  const exits = truth.visits.map((v: any) => {
    const from = Date.parse(v.to);
    const assignment = events.find(p => Date.parse(p.publishedAt) >= Date.parse(v.from) && p.regionInference.regionId === v.roomId);
    const next = assignment && events.find(p => Date.parse(p.publishedAt) > Date.parse(assignment.publishedAt!) && p.regionInference.regionId !== v.roomId);
    return { roomId: v.roomId, physicalExit: v.to, assignedAt: assignment?.publishedAt, firstReleaseDecision: next?.publishedAt, elapsedSecondsFromPhysicalExit: next ? (Date.parse(next.publishedAt) - from) / 1000 : null, nextState: next?.regionInference.state, nextRoomId: next?.regionInference.regionId };
  });
  const corridorEvidenceDuringHold = events.filter(p => p.regionInference.regionId && p.rawPosition && config.corridors.some(c => pointInPolygon(p.rawPosition!, c))).map(p => ({ at: p.publishedAt, state: p.regionInference.state, roomId: p.regionInference.regionId, rawX: p.rawPosition.x, rawY: p.rawPosition.y, roomDistance: wallDistance(p.rawPosition, config.regions.find(r => r.id === p.regionInference.regionId)!), reasons: p.regionInference.reasons }));
  results.push({ name, warnings: config.warnings, configVersion: config.version, roomPolicies: config.regions.map(r => ({ id: r.id, usesDoorPolicy: r.usesDoorPolicy, coverage: r.coverage })), transitions, exits, corridorEvidenceDuringHold });
}
writeFileSync('.codex-artifacts/video-analysis-20261008/probe-after-results.json', JSON.stringify(results, null, 2));
for (const r of results) console.log(JSON.stringify({ variant: r.name, exits: r.exits, heldCorridorPackets: r.corridorEvidenceDuringHold.length }));
