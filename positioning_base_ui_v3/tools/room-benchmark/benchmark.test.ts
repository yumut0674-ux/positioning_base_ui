import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileRegionsConfig } from '../../src/server/regionEngine/configLoader';
import type { RegionsConfig } from '../../src/features/regions/types/region.types';
import { replayRows } from './replay';
import { compare, markdown } from './report';
import { inspectRows } from './importer';
import { score } from './score';
import { spatialEvidence } from './spatialEvidence';
import type { RawRow, Truth } from './model';

const config=compileRegionsConfig(JSON.parse(readFileSync(new URL('../../config/maps/spor-koridor/regions.json',import.meta.url),'utf8')) as RegionsConfig);
const origin=Date.parse('2026-09-24T10:00:00.000Z');
const at=(n:number)=>new Date(origin+n).toISOString();
const truth:Truth={testId:'test-00000000-0000-0000-0000-000000000001',timezone:'Europe/Istanbul',revision:1,revisionReason:'fixture',test:{from:at(5000),to:at(20000)},visits:[{roomId:'room-03',from:at(7000),to:at(16000)}],groups:[{id:'walker',tagCodes:['A','B']}]};
const center=config.regions.find(r=>r.id==='room-03')!.roomCenter;
const row=(id:number,tag:string,measured:number,received:number|null,x=center.x,y=center.y):RawRow=>({id:String(id),tag_code:tag,x,y,created_at:at(measured),received_at:received===null?null:at(received),quality:1,map_id:'spor-koridor',zone_id:null,zone_name:null});
const opts={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:5000,observationMs:70000};

