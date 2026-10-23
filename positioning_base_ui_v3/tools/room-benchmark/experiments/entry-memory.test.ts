import test from 'node:test';
import assert from 'node:assert/strict';
import {Server,Socket} from 'node:net';
import {readFileSync} from 'node:fs';
import {scenarioConfig} from '../../../test_api/room_scenarios.js';
import type {RegionsConfig} from '../../../src/features/regions/types/region.types';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import {replayRows} from '../replay';
import type {RawRow,Truth} from '../model';
import {entryMemoryFactory,ENTRY_MEMORY_POLICIES,type EntryMemoryTrace} from './entry-memory';

const origin=Date.parse('2026-10-13T00:00:00Z');
const at=(time:number)=>new Date(origin+time).toISOString();
const source=scenarioConfig() as RegionsConfig;
const config=compileRegionsConfig({...source,engine:{...source.engine,entryConfirmationCount:3,entryEvidenceDurationMs:1500,
  maximumSpeedMetersPerSecond:20,maximumStepDistanceMeters:10},
  regions:source.regions.map(r=>({...r,coverage:'regular',entrances:[]}))});
const truth:Truth={testId:'test-00000000-0000-0000-0000-000000000002',timezone:'Europe/Istanbul',revision:1,revisionReason:'anonymous entry-memory fixture',
  test:{from:at(0),to:at(8000)},groups:[{id:'route',tagCodes:['A','B']}],visits:[{roomId:'A',from:at(0),to:at(7000)}]};
const options={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:0,observationMs:40000};
const row=(id:number,t:number,kind:'inside'|'outside'|'other'|'wall',tag='A',quality=1,delivered=t):RawRow=>({
  id:String(id),tag_code:tag,x:kind==='other'?9:3,y:kind==='outside'?-1:kind==='wall'?0.1:3,
  created_at:at(t),received_at:at(delivered),quality,map_id:'simulation-reference',zone_id:null,zone_name:null});
const confirmed=(result:ReturnType<typeof replayRows>,tag='A')=>result.decisions.filter(d=>d.tagCode===tag&&d.state==='IN_REGION');

