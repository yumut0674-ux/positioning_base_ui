import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import type {RegionsConfig} from '../../../src/features/regions/types/region.types';
import {readDataset} from '../importer';
import {readRun,writeReport} from '../report';
import {replayRows,type Run} from '../replay';
import {sha256} from '../model';
const dir='tools/room-benchmark/reports/yogun-bakim-pdop-two-20261013';
const source=JSON.parse(await readFile(dir+'/current-config.json','utf8')) as RegionsConfig;
const ids=['test-36f6f20f-65cb-49f4-b704-71912f20c01d','test-4255236f-db12-4a1c-bc09-5e11c51d5d2a','test-f6d295ed-38a9-4e8f-a8d2-f5f6ba4b1d06'];
const reports=[];
for(const id of ids){
  const short=id.split('-')[1],data=await readDataset(id);
  const baseline=await readRun(`tools/room-benchmark/reports/${short==='f6d295ed'?'yogun-bakim-old-f6d295ed-current-distance-on-20261013':'yogun-bakim-'+short+'-current-20261013'}/report.json`);
  const trials=[];
  for(const profile of [{name:'exit-1500-2',engine:{exitEvidenceDurationMs:1500,exitConfirmationCount:2}},
    {name:'exit-2000-3',engine:{exitEvidenceDurationMs:2000,exitConfirmationCount:3}},
    {name:'entry2-exit1500',engine:{entryConfirmationCount:2,exitEvidenceDurationMs:1500}},
    {name:'wall-005',wall:0.05}]){
    const local:RegionsConfig={...structuredClone(source),...('engine' in profile?{engine:{...source.engine,...profile.engine}}:{}),
      ...('wall' in profile?{regions:source.regions.map(r=>({...r,inference:{...r.inference,wallBandMeters:profile.wall}}))}:{})};
    const config=compileRegionsConfig(local),bytes=Buffer.from(JSON.stringify(local,null,2)+'\n'),file=dir+'/'+short+'-'+profile.name+'-config.json';
    await writeFile(file,bytes,{flag:'wx'});
    const settings={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:data.manifest.warmupMs,observationMs:data.manifest.observationMs,pdopMax:70,pdopEnabled:true};
    const result=replayRows(data.rows,data.truth,config,settings);assert.deepEqual(result,replayRows(data.rows,data.truth,config,settings));
    const full:Run={...baseline,...result,config:{path:path.resolve(file),sha256:await sha256(bytes),version:config.version??'unversioned',context:'erken çıkış için çevrimdışı config deneyi '+profile.name},
      preprocessing:{pdop:{...baseline.preprocessing!.pdop,...result.preprocessing.pdop}}};
    const reportPath=await writeReport(full,`yogun-bakim-${short}-${profile.name}-20261013`);
    const c=result.metrics.summary,tag=data.truth.groups[0].tagCodes[0],visits=result.metrics.tags[tag].visits as {missed:boolean;index:number;roomId:string}[];
    const exits=result.decisions.filter(d=>d.reasonCodes.includes('ROOM_EXIT_CONFIRMED')&&d.at>=data.truth.test.from&&d.at<data.truth.test.to).map(d=>({at:d.at,input:d.input}));
    trials.push({profile:profile.name,reportPath,configVersion:config.version,caught:visits.filter(v=>!v.missed).length,totalVisits:visits.length,roomPercent:result.metrics.roomOnlySuccessPercent,
      confirmedSeconds:c.correctConfirmedMs/1000,inferredSeconds:c.correctInferredMs/1000,wrongRoomSeconds:c.wrongRoomMs/1000,corridorFalseSeconds:c.corridorFalseRoomMs/1000,visits,exits});
  }
  reports.push({testId:id,trials});
  console.log(JSON.stringify({testId:id,trials:trials.map(({profile,caught,roomPercent,confirmedSeconds,inferredSeconds,wrongRoomSeconds,corridorFalseSeconds,exits})=>({profile,caught,roomPercent,confirmedSeconds,inferredSeconds,wrongRoomSeconds,corridorFalseSeconds,exits:exits.map(e=>e.at)}))}));
}
await writeFile(dir+'/exit-study.json',JSON.stringify({reports,deterministic:true,caveat:'Aynı raw/truth/current map geometri ve aktif motor; yalnız belirtilen config alanları değişti. Her koşu iki kez doğrulandı. Üretim ayarı değişmedi.'},null,2)+'\n',{flag:'wx'});
