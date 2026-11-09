import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import type {RegionsConfig} from '../../../src/features/regions/types/region.types';
import type {ProcessedPosition} from '../../../src/server/regionEngine/types';
import {readDataset} from '../importer';
import {runTest,replayRows,type Run,type Decision} from '../replay';
import {writeReport,readRun} from '../report';
import {spatialEvidence} from '../spatialEvidence';
import {score} from '../score';
import {sha256,round} from '../model';
import {visitDiagnostics,canonical,countCodes,pct,median} from './visit-diagnostics';
import {locationLostSeconds} from './study-metrics';
const dir='tools/room-benchmark/reports/yogun-bakim-pdop-two-20261013';
async function writeOnce(file:string,bytes:string|Buffer){
  try {await writeFile(file,bytes,{flag:'wx'});}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    assert.equal((await readFile(file)).toString(),bytes.toString(),'Mevcut çıktı farklı; üzerine yazılmaz: '+file);
  }
}
async function saveReport(run:Run,id:string){
  const location='tools/room-benchmark/reports/'+id;
  try {
    const saved=await readRun(location+'/report.json');
    assert.deepEqual(saved.decisions,run.decisions);assert.deepEqual(saved.metrics,run.metrics);
    assert.equal(saved.config.sha256,run.config.sha256);assert.equal(saved.dataset.sha256,run.dataset.sha256);
    assert.equal(saved.preprocessing?.pdop.limit,run.preprocessing?.pdop.limit);assert.equal(saved.preprocessing?.pdop.enabled,run.preprocessing?.pdop.enabled);
    return location;
  } catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return writeReport(run,id);}
}
const configPath='config/maps/necmettin-yogun-bakim/regions.json';
const configBytes=await readFile(configPath),source=JSON.parse(configBytes.toString()) as RegionsConfig,config=compileRegionsConfig(source);
await writeOnce(dir+'/current-config.json',configBytes);
await writeOnce(dir+'/current-tracking-filter.json',await readFile('config/maps/necmettin-yogun-bakim/tracking-filter.json'));
const ids=['test-36f6f20f-65cb-49f4-b704-71912f20c01d','test-4255236f-db12-4a1c-bc09-5e11c51d5d2a'];
const reports=[];
for(const id of ids){
  const {rows,truth,manifest}=await readDataset(id),short=id.split('-')[1];
  assert.deepEqual(Object.keys(manifest.mapIds),['necmettin-yogun-bakim']);
  const baseline=await runTest(id,{configPath,tickMs:1000,sampleMs:250,boundaryToleranceMs:2000});
  const basePdop=baseline.preprocessing!.pdop;
  const settings={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:manifest.warmupMs,observationMs:manifest.observationMs,pdopEnabled:basePdop.enabled,pdopMax:basePdop.limit};
  const repeated=replayRows(rows,truth,config,settings);
  assert.deepEqual(repeated.decisions,baseline.decisions);assert.deepEqual(repeated.metrics,baseline.metrics);
  const baselinePath=await saveReport(baseline,`yogun-bakim-${short}-current-20261013`);
  const profiles=[{name:'current',pdopMax:basePdop.limit},{name:'pdop-off',pdopEnabled:false},
    ...[20,10,7,5].map(n=>({name:'pdop-'+n,pdopMax:n})),
    {name:'distance-off',engine:{maximumStepDistanceMeters:0}},
    {name:'distance-5',engine:{maximumStepDistanceMeters:5}},
    {name:'entry-2',engine:{entryConfirmationCount:2}},
    {name:'wall-02',wall:0.2}];
  const trials=[];
  for(const profile of profiles){
    const local:RegionsConfig={...structuredClone(source),
      ...('engine' in profile?{engine:{...source.engine,...profile.engine}}:{}),
      ...('wall' in profile?{regions:source.regions.map(r=>({...r,inference:{...r.inference,wallBandMeters:profile.wall}}))}:{})};
    const compiled=compileRegionsConfig(local),localSettings={...settings,...('pdopMax' in profile?{pdopMax:profile.pdopMax}:{}),...('pdopEnabled' in profile?{pdopEnabled:profile.pdopEnabled}:{})};
    const result=replayRows(rows,truth,compiled,localSettings);
    assert.deepEqual(result,replayRows(rows,truth,compiled,localSettings));
    const file=dir+'/'+short+'-'+profile.name+'-config.json',bytes=Buffer.from(JSON.stringify(local,null,2)+'\n');
    await writeOnce(file,bytes);
    const full:Run={...baseline,...result,config:profile.name==='current'?baseline.config:{path:path.resolve(file),sha256:await sha256(bytes),version:compiled.version??'unversioned',context:'çevrimdışı tek parametre deneyi; aynı ham/truth; değişiklik '+profile.name},
      preprocessing:{pdop:{...basePdop,...result.preprocessing.pdop,settingsSource:profile.name==='current'?basePdop.settingsSource:'offline profile '+profile.name}}};
    const reportPath=profile.name==='current'?baselinePath:await saveReport(full,`yogun-bakim-${short}-${profile.name}-20261013`);
    const tag=truth.groups[0].tagCodes[0],visits=result.metrics.tags[tag].visits as {missed:boolean}[],c=result.metrics.summary;
    const tolerant=Object.values(result.metrics.tags[tag].roomsTolerant),total=tolerant.reduce((s,r)=>s+r.totalMs,0);
    trials.push({profile:profile.name,reportPath,config:full.config,pdop:result.preprocessing.pdop.enabled?result.preprocessing.pdop.limit:'off',filtered:result.preprocessing.pdop.rejected.length,
      caught:visits.filter(v=>!v.missed).length,totalVisits:visits.length,roomPercent:result.metrics.roomOnlySuccessPercent,
      roomPercentTolerant:pct(tolerant.reduce((s,r)=>s+r.correctConfirmedMs+r.correctInferredMs,0),total),
      confirmedSeconds:c.correctConfirmedMs/1000,inferredSeconds:c.correctInferredMs/1000,wrongRoomSeconds:c.wrongRoomMs/1000,corridorFalseSeconds:c.corridorFalseRoomMs/1000,
      uncertainSeconds:c.lostOrUncertainMs/1000,locationLostSeconds:locationLostSeconds(result.decisions,[tag],truth.test.from,truth.test.to),
      measurementRejections:result.decisions.filter(d=>!d.synthetic&&d.eventType==='MEASUREMENT_REJECTED'&&d.at>=truth.test.from&&d.at<truth.test.to).length,
      resultSha256:await sha256(Buffer.from(JSON.stringify(result)))});
  }
  const audit=JSON.parse(await readFile(dir+'/'+id+'-audit.json','utf8'));
  const originalSource=audit.session?.plan.floors.find((f:{mapId:string})=>f.mapId==='necmettin-yogun-bakim')?.config;
  const originalConfig=originalSource?compileRegionsConfig(originalSource as RegionsConfig):null;
  if(originalSource)await writeOnce(dir+'/'+short+'-recorded-plan-config.json',JSON.stringify(originalSource,null,2)+'\n');
  const recorded:Decision[]=audit.decisions.map((row:{payload:string})=>{
    const p=JSON.parse(row.payload) as ProcessedPosition,t=p.decisionTrace;
    return {at:p.publishedAt!,tagCode:p.tagCode,state:p.regionInference.state,roomId:p.regionInference.regionId,eventType:t?.eventType??null,
      reasonCodes:t?.reasons.map(r=>r.code)??[],synthetic:!!p.synthetic,input:{...(t?.input??{measuredAt:p.timestamp,x:p.x,y:p.y}),pdop:p.pdop??null},evidence:t?.evidence};
  });
  const recordedMetrics=score(truth,recorded,rows,250,2000);
  const visits=visitDiagnostics(rows,truth,manifest,config,baseline);
  const report={testId:id,tag:truth.groups[0].tagCodes[0],name:audit.tags[0]?.name,engineVersion:baseline.engineVersion,git:baseline.git,currentConfig:baseline.config,pdopPolicy:basePdop,
    originalPlanVersion:originalConfig?.version??null,originalPlanSemanticallyMatchesCurrent:originalConfig?canonical({...originalConfig,version:undefined})===canonical({...config,version:undefined}):null,
    dataset:baseline.dataset,currentMetrics:baseline.metrics,recordedDecisionMetrics:recordedMetrics,recordedVersions:audit.versions,
    recordedDecisionCaveat:'Kalıcı DB kararları canlı akışın eksiksiz kopyası değildir; tick fazı ve replay başlangıç state farkı olabilir.',
    trials,visits,reasonCounts:countCodes(baseline.decisions.filter(d=>d.at>=truth.test.from&&d.at<truth.test.to)),
    measurementDeliveryMedianMs:median(rows.filter(r=>r.created_at&&r.received_at).map(r=>Date.parse(r.received_at!)-Date.parse(r.created_at!)))};
  await writeOnce(dir+'/'+short+'-analysis.json',JSON.stringify(report,null,2)+'\n');
  reports.push(report);
  console.log(JSON.stringify({testId:id,name:report.name,engine:baseline.engineVersion,config:baseline.config.version,pdop:basePdop.limit,recordedRoomPercent:recordedMetrics.roomOnlySuccessPercent,
    trials:trials.map(({profile,filtered,caught,roomPercent,confirmedSeconds,inferredSeconds,wrongRoomSeconds,corridorFalseSeconds})=>({profile,filtered,caught,roomPercent,confirmedSeconds,inferredSeconds,wrongRoomSeconds,corridorFalseSeconds})),
    visits:visits.map(v=>({index:v.index,room:v.roomId,missed:v.missed,roomPercent:v.roomPercent,entryDelayMs:v.entryDelayMs,exitDelayMs:v.exitDelayMs,spatial:v.rawSpatial,reasons:v.reasonCounts}))}));
}
const older=[];
for(const id of ['test-f6d295ed-38a9-4e8f-a8d2-f5f6ba4b1d06','test-2a7fecc4-d625-4091-8b6c-a5a056302913']){
  const data=await readDataset(id),short=id.split('-')[1],baseline=await runTest(id,{configPath,tickMs:1000,sampleMs:250,boundaryToleranceMs:2000});
  const paths=[`tools/room-benchmark/reports/integrated-filter-hospital-20261013/${id}-current-config.json`,
    ...(short==='f6d295ed'?['tools/room-benchmark/reports/necmettin-yogun-bakim-f6d295ed-entry-exit-study-20261009/config.snapshot.json']:[])];
  const trials=[];
  const configs=[{name:'current',source},...await Promise.all(paths.map(async(file,i)=>({name:i===0?'earlier-13oct-config':'original-9oct-config',source:JSON.parse(await readFile(file,'utf8')) as RegionsConfig})))];
  for(const variant of configs)for(const distance of ['on','off']){
    const local:RegionsConfig={...structuredClone(variant.source),...(distance==='off'?{engine:{...variant.source.engine,maximumStepDistanceMeters:0}}:{})};
    const compiled=compileRegionsConfig(local),bytes=Buffer.from(JSON.stringify(local,null,2)+'\n'),file=dir+'/'+short+'-'+variant.name+'-distance-'+distance+'-config.json';
    await writeOnce(file,bytes);
    const settings={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:data.manifest.warmupMs,observationMs:data.manifest.observationMs,pdopMax:baseline.preprocessing!.pdop.limit,pdopEnabled:baseline.preprocessing!.pdop.enabled};
    const result=replayRows(data.rows,data.truth,compiled,settings);assert.deepEqual(result,replayRows(data.rows,data.truth,compiled,settings));
    const full:Run={...baseline,...result,config:{path:path.resolve(file),sha256:await sha256(bytes),version:compiled.version??'unversioned',context:'eski ham veri + '+variant.name+' config + aktif motor; eski motor yeniden çalıştırılmadı'},
      preprocessing:{pdop:{...baseline.preprocessing!.pdop,...result.preprocessing.pdop,settingsSource:'same current ICU PDOP policy'}}};
    const reportPath=await saveReport(full,`yogun-bakim-old-${short}-${variant.name}-distance-${distance}-20261013`);
    const c=result.metrics.summary,visits=Object.values(result.metrics.tags).flatMap(t=>t.visits as {missed:boolean}[]);
    trials.push({config:variant.name,distanceFilter:distance,configVersion:compiled.version,reportPath,caught:visits.length?visits.filter(v=>!v.missed).length:null,totalVisits:visits.length||null,
      roomPercent:result.metrics.roomOnlySuccessPercent,confirmedSeconds:c.correctConfirmedMs/1000,inferredSeconds:c.correctInferredMs/1000,wrongRoomSeconds:c.wrongRoomMs/1000,corridorFalseSeconds:c.corridorFalseRoomMs/1000});
  }
  older.push({testId:id,scored:data.truth.groups.length>0,dataset:baseline.dataset,trials,caveat:'Aynı eski raw/truth üzerinde tüm deneyler güncel motorla yapıldı. Farklı config sürümleri görünürdür; eski canlı motor performansına eşit deney değildir.'});
  console.log(JSON.stringify({oldTest:id,scored:data.truth.groups.length>0,trials}));
}
await writeOnce(dir+'/study.json',JSON.stringify({reports,older,deterministic:true,engineSha256:await sha256(await readFile('src/server/regionEngine/RegionPositionEngine.ts')),configSha256:await sha256(configBytes)},null,2)+'\n');
const md=['# Yoğun Bakım — iki yeni test ve eski veriler — 13 Ekim 2026','',
  'Bağımsız tag/rotalar ayrı puanlandı. UTC milisaniyeleri korunur, yerel gösterim Europe/Istanbul. Aktif motor ayrı süreçte sanal saatle çalıştırıldı; canlı ayarlar değiştirilmedi.',''];
