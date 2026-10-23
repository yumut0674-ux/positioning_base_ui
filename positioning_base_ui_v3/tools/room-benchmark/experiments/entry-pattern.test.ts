import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scenarioConfig} from '../../../test_api/room_scenarios.js';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import type {RegionsConfig} from '../../../src/features/regions/types/region.types';
import type {RawRow,Truth} from '../model';
import {replayRows} from '../replay';
import {entryMemoryFactory,ENTRY_PATTERN_POLICIES,type EntryMemoryTrace} from './entry-memory';

const epoch=Date.parse('2026-10-13T00:00:00Z'),at=(n:number)=>new Date(epoch+n).toISOString();
const source=scenarioConfig() as RegionsConfig;
const makeConfig=(points:number)=>compileRegionsConfig({...source,engine:{...source.engine,entryConfirmationCount:points,
  entryEvidenceDurationMs:1500,maximumSpeedMetersPerSecond:20,maximumStepDistanceMeters:10},
  regions:source.regions.map(r=>({...r,coverage:'regular',entrances:[]}))});
const truth:Truth={testId:'test-00000000-0000-0000-0000-000000000003',timezone:'Europe/Istanbul',revision:1,revisionReason:'anonymous pattern fixture',
  test:{from:at(0),to:at(8000)},visits:[{roomId:'A',from:at(0),to:at(7000)}],groups:[{id:'walker',tagCodes:['A']}]};
const opts={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:0,observationMs:40000};
const row=(id:number,t:number,kind:'inside'|'outside'|'weak'|'other',quality=1,tag='A'):RawRow=>({id:String(id),tag_code:tag,
  x:kind==='other'?9:3,y:kind==='outside'?-1:kind==='weak'?0.1:3,created_at:at(t),received_at:at(t),quality,
  map_id:'simulation-reference',zone_id:null,zone_name:null});
const rows=[row(1,0,'inside'),row(2,1000,'inside'),row(3,1500,'outside'),row(4,2500,'inside'),row(5,3000,'inside')];
const confirmed=(r:ReturnType<typeof replayRows>,tag='A')=>r.decisions.filter(d=>d.tagCode===tag&&d.state==='IN_REGION');

