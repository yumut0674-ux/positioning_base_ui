/** Parameter sensitivity of the real integrated engine; all mutations are local config copies. */
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {ROOM_ENGINE_VERSION} from '../../../src/server/regionEngine/RegionPositionEngine';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import {readDataset} from '../importer';
import {sha256} from '../model';
import {replayRows} from '../replay';
import {locationLostSeconds} from './study-metrics';

const runId=process.argv[2];if(!runId||!/^[a-zA-Z0-9-]+$/.test(runId))throw Error('New run ID required');
const root=path.resolve('tools/room-benchmark'),out=path.join(root,'reports',runId);await mkdir(out);
const protectedFiles=['src/server/regionEngine/RegionPositionEngine.ts','src/server/regionEngine/StepDistanceFilter.ts',
  'src/server/regionEngine/controller.ts','src/server/regionEngine/configLoader.ts','src/server/regionEngine/geometry.ts',
  'src/features/regions/config/regionInferenceSettings.ts','config/maps/necmettin-servis/regions.json','config/maps/necmettin-yogun-bakim/regions.json'];
const hashes=async(files:string[])=>Object.fromEntries(await Promise.all(files.map(async p=>[p,await sha256(await readFile(p))])));
const before=await hashes(protectedFiles);
const keys={D:'maximumStepDistanceMeters',R:'relocationClusterRadiusMeters',N:'relocationConfirmationCount',
  T:'relocationConfirmationDurationMs',G:'relocationMaximumGapMs',W:'relocationCandidateWindowMs'} as const;