for(const r of reports){
  md.push('## '+r.testId+' / '+r.name,'',`Motor ${r.engineVersion}; configVersion ${r.currentConfig.version}; PDOP ${r.pdopPolicy.limit}. Plan snapshotı ${r.originalPlanVersion}, normalize derlenmiş içerik aynı: ${r.originalPlanSemanticallyMatchesCurrent}. Kayıtlı DB kararları doğru oda %${r.recordedDecisionMetrics.roomOnlySuccessPercent} (eksiksiz canlı kopya varsayılmaz).`,'',
    '| Oda | Yakalama | Katı doğru oda | Kesin / tahmini sn | Giriş / çıkış gecikmesi | Ham beklenen / toplam |','|---|---|---:|---:|---:|---:|',
    ...r.visits.map(v=>`| ${v.roomId} (${v.roomName}) | ${v.missed?'kaçırıldı':v.fleeting?'yalnız anlık':'yakalandı'} | %${v.roomPercent} | ${v.confirmedMs/1000} / ${v.inferredMs/1000} | ${v.entryDelayMs===null?'—':v.entryDelayMs/1000} / ${v.exitDelayMs===null?'—':v.exitDelayMs/1000} sn | ${v.rawSpatial?.expectedRoomCount} / ${v.rawSpatial?.packetCount} |`),'',
    '| Profil | Elenen PDOP | Yakalama | Katı / toleranslı doğru oda | Kesin / tahmini sn | Yanlış oda sn | Koridorda oda sn |','|---|---:|---:|---:|---:|---:|---:|',
    ...r.trials.map(t=>`| ${t.profile} | ${t.filtered} | ${t.caught}/${t.totalVisits} | %${t.roomPercent} / %${t.roomPercentTolerant} | ${t.confirmedSeconds} / ${t.inferredSeconds} | ${t.wrongRoomSeconds} | ${round(t.corridorFalseSeconds)} |`),'',
    `Ham satır ${r.dataset.rowCount}; PDOP bilinen ${r.dataset.pdop?.knownValues}, eksik ${r.dataset.pdop?.missingValues}; eksik received_at/ölçüm/koordinat ${r.dataset.quality.missingReceivedAt}/${r.dataset.quality.missingMeasurementAt}/${r.dataset.quality.missingCoordinates}; hardware quality boş ${r.dataset.quality.missingQuality}; >5 sn boşluk ${r.dataset.quality.largeGaps.length}; ölçüm→teslim medyanı ${r.measurementDeliveryMedianMs} ms.`,'');
}
md.push('## Eski ham veride güncel motor/config etkisi','');
for(const r of older){md.push('### '+r.testId,'',r.caveat,...(!r.scored?['Tag eşleşmesi belirsiz; bu test puanlanmadı.']:[]),'',
  '| Config | Mesafe filtresi | Yakalama | Doğru oda | Kesin / tahmini sn | Yanlış oda sn | Koridorda oda sn |','|---|---|---:|---:|---:|---:|---:|',
  ...r.trials.map(t=>`| ${t.config} (${t.configVersion}) | ${t.distanceFilter} | ${t.caught===null?'puanlanmadı':t.caught+'/'+t.totalVisits} | ${t.roomPercent===null?'puanlanmadı':'%'+t.roomPercent} | ${t.confirmedSeconds} / ${t.inferredSeconds} | ${t.wrongRoomSeconds} | ${t.corridorFalseSeconds} |`),'');}
