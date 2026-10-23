import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import {DistanceRelocationFilter,exampleSettings,replayWithDistanceFilter,type PhysicalPolicy} from './distance-relocation';
import {replayRows} from '../replay';
import type {Decision} from '../replay';
import {locationLostSeconds} from './study-metrics';
import type {RawRow,Truth} from '../model';
const origin=Date.parse('2026-10-12T12:00:00Z');
const at=(n:number)=>new Date(origin+n).toISOString();
const row=(id:number,time:number,x:number,y=0,tag='A'):RawRow=>({id:String(id),tag_code:tag,x,y,created_at:at(time),received_at:at(time),quality:1,map_id:'test',zone_id:null,zone_name:null});
const policy:PhysicalPolicy={speed:4,tolerance:0.25,relocationAfterMs:15000,freshnessMs:4000,minimumQuality:0.25};
const step=(f:DistanceRelocationFilter,r:RawRow,now=Date.parse(r.received_at!))=>f.process(r.tag_code,r,now,policy);
test('A B C D E: candidates never become room evidence; D resets and E accepts',()=>{
  const f=new DistanceRelocationFilter(exampleSettings);
  const results=[row(1,0,0),row(2,1000,8),row(3,2000,8.2),row(4,3000,8.1),row(5,4000,8.3)].map(r=>step(f,r));
  assert.deepEqual(results.map(r=>r.action),['ACCEPT','REJECT','REJECT','REFERENCE_RESET','ACCEPT']);
  assert.deepEqual(results.map(r=>r.usedAsRoomEvidence),[true,false,false,false,true]);
  assert.equal(results[4].reference?.id,'4');
});
test('exact distance/count/time/gap/radius/window boundaries pass; too-short span does not',()=>{
  const f=new DistanceRelocationFilter({...exampleSettings,confirmationDurationMs:2000,candidateWindowMs:2000});
  step(f,row(1,0,0));assert.equal(step(f,row(2,1000,3)).action,'ACCEPT');
  step(f,row(3,2000,8));assert.equal(step(f,row(4,2500,8.5)).action,'REJECT');
  const end=step(f,row(5,4000,9));assert.equal(end.action,'REFERENCE_RESET');assert.equal(end.spanMs,2000);
  const g=new DistanceRelocationFilter({...exampleSettings,confirmationCount:2,confirmationDurationMs:2000});
  step(g,row(1,0,0));step(g,row(2,1000,8));assert.equal(step(g,row(3,3000,8)).action,'REFERENCE_RESET');
});
test('return to old reference cancels candidate; speed-only rejection cannot relocate',()=>{
  const f=new DistanceRelocationFilter(exampleSettings);step(f,row(1,0,0));step(f,row(2,1000,8));
  assert.equal(step(f,row(3,1500,0.5)).action,'ACCEPT');assert.equal(f.inspect('A')?.candidate,null);
  assert.deepEqual(step(f,row(4,1510,2)).reasons,['MEASUREMENT_REJECTED_BY_SPEED']);
  assert.equal(f.inspect('A')?.reference?.x,0.5);assert.equal(f.inspect('A')?.candidate,null);
});
test('long gap does not bypass distance; inconsistent cluster, speed and expired candidate restart',()=>{
  const f=new DistanceRelocationFilter(exampleSettings);step(f,row(1,0,0));
  assert.equal(step(f,row(2,20000,8)).action,'REJECT');
  assert.equal(step(f,row(3,20500,12)).candidateStatus,'RESTARTED');
  assert.equal(step(f,row(4,20510,12.8)).candidateStatus,'RESTARTED');
  assert.equal(step(f,row(5,24000,12.8)).candidateStatus,'RESTARTED');assert.equal(f.inspect('A')?.reference?.id,'1');
});
test('duplicate and out-of-order points do not count; stale/low-quality/future points cannot seed candidate',()=>{
  const f=new DistanceRelocationFilter(exampleSettings);step(f,row(1,0,0));step(f,row(2,1000,8));
  assert.equal(step(f,row(3,1000,8.1)).action,'IGNORE');assert.equal(step(f,row(4,500,8)).action,'IGNORE');
  assert.equal(f.inspect('A')?.candidate?.count,1);
  assert.equal(step(f,{...row(5,2000,8),quality:0.1}).action,'REJECT');assert.equal(f.inspect('A')?.candidate,null);
  assert.equal(step(f,row(6,3000,8),origin+8000).action,'REJECT');assert.equal(f.inspect('A')?.reference?.id,'1');
  assert.equal(step(f,row(7,12000,8),origin+9000).action,'REJECT');
});
test('references are independent and settings validate',()=>{
  const f=new DistanceRelocationFilter(exampleSettings);step(f,row(1,0,0));step(f,row(2,0,20,0,'B'));
  step(f,row(3,1000,8));assert.equal(f.inspect('B')?.reference?.x,20);assert.equal(f.inspect('B')?.candidate,null);
  f.clear('A');assert.equal(f.inspect('A'),undefined);
  for(const bad of [{distanceMeters:-1},{distanceMeters:Infinity},{clusterRadiusMeters:4},{confirmationCount:1},{confirmationCount:2.5},{confirmationDurationMs:0},{candidateWindowMs:1000}])
    assert.throws(()=>new DistanceRelocationFilter({...exampleSettings,...bad}));
});
const base=JSON.parse(readFileSync(new URL('../../../config/maps/necmettin-servis/regions.json',import.meta.url),'utf8'));
const config=compileRegionsConfig(base);
const options={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:1000,observationMs:60000};
const truth:Truth={testId:'test-00000000-0000-0000-0000-000000000099',timezone:'Europe/Istanbul',revision:1,revisionReason:'synthetic experiment',test:{from:at(0),to:at(15000)},visits:[],groups:[{id:'test',tagCodes:['A','B']}]};
test('disabled filter exactly equals the existing replay, including decisions and measurement/delivery clocks',()=>{
  const p=config.regions[0].roomCenter;
  const rows=[row(1,0,p.x,p.y),{...row(2,1000,p.x,p.y),received_at:at(1500)},row(3,2000,p.x,p.y, 'B')];
  const {filterEvents,...actual}=replayWithDistanceFilter(rows,truth,config,options,{...exampleSettings,distanceMeters:0});
  assert.deepEqual(actual,replayRows(rows,truth,config,options));assert.deepEqual(filterEvents,[]);
});
test('reset clears the old engine epoch; no B/C/D evidence or bridge, speed-rejected E cannot sneak into fresh engine',()=>{
  const a=config.regions[0].roomCenter,b=config.regions.at(-1)!.roomCenter;
  const rows=[row(1,0,a.x,a.y),row(2,1000,b.x,b.y),row(3,2000,b.x,b.y),row(4,3000,b.x,b.y),
    row(5,3010,b.x+2,b.y),row(6,4000,b.x,b.y)];
  const r=replayWithDistanceFilter(rows,truth,config,options,exampleSettings);
  assert.deepEqual(r.filterEvents.map(e=>e.action),['ACCEPT','REJECT','REJECT','REFERENCE_RESET','REJECT','ACCEPT']);
  assert.ok(r.decisions.some(d=>d.eventType==='FILTER_REFERENCE_RESET'&&d.roomId===null));
  for(const n of [1000,2000,3000,3010])assert.ok(!r.decisions.some(d=>d.input.measuredAt===at(n)&&['ROOM_CONFIRMED','ENTRY_CANDIDATE','ROOM_INFERRED','ROOM_TRANSITIONED'].includes(d.eventType??'')));
  assert.ok(r.decisions.some(d=>d.input.measuredAt===at(4000)&&d.eventType==='ENTRY_CANDIDATE'));
  assert.deepEqual(r,replayWithDistanceFilter(rows,truth,config,options,exampleSettings));
});
test('continued distance rejection cannot renew room evidence or prevent expiry',()=>{
  const a=config.regions[0].roomCenter;
  const rows=Array.from({length:6},(_,i)=>row(i+1,i*1000,a.x,a.y));
  for(let i=6;i<50;i++)rows.push(row(i+1,i*1000,i%2?100:-100,100));
  const r=replayWithDistanceFilter(rows,{...truth,test:{from:at(0),to:at(60000)}},config,options,exampleSettings);
  assert.ok(r.decisions.some(d=>d.state==='IN_REGION'));
  assert.ok(r.decisions.filter(d=>Date.parse(d.at)>origin+40000).every(d=>d.roomId===null));
  assert.equal(r.filterEvents.filter(e=>e.action==='REFERENCE_RESET').length,0);
});
test('lost time is integrated per scored tag, clipped to scoring window',()=>{
  const d=(tagCode:string,n:number,state:Decision['state'])=>({tagCode,at:at(n),state} as Decision);
  const events=[d('A',-1000,'LOCATION_LOST'),d('B',0,'LOCATION_LOST'),d('C',500,'LOCATION_LOST'),d('A',1000,'IN_REGION'),d('B',2000,'IN_REGION'),d('A',3000,'LOCATION_LOST')];
  assert.equal(locationLostSeconds(events,['A','B'],at(0),at(5000)),5);
});
test('experiment starts no listener, controller, SSE or database writes and imports the production engine',()=>{
  const text=readFileSync(new URL('./distance-relocation.ts',import.meta.url),'utf8');
  assert.match(text,/import \{RegionPositionEngine\} from/);
  assert.doesNotMatch(text,/\.listen\s*\(|createServer\s*\(|queryPostgres\s*\(|from ['"][^'"]*(?:controller|trackingBuffer|roomDecisions)['"]/);
});
