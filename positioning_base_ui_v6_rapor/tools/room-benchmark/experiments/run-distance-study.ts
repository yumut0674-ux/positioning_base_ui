import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {ROOM_ENGINE_VERSION} from '../../../src/server/regionEngine/RegionPositionEngine';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import {readDataset} from '../importer';
import {sha256} from '../model';
import {replayRows} from '../replay';
import {exampleSettings,replayWithDistanceFilter,type FilterSettings} from './distance-relocation';
import {locationLostSeconds} from './study-metrics';

const args=process.argv.slice(2),option=(name:string,fallback:string)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
const scope=option('scope','service'),runId=option('run-id','distance-relocation-servis-20261012');
if(!/^[a-zA-Z0-9-]+$/.test(runId)||!['service','other'].includes(scope))throw new Error('Invalid scope/run ID');
const root=path.resolve('tools/room-benchmark'),out=path.join(root,'reports',runId);
const hashes=async(files:string[])=>Object.fromEntries(await Promise.all(files.map(async file=>[file,await sha256(await readFile(file))])));
const protectedFiles=['src/server/regionEngine/RegionPositionEngine.ts','src/server/regionEngine/controller.ts',
  'config/maps/necmettin-servis/regions.json','config/maps/spor-koridor/regions.json','config/maps/necmettin-yogun-bakim/regions.json'];