md.push('## Yorumlama sınırları','',
  'PDOP ön filtresinde canlıda elenmiş paketler DB arşivinde bulunmayabilir; off deneyi bunları geri getirmez. Aynı raw/truth üzerinde farklı eşik/config sonuçları ayrı deneylerdir. Distance-off mevcut motorun config seçeneğidir, eski motorun kopyası değildir. Giriş nokta sayısını/duvar bandını değiştiren profiller yalnız bu rapor klasöründeki config kopyalarını kullanır.', '',
  'Her ziyaretin ham noktası, ölçüm ve teslim zamanı, motor durumu/odası, eventType/reasonCodes, evidence ve sonraki boşluğu <kısa-id>-analysis.json dosyalarında bulunur. study.json tüm profilleri ve SHA-256/commit/timing metadata içeren standart rapor yollarını kaydeder.', '',
  '## Hatırlatma','',
  'Gerçekte odadayken koordinatların başka odaya/koridora düşmesi, harita hizası ve sinyal boşlukları sistemin konum üretimi/kayıt kapsamı açısından da incelenmelidir. Motor eşiklerinin başarısını kesin/tahmini süre, yanlış oda ve koridor maliyetiyle birlikte değerlendir.');
await writeOnce(dir+'/analysis.md',md.join('\n')+'\n');