const profiles:{name:string;changes:Partial<Record<keyof typeof keys,number>>}[]=[
  {name:'off',changes:{D:0}},{name:'current',changes:{}},
  {name:'D6',changes:{D:6}},{name:'D8',changes:{D:8}},{name:'D10',changes:{D:10}},
  {name:'R15',changes:{R:1.5}},{name:'R2',changes:{R:2}},
  {name:'T1000',changes:{T:1000}},{name:'T750',changes:{T:750}},{name:'N3',changes:{N:3}},
  {name:'G4000',changes:{G:4000}},
  {name:'D5-R15-T1000-G4000',changes:{R:1.5,T:1000,G:4000}},
  {name:'D5-R2-T1000-G4000',changes:{R:2,T:1000,G:4000}},
  {name:'D8-R15-T1000-G4000',changes:{D:8,R:1.5,T:1000,G:4000}},
  {name:'D8-R2-T1000-G4000',changes:{D:8,R:2,T:1000,G:4000}},
  {name:'D10-R2-T1000-G4000',changes:{D:10,R:2,T:1000,G:4000}},
  {name:'D8-R15-T1500-G4000',changes:{D:8,R:1.5,G:4000}},
  {name:'D8-R15-N3-T750-G4000',changes:{D:8,R:1.5,N:3,T:750,G:4000}},
  {name:'D5-R2-T1000-G4000-W10000',changes:{R:2,T:1000,G:4000,W:10000}}
];
type Visit={index:number;roomId:string;from:string;to:string;missed:boolean;entryDelayMs:number|null;exitDelayMs:number|null};
const tests:any[]=[],skipped:any[]=[];
for(const id of (await readdir(path.join(root,'datasets'))).sort()){
  let manifest:any;try{manifest=JSON.parse(await readFile(path.join(root,'datasets',id,'manifest.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}
  const maps=Object.keys(manifest.mapIds);if(maps.length!==1||!['necmettin-servis','necmettin-yogun-bakim'].includes(maps[0]))continue;
  const {rows,truth,truthSha256}=await readDataset(id);
  if(!truth.groups.some(g=>g.tagCodes.length)){skipped.push({id,reason:'Unconfirmed tag assignment'});continue;}
  const map=maps[0],configPath=path.resolve('config/maps',map,'regions.json'),bytes=await readFile(configPath),source=JSON.parse(bytes.toString());
  const simulation={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:manifest.warmupMs,observationMs:manifest.observationMs};
  const trials:any[]=[];
  for(const profile of profiles){
    const json=structuredClone(source);for(const [key,value] of Object.entries(profile.changes))json.engine[keys[key as keyof typeof keys]]=value;
    const config=compileRegionsConfig(json),result=replayRows(rows,truth,config,simulation);
    assert.deepEqual(result,replayRows(rows,truth,config,simulation));
    const visits=Object.entries(result.metrics.tags).flatMap(([tag,t])=>(t.visits as Visit[]).map(v=>({...v,tag,timeline:undefined})));
    const c=result.metrics.summary,events=result.decisions.filter(d=>!d.synthetic&&d.at>=truth.test.from&&d.at<truth.test.to);
    const tolerant=Object.values(result.metrics.tags).flatMap(t=>Object.values(t.roomsTolerant)),denominator=tolerant.reduce((s,c)=>s+c.totalMs,0);
    const summary={caught:visits.filter(v=>!v.missed).length,totalVisits:visits.length,roomPercent:result.metrics.roomOnlySuccessPercent,
      roomSeconds:result.metrics.actualRoomMs/1000,confirmedSeconds:c.correctConfirmedMs/1000,inferredSeconds:c.correctInferredMs/1000,
      wrongRoomSeconds:c.wrongRoomMs/1000,corridorFalseSeconds:c.corridorFalseRoomMs/1000,uncertainSeconds:c.lostOrUncertainMs/1000,
      locationLostSeconds:locationLostSeconds(result.decisions,Object.keys(result.metrics.tags),truth.test.from,truth.test.to),
      filterRejections:events.filter(d=>d.reasonCodes.includes('MEASUREMENT_REJECTED_BY_DISTANCE')).length,
      resets:events.filter(d=>d.reasonCodes.includes('DISTANCE_REFERENCE_REESTABLISHED')).length,
      tolerantRoomPercent:denominator?100*tolerant.reduce((s,c)=>s+c.correctConfirmedMs+c.correctInferredMs,0)/denominator:null,
      visits,rooms:Object.fromEntries(Object.entries(result.metrics.tags).map(([tag,t])=>[tag,t.rooms])),
      outputSha256:await sha256(Buffer.from(JSON.stringify(result)))};
    const configFile=id+'-'+profile.name+'-config.json';const configBytes=Buffer.from(JSON.stringify(json,null,2)+'\n');
    await writeFile(path.join(out,configFile),configBytes,{flag:'wx'});
    trials.push({profile:profile.name,configFile,configVersion:config.version,configSha256:await sha256(configBytes),
      parameters:Object.fromEntries(Object.entries(keys).map(([key,field])=>[key,config.rules[field]])),summary});
    // Keep complete decisions/metrics for base controls; other profiles retain reproducible fingerprints.
    if(['off','current'].includes(profile.name))await writeFile(path.join(out,id+'-'+profile.name+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  }
  tests.push({testId:id,map,simulation,dataset:{...manifest,truthSha256,truthRevision:truth.revision},sourceConfig:{path:configPath,sha256:await sha256(bytes),version:compileRegionsConfig(source).version},trials});
  console.log(JSON.stringify({test:id,profiles:trials.length,caught:trials.map(t=>[t.profile,t.summary.caught])}));
}
assert.deepEqual(await hashes(protectedFiles),before,'Engine/config changed during sweep');
const totals=[];
for(const map of [...new Set(tests.map(t=>t.map))])for(const profile of profiles){
  const data=tests.filter(t=>t.map===map).map(t=>t.trials.find((x:any)=>x.profile===profile.name).summary),sum=(key:string)=>data.reduce((s,t)=>s+t[key],0);
  totals.push({map,profile:profile.name,caught:sum('caught'),totalVisits:sum('totalVisits'),roomPercent:100*(sum('confirmedSeconds')+sum('inferredSeconds'))/sum('roomSeconds'),
    confirmedSeconds:sum('confirmedSeconds'),inferredSeconds:sum('inferredSeconds'),wrongRoomSeconds:sum('wrongRoomSeconds'),corridorFalseSeconds:sum('corridorFalseSeconds'),
    lostSeconds:sum('locationLostSeconds'),filterRejections:sum('filterRejections'),resets:sum('resets')});
}
const git={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim()};
await writeFile(path.join(out,'summary.json'),JSON.stringify({engine:ROOM_ENGINE_VERSION,git,profiles,tests,totals,skipped,
  sourceHashes:await hashes(['tools/room-benchmark/experiments/sweep-integrated-filter.ts','tools/room-benchmark/replay.ts','tools/room-benchmark/score.ts']),protectedBefore:before,protectedAfter:await hashes(protectedFiles)},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,totals},null,2));