test('received_at delivers, created_at remains measurement time; id stabilizes ties; flush has no effect',()=>{
  const rows=[row(3,'A',3000,6000),row(2,'A',2000,6000),row(1,'A',1000,1000)] as (RawRow&{flushed_at?:string})[];
  rows[0].flushed_at=at(999999);
  const a=replayRows(rows,truth,config,opts),b=replayRows(rows.map(({flushed_at,...r})=>r),truth,config,opts);
  assert.deepEqual(a,b);
  const measured=a.decisions.filter(d=>d.tagCode==='A'&&d.eventType!=='LOCATION_LOST'&&d.input.measuredAt!==at(1000));
  assert.deepEqual(measured.slice(0,2).map(d=>d.input.measuredAt),[at(2000),at(3000)]);
  assert.deepEqual(measured.slice(0,2).map(d=>d.at),[at(6000),at(6000)]);
});
test('ticks continue without packets, post-test observation is separate, and warmup is unscored',()=>{
  const rows=[row(1,'A',1000,1000),row(2,'A',3000,3000),row(3,'A',5000,5000)];
  const r=replayRows(rows,truth,config,opts);
  assert.ok(r.decisions.some(d=>d.synthetic&&d.state==='LOCATION_LOST'&&Date.parse(d.at)>Date.parse(truth.test.to)));
  assert.ok(r.metrics.tags.A.observationEvents.length>0);
  assert.equal(r.metrics.tags.A.strict.totalMs,15000);
  assert.equal(r.metrics.tags.A.strict.correctConfirmedMs+r.metrics.tags.A.strict.correctInferredMs+r.metrics.tags.A.strict.wrongRoomMs+r.metrics.tags.A.strict.lostOrUncertainMs+r.metrics.tags.A.strict.corridorFalseRoomMs+r.metrics.tags.A.strict.outsideCorrectMs,15000);
});
test('tag state is independent; approximate timing is visible',()=>{
  const rows=[row(1,'A',1000,1000),row(2,'B',1000,1000,1e5,1e5),row(3,'A',3000,3000),row(4,'B',3000,3000,1e5,1e5),row(5,'A',5000,5000)];
  const r=replayRows(rows,truth,config,opts);
  assert.ok(r.decisions.some(d=>d.tagCode==='A'&&d.roomId==='room-03'));
  assert.ok(!r.decisions.some(d=>d.tagCode==='B'&&d.roomId==='room-03'));
  assert.equal(inspectRows([row(6,'A',6000,null)]).missingReceivedAt,1);
  const approximate=replayRows([row(6,'A',6000,null)],truth,config,opts);
  assert.ok(approximate.decisions.length>0);
});
test('uncertain and candidate states never count as correct; tolerance applies only to boundaries',()=>{
  const decisions=[{at:at(0),tagCode:'A',state:'ENTRY_CANDIDATE',roomId:'room-03',eventType:'ENTRY_CANDIDATE',reasonCodes:[],synthetic:false,input:{measuredAt:at(0),x:0,y:0}}];
  const result=score({...truth,groups:[{id:'walker',tagCodes:['A']}]},decisions,[],250,2000).tags.A;
  assert.equal(result.strict.correctConfirmedMs,0);
  assert.equal(result.strict.correctInferredMs,0);
  assert.ok(result.strict.lostOrUncertainMs>0);
  assert.equal(result.tolerant.totalMs,15000-8000);
  const resultSummary=score({...truth,groups:[{id:'walker',tagCodes:['A']}]},decisions,[],250,2000);
  assert.equal(resultSummary.roomOnlySuccessPercent,0);
  assert.ok(resultSummary.actualRoomMs>0);
});
test('same inputs reproduce decisions and metrics; compare rejects changed experiment',()=>{
  const rows=[row(1,'A',1000,1000),row(2,'A',3000,3000)];
  assert.deepEqual(replayRows(rows,truth,config,opts),replayRows(rows,truth,config,opts));
  const base={testId:'t',engineVersion:'v',git:{commit:'c',dirty:false,status:''},config:{sha256:'a'},dataset:{sha256:'b',truthRevision:1,truthSha256:'d'},simulation:{tickMs:1000,sampleMs:250,boundaryToleranceMs:2000},metrics:{tags:{}}};
  assert.throws(()=>compare(base as never,{...base,config:{sha256:'different'}} as never),/Farklı deneyler/);
});
test('benchmark replay has no live listener, controller, SSE or DB write path',()=>{
  const sources=['replay.ts','score.ts','report.ts'].map(name=>readFileSync(new URL(name,import.meta.url),'utf8'));
  for(const source of sources) {
    assert.doesNotMatch(source,/from ['"][^'"]*(?:controller|trackingBuffer|roomDecisions)['"]/);
    assert.doesNotMatch(source,/\.listen\s*\(|createServer\s*\(|queryPostgres\s*\(/);
  }
});
test('unassigned tags are explicitly unscored while decisions remain visible',()=>{
  const unassigned={...truth,groups:[]};
  const replay=replayRows([row(1,'A',1000,1000)],unassigned,config,opts);
  assert.ok(replay.decisions.length>0);
  assert.equal(replay.metrics.successPercent,null);
  const output=markdown({testId:truth.testId,engineVersion:'test',git:{commit:'test',dirty:false,status:''},
    config:{path:'fixture',sha256:'x',version:'x',context:'fixture'},
    dataset:{source:'fixture',caveat:'fixture',sha256:'x',rowCount:1,candidateTags:{A:1},timing:'exact',quality:inspectRows([row(1,'A',1000,1000)]),truthRevision:1,truthSha256:'x',warmupMs:5000,observationMs:70000},
    simulation:{tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,tickOrigin:at(0),equalTimeOrder:'tick then packet'},
    ...replay,schemaVersion:1});
  assert.match(output,/Motor kararları üretildi; oda doğruluğu hesaplanmadı/);
  assert.match(output,/Tag eşleşmesi doğrulanmadığı için süreler puanlanmadı/);
  assert.match(output,/Ham konum \/ sistem hatırlatması/);
});

test('report ends with raw spatial evidence and a system-level interpretation reminder',()=>{
  const room06=config.regions.find(region=>region.id==='room-06')!.roomCenter;
  const room01=config.regions.find(region=>region.id==='room-01')!.roomCenter;
  const visitTruth:Truth={...truth,visits:[{roomId:'room-06',from:at(7000),to:at(16000)}],groups:[{id:'walker',tagCodes:['A']}]};
  const rows=[row(1,'A',8000,8000,room06.x,room06.y),row(2,'A',9000,9000,room01.x,room01.y),
    row(3,'A',10000,10000,11,1),row(4,'A',11000,11000,100,100),{...row(5,'A',12000,12000),x:null}];
  const evidence=spatialEvidence(rows,visitTruth,config);
  assert.deepEqual(evidence,[{tagCode:'A',visitIndex:1,roomId:'room-06',packetCount:5,expectedRoomCount:1,
    otherRoomCounts:{'room-01':1},corridorCount:1,outsideMappedCount:1,missingCoordinatesCount:1}]);
  const output=markdown({schemaVersion:1,testId:visitTruth.testId,engineVersion:'test',git:{commit:'test',dirty:false,status:''},
    config:{path:'fixture',sha256:'x',version:'x',context:'fixture'},
    dataset:{source:'fixture',caveat:'fixture',sha256:'x',rowCount:rows.length,candidateTags:{A:rows.length},timing:'exact',
      quality:inspectRows(rows),truthRevision:1,truthSha256:'x',warmupMs:5000,observationMs:70000},
    simulation:{tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,tickOrigin:at(0),equalTimeOrder:'tick then packet'},
    unscoredTags:[],decisions:[],metrics:score(visitTruth,[],rows),rawSpatialEvidence:evidence});
  assert.match(output,/\| A \| 1\. room-06 \| 5 \| 1 \| room-01: 1 \| 1 \| 1 \| 1 \|/);
  assert.match(output.trimEnd().split('\n').at(-1)!,/^Hatırlatma: Gerçekte odadayken ham koordinatların/);
});
