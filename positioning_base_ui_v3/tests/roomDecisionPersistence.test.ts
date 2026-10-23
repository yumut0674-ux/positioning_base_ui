import assert from "node:assert/strict";
import test from "node:test";
import { decodeDecisionCursor, encodeDecisionCursor, PostgresRoomDecisionRepository } from "../src/server/location/roomDecisionRepository";
import { queryPostgres } from "../src/server/postgresClient";
import { RegionPositionEngine, ROOM_ENGINE_VERSION } from "../src/server/regionEngine/RegionPositionEngine";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import { scenarioConfig } from "../test_api/room_scenarios.js";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import type { ProcessedPosition } from "../src/server/regionEngine/types";
import { LocationService } from "../src/server/location/locationService";
import type { EntityRepository } from "../src/server/location/entityRepository";
import type { PositionRepository } from "../src/server/location/positionRepository";
import { TrackingBuffer } from "../src/server/trackingBuffer";

function decisions() {
  const events:ProcessedPosition[]=[];let clock=Date.parse("2026-09-01T00:00:00Z");const start=clock;
  const engine=new RegionPositionEngine(p=>events.push(p),250,()=>clock,false);
  engine.enable(compileRegionsConfig(scenarioConfig() as RegionsConfig));
  for(let i=0;i<3;i++){clock=start+i*1000;engine.ingest({tagCode:"ROOM-TEST",x:3+i*0.1,y:3,timestamp:new Date(clock).toISOString(),receivedAt:new Date(clock+20).toISOString(),mapId:"map-a",sourceZoneId:"zone-a",sourceZoneName:"Zone A"});}
  clock=start+7000;engine.tick();clock+=1000;engine.tick();clock=start+40000;engine.tick();engine.disable();
  return events;
}
test("decision queue stores raw decisions and state changes, deduplicates synthetic centres",async()=>{
  const sql:string[]=[];const repo=new PostgresRoomDecisionRepository(async q=>{sql.push(q);return [];});
  try {
    const events=decisions();events.forEach(p=>repo.record(p));
    assert.equal(repo.status().queueSize,5);
    const current=await repo.latest("ROOM-TEST","2026-09-01T00:01:00Z");assert.deepEqual(current,events.at(-1));
    const before=await repo.latest("ROOM-TEST","2026-09-01T00:00:03Z");assert.equal(before?.regionInference.state,"IN_REGION");
    const history=await repo.history(["ROOM-TEST"],"2026-09-01T03:00:00+03:00","2026-09-01T03:01:00+03:00",100);
    assert.equal(history.length,5);
    await repo.flush();assert.equal(repo.status().queueSize,0);
    assert.deepEqual(await repo.detail(events[0].decisionId!),events[0]);
    assert.ok(sql.at(-1)!.includes("ON CONFLICT (event_id) DO NOTHING"));
    assert.ok(sql.at(-1)!.includes("map_id,zone_id,event_type,severity,state,region_id,candidate_region_id,measurement_kind,confidence,reason_codes,payload"));
    assert.ok(sql.at(-1)!.includes("ROOM_CONFIRMED"));assert.ok(sql.at(-1)!.includes("reason_codes"));
    assert.ok(sql.at(-1)!.includes("engine_version"));assert.ok(sql.at(-1)!.includes(`'${ROOM_ENGINE_VERSION}'`));
    assert.ok(events.every(event=>event.engineVersion===ROOM_ENGINE_VERSION));
    assert.equal(events.at(-1)?.mapId,"map-a");assert.equal(events.at(-1)?.sourceZoneId,"zone-a");
    assert.ok(!sql.at(-1)!.includes("INSERT INTO tag_location_history"));
  } finally {repo.stop();}
});
test("decision buffer caps memory, including an interrupted persistence flush",async()=>{
  const repo=new PostgresRoomDecisionRepository(async()=>[]);
  try {const p=decisions()[0];for(let i=0;i<21000;i++)repo.record({...p,decisionId:String(i)});assert.equal(repo.status().queueSize,20000);assert.equal(repo.status().dropped,1000);await repo.flush();assert.equal(repo.status().queueSize,19000);}finally{repo.stop();}
});
test("raw buffer is bounded and received/measurement times persist independently",async()=>{
  const calls:string[]=[];const time=Date.parse("2026-09-01T00:00:10Z");
  const buffer=new TrackingBuffer(async sql=>{calls.push(sql);return sql.startsWith("SELECT")?[{tag_code:"ROOM-TEST"}]:[];},()=>time,false);
  const raw={tagCode:"ROOM-TEST",x:1.2,y:3.4,timestamp:"2026-09-01T00:00:00Z",quality:0.8,mapId:"map-a",sourceZoneId:"zone-a",sourceZoneName:"Zone A"};
  try {for(let i=0;i<21000;i++) await buffer.ingest(raw);assert.equal(buffer.status().queueSize,20000);assert.equal(buffer.status().dropped,1000);await buffer.flush();assert.ok(calls.at(-1)!.includes("received_at, quality, zone_id, zone_name, map_id"));assert.ok(calls.at(-1)!.includes(raw.timestamp));assert.ok(calls.at(-1)!.includes("'zone-a', 'Zone A', 'map-a'"));assert.ok(calls.at(-1)!.includes(new Date(time).toISOString()));assert.ok(!("receivedAt" in raw));}finally{buffer.stop();}
});
test("LocationService exposes the live decision and keeps inferred/uncertain visits separate",async()=>{
  const events=decisions(),latest=events.at(-1)!;
  const repo=new PostgresRoomDecisionRepository(async()=>[]);events.forEach(p=>repo.record(p));
  const assignment={entityId:1,tagCode:"ROOM-TEST",assignedAt:"2026-08-01T00:00:00Z",unassignedAt:null,usesLegacyTagModel:false};
  const entities:EntityRepository={search:async()=>[],getById:async()=>({entityId:1,entityCode:"E",name:"Test",entityType:"asset",status:"active",aliases:[],usesLegacyTagModel:false}),getAssignmentAt:async()=>assignment,getAssignmentsInRange:async()=>[assignment]};
  const points=events.filter(p=>!p.synthetic).map(p=>({tagCode:p.tagCode,x:p.rawPosition!.x,y:p.rawPosition!.y,observedAt:p.timestamp,gapBeforeSeconds:null}));
  const history=async()=>({positions:points,sourcePointCount:points.length,processingTruncated:false});
  const positions:PositionRepository={latest:async()=>points.at(-1)!,nearest:async()=>points.at(-1)!,history,timelineHistory:history};
  const service=new LocationService(entities,positions,()=>"WRONG GEOMETRY",repo);
  try {
    const current=await service.current(1,()=>new Date(latest.publishedAt!));
    assert.equal(current.meta.dataStatus,"ambiguous");assert.equal(current.data.ageSeconds,38);
    assert.equal(current.data.position.zoneName,"Belirsiz");assert.equal(current.data.position.rawPosition?.x,3.2);
    const at=await service.atTime(1,"2026-09-01T00:00:03Z",60);assert.equal(at.data.position?.zoneName,"Oda A");
    const h=await service.history({entityId:1,from:"2026-09-01T00:00:00Z",to:"2026-09-01T00:01:00Z",format:"zone_timeline",limit:100});
    assert.ok("timeline" in h.data);assert.ok(h.data.timeline.some(t=>t.zoneName==="Oda A (tahmin)"));assert.ok(h.data.timeline.some(t=>t.zoneName==="Belirsiz"));
    assert.ok(!h.data.timeline.some(t=>t.zoneName==="WRONG GEOMETRY"));
  } finally {repo.stop();}
});
test("PostgreSQL roundtrip uses separate decision table and preserves measurement/publication timestamps", {skip:process.env.ROOM_DATABASE_TEST!=="1"},async()=>{
  let stored:ProcessedPosition[]=[];
  const repo=new PostgresRoomDecisionRepository(async sql=>{
    const rows=await queryPostgres(`BEGIN;
      CREATE TEMP TABLE tags(tag_code TEXT); INSERT INTO tags VALUES ('ROOM-TEST');
      CREATE TEMP TABLE tag_room_decisions(id BIGINT GENERATED ALWAYS AS IDENTITY,event_id TEXT UNIQUE,tag_code TEXT,measured_at TIMESTAMPTZ,published_at TIMESTAMPTZ,engine_version TEXT,config_version TEXT,map_id TEXT,zone_id TEXT,event_type TEXT,severity TEXT,state TEXT,region_id TEXT,candidate_region_id TEXT,measurement_kind TEXT,confidence DOUBLE PRECISION,reason_codes TEXT[],payload JSONB);
      ${sql}
      SELECT payload::text FROM tag_room_decisions ORDER BY published_at,id; ROLLBACK;`);
    stored=rows.filter(r=>r.payload).map(r=>JSON.parse(r.payload!) as ProcessedPosition);return rows;
  });
  try {const events=decisions();events.forEach(p=>repo.record(p));await repo.flush();assert.equal(repo.status().error,null);assert.equal(stored.length,5);assert.deepEqual(stored.at(-1),events.at(-1));assert.notEqual(stored.at(-1)!.timestamp,stored.at(-1)!.publishedAt);}finally{repo.stop();}
});