test('two inside, one outside, returning third inside can confirm; outside never counts',()=>{
  const rows=[row(1,0,'inside'),row(2,1000,'inside'),row(3,1500,'outside'),row(4,2500,'inside'),row(5,3500,'inside')];
  const base=replayRows(rows,truth,config,options),trace:EntryMemoryTrace[]=[];
  const result=replayRows(rows,truth,config,options,entryMemoryFactory(ENTRY_MEMORY_POLICIES[0],trace));
  assert.equal(confirmed(base).length,0);
  assert.equal(confirmed(result)[0].at,at(2500));
  assert.equal(confirmed(result)[0].evidence?.collectedMeasurements,3);
  assert.equal(result.decisions.find(d=>d.at===at(1500)&&!d.synthetic)?.roomId,null);
  assert.equal(trace.find(t=>t.action==='confirmed')?.strongInsidePoints,3);
  assert.deepEqual(result,replayRows(rows,truth,config,options,entryMemoryFactory(ENTRY_MEMORY_POLICIES[0])));
});
test('two outside points, a different room, timeout or overall window expire evidence',()=>{
  for(const rows of [
    [row(1,0,'inside'),row(2,1000,'inside'),row(3,1500,'outside'),row(4,1700,'outside'),row(5,2500,'inside')],
    [row(1,0,'inside'),row(2,1000,'inside'),row(3,1500,'other'),row(4,2500,'inside')],
    [row(1,0,'inside'),row(2,1000,'inside'),row(3,1500,'outside'),row(4,3500,'inside')],
    [row(1,0,'inside'),row(2,3500,'inside'),row(3,5500,'outside'),row(4,6500,'inside')],
  ])assert.equal(confirmed(replayRows(rows,truth,config,options,entryMemoryFactory(ENTRY_MEMORY_POLICIES[0]))).length,0);
});
test('rejected, duplicate and weak wall points do not become reliable inside evidence',()=>{
  const rows=[row(1,0,'inside'),row(2,1000,'inside'),row(3,1500,'outside'),row(4,2000,'inside','A',0.1),
    row(5,1000,'inside','A',1,2100),row(6,2200,'wall')];
  assert.equal(confirmed(replayRows(rows,truth,config,options,entryMemoryFactory(ENTRY_MEMORY_POLICIES[0]))).length,0);
  const result=replayRows([...rows,row(7,2500,'inside')],truth,config,options,entryMemoryFactory(ENTRY_MEMORY_POLICIES[0]));
  assert.equal(confirmed(result)[0].evidence?.collectedMeasurements,3);
  assert.equal(confirmed(result)[0].at,at(2500));
});
test('delivery and measurement clocks both bound return; delays cannot silently extend memory',()=>{
  const rows=[row(1,0,'inside'),row(2,1000,'inside'),row(3,1500,'outside'),row(4,2500,'inside','A',1,3501)];
  assert.equal(confirmed(replayRows(rows,truth,config,options,entryMemoryFactory(ENTRY_MEMORY_POLICIES[0]))).length,0);
});
test('service five-point requirement remains five; outside-free replay is identical',()=>{
  const service=compileRegionsConfig({...source,engine:{...source.engine,entryConfirmationCount:5,entryEvidenceDurationMs:2000,
    maximumSpeedMetersPerSecond:20,maximumStepDistanceMeters:10},regions:source.regions.map(r=>({...r,coverage:'regular',entrances:[]}))});
  const rows=[row(1,0,'inside'),row(2,1000,'inside'),row(3,1500,'outside'),row(4,2500,'inside'),row(5,3000,'inside')];
  assert.equal(confirmed(replayRows(rows,truth,service,options,entryMemoryFactory(ENTRY_MEMORY_POLICIES[0]))).length,0);
  assert.equal(confirmed(replayRows([...rows,row(6,3200,'inside')],truth,service,options,entryMemoryFactory(ENTRY_MEMORY_POLICIES[1])))[0].evidence?.collectedMeasurements,5);
  const continuous=[row(1,0,'inside'),row(2,1000,'inside'),row(3,2000,'inside')];
  assert.deepEqual(replayRows(continuous,truth,config,options,entryMemoryFactory(ENTRY_MEMORY_POLICIES[0])),replayRows(continuous,truth,config,options));
});
test('tags are independent, native ticks continue and no network/listener/timer is started',()=>{
  const rows=[row(1,0,'inside'),row(2,500,'outside','B'),row(3,1000,'inside'),row(4,1500,'outside'),row(5,2000,'outside','B'),row(6,2500,'inside')];
  const timer=globalThis.setInterval,listen=Server.prototype.listen,connect=Socket.prototype.connect;
  try{
    globalThis.setInterval=(()=>{throw Error('timer forbidden');}) as typeof timer;
    Server.prototype.listen=(()=>{throw Error('listener forbidden');}) as typeof listen;
    Socket.prototype.connect=(()=>{throw Error('network / DB forbidden');}) as typeof connect;
    const result=replayRows(rows,truth,config,options,entryMemoryFactory(ENTRY_MEMORY_POLICIES[0]));
    assert.ok(confirmed(result).length);assert.equal(confirmed(result,'B').length,0);
    assert.ok(result.decisions.some(d=>d.synthetic&&d.state==='LOCATION_LOST'&&d.at>truth.test.to));
  }finally{globalThis.setInterval=timer;Server.prototype.listen=listen;Socket.prototype.connect=connect;}
  const source=readFileSync(new URL('./entry-memory.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from ['"][^'"]*(?:controller|trackingBuffer|roomDecisions|postgresClient)['"]/);
});
test('corridor jitter can create a false entry: acceptance of this sequence alone is not proof of truth',()=>{
  const corridorTruth={...truth,groups:[{id:'route',tagCodes:['A']}],visits:[]};
  const rows=[row(1,0,'inside'),row(2,1000,'inside'),row(3,1500,'outside'),row(4,2500,'inside')];
  const base=replayRows(rows,corridorTruth,config,options);
  const result=replayRows(rows,corridorTruth,config,options,entryMemoryFactory(ENTRY_MEMORY_POLICIES[0]));
  assert.equal(base.metrics.summary.corridorFalseRoomMs,0);
  assert.ok(result.metrics.summary.corridorFalseRoomMs>0);
});
