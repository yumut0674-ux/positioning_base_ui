/** Exit sensitivity of the current engine. Production files remain read-only. */
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import {ROOM_ENGINE_VERSION} from '../../../src/server/regionEngine/RegionPositionEngine';
import type {RegionsConfig} from '../../../src/features/regions/types/region.types';
import {readDataset} from '../importer';
import {sha256,round} from '../model';
import {replayRows,type Decision} from '../replay';
import {locationLostSeconds} from './study-metrics';

const runId=process.argv[2];
if(!runId||!/^[a-zA-Z0-9-]+$/.test(runId))throw Error('Yeni ve benzersiz run ID gerekli');
const root=path.resolve('tools/room-benchmark'),out=path.join(root,'reports',runId);
await mkdir(out);
const protectedPaths=['src/server/regionEngine/RegionPositionEngine.ts','src/server/regionEngine/StepDistanceFilter.ts','src/server/regionEngine/controller.ts',
  'src/server/regionEngine/configLoader.ts','src/server/trackingBuffer.ts','src/server/location/roomDecisionRepository.ts',
  'src/features/regions/config/regionInferenceSettings.ts','config/maps/necmettin-servis/regions.json'];
const hashes=async()=>Object.fromEntries(await Promise.all(protectedPaths.map(async p=>[p,await sha256(await readFile(p))])));
const before=await hashes();
const configPath='config/maps/necmettin-servis/regions.json',configBytes=await readFile(configPath),source=JSON.parse(configBytes.toString()) as RegionsConfig;
const profiles=[{id:'current',durationMs:null,count:null},{id:'duration-2500-count-3',durationMs:2500,count:3},
  {id:'duration-1500-count-4',durationMs:1500,count:4},{id:'duration-2500-count-4',durationMs:2500,count:4},
  {id:'duration-3000-count-4',durationMs:3000,count:4}];
const compiled=profiles.map(profile=>{
  const config:RegionsConfig={...structuredClone(source),engine:{...source.engine,
    ...(profile.durationMs!==null?{exitEvidenceDurationMs:profile.durationMs}:{}),
    ...(profile.count!==null?{exitConfirmationCount:profile.count}:{})}};
  return {profile,config,compiled:compileRegionsConfig(config)};
});
for(const c of compiled)await writeFile(path.join(out,c.profile.id+'-config.json'),JSON.stringify(c.config,null,2)+'\n',{flag:'wx'});
const tests:unknown[]=[],skipped:unknown[]=[],totals=compiled.map(c=>({profile:c.profile.id,durationMs:c.compiled.rules.exitEvidenceDurationMs,count:c.compiled.rules.exitConfirmationCount,
  caught:0,visits:0,actualRoomMs:0,confirmedMs:0,inferredMs:0,wrongRoomMs:0,corridorFalseMs:0,uncertainMs:0,locationLostSeconds:0,earlyExitEvents:0,earlyExitVisits:0}));
