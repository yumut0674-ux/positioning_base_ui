import assert from "node:assert/strict";
import test from "node:test";
import { PostgresRoomDecisionRepository } from "../src/server/location/roomDecisionRepository";
import { queryPostgres } from "../src/server/postgresClient";
import { RegionPositionEngine } from "../src/server/regionEngine/RegionPositionEngine";
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
  for(let i=0;i<3;i++){clock=start+i*1000;engine.ingest({tagCode:"ROOM-TEST",x:3+i*0.1,y:3,timestamp:new Date(clock).toISOString(),receivedAt:new Date(clock+20).toISOString()});}
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
    assert.ok(sql.at(-1)!.includes("ON CONFLICT (event_id) DO NOTHING"));
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
  const raw={tagCode:"ROOM-TEST",x:1.2,y:3.4,timestamp:"2026-09-01T00:00:00Z",quality:0.8};
  try {for(let i=0;i<21000;i++) await buffer.ingest(raw);assert.equal(buffer.status().queueSize,20000);assert.equal(buffer.status().dropped,1000);await buffer.flush();assert.ok(calls.at(-1)!.includes("received_at, quality"));assert.ok(calls.at(-1)!.includes(raw.timestamp));assert.ok(calls.at(-1)!.includes(new Date(time).toISOString()));assert.ok(!("receivedAt" in raw));}finally{buffer.stop();}
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
      CREATE TEMP TABLE tag_room_decisions(id BIGINT GENERATED ALWAYS AS IDENTITY,event_id TEXT UNIQUE,tag_code TEXT,measured_at TIMESTAMPTZ,published_at TIMESTAMPTZ,engine_version TEXT,config_version TEXT,payload JSONB);
      ${sql}
      SELECT payload::text FROM tag_room_decisions ORDER BY published_at,id; ROLLBACK;`);
    stored=rows.filter(r=>r.payload).map(r=>JSON.parse(r.payload!) as ProcessedPosition);return rows;
  });
  try {const events=decisions();events.forEach(p=>repo.record(p));await repo.flush();assert.equal(repo.status().error,null);assert.equal(stored.length,5);assert.deepEqual(stored.at(-1),events.at(-1));assert.notEqual(stored.at(-1)!.timestamp,stored.at(-1)!.publishedAt);}finally{repo.stop();}
});
