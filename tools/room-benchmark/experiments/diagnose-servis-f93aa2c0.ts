import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {queryPostgres} from '../../../src/server/postgresClient';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import {ROOM_ENGINE_VERSION} from '../../../src/server/regionEngine/RegionPositionEngine';
import type {RegionsConfig} from '../../../src/features/regions/types/region.types';
import {sha256} from '../model';

const dir='tools/room-benchmark/reports/servis-f93aa2c0-audit-20261013';
const code='9C76E417B4CB5ECF';
const quote=(s:string)=>`'${s.replaceAll("'","''")}'`;
const source=JSON.parse(await readFile('tools/room-benchmark/datasets/test-f93aa2c0-e0fc-4130-b0c5-3d1207fd120a/source.json','utf8'));
const from=new Date(Date.parse(source.started_at)-30000).toISOString(),to=new Date(Date.parse(source.rooms.at(-1).exited_at)+60000).toISOString();
// Every database command in this diagnostic is a SELECT; no repositories are instantiated.
const identity=await queryPostgres('SELECT current_database() AS database, current_timestamp::text AS checked_at');
const normalized=`upper(regexp_replace(tag_code,'[^0-9A-Fa-f]','','g'))=${quote(code)}`;
const registry=await queryPostgres(`SELECT tag_code,COALESCE(display_name,tag_name,tag_code) AS name FROM tags WHERE ${normalized}`);
const rawAllTime=await queryPostgres(`SELECT count(*)::text AS count,min(created_at)::text AS first_at,max(created_at)::text AS last_at FROM tag_location_history WHERE ${normalized}`);
const decisionsAllTime=await queryPostgres(`SELECT count(*)::text AS count,min(published_at)::text AS first_at,max(published_at)::text AS last_at FROM tag_room_decisions WHERE ${normalized}`);
const window=`created_at BETWEEN ${quote(from)}::timestamptz AND ${quote(to)}::timestamptz OR received_at BETWEEN ${quote(from)}::timestamptz AND ${quote(to)}::timestamptz`;
const deliveries=await queryPostgres(`SELECT tag_code,map_id,count(*)::text AS count,min(created_at)::text AS first_measurement,max(created_at)::text AS last_measurement,min(received_at)::text AS first_delivery,max(received_at)::text AS last_delivery FROM tag_location_history WHERE ${window} GROUP BY tag_code,map_id`);
const registrySize=await queryPostgres('SELECT count(*)::text AS count FROM tags');
const configPath='config/maps/necmettin-servis/regions.json',configBytes=await readFile(configPath),config=compileRegionsConfig(JSON.parse(configBytes.toString()) as RegionsConfig);
const audit=JSON.parse(await readFile(dir+'/session-audit.json','utf8'));
const historicalFloor=audit.session.plan.floors.find((floor:{mapId:string})=>floor.mapId==='necmettin-servis');
const historicalConfig=historicalFloor?.config?compileRegionsConfig(historicalFloor.config as RegionsConfig):null;
const checks={identity,registry,registrySize,rawAllTime,decisionsAllTime,deliveries,
  userObservation:'Kullanıcı test sırasında aynı kodun Tag Panel’de hareket ettiğini doğruladı; bu beyan geçmiş ham koordinat/karar arşivi yerine geçmez.',
  session:{status:audit.projection.status,endedAt:audit.projection.endedAt,tagVerified:audit.projection.tagVerified,planHash:audit.session.configHash},
  engineVersion:ROOM_ENGINE_VERSION,git:{commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--short'],{encoding:'utf8'}).trim()},
  config:{path:configPath,sha256:await sha256(configBytes),version:config.version,warnings:config.warnings,rules:config.rules,
    rooms:config.regions.map(room=>({id:room.id,name:room.name,settings:room.settings,doors:room.entrances.map(door=>({id:door.id,approachDepthMeters:door.approachDepthMeters,settings:door.settings}))}))},
  historicalPlanConfig:historicalConfig?{version:historicalConfig.version,warnings:historicalConfig.warnings}:null};
await writeFile(dir+'/data-diagnostic.json',JSON.stringify(checks,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({identity,registry,registrySize,rawAllTime,decisionsAllTime,deliveries,engineVersion:ROOM_ENGINE_VERSION,
  configVersion:config.version,configWarnings:config.warnings,historicalConfigVersion:historicalConfig?.version??null,rules:config.rules},null,2));