for(const id of (await readdir(path.join(root,'datasets'))).sort()){
  let data:Awaited<ReturnType<typeof readDataset>>;
  try{
    const manifest=JSON.parse(await readFile(path.join(root,'datasets',id,'manifest.json'),'utf8'));
    if(Object.keys(manifest.mapIds).length!==1||!manifest.mapIds['necmettin-servis'])continue;
    data=await readDataset(id);
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT'){
      try{const truth=JSON.parse(await readFile(path.join(root,'datasets',id,'truth.json'),'utf8'));
        if(truth.site?.includes('Servis'))skipped.push({testId:id,reason:'Raw/manifest yok; başarıya veya başarısızlığa eklenmedi'});
      }catch{}
      continue;
    }throw error;
  }
  const {rows,truth,manifest,truthSha256}=data;
  if(!truth.groups.some(group=>group.tagCodes.length)){skipped.push({testId:id,reason:'Tag eşleşmesi doğrulanmamış'});continue;}
  const settings={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:manifest.warmupMs,observationMs:manifest.observationMs};
  const trials=[];
  for(let index=0;index<compiled.length;index++){
    const c=compiled[index],result=replayRows(rows,truth,c.compiled,settings);
    assert.deepEqual(result,replayRows(rows,truth,c.compiled,settings),'Karar ve metrikler deterministik olmalı');
    const visits=Object.entries(result.metrics.tags).flatMap(([tag,t])=>(t.visits as {index:number;roomId:string;from:string;to:string;missed:boolean;entryDelayMs:number|null;exitDelayMs:number|null}[]).map(v=>({...v,tag,timeline:undefined})));
    const earlyExits:{tag:string;visitIndex:number;at:string;roomId:string}[]=[];
    for(const tag of Object.keys(result.metrics.tags)){
      let previous:Decision|undefined;
      for(const d of result.decisions.filter(d=>d.tagCode===tag)){
        const visit=truth.visits.findIndex(v=>d.at>=v.from&&d.at<v.to);
        if(d.eventType==='ROOM_EXITED'&&visit>=0&&previous?.roomId===truth.visits[visit].roomId)
          earlyExits.push({tag,visitIndex:visit+1,at:d.at,roomId:truth.visits[visit].roomId});
        previous=d;
      }
    }
    const m=result.metrics,s=m.summary,earlyExitVisits=new Set(earlyExits.map(e=>e.tag+':'+e.visitIndex)).size;
    const total=totals[index];total.caught+=visits.filter(v=>!v.missed).length;total.visits+=visits.length;total.actualRoomMs+=m.actualRoomMs;
    total.confirmedMs+=s.correctConfirmedMs;total.inferredMs+=s.correctInferredMs;total.wrongRoomMs+=s.wrongRoomMs;
    total.corridorFalseMs+=s.corridorFalseRoomMs;total.uncertainMs+=s.lostOrUncertainMs;
    total.locationLostSeconds+=locationLostSeconds(result.decisions,Object.keys(m.tags),truth.test.from,truth.test.to);
    total.earlyExitEvents+=earlyExits.length;total.earlyExitVisits+=earlyExitVisits;
    const sample={profile:c.profile.id,configVersion:c.compiled.version,
      caught:visits.filter(v=>!v.missed).length,totalVisits:visits.length,roomPercent:m.roomOnlySuccessPercent,
      confirmedSeconds:s.correctConfirmedMs/1000,inferredSeconds:s.correctInferredMs/1000,wrongRoomSeconds:s.wrongRoomMs/1000,
      corridorFalseSeconds:s.corridorFalseRoomMs/1000,uncertainSeconds:s.lostOrUncertainMs/1000,earlyExits,visits,
      resultSha256:await sha256(Buffer.from(JSON.stringify(result)))};
    trials.push(sample);
    await writeFile(path.join(out,id+'-'+c.profile.id+'.json'),JSON.stringify({testId:id,profile:c.profile.id,configVersion:c.compiled.version,
      rawSha256:manifest.sha256,truthRevision:truth.revision,truthSha256,settings,...result},null,2)+'\n',{flag:'wx'});
  }
  tests.push({testId:id,rawSha256:manifest.sha256,rawRowCount:rows.length,truthRevision:truth.revision,truthSha256,trials});
}
const summary=totals.map(t=>({...t,roomPercent:t.actualRoomMs?round(100*(t.confirmedMs+t.inferredMs)/t.actualRoomMs):null,
  confirmedSeconds:t.confirmedMs/1000,inferredSeconds:t.inferredMs/1000,wrongRoomSeconds:t.wrongRoomMs/1000,
  corridorFalseSeconds:t.corridorFalseMs/1000,uncertainSeconds:t.uncertainMs/1000}));
