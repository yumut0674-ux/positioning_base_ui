import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileRegionsConfig} from '../../src/server/regionEngine/configLoader';
import {replayRows} from './replay';
import {compare} from './report';
import type {RawRow,Truth} from './model';
const config=compileRegionsConfig(JSON.parse(readFileSync(new URL('../../config/maps/spor-koridor/regions.json',import.meta.url),'utf8')));
const room=config.regions.find(r=>r.id==='room-03')!.roomCenter,origin=Date.parse('2026-10-13T00:00:00Z');
const at=(t:number)=>new Date(origin+t).toISOString();
const truth:Truth={testId:'test-00000000-0000-0000-0000-000000000001',timezone:'Europe/Istanbul',revision:1,revisionReason:'anonim PDOP fixture',
  test:{from:at(5000),to:at(20000)},visits:[{roomId:'room-03',from:at(7000),to:at(16000)}],groups:[{id:'route',tagCodes:['ANON']} ]};
const settings={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:5000,observationMs:70000};
const row=(id:number,t:number,pdop?:number|null):RawRow=>({id:String(id),tag_code:'ANON',x:room.x,y:room.y,created_at:at(t),received_at:at(t+200),quality:1,
  pdop,map_id:'spor-koridor',zone_id:null,zone_name:null});
test('PDOP rejects before engine without refreshing state; virtual ticks still reach LOCATION_LOST',()=>{
  const accepted=[row(1,1000,1),row(2,3000,2),row(3,5000,3)];
  const base=replayRows(accepted,truth,config,settings);
  const actual=replayRows([...accepted,{...row(4,7000,21),x:1e5},{...row(5,40000,21),x:1e5}],truth,config,settings);
  assert.deepEqual(actual.decisions,base.decisions);
  assert.deepEqual(actual.metrics,base.metrics);
  assert.equal(actual.preprocessing.pdop.rejected.length,2);
  assert.ok(actual.decisions.some(d=>d.synthetic&&d.state==='LOCATION_LOST'));
  assert.equal(actual.preprocessing.pdop.rejected[1].measuredAt,at(40000));
  assert.equal(actual.preprocessing.pdop.rejected[1].deliveredAt,at(40200));
});
test('PDOP 20, zero, null and missing pass; unknown geometry is explicitly counted',()=>{
  const values=[20,0,null,undefined];
  const actual=replayRows(values.map((v,i)=>row(i+1,1000+i*2000,v)),truth,config,settings);
  assert.equal(actual.preprocessing.pdop.rejected.length,0);
  assert.equal(actual.preprocessing.pdop.knownValues,2);
  assert.equal(actual.preprocessing.pdop.unknownValues,2);
  assert.deepEqual(actual.decisions.filter(d=>!d.synthetic).map(d=>d.input.pdop),[20,0,null,null]);
  assert.deepEqual(actual,replayRows(values.map((v,i)=>row(i+1,1000+i*2000,v)),truth,config,settings));
});
test('offline PDOP profiles keep rejected rows in the source and compare rejects different filter policies',()=>{
  const rows=[row(1,1000,12),row(2,3000,15),row(3,5000,4)];
  const original=structuredClone(rows);
  const lower=replayRows(rows,truth,config,{...settings,pdopMax:10});
  const off=replayRows(rows,truth,config,{...settings,pdopEnabled:false});
  assert.equal(lower.preprocessing.pdop.rejected.length,2);
  assert.equal(off.preprocessing.pdop.rejected.length,0);
  assert.deepEqual(rows,original);
  const base={testId:'t',engineVersion:'v',git:{commit:'c',dirty:false,status:''},config:{sha256:'a'},dataset:{sha256:'b',truthRevision:1,truthSha256:'d'},
    simulation:{tickMs:1000,sampleMs:250,boundaryToleranceMs:2000},metrics:{tags:{}}};
  assert.throws(()=>compare({...base,preprocessing:lower.preprocessing} as never,{...base,preprocessing:off.preprocessing} as never),/PDOP/);
});
