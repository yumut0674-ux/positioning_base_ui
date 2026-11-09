import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import type {RegionsConfig} from '../../../src/features/regions/types/region.types';
import {readDataset} from '../importer';
import {runTest,replayRows,type Run,type ReplayEngineFactory,type Decision} from '../replay';
import {readRun,writeReport} from '../report';
import {sha256,round} from '../model';
import {spatialEvidence} from '../spatialEvidence';
import {visitDiagnostics,canonical,countCodes,pct} from './visit-diagnostics';
import {locationLostSeconds} from './study-metrics';

const runId=process.argv[2];
if(!runId||!/^[a-zA-Z0-9_-]+$/.test(runId))throw Error('Usage: node --import tsx tools/room-benchmark/experiments/compare-icu-friday.ts RUN-ID');
const root=path.resolve('tools/room-benchmark/reports',runId);
const provenance=JSON.parse(await readFile(path.join(root,'provenance.json'),'utf8')) as {
  historicalCommit:string;historicalSourceRoot:string;historicalRuntimeRoot:string;historicalEvidence:{archivedReport:string};
  currentConfigSha256:string;currentEngineSha256:string;currentTrackingFilterSha256:string;
  sources:{path:string;storedPath:string;sha256:string}[];
  transpilation:{outputs:{path:string;sha256:string}[]};
};
const engineFile=path.join(provenance.historicalRuntimeRoot,'src/server/regionEngine/RegionPositionEngine.js');
for(const source of provenance.sources)assert.equal(await sha256(await readFile(source.storedPath)),source.sha256,'Historical snapshot changed');
for(const output of provenance.transpilation.outputs)assert.equal(await sha256(await readFile(output.path)),output.sha256,'Historical transpiled runtime changed');
assert.equal(await sha256(await readFile('src/server/regionEngine/RegionPositionEngine.ts')),provenance.currentEngineSha256);
assert.equal(await sha256(await readFile('config/maps/necmettin-yogun-bakim/regions.json')),provenance.currentConfigSha256);
assert.equal(await sha256(await readFile('config/maps/necmettin-yogun-bakim/tracking-filter.json')),provenance.currentTrackingFilterSha256);
type EngineModule={ROOM_ENGINE_VERSION:string;RegionPositionEngine:new(publish:Parameters<ReplayEngineFactory>[0],interval:number,now:()=>number,automatic:boolean)=>ReturnType<ReplayEngineFactory>};
const oldEngine=await import(pathToFileURL(engineFile).href) as EngineModule;
const oldLoader=await import(pathToFileURL(path.join(provenance.historicalRuntimeRoot,'src/server/regionEngine/configLoader.js')).href) as {compileRegionsConfig:typeof compileRegionsConfig};
assert.equal(oldEngine.ROOM_ENGINE_VERSION,'room-evidence-9');
const historicalFactory:ReplayEngineFactory=(publish,interval,now)=>new oldEngine.RegionPositionEngine(publish,interval,now,false);
const configFiles={
  current:path.join(root,'current-config.json'),
  'friday-initial':path.join(root,'friday-initial-config.json'),
  'friday-final':path.join(provenance.historicalSourceRoot,'config/maps/necmettin-yogun-bakim/regions.json'),
  'current-exit1500':path.join(root,'current-exit1500-config.json'),
  'current-silent8':path.join(root,'current-silent8-config.json'),
  'current-entry2':path.join(root,'current-entry2-config.json'),
};
const currentSource=JSON.parse(await readFile(configFiles.current,'utf8')) as RegionsConfig;
for(const [name,changes] of [['current-exit1500',{exitEvidenceDurationMs:1500}],['current-silent8',{silentCoverageStaleMultiplier:8}],['current-entry2',{entryConfirmationCount:2}]] as const){
  const bytes=JSON.stringify({...structuredClone(currentSource),engine:{...currentSource.engine,...changes}},null,2)+'\n';
  await save(configFiles[name],bytes);
}
const sources=Object.fromEntries(await Promise.all(Object.entries(configFiles).map(async([name,file])=>[name,JSON.parse(await readFile(file,'utf8')) as RegionsConfig]))) as Record<keyof typeof configFiles,RegionsConfig>;
assert.equal(canonical(sources.current.regions),canonical(sources['friday-final'].regions),'Geometry changed; cannot attribute result to engine/parameters only');
assert.equal(canonical(sources.current.regions),canonical(sources['friday-initial'].regions));
const profiles:[string,'current'|'friday',keyof typeof configFiles,boolean][]=[
  ['friday-initial','friday','friday-initial',false],
  ['friday-final','friday','friday-final',false],
  ['current','current','current',true],
  ['old-engine-current-settings','friday','current',true],
  ['current-engine-friday-initial','current','friday-initial',true],
  ['current-engine-friday-final','current','friday-final',true],
  ['friday-final-pdop70','friday','friday-final',true],
  ['current-pdop-off','current','current',false],
  ['current-exit1500','current','current-exit1500',true],
  ['current-silent8','current','current-silent8',true],
  ['current-entry2','current','current-entry2',true],
];
async function save(file:string,bytes:string){
  try{await writeFile(file,bytes,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;assert.equal(await readFile(file,'utf8'),bytes,'Existing result differs: '+file);}
}
async function saveRun(run:Run,id:string){
  const folder=path.resolve('tools/room-benchmark/reports',id);
  try{
    const existing=await readRun(path.join(folder,'report.json'));
    assert.deepEqual(existing.decisions,run.decisions);assert.deepEqual(existing.metrics,run.metrics);
    assert.equal(existing.config.sha256,run.config.sha256);assert.equal(existing.engineVersion,run.engineVersion);
    // Refresh this experiment's executable path after packaging the same verified Git source as JS.
    await writeFile(path.join(folder,'report.json'),JSON.stringify(run,null,2)+'\n');
    return folder;
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return path.resolve(await writeReport(run,id));}
}
const normalizeArchivedDecision=(d:Decision)=>{
  const {pdop,...input}=d.input;
  // Friday's report schema did not retain evidence or the later PDOP annotation.
  const {evidence,...recordedFields}=d;
  return {...recordedFields,input};
};
type TrialTotals={profile:string;caught:number|null;totalVisits:number|null;actualRoomMs:number;confirmedSeconds:number;inferredSeconds:number;wrongRoomSeconds:number;corridorFalseSeconds:number;visits:{durationSeconds:number}[]};
const datasets:{testId:string;scored:boolean;name:string;dataset:Run['dataset'];trials:TrialTotals[];caveat:string}[]=[];
let archivedFridayReplayMatched=false;
const ids=['test-36f6f20f-65cb-49f4-b704-71912f20c01d','test-4255236f-db12-4a1c-bc09-5e11c51d5d2a','test-f6d295ed-38a9-4e8f-a8d2-f5f6ba4b1d06','test-2a7fecc4-d625-4091-8b6c-a5a056302913'];
for(const id of ids){
  const data=await readDataset(id),short=id.split('-')[1];
  assert.deepEqual(Object.keys(data.manifest.mapIds),['necmettin-yogun-bakim']);
  const active=await runTest(id,{configPath:'config/maps/necmettin-yogun-bakim/regions.json',tickMs:1000,sampleMs:250,boundaryToleranceMs:2000});
  assert.equal(active.preprocessing!.pdop.limit,70);assert.equal(active.preprocessing!.pdop.enabled,true);
  const trials=[];
  for(const [name,engine,configName,pdopEnabled] of profiles){
    const source=sources[configName],compiler=engine==='friday'?oldLoader.compileRegionsConfig:compileRegionsConfig;
    const compiled=compiler(source);
    const settings={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:data.manifest.warmupMs,observationMs:data.manifest.observationMs,pdopEnabled,pdopMax:70};
    const factory=engine==='friday'?historicalFactory:undefined;
    const result=replayRows(data.rows,data.truth,compiled,settings,factory);
    assert.deepEqual(result,replayRows(data.rows,data.truth,compiled,settings,factory));
    if(name==='current'){assert.deepEqual(result.decisions,active.decisions);assert.deepEqual(result.metrics,active.metrics);}
    if(short==='f6d295ed'&&name==='friday-initial'){
      const archived=await readRun(provenance.historicalEvidence.archivedReport);
      assert.equal(archived.dataset.sha256,active.dataset.sha256);assert.equal(archived.dataset.truthSha256,active.dataset.truthSha256);
      const actual=result.decisions.map(normalizeArchivedDecision),expected=archived.decisions.map(normalizeArchivedDecision);
      assert.equal(await sha256(Buffer.from(canonical(actual))),await sha256(Buffer.from(canonical(expected))),'Friday decisions differ on fields retained in the archived schema (including decision IDs)');
      const retainedMetricFields=(value:unknown)=>JSON.parse(JSON.stringify(value,(key,item)=>key==='evidence'||key==='pdop'?undefined:item));
      assert.equal(await sha256(Buffer.from(canonical(retainedMetricFields(result.metrics)))),await sha256(Buffer.from(canonical(retainedMetricFields(archived.metrics)))),'Friday replay differs in archived metric fields');
      archivedFridayReplayMatched=true;
    }
    const configBytes=await readFile(configFiles[configName]);
    const engineVersion=engine==='friday'?oldEngine.ROOM_ENGINE_VERSION:active.engineVersion;
    const full:Run&{engineRuntime:unknown}={...active,...result,engineVersion,
      git:engine==='friday'?{commit:provenance.historicalCommit,dirty:false,status:'Immutable Git experiment snapshot; original Friday dirty checkout provenance is recorded in provenance.json'}:active.git,
      config:{path:configFiles[configName],sha256:await sha256(configBytes),version:compiled.version??'unversioned',context:'historical comparison: '+name+'; same raw/truth/region geometry; settings and engine versions explicit'},
      preprocessing:{pdop:{...active.preprocessing!.pdop,...result.preprocessing.pdop,settingsSource:pdopEnabled?'current ICU policy, enabled/70':'Friday had no PDOP prefilter; disabled for historical replay',settingsSha256:pdopEnabled?active.preprocessing!.pdop.settingsSha256:'historically-absent'}},
      engineRuntime:{source:engine==='friday'?'verified immutable Git snapshot':'active workspace import',sourcePath:engine==='friday'?provenance.sources.find(s=>s.path.endsWith('/RegionPositionEngine.ts'))!.storedPath:path.resolve('src/server/regionEngine/RegionPositionEngine.ts'),...(engine==='friday'?{executablePath:engineFile}:{}),sourceSha256:engine==='friday'?provenance.sources.find(s=>s.path.endsWith('/RegionPositionEngine.ts'))!.sha256:provenance.currentEngineSha256,compilerSource:engine==='friday'?'Friday matching configLoader and defaults':'active configLoader and defaults',provenancePath:path.join(root,'provenance.json')}};
    const reportPath=await saveRun(full,runId+'-'+short+'-'+name);
    const visits=data.truth.groups.length?visitDiagnostics(data.rows,data.truth,data.manifest,compiled,full):[];
    const activeRooms=new Map<string,string>(),roomExits:{at:string;roomId:string;reasons:string[]}[]=[];
    for(const event of result.decisions){
      if(event.eventType==='ROOM_EXITED'){
        const exited=activeRooms.get(event.tagCode);
        if(exited)roomExits.push({at:event.at,roomId:exited,reasons:event.reasonCodes});
        activeRooms.delete(event.tagCode);
      }else if(event.roomId&&['IN_REGION','INFERRED_IN_REGION','EXIT_CANDIDATE'].includes(event.state))activeRooms.set(event.tagCode,event.roomId);
    }
    const allVisits=Object.values(result.metrics.tags).flatMap(t=>t.visits as {missed:boolean}[]),summary=result.metrics.summary;
    const tolerant=Object.values(result.metrics.tags).flatMap(t=>Object.values(t.roomsTolerant));
    const trial={profile:name,engineVersion,engineGit:full.git,engineSourceSha256:(full.engineRuntime as {sourceSha256:string}).sourceSha256,
      config:full.config,pdop:{enabled:pdopEnabled,limit:70,rejected:result.preprocessing.pdop.rejected.length,unknown:result.preprocessing.pdop.unknownValues},reportPath,
      caught:allVisits.length?allVisits.filter(v=>!v.missed).length:null,totalVisits:allVisits.length||null,roomPercent:result.metrics.roomOnlySuccessPercent,actualRoomMs:result.metrics.actualRoomMs,
      tolerantRoomPercent:data.truth.groups.length?pct(tolerant.reduce((n,c)=>n+c.correctConfirmedMs+c.correctInferredMs,0),tolerant.reduce((n,c)=>n+c.totalMs,0)):null,
      confirmedSeconds:summary.correctConfirmedMs/1000,inferredSeconds:summary.correctInferredMs/1000,wrongRoomSeconds:summary.wrongRoomMs/1000,corridorFalseSeconds:summary.corridorFalseRoomMs/1000,
      uncertainSeconds:summary.lostOrUncertainMs/1000,locationLostSeconds:data.truth.groups.length?locationLostSeconds(result.decisions,data.truth.groups.flatMap(g=>g.tagCodes),data.truth.test.from,data.truth.test.to):null,
      rejections:countCodes(result.decisions.filter(d=>d.eventType==='MEASUREMENT_REJECTED'&&d.at>=data.truth.test.from&&d.at<data.truth.test.to)),
      compiledSettings:compiled.regions.map(r=>({roomId:r.id,settings:r.settings,doors:r.entrances})),
      visits:visits.map(v=>({index:v.index,roomId:v.roomId,from:v.from,to:v.to,durationSeconds:v.durationSeconds,missed:v.missed,entryDelayMs:v.entryDelayMs,exitDelayMs:v.exitDelayMs,roomPercent:v.roomPercent,confirmedSeconds:v.confirmedMs/1000,inferredSeconds:v.inferredMs/1000,exactCorrectSeconds:(v.exactConfirmedMs+v.exactInferredMs)/1000,rawSpatial:v.rawSpatial,
        earlyExits:roomExits.filter(e=>e.roomId===v.roomId&&Date.parse(e.at)>=Date.parse(v.from)&&Date.parse(e.at)<Date.parse(v.to)).map(e=>({at:e.at,exitedRoomId:e.roomId,remainingVisitMs:Date.parse(v.to)-Date.parse(e.at),reasons:e.reasons})),reasonCounts:v.reasonCounts})),
      resultSha256:await sha256(Buffer.from(JSON.stringify(result)))};
    if(data.truth.groups.length)await save(path.join(root,short+'-'+name+'-visit-details.json'),JSON.stringify(visits,null,2)+'\n');
    trials.push(trial);
    console.log(JSON.stringify({test:short,profile:name,engine:engineVersion,config:full.config.version,caught:trial.caught,roomPercent:trial.roomPercent,confirmed:trial.confirmedSeconds,inferred:trial.inferredSeconds,wrong:trial.wrongRoomSeconds,corridor:trial.corridorFalseSeconds}));
  }
  datasets.push({testId:id,scored:data.truth.groups.length>0,name:short==='36f6f20f'?'13 Ekim — Cafer':short==='4255236f'?'13 Ekim — Bilgisayar':short==='f6d295ed'?'9 Ekim — Hasan':'8 Ekim — tag belirsiz',dataset:active.dataset,trials,
    caveat:data.truth.groups.length?'Same immutable raw/truth. All profiles use the same virtual delivery clock/ticks.':'Tag carried in this test remains unconfirmed. Decisions are replayed, accuracy is not scored.'});
}
assert.equal(archivedFridayReplayMatched,true);
const settingsDelta=Object.keys({...sources['friday-final'].engine,...sources.current.engine}).filter(k=>canonical((sources['friday-final'].engine as Record<string,unknown>)[k])!==canonical((sources.current.engine as Record<string,unknown>)[k])).map(key=>({key,friday:(sources['friday-final'].engine as Record<string,unknown>)[key]??'absent (Friday code has no distance filter)',current:(sources.current.engine as Record<string,unknown>)[key]}));
const combined=profiles.map(([profile])=>{
  const scored=datasets.filter(d=>d.scored),trials=scored.map(d=>d.trials.find(t=>t.profile===profile)!);
  const confirmed=trials.reduce((n,t)=>n+t.confirmedSeconds,0),inferred=trials.reduce((n,t)=>n+t.inferredSeconds,0),denominator=scored.reduce((n,d)=>n+d.trials.find(t=>t.profile===profile)!.visits.reduce((s,v)=>s+Math.round(v.durationSeconds*1000),0),0)/1000;
  const sampledSeconds=trials.reduce((n,t)=>n+t.actualRoomMs,0)/1000;
  return {profile,caught:trials.reduce((n,t)=>n+t.caught!,0),totalVisits:trials.reduce((n,t)=>n+t.totalVisits!,0),confirmedSeconds:confirmed,inferredSeconds:inferred,wrongRoomSeconds:trials.reduce((n,t)=>n+t.wrongRoomSeconds,0),corridorFalseSeconds:trials.reduce((n,t)=>n+t.corridorFalseSeconds,0),exactTruthRoomSeconds:denominator,sampledTruthRoomSeconds:sampledSeconds,roomPercent:pct(confirmed+inferred,sampledSeconds)};
});
await writeFile(path.join(root,'study.json'),JSON.stringify({datasets,combined,settingsDelta,geometrySame:true,archivedFridayReplayMatched,deterministic:true,profiles:profiles.map(([profile,engine,config,pdop])=>({profile,engine,config,pdop})),
  archivedParityPolicy:'All decision fields retained by Friday schema, including decision IDs, and all metric fields matched. Only later-added PDOP/evidence annotations were excluded from schema parity; new reports retain them.',
  comparisonPolicy:'This is an explicitly labeled engine/config factorial experiment, not compare CLI equality. Raw SHA/truth SHA/tick/sample/tolerance are identical per dataset; engine/config/PDOP differences are reported. Old archived PDOP-rejected inputs cannot be recovered.'},null,2)+'\n');
console.log(JSON.stringify({root,archivedFridayReplayMatched,deterministic:true,combined}));