const after=await hashes();assert.deepEqual(after,before,'Üretim kaynağı/config değişti; deney geçersiz');
const git={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim()};
const report={engineVersion:ROOM_ENGINE_VERSION,git,currentConfig:{path:configPath,sha256:await sha256(configBytes),version:compiled[0].compiled.version},
  profiles:compiled.map(c=>({id:c.profile.id,configVersion:c.compiled.version,configSha256:before[configPath],durationMs:c.compiled.rules.exitEvidenceDurationMs,count:c.compiled.rules.exitConfirmationCount})),
  sourceHashes:before,verifiedSameAfter:true,deterministic:true,summary,tests,skipped,
  caveats:['Aynı eski veriler ayar seçimi için tekrar kullanıldı; ayrı doğrulama seti değildir.',
    'Oda geçişinin roomSwitch eşikleri ayrı kalır; çıkış süresi bunları yavaşlatmaz.',
    'EXIT_CANDIDATE ilk uygun ölçümde başlar; süre/sayı artışı bu aday durumunun başlangıcını geciktirmez.',
    'Çıkış süresinin 2 katı kesinti sonrası dış kanıt yolunda da kullanılır.',
    'DB geçmişi canlı motorun gördüğü her paketi kapsamayabilir; tüm koşular geçmiş veri + güncel harita bağlamındadır.']};
// Each experimental config has its own hash, rather than inheriting the source config hash.
for(const p of report.profiles)p.configSha256=await sha256(await readFile(path.join(out,p.id+'-config.json')));
await writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
const lines=['# Servis çıkış eşiği deneyi — 13 Ekim 2026','',
  `Motor ${ROOM_ENGINE_VERSION}; commit ${git.commit}; çalışma ağacı kirli: ${!!git.status}. Güncel config ${compiled[0].compiled.version}.`, '',
  'Her koşu aynı ham/truth/geometriyle iki kez yapıldı; karar ve metrik eşitliği doğrulandı. Üretim dosyaları değişmedi.', '',
  '| Profil | Süre / nokta | Yakalama | Doğru oda | Kesin / tahmini doğru | Odadayken yanlış oda | Koridorda oda | Odadayken erken çıkış olayı |',
  '|---|---|---:|---:|---:|---:|---:|---:|',
  ...summary.map(s=>`| ${s.profile} | ${s.durationMs/1000} sn / ${s.count} | ${s.caught}/${s.visits} | %${s.roomPercent} | ${s.confirmedSeconds} / ${s.inferredSeconds} sn | ${s.wrongRoomSeconds} sn | ${s.corridorFalseSeconds} sn | ${s.earlyExitEvents} (${s.earlyExitVisits} ziyaret) |`),'',
  'Erken çıkış, gerçek ziyaret sırasında aynı atanmış odanın ROOM_EXITED kararıdır. Sayı başarılı/başarısız ziyaret oranının yerine geçmez. EXIT_CANDIDATE ve LOCATION_LOST doğru oda sayılmaz.', '',
  '## Test bazında','',
  ...tests.flatMap((test:any)=>['### '+test.testId,'','| Profil | Yakalama | Doğru oda | Koridorda oda |','|---|---:|---:|---:|',...test.trials.map((t:any)=>`| ${t.profile} | ${t.caught}/${t.totalVisits} | %${t.roomPercent} | ${t.corridorFalseSeconds} sn |`),'']),
  '## Sınırlamalar','',...report.caveats.map(c=>'- '+c),'',
  'Ham arşivi olmayan f93aa2c0 testi puanlanmadı. Özel karar/timeline dosyaları ve veri/config/truth SHA-256 bilgileri bu klasördedir.', '',
  '## Hatırlatma','',
  'Koridora/karşı odaya düşen ham noktalar, sinyal kesintileri ve harita hizası sistem sorunudur. Eşik değişikliğinin doğru oda kazancını, koridorda yanlış oda maliyetini ve kesin/tahmini ayrımını birlikte değerlendirin.'
];
await writeFile(path.join(out,'analysis.md'),lines.join('\n')+'\n',{flag:'wx'});
console.log(JSON.stringify({runId,engineVersion:ROOM_ENGINE_VERSION,currentConfigVersion:compiled[0].compiled.version,summary,skipped},null,2));
