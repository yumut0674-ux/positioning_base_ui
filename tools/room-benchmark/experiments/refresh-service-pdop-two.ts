import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {runTest,type Decision} from '../replay';
import {readRun,writeReport} from '../report';
import {sha256} from '../model';
const suffix=process.argv[2]??'latest-20261013';
if(!/^[a-z0-9-]+$/.test(suffix))throw new Error('Geçersiz rapor son eki');
const dir=`tools/room-benchmark/reports/servis-pdop-two-${suffix}`;
await mkdir(dir,{recursive:false}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;});
const critical=['src/server/regionEngine/RegionPositionEngine.ts','src/server/regionEngine/controller.ts','config/maps/necmettin-servis/regions.json','src/shared/tracking/pdop.ts'];
const fingerprint=async()=>Object.fromEntries(await Promise.all(critical.map(async p=>[p,await sha256(await readFile(p))])));
const before=await fingerprint();
try { await writeFile(dir+'/source-hashes-before.json',JSON.stringify(before,null,2)+'\n',{flag:'wx'}); }
catch(error) {
  if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  assert.deepEqual(JSON.parse(await readFile(dir+'/source-hashes-before.json','utf8')),before);
}
const actions=(decisions:Decision[])=>decisions.map(d=>({...d,input:{...d.input,pdop:null}}));
const scoring=(value:unknown)=>JSON.parse(JSON.stringify(value,(key,item)=>key==='pdop'?null:item));
for(const id of ['test-344ab34d-5988-4308-be11-99eb88a54bd4','test-9a7debf0-57ad-4df2-802b-ae92e4c20b13']){
  const short=id.split('-')[1];
  const result=await runTest(id,{configPath:'config/maps/necmettin-servis/regions.json',tickMs:1000,sampleMs:250,boundaryToleranceMs:2000});
  assert.equal(result.preprocessing?.pdop.enabled,true);assert.equal(result.preprocessing?.pdop.limit,20);
  const previous=await readRun(`tools/room-benchmark/reports/servis-${short}-pdop-current-20261013/report.json`);
  assert.deepEqual(scoring(result.metrics),scoring(previous.metrics));
  assert.deepEqual(actions(result.decisions),actions(previous.decisions));
  let report=`tools/room-benchmark/reports/servis-${short}-pdop-current-${suffix}`;
  try {
    const saved=await readRun(report+'/report.json');
    assert.deepEqual(saved.decisions,result.decisions);assert.deepEqual(saved.metrics,result.metrics);
  } catch(error) {
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    report=await writeReport(result,`servis-${short}-pdop-current-${suffix}`);
  }
  console.log(JSON.stringify({id,report,engine:result.engineVersion,config:result.config.version,commit:result.git.commit,roomPercent:result.metrics.roomOnlySuccessPercent}));
}
assert.deepEqual(await fingerprint(),before,'Replay sırasında ilgili kaynak/config değişti');