test("decision log list applies combined filters, merges pending records and uses a stable cursor",async()=>{
  const queries:string[]=[];const events=decisions();const pending=events[0];
  const repo=new PostgresRoomDecisionRepository(async sql=>{queries.push(sql);return sql.includes("WITH filtered AS")?[{
    decision_id:pending.decisionId!,tag_code:pending.tagCode,measured_at:pending.lastRawDataTimestamp,published_at:pending.publishedAt!,map_id:pending.mapId??null,
    event_type:pending.decisionTrace!.eventType,severity:pending.decisionTrace!.severity,previous_state:pending.decisionTrace!.previousState??null,state:pending.regionInference.state,
    region_id:pending.regionInference.regionId,candidate_region_id:pending.regionInference.candidateRegionId??null,measurement_kind:pending.regionInference.measurementKind!,confidence:String(pending.regionInference.confidence),
    received_at:null,raw_x:String(pending.rawPosition!.x),raw_y:String(pending.rawPosition!.y),published_x:String(pending.x),published_y:String(pending.y),door_id:null,door_distance_meters:null,
    reason_codes:JSON.stringify(pending.decisionTrace!.reasons.map(reason=>reason.code)),short_reason:pending.decisionTrace!.reasons[0]?.message??null,engine_version:pending.engineVersion!,config_version:pending.configVersion!,filtered_total:"1",
  }]:[];});
  try{
    repo.record(pending);
    const cursor=encodeDecisionCursor({publishedAt:"2026-09-01T00:00:00.000Z",key:"z"});assert.deepEqual(decodeDecisionCursor(cursor),{publishedAt:"2026-09-01T00:00:00.000Z",key:"z"});
    const result=await repo.list({tagCode:"ROOM",from:"2026-09-01T00:00:00Z",to:"2026-09-01T00:01:00Z",mapId:"map-a",eventType:pending.decisionTrace!.eventType,state:pending.regionInference.state,measurementKind:pending.regionInference.measurementKind,engineVersion:ROOM_ENGINE_VERSION,configVersion:pending.configVersion,limit:100});
    assert.equal(result.items.length,1);assert.equal(result.items[0].decisionId,pending.decisionId);assert.equal(result.metadata.filteredCount,2);assert.equal(result.metadata.countAccuracy,"estimated");
    const sql=queries.at(-1)!;assert.match(sql,/tag_code ILIKE/);assert.match(sql,/COALESCE\(map_id/);assert.match(sql,/COALESCE\(event_type/);assert.match(sql,/COALESCE\(measurement_kind/);assert.match(sql,/engine_version=/);
  }finally{repo.stop();}
});

test("decision list keyset order does not skip equal timestamps",async()=>{
  const published="2026-09-01T00:00:00.000Z";const rows=["c","b","a"].map(id=>({decision_id:id,tag_code:"T",measured_at:published,published_at:published,map_id:"map-a",event_type:"MEASUREMENT_ACCEPTED",severity:"info",previous_state:null,state:"TRACKING_OUTSIDE",region_id:null,region_name:null,candidate_region_id:null,measurement_kind:"measured",confidence:"0",received_at:null,raw_x:"1",raw_y:"2",published_x:"1",published_y:"2",door_id:null,door_distance_meters:null,reason_codes:"[]",short_reason:null,engine_version:ROOM_ENGINE_VERSION,config_version:"v1",filtered_total:"3"}));
  let page=0;const repo=new PostgresRoomDecisionRepository(async sql=>sql.includes("WITH filtered AS")?(page++===0?rows.slice(0,2):rows.slice(2)):[]);
  try{const base={from:"2026-09-01T00:00:00Z",to:"2026-09-01T00:01:00Z",limit:1} as const;const first=await repo.list(base);assert.equal(first.items[0].decisionId,"c");assert.ok(first.nextCursor);const second=await repo.list({...base,cursor:first.nextCursor!});assert.equal(second.items[0].decisionId,"a");assert.notEqual(first.items[0].decisionId,second.items[0].decisionId);}finally{repo.stop();}
});

test("recent decision detail is shared across route repository instances",async()=>{
  const writer=new PostgresRoomDecisionRepository(async()=>[]);const reader=new PostgresRoomDecisionRepository(async()=>[]);const event=decisions()[0];
  try{writer.record(event);assert.deepEqual(await reader.detail(event.decisionId!),event);await writer.flush();assert.deepEqual(await reader.detail(event.decisionId!),event);}finally{writer.stop();reader.stop();}
});