const protectedBefore=await hashes(protectedFiles);
const sourceHashes=await hashes(['tools/room-benchmark/experiments/distance-relocation.ts','tools/room-benchmark/experiments/run-distance-study.ts','tools/room-benchmark/experiments/study-metrics.ts','tools/room-benchmark/replay.ts','tools/room-benchmark/score.ts']);
await mkdir(out); // New study only; never overwrite a previous run.
const variants:{name:string;settings:FilterSettings}[]=(scope==='service'?[
  ['off',{distanceMeters:0}],['D2', {distanceMeters:2}],['D3',{}],['D5',{distanceMeters:5}],
  ['D3-R05',{clusterRadiusMeters:0.5}],['D3-R15',{clusterRadiusMeters:1.5}],
  ['D3-fast',{confirmationCount:2,confirmationDurationMs:750}],
  ['D3-strict',{confirmationCount:4,confirmationDurationMs:2500}],
  ['prechecks-control',{distanceMeters:100}]
]:[['off',{distanceMeters:0}],['D3',{}],['D5',{distanceMeters:5}]]).map(([name,change])=>({name:name as string,settings:{...exampleSettings,...change as Partial<FilterSettings>}}));
const git={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim()};
type Visit={index:number;roomId:string;from:string;to:string;missed:boolean;entryDelayMs:number|null;exitDelayMs:number|null};
const tests:any[]=[];
const skipped:{id:string;reason:string}[]=[];
for(const id of (await readdir(path.join(root,'datasets'))).sort()){
  if(id.includes('00000000'))continue;
  let dataset:Awaited<ReturnType<typeof readDataset>>;
  try{dataset=await readDataset(id);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){skipped.push({id,reason:'No immutable raw export'});continue;}throw error;}
  const {truth,manifest,rows,truthSha256}=dataset,maps=Object.keys(manifest.mapIds);
  if(maps.length!==1)throw new Error('Mixed map dataset must be partitioned explicitly: '+id);
  const mapId=maps[0];if((scope==='service')!==(mapId==='necmettin-servis'))continue;
  if(!truth.groups.flatMap(g=>g.tagCodes).length){skipped.push({id,reason:'Unconfirmed tag assignment; not scored'});continue;}
  const configPath=path.resolve('config/maps',mapId,'regions.json'),configBytes=await readFile(configPath),config=compileRegionsConfig(JSON.parse(configBytes.toString()));
  for(const v of truth.visits)if(!config.regions.some(r=>r.id===v.roomId))throw new Error('Truth room not in map: '+v.roomId);
  const simulation={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:manifest.warmupMs,observationMs:manifest.observationMs};
  const metadata={testId:id,engineVersion:ROOM_ENGINE_VERSION,git,sourceHashes,config:{path:configPath,sha256:await sha256(configBytes),version:config.version,context:'Historical field data + current map'},
    dataset:{sha256:manifest.sha256,truthSha256,truthRevision:truth.revision,rowCount:manifest.rowCount,timing:manifest.timing,quality:manifest.quality},simulation};
  await writeFile(path.join(out,id+'-config.json'),configBytes);
  const baseline=replayRows(rows,truth,config,simulation),baseVisits=Object.entries(baseline.metrics.tags).flatMap(([tag,t])=>(t.visits as Visit[]).map(v=>({...v,tag})));
  const testResult={...metadata,mapId,trials:[] as any[]};
  for(const variant of variants){
    const result=replayWithDistanceFilter(rows,truth,config,simulation,variant.settings);
    assert.deepEqual(result,replayWithDistanceFilter(rows,truth,config,simulation,variant.settings));
    if(variant.name==='off'){const {filterEvents,...without}=result;assert.deepEqual(without,baseline);}
    const visits=Object.entries(result.metrics.tags).flatMap(([tag,t])=>(t.visits as Visit[]).map(v=>({...v,tag,timeline:undefined})));
    const roomTime=Object.values(result.metrics.tags).flatMap(t=>Object.values(t.roomsTolerant));
    const tolerantDenominator=roomTime.reduce((sum,c)=>sum+c.totalMs,0),tolerantCorrect=roomTime.reduce((sum,c)=>sum+c.correctConfirmedMs+c.correctInferredMs,0);
    const during=result.filterEvents.filter(e=>e.deliveredAt>=truth.test.from&&e.deliveredAt<truth.test.to),s=result.metrics.summary;
    const gained=visits.filter((v,i)=>!v.missed&&baseVisits[i].missed),lost=visits.filter((v,i)=>v.missed&&!baseVisits[i].missed);
    const matched=visits.map((v,i)=>({v,base:baseVisits[i]})).filter(({v,base})=>!v.missed&&!base.missed);
    const lostSeconds=locationLostSeconds(result.decisions,truth.groups.flatMap(g=>g.tagCodes),truth.test.from,truth.test.to);
    const summary={name:variant.name,filter:variant.settings,caught:visits.filter(v=>!v.missed).length,totalVisits:visits.length,
      roomPercent:result.metrics.roomOnlySuccessPercent,tolerantRoomPercent:100*tolerantCorrect/tolerantDenominator,
      roomSeconds:result.metrics.actualRoomMs/1000,confirmedSeconds:s.correctConfirmedMs/1000,inferredSeconds:s.correctInferredMs/1000,
      wrongRoomSeconds:s.wrongRoomMs/1000,corridorFalseSeconds:s.corridorFalseRoomMs/1000,uncertainSeconds:s.lostOrUncertainMs/1000,locationLostSeconds:lostSeconds,
      distanceRejects:during.filter(e=>e.action==='REJECT'&&e.reasons.includes('MEASUREMENT_REJECTED_BY_DISTANCE')).length,
      referenceResets:during.filter(e=>e.action==='REFERENCE_RESET').length,candidateRestarts:during.filter(e=>e.candidateStatus==='RESTARTED').length,
      accepted:during.filter(e=>e.action==='ACCEPT').length,gained,lost,matchedVisits:matched.length,
      entryDelayDeltaSeconds:matched.length?matched.reduce((sum,{v,base})=>sum+v.entryDelayMs!-base.entryDelayMs!,0)/matched.length/1000:null,
      unchangedFromBaseline:JSON.stringify(result.metrics)===JSON.stringify(baseline.metrics),visits};
    await writeFile(path.join(out,id+'-'+variant.name+'.json'),JSON.stringify({...metadata,variant,adapterVersion:'distance-experiment-v1',deterministic:true,...result},null,2)+'\n');
    testResult.trials.push(summary);
    console.log(JSON.stringify({test:id.split('-')[1],variant:variant.name,caught:summary.caught,total:summary.totalVisits,roomPercent:summary.roomPercent,wrong:summary.wrongRoomSeconds,corridor:summary.corridorFalseSeconds,resets:summary.referenceResets}));
  }
  tests.push(testResult);
}
assert.deepEqual(await hashes(protectedFiles),protectedBefore,'Engine or map changed during study: comparison invalid');
const totals=variants.map(variant=>{
  const trials=tests.map(t=>t.trials.find((r:any)=>r.name===variant.name));
  const sum=(key:string)=>trials.reduce((s,t)=>s+t[key],0),roomSeconds=sum('roomSeconds');
  return {name:variant.name,settings:variant.settings,caught:sum('caught'),totalVisits:sum('totalVisits'),
    roomPercent:100*(sum('confirmedSeconds')+sum('inferredSeconds'))/roomSeconds,roomSeconds,
    confirmedSeconds:sum('confirmedSeconds'),inferredSeconds:sum('inferredSeconds'),wrongRoomSeconds:sum('wrongRoomSeconds'),
    corridorFalseSeconds:sum('corridorFalseSeconds'),uncertainSeconds:sum('uncertainSeconds'),locationLostSeconds:sum('locationLostSeconds'),
    distanceRejects:sum('distanceRejects'),referenceResets:sum('referenceResets'),candidateRestarts:sum('candidateRestarts'),
    gained:trials.reduce((s,t)=>s+t.gained.length,0),lost:trials.reduce((s,t)=>s+t.lost.length,0)};
});
await writeFile(path.join(out,'summary.json'),JSON.stringify({scope,engine:ROOM_ENGINE_VERSION,git,sourceHashes,protectedBefore,protectedAfter:await hashes(protectedFiles),variants,tests,totals,skipped},null,2)+'\n');
console.log(JSON.stringify({out,totals},null,2));
