/** Evaluate the actual integrated engine. No experimental sidecar and no production writes. */
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import {runTest,type Run} from '../replay';
import {writeReport} from '../report';
import {sha256} from '../model';
import {locationLostSeconds} from './study-metrics';

const root=path.resolve('tools/room-benchmark');
const id=process.argv[2];if(!id||!/^[a-zA-Z0-9-]+$/.test(id))throw new Error('New run ID required');
const out=path.join(root,'reports',id);await mkdir(out);
const protectedFiles=['src/server/regionEngine/RegionPositionEngine.ts','src/server/regionEngine/StepDistanceFilter.ts',
  'src/server/regionEngine/controller.ts','src/server/regionEngine/configLoader.ts','src/server/regionEngine/geometry.ts',
  'src/features/regions/config/regionInferenceSettings.ts','config/maps/necmettin-servis/regions.json','config/maps/necmettin-yogun-bakim/regions.json'];
const hashFiles=async(files:string[])=>Object.fromEntries(await Promise.all(files.map(async p=>[p,await sha256(await readFile(p))])));
const before=await hashFiles(protectedFiles),sourceHashes=await hashFiles(['tools/room-benchmark/replay.ts','tools/room-benchmark/score.ts','tools/room-benchmark/experiments/run-integrated-filter-study.ts']);
const git={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim()};
type Visit={index:number;roomId:string;from:string;to:string;missed:boolean;entryDelayMs:number|null;exitDelayMs:number|null};
function summarize(run:Run){
  const visits=Object.entries(run.metrics.tags).flatMap(([tag,t])=>(t.visits as Visit[]).map(v=>({...v,tag,timeline:undefined})));
  const c=run.metrics.summary;
  const events=run.decisions.filter(d=>!d.synthetic&&Date.parse(d.at)>=Date.parse(run.simulation.tickOrigin)+run.dataset.warmupMs&&Date.parse(d.at)<Date.parse(run.simulation.tickOrigin)+run.dataset.warmupMs+c.totalMs/Math.max(1,Object.keys(run.metrics.tags).length));
  // Restricting counts by truth separately below also handles unscored data.
  return {caught:visits.filter(v=>!v.missed).length,totalVisits:visits.length,roomPercent:run.metrics.roomOnlySuccessPercent,
    roomSeconds:run.metrics.actualRoomMs/1000,confirmedSeconds:c.correctConfirmedMs/1000,inferredSeconds:c.correctInferredMs/1000,
    wrongRoomSeconds:c.wrongRoomMs/1000,corridorFalseSeconds:c.corridorFalseRoomMs/1000,uncertainSeconds:c.lostOrUncertainMs/1000,
    visits,filterRejections:events.filter(d=>d.reasonCodes.includes('MEASUREMENT_REJECTED_BY_DISTANCE')).length};
}
const tests:any[]=[];
for(const datasetId of (await readdir(path.join(root,'datasets'))).sort()){
  const dir=path.join(root,'datasets',datasetId);let manifest:any;
  try{manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}
  const maps=Object.keys(manifest.mapIds);if(maps.length!==1||!['necmettin-servis','necmettin-yogun-bakim'].includes(maps[0]))continue;
  const map=maps[0],truth=JSON.parse(await readFile(path.join(dir,'truth.json'),'utf8'));
  const livePath=path.resolve('config/maps',map,'regions.json'),bytes=await readFile(livePath),source=JSON.parse(bytes.toString());
  const previousDir=path.join(root,'reports',map==='necmettin-servis'?'distance-relocation-servis-final-20261013':'distance-relocation-other-final-20261013');
  let prior:any=null,configChanges:any[]=[];
  try{
    prior=JSON.parse(await readFile(path.join(previousDir,datasetId+'-off.json'),'utf8'));
    const oldConfig=JSON.parse(await readFile(path.join(previousDir,datasetId+'-config.json'),'utf8'));
    const walk=(a:any,b:any,p='')=>{if(JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[key],b[key],p+'/'+key);}else configChanges.push({path:p,before:a??null,after:b??null});};walk(oldConfig,source);
    assert.equal(prior.dataset.sha256,manifest.sha256);assert.equal(prior.dataset.truthSha256,await sha256(await readFile(path.join(dir,'truth.json'))));
  }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const testResult:any={testId:datasetId,map,truth,scored:truth.groups.some((g:any)=>g.tagCodes.length),configChanges,
    prior:prior?{engine:prior.engineVersion,config:prior.config,metrics:prior.metrics}:null,trials:[]};
  for(const variant of ['current','filter-off']){
    const configJson=structuredClone(source);if(variant==='filter-off')configJson.engine.maximumStepDistanceMeters=0;
    const configPath=path.join(out,datasetId+'-'+variant+'-config.json');await writeFile(configPath,JSON.stringify(configJson,null,2)+'\n',{flag:'wx'});
    const options={configPath,tickMs:1000,sampleMs:250,boundaryToleranceMs:2000},run=await runTest(datasetId,options),repeat=await runTest(datasetId,options);
    assert.deepEqual(run,repeat,'Replay must be deterministic');
    const reportDir=await writeReport(run,id+'-'+datasetId.split('-')[1]+'-'+variant);
    const events=run.decisions.filter(d=>!d.synthetic&&d.at>=truth.test.from&&d.at<truth.test.to);
    const lostToRejectedInference=run.decisions.filter((d,i)=>!d.synthetic&&d.at>=truth.test.from&&d.at<truth.test.to&&d.state==='INFERRED_IN_REGION'&&d.eventType==='MEASUREMENT_REJECTED'&&run.decisions.slice(0,i).findLast(x=>x.tagCode===d.tagCode)?.state==='LOCATION_LOST');
    const summary={...summarize(run),filterRejections:events.filter(d=>d.reasonCodes.includes('MEASUREMENT_REJECTED_BY_DISTANCE')).length,
      resets:events.filter(d=>d.reasonCodes.includes('DISTANCE_REFERENCE_REESTABLISHED')).length,
      rejectionReasons:Object.fromEntries([...new Set(events.flatMap(d=>d.reasonCodes).filter(r=>r.startsWith('MEASUREMENT_REJECTED')))].map(code=>[code,events.filter(d=>d.reasonCodes.includes(code)).length])),
      locationLostSeconds:locationLostSeconds(run.decisions,Object.keys(run.metrics.tags),truth.test.from,truth.test.to),
      lostToRejectedInference:lostToRejectedInference.map(d=>({at:d.at,tag:d.tagCode,room:d.roomId,input:d.input,reasons:d.reasonCodes})),
      tolerantRoomPercent:(()=>{const rooms=Object.values(run.metrics.tags).flatMap(t=>Object.values(t.roomsTolerant));const total=rooms.reduce((s,r)=>s+r.totalMs,0);return total?100*rooms.reduce((s,r)=>s+r.correctConfirmedMs+r.correctInferredMs,0)/total:null;})()};
    testResult.trials.push({variant,reportDir,config:run.config,settings:compileRegionsConfig(configJson).rules,summary,dataset:run.dataset,spatial:run.rawSpatialEvidence});
    console.log(JSON.stringify({test:datasetId,variant,scored:testResult.scored,...summary,visits:undefined,lostToRejectedInference:lostToRejectedInference.length}));
  }
  tests.push(testResult);
}
assert.deepEqual(await hashFiles(protectedFiles),before,'Source or configuration changed during study');
await writeFile(path.join(out,'summary.json'),JSON.stringify({git,sourceHashes,protectedBefore:before,protectedAfter:await hashFiles(protectedFiles),tests},null,2)+'\n',{flag:'wx'});
console.log(out);