test('user sequence waits for second returning inside point in ICU and Service; source config is unchanged',()=>{
  for(const points of [3,5]){
    const config=makeConfig(points),before=structuredClone(config),trace:EntryMemoryTrace[]=[];
    const result=replayRows(rows,truth,config,opts,entryMemoryFactory(ENTRY_PATTERN_POLICIES[1],trace));
    assert.equal(confirmed(result)[0].at,at(3000));assert.equal(confirmed(result)[0].evidence?.collectedMeasurements,4);
    assert.equal(result.decisions.find(d=>d.at===at(2500)&&!d.synthetic)?.state,'ENTRY_CANDIDATE');
    assert.equal(trace.find(t=>t.action==='confirmed')?.recentPattern,'IIOII');
    assert.deepEqual(config,before,'temporary alternative may never change the shared compiled config');
    assert.deepEqual(result,replayRows(rows,truth,config,opts,entryMemoryFactory(ENTRY_PATTERN_POLICIES[1])));
  }
});
test('map-count-preserving variant still needs five Service inside points',()=>{
  const config=makeConfig(5),factory=()=>entryMemoryFactory(ENTRY_PATTERN_POLICIES[3]);
  assert.equal(confirmed(replayRows(rows,truth,config,opts,factory())).length,0);
  const result=replayRows([...rows,row(6,3500,'inside')],truth,config,opts,factory());
  assert.equal(confirmed(result)[0].evidence?.collectedMeasurements,5);
  assert.equal(confirmed(result)[0].at,at(3500));
});
test('exact IIOII rule differs from general four-of-five: it requires two inside before the outside',()=>{
  const config=makeConfig(5);
  const alternative=[row(1,0,'inside'),row(2,500,'outside'),row(3,1000,'inside'),row(4,2000,'inside'),row(5,2500,'inside')];
  assert.equal(confirmed(replayRows(alternative,truth,config,opts,entryMemoryFactory(ENTRY_PATTERN_POLICIES[4]))).length,0);
  assert.ok(confirmed(replayRows(alternative,truth,config,opts,entryMemoryFactory(ENTRY_PATTERN_POLICIES[1]))).length);
  assert.equal(confirmed(replayRows(rows,truth,config,opts,entryMemoryFactory(ENTRY_PATTERN_POLICIES[4])))[0].at,at(3000));
});
test('ordinary consecutive entry requirements are preserved; alternative is not a global count change',()=>{
  for(const points of [3,5]){
    const config=makeConfig(points),continuous=[row(1,0,'inside'),row(2,1000,'inside'),row(3,2000,'inside'),row(4,2500,'inside')];
    const before=replayRows(continuous,truth,config,opts),after=replayRows(continuous,truth,config,opts,entryMemoryFactory(ENTRY_PATTERN_POLICIES[1]));
    // Variant config fingerprints intentionally change IDs; every decision field and score must match.
    const semantic=(v:unknown)=>JSON.parse(JSON.stringify(v,(key,value)=>key==='decisionId'?undefined:value));
    assert.deepEqual(semantic(after.metrics),semantic(before.metrics));
    assert.deepEqual(semantic(after.decisions),semantic(before.decisions));
    assert.equal(confirmed(after).length>0,points===3);
  }
});
test('second outside, another room, weak point and rejected point cannot satisfy four-of-five',()=>{
  const config=makeConfig(3),factory=()=>entryMemoryFactory(ENTRY_PATTERN_POLICIES[1]);
  for(const items of [
    [rows[0],rows[1],rows[2],row(6,1800,'outside'),rows[3],rows[4]],
    [rows[0],rows[1],row(3,1500,'other'),rows[3],rows[4]],
    [rows[0],row(6,500,'weak'),rows[1],rows[2],rows[3],rows[4]],
    [...rows.slice(0,4),row(5,3000,'inside',0.1)],
  ])assert.equal(confirmed(replayRows(items,truth,config,opts,factory())).length,0);
});
test('evidence variant ignores weak inside without counting it, whereas raw-window variant consumes its slot',()=>{
  const config=makeConfig(3),withWeak=[rows[0],row(6,500,'weak'),...rows.slice(1)];
  const strict=replayRows(withWeak,truth,config,opts,entryMemoryFactory(ENTRY_PATTERN_POLICIES[4]));
  const evidence=replayRows(withWeak,truth,config,opts,entryMemoryFactory(ENTRY_PATTERN_POLICIES[5]));
  assert.equal(confirmed(strict).length,0);assert.equal(confirmed(evidence)[0].at,at(3000));
  assert.equal(confirmed(evidence)[0].evidence?.collectedMeasurements,4);
});
test('two returning inside measurements must occur before the configured deadline on both clocks',()=>{
  const config=makeConfig(3),delayed=[...rows.slice(0,4),row(5,3101,'inside')];
  assert.equal(confirmed(replayRows(delayed,truth,config,opts,entryMemoryFactory(ENTRY_PATTERN_POLICIES[0]))).length,0);
  const delayedDelivery={...rows[4],received_at:at(4601)};
  assert.equal(confirmed(replayRows([...rows.slice(0,4),delayedDelivery],truth,config,opts,entryMemoryFactory(ENTRY_PATTERN_POLICIES[1]))).length,0);
});
test('independent tag state and true corridor jitter risk remain visible',()=>{
  const config=makeConfig(3),twoTags={...truth,groups:[{id:'walker',tagCodes:['A','B']}]};
  const result=replayRows([...rows,row(6,500,'outside',1,'B'),row(7,2700,'inside',1,'B')],twoTags,config,opts,entryMemoryFactory(ENTRY_PATTERN_POLICIES[1]));
  assert.ok(confirmed(result).length);assert.equal(confirmed(result,'B').length,0);
  const corridor={...truth,visits:[]};
  const base=replayRows(rows,corridor,config,opts),pattern=replayRows(rows,corridor,config,opts,entryMemoryFactory(ENTRY_PATTERN_POLICIES[1]));
  assert.equal(base.metrics.summary.corridorFalseRoomMs,0);assert.ok(pattern.metrics.summary.corridorFalseRoomMs>0);
});
test('existing entry-memory v1 fixture decisions stay identical to archived field replay',async t=>{
  const dir='tools/room-benchmark/reports/entry-memory-hospital-20261013-verified';
  let archived;
  try{archived=JSON.parse(await readFile(dir+'/test-36f6f20f-65cb-49f4-b704-71912f20c01d-one-outside-3000-window6000.json','utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){t.skip('Optional private archive absent; anonymous tests remain portable');return;}throw error;}
  const {readDataset}=await import('../importer');
  const {ENTRY_MEMORY_POLICIES}=await import('./entry-memory');
  const data=await readDataset('test-36f6f20f-65cb-49f4-b704-71912f20c01d');
  const config=compileRegionsConfig(JSON.parse(await readFile(dir+'/necmettin-yogun-bakim-config.json','utf8')));
  const result=replayRows(data.rows,data.truth,config,archived.settings,entryMemoryFactory(ENTRY_MEMORY_POLICIES[1]));
  assert.deepEqual(result.decisions,archived.decisions);assert.deepEqual(result.metrics,archived.metrics);
});
