import { readFileSync } from 'node:fs';
import { RegionPositionEngine as Before } from './RegionPositionEngine.before';
import { RegionPositionEngine as After } from '../../src/server/regionEngine/RegionPositionEngine';
import { compileRegionsConfig } from '../../src/server/regionEngine/configLoader';

const fixture = JSON.parse(readFileSync('tests/fixtures/september21SporKoridorRoute.json', 'utf8'));
const config = JSON.parse(readFileSync('config/maps/spor-koridor/regions.json', 'utf8'));
if (process.argv[2]) config.engine.maximumSpeedMetersPerSecond = Number(process.argv[2]);
for (const [name, Engine] of [['before', Before], ['after', After]] as const) {
  let now = Date.parse(fixture.positions[0][0]);
  let rejected = 0;
  const confirmations: string[] = [], exits: string[] = [];
  const engine = new Engine(p => {
    if (p.decisionTrace?.reasons.some(r => r.code === 'MEASUREMENT_REJECTED_BY_SPEED')) rejected++;
    if (p.decisionTrace?.eventType === 'ROOM_CONFIRMED') confirmations.push(p.regionInference.regionId!);
    if (p.decisionTrace?.eventType === 'ROOM_EXITED') exits.push(p.regionInference.lastKnownRegionId!);
  }, 250, () => now, false);
  engine.enable(compileRegionsConfig(config));
  for (const [timestamp, x, y, receivedAt] of fixture.positions) {
    if (timestamp > '2026-09-21T09:49:31.785Z') break;
    now = Date.parse(receivedAt ?? timestamp);
    engine.ingest({tagCode: fixture.tagCode, mapId: fixture.mapId, timestamp, x, y, receivedAt});
  }
  console.log(JSON.stringify({name, configuredSpeed: config.engine.maximumSpeedMetersPerSecond, rejected, confirmations, exits}));
  engine.disable();
}
