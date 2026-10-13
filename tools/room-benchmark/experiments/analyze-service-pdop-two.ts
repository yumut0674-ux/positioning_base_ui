import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import {pointInPolygon,wallDistance} from '../../../src/server/regionEngine/geometry';
import type {RegionsConfig} from '../../../src/features/regions/types/region.types';
import type {ProcessedPosition} from '../../../src/server/regionEngine/types';
import {readDataset} from '../importer';
import {readRun,writeReport} from '../report';
import {replayRows,type Decision,type Run} from '../replay';
import {score} from '../score';
import {sha256,round,type Truth} from '../model';
import {locationLostSeconds} from './study-metrics';
const suffix=process.argv[2]??'20261013';
if(!/^[a-z0-9-]+$/.test(suffix))throw new Error('Geçersiz rapor son eki');
const dir=`tools/room-benchmark/reports/servis-pdop-two-${suffix}`;
const auditDir='tools/room-benchmark/reports/servis-pdop-two-20261013';
const ids=['test-344ab34d-5988-4308-be11-99eb88a54bd4','test-9a7debf0-57ad-4df2-802b-ae92e4c20b13'];
const configBytes=await readFile('config/maps/necmettin-servis/regions.json'),configSource=JSON.parse(configBytes.toString()) as RegionsConfig;
const config=compileRegionsConfig(configSource);
await writeFile(dir+'/current-config.json',configBytes,{flag:'wx'});
const pdopPath='src/shared/tracking/pdop.ts',pdopSha=await sha256(await readFile(pdopPath));
const countCodes=(decisions:Decision[])=>{const out:Record<string,number>={};for(const d of decisions)for(const code of new Set(d.reasonCodes))out[code]=(out[code]??0)+1;return out;};
const pct=(n:number,d:number)=>d?round(100*n/d):null;
const quantile=(values:number[],p:number)=>values.length?[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)]:null;
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const local=(s:string)=>new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3}).format(new Date(s));
function visitDurations(truth:Truth,decisions:Decision[]){
  const spans=truth.visits.map(()=>({sampledMs:0,confirmedMs:0,inferredMs:0,wrongMs:0,uncertainMs:0,exactConfirmedMs:0,exactInferredMs:0}));
  let index=0,current:Decision|undefined;
  for(let t=Date.parse(truth.test.from);t<Date.parse(truth.test.to);t+=250){
    const dt=Math.min(250,Date.parse(truth.test.to)-t),middle=t+dt/2;
    while(index<decisions.length&&Date.parse(decisions[index].at)<=middle)current=decisions[index++];
    const visit=truth.visits.findIndex(v=>Date.parse(v.from)<=middle&&middle<Date.parse(v.to));
    if(visit<0)continue;const c=spans[visit];c.sampledMs+=dt;
    if(current?.roomId===truth.visits[visit].roomId&&current.state==='IN_REGION')c.confirmedMs+=dt;
    else if(current?.roomId===truth.visits[visit].roomId&&current.state==='INFERRED_IN_REGION')c.inferredMs+=dt;
    else if(current?.roomId&&['IN_REGION','INFERRED_IN_REGION'].includes(current.state))c.wrongMs+=dt;
    else c.uncertainMs+=dt;
  }
  for(let i=0;i<decisions.length;i++){
    const d=decisions[i];if(!['IN_REGION','INFERRED_IN_REGION'].includes(d.state))continue;
    for(let j=0;j<truth.visits.length;j++){
      const v=truth.visits[j];if(d.roomId!==v.roomId)continue;
      const dt=Math.max(0,Math.min(Date.parse(v.to),Date.parse(decisions[i+1]?.at??truth.test.to))-Math.max(Date.parse(v.from),Date.parse(d.at)));
      if(d.state==='IN_REGION')spans[j].exactConfirmedMs+=dt;else spans[j].exactInferredMs+=dt;
    }
  }
  return spans;
}
const reports=[];
for(const id of ids){
  const data=await readDataset(id),{rows,truth,manifest}=data,short=id.split('-')[1];
  const baseline=await readRun(`tools/room-benchmark/reports/servis-${short}-pdop-current-${suffix}/report.json`);
  assert.equal(baseline.config.sha256,await sha256(configBytes));assert.equal(baseline.dataset.sha256,manifest.sha256);
  const settings={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:manifest.warmupMs,observationMs:manifest.observationMs};
  const repeated=replayRows(rows,truth,config,settings);
  assert.deepEqual(repeated.decisions,baseline.decisions);assert.deepEqual(repeated.metrics,baseline.metrics);
  const audit=JSON.parse(await readFile(auditDir+'/'+id+'-audit.json','utf8'));
  const originalSource=audit.session?.plan.floors.find((f:{mapId:string})=>f.mapId==='necmettin-servis')?.config;
  const originalConfig=originalSource?compileRegionsConfig(originalSource as RegionsConfig):null;
  if(originalSource)await writeFile(dir+'/'+short+'-recorded-plan-config.json',JSON.stringify(originalSource,null,2)+'\n',{flag:'wx'});
  const trials=[];
  for(const profile of [{name:'current-20',enabled:true,max:20},{name:'off',enabled:false,max:20},
    ...(manifest.pdop?.knownValues?[{name:'max-15',enabled:true,max:15},{name:'max-10',enabled:true,max:10},{name:'max-7',enabled:true,max:7},{name:'max-5',enabled:true,max:5}]:[])]){
    const result=replayRows(rows,truth,config,{...settings,pdopEnabled:profile.enabled,pdopMax:profile.max});
    assert.deepEqual(result,replayRows(rows,truth,config,{...settings,pdopEnabled:profile.enabled,pdopMax:profile.max}));
    if(profile.name==='off'){assert.deepEqual(result.decisions,baseline.decisions);assert.deepEqual(result.metrics,baseline.metrics);}
    const full:Run={...baseline,...result,preprocessing:{pdop:{...baseline.preprocessing?.pdop,...result.preprocessing.pdop,sourcePath:path.resolve(pdopPath),sourceSha256:pdopSha,
      caveat:'Koşullar aynı kalıcı DB girdileri üzerinde. Canlıda DB öncesi elenen paketler off koşusuyla geri getirilemez; bu bir tam canlı aç/kapat A/B deneyi değildir.'}}};
    let reportPath=`tools/room-benchmark/reports/servis-${short}-pdop-current-${suffix}`;
    if(profile.name!=='current-20')reportPath=await writeReport(full,`servis-${short}-pdop-${profile.name}-${suffix}`);
    const c=result.metrics.summary,tag=truth.groups[0].tagCodes[0],visits=result.metrics.tags[tag].visits as {missed:boolean}[];
    const tolerantRooms=Object.values(result.metrics.tags[tag].roomsTolerant),tolerantTotal=tolerantRooms.reduce((n,r)=>n+r.totalMs,0);
    trials.push({profile:profile.name,pdopMax:profile.max,pdopEnabled:profile.enabled,reportPath,filtered:result.preprocessing.pdop.rejected.length,
      caught:visits.filter(v=>!v.missed).length,totalVisits:visits.length,roomPercent:result.metrics.roomOnlySuccessPercent,
      roomPercentTolerant:pct(tolerantRooms.reduce((n,r)=>n+r.correctConfirmedMs+r.correctInferredMs,0),tolerantTotal),tolerantRoomSeconds:tolerantTotal/1000,
      confirmedSeconds:c.correctConfirmedMs/1000,inferredSeconds:c.correctInferredMs/1000,wrongRoomSeconds:c.wrongRoomMs/1000,corridorFalseSeconds:c.corridorFalseRoomMs/1000,
      uncertainSeconds:c.lostOrUncertainMs/1000,locationLostSeconds:locationLostSeconds(result.decisions,[tag],truth.test.from,truth.test.to),
      resultSha256:await sha256(Buffer.from(JSON.stringify(result)))});
  }
  const tag=truth.groups[0].tagCodes[0],events=baseline.decisions.filter(d=>d.tagCode===tag),durations=visitDurations(truth,events);
  assert.equal(durations.reduce((s,c)=>s+c.confirmedMs,0),baseline.metrics.summary.correctConfirmedMs);
  assert.equal(durations.reduce((s,c)=>s+c.inferredMs,0),baseline.metrics.summary.correctInferredMs);
  const visits=truth.visits.map((v,i)=>{
    const from=Date.parse(v.from),to=Date.parse(v.to),expected=config.regions.find(r=>r.id===v.roomId)!;
    const selected=rows.filter(r=>r.created_at&&Date.parse(r.created_at)>=from&&Date.parse(r.created_at)<to);
    const rawDetails=selected.map(r=>{
      const d=events.find(e=>!e.synthetic&&e.input.measuredAt===r.created_at&&e.input.receivedAt===r.received_at&&e.input.x===r.x&&e.input.y===r.y);
      const p={x:r.x!,y:r.y!},inside=pointInPolygon(p,expected);
      const other=config.regions.find(region=>region.id!==v.roomId&&pointInPolygon(p,region));
      const corridor=config.corridors.find(region=>pointInPolygon(p,region));
      const next=rows[rows.findIndex(n=>n.id===r.id)+1];
      return {...r,classification:inside?'expected-room':other?'other-room':corridor?'corridor':'outside-map',otherRoomId:other?.id??null,
        expectedWallDistance:inside?wallDistance(p,expected):null,expectedDoorDistance:expected.entrances.length?Math.min(...expected.entrances.map(door=>Math.hypot(p.x-door.x,p.y-door.y))):null,
        deliveredDecision:d??null,nextSignalGapMs:next?.received_at&&r.received_at?Date.parse(next.received_at)-Date.parse(r.received_at):null};
    });
    const windowEvents=events.filter(d=>Date.parse(d.at)>=from-5000&&Date.parse(d.at)<=to+5000),during=events.filter(d=>Date.parse(d.at)>=from&&Date.parse(d.at)<to);
    const existing=(baseline.metrics.tags[tag].visits as {missed:boolean;entryDelayMs:number|null;exitDelayMs:number|null}[])[i];
    const allPdop=selected.flatMap(r=>r.pdop==null?[]:[r.pdop]);
    const gaps=manifest.quality.largeGaps.filter(g=>Date.parse(g.to)>from&&Date.parse(g.from)<to);
    return {index:i+1,...v,roomName:expected.name,durationSeconds:(to-from)/1000,...existing,...durations[i],
      roomPercent:pct(durations[i].confirmedMs+durations[i].inferredMs,durations[i].sampledMs),
      fleeting:(durations[i].exactConfirmedMs+durations[i].exactInferredMs)>0&&(durations[i].exactConfirmedMs+durations[i].exactInferredMs)<1000,
      rawSpatial:baseline.rawSpatialEvidence?.find(e=>e.visitIndex===i+1&&e.tagCode===tag),
      expectedInsideRows:rawDetails.filter(r=>r.classification==='expected-room').map(r=>({id:r.id,createdAt:r.created_at,receivedAt:r.received_at,x:r.x,y:r.y,pdop:r.pdop,wallDistance:r.expectedWallDistance,doorDistance:r.expectedDoorDistance,
        state:r.deliveredDecision?.state??null,roomId:r.deliveredDecision?.roomId??null,eventType:r.deliveredDecision?.eventType??null,reasonCodes:r.deliveredDecision?.reasonCodes??[],evidence:r.deliveredDecision?.evidence??null})),
      rawDetails,pdop:{known:allPdop.length,minimum:quantile(allPdop,0),median:quantile(allPdop,0.5),maximum:quantile(allPdop,1)},gaps,
      reasonCounts:countCodes(during),windowEvents};
  });
  const recorded:Decision[]=audit.decisions.map((row:{payload:string})=>{
    const p=JSON.parse(row.payload) as ProcessedPosition,trace=p.decisionTrace;
    return {at:p.publishedAt!,tagCode:p.tagCode,state:p.regionInference.state,roomId:p.regionInference.regionId,eventType:trace?.eventType??null,
      reasonCodes:trace?.reasons.map(r=>r.code)??[],synthetic:!!p.synthetic,input:{...(trace?.input??{measuredAt:p.timestamp,x:p.x,y:p.y}),pdop:p.pdop??null},evidence:trace?.evidence};
  });
  const recordedMetrics=score(truth,recorded,rows,250,2000);
  const roomPdopRows=visits.flatMap(v=>v.rawDetails).filter(r=>r.pdop!=null);
  const pdopSpatial=Object.fromEntries(['expected-room','other-room','corridor','outside-map'].map(kind=>{
    const list=roomPdopRows.filter(r=>r.classification===kind).map(r=>r.pdop!);return [kind,{count:list.length,minimum:quantile(list,0),median:quantile(list,0.5),maximum:quantile(list,1),atMost5:list.filter(p=>p<=5).length}];}));
  const report={testId:id,start:truth.test.from,end:truth.test.to,engineVersion:baseline.engineVersion,git:baseline.git,currentConfig:baseline.config,
    originalPlanConfigVersion:originalConfig?.version??null,originalPlanMatchesCurrent:originalConfig?.version===config.version,
    originalPlanSemanticallyMatchesCurrent:originalConfig?canonical({...originalConfig,version:undefined})===canonical({...config,version:undefined}):null,
    dataset:baseline.dataset,pdopRule:{path:pdopPath,sha256:pdopSha,currentLimit:20,missingPolicy:'accept as unknown',placement:'before engine, SSE and persistent history'},
    currentMetrics:baseline.metrics,recordedDecisionMetrics:recordedMetrics,recordedDecisionVersions:audit.versions,recordedDecisionCaveat:'DB kararları tam canlı akışın garantili kopyası değildir; sanal tick fazı ve ısınma state başlangıcı canlıyla farklı olabilir.',
    trials,visits,pdopSpatial,reasonCounts:countCodes(events.filter(d=>d.at>=truth.test.from&&d.at<truth.test.to)),
    timings:{measurementToDeliveryMedianMs:quantile(rows.filter(r=>r.created_at&&r.received_at).map(r=>Date.parse(r.received_at!)-Date.parse(r.created_at!)),0.5)}};
  await writeFile(dir+'/'+short+'-analysis.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  reports.push(report);
  console.log(JSON.stringify({testId:id,trials:trials.map(({profile,filtered,caught,roomPercent,wrongRoomSeconds,corridorFalseSeconds})=>({profile,filtered,caught,roomPercent,wrongRoomSeconds,corridorFalseSeconds})),
    recordedRoomPercent:recordedMetrics.roomOnlySuccessPercent,missed:visits.filter(v=>v.missed).map(v=>({index:v.index,roomId:v.roomId})),fleeting:visits.filter(v=>v.fleeting).map(v=>({index:v.index,roomId:v.roomId,exactCorrectMs:v.exactConfirmedMs+v.exactInferredMs}))}));
}
await writeFile(dir+'/study.json',JSON.stringify({reports,deterministic:true,sourceFingerprint:pdopSha},null,2)+'\n',{flag:'wx'});
const lines=['# Servis — iki yeni test ve PDOP incelemesi — 13 Ekim 2026','',
  'Kaynak UTC milisaniyeleri korunur; yerel gösterim Europe/Istanbul. Kullanıcı tagı 9C76E417B4CB5ECF (bilgisayar). Güncel disk motoru ve aynı harita kullanıldı. Her koşu iki kez doğrulandı. Diğer aday tag puanlanmadı.',''];
for(const r of reports){
  const c=r.currentMetrics.summary,current=r.trials[0];
  lines.push('## '+r.testId,'',`${local(r.start)} – ${local(r.end)}; ${r.dataset.rowCount} ham paket; ${current.caught}/${current.totalVisits} anlık/kalıcı ziyaret yakalama. Gerçek oda sürelerinde doğru oda %${current.roomPercent}; kesin ${c.correctConfirmedMs/1000} sn, tahmini ${c.correctInferredMs/1000} sn.`,
    `Motor ${r.engineVersion}; configVersion ${r.currentConfig.version}. Test planı snapshotı ${r.originalPlanConfigVersion}; sürüm eşitliği: ${r.originalPlanMatchesCurrent}, derlenmiş içerik eşitliği (version hariç, nesne anahtar sırası normalize): ${r.originalPlanSemanticallyMatchesCurrent}. Geçmiş kayıtlı kararların doğru oda oranı %${r.recordedDecisionMetrics.roomOnlySuccessPercent}; bunun canlı akışın eksiksiz kopyası olduğu varsayılmaz.`,
    `±2 sn yalnız giriş/çıkış çevresindeki sınır örnekleri dışlanınca doğru oda %${current.roomPercentTolerant}; puanlanan oda süresi ${current.tolerantRoomSeconds} sn. Katı puan tüm oda süresini kullanır.`, '',
    '| # | Oda | Yakalandı | Süreye göre doğru oda | Kesin / tahmini doğru sn | Giriş gecikmesi | Ham: beklenen / toplam |','|---|---|---|---:|---:|---:|---:|',
    ...r.visits.map(v=>`| ${v.index} | ${v.roomId} (${v.roomName}) | ${v.missed?'hayır':v.fleeting?'yalnız anlık '+round((v.exactConfirmedMs+v.exactInferredMs)/1000)+' sn':'evet'} | %${v.roomPercent} | ${v.confirmedMs/1000} / ${v.inferredMs/1000} | ${v.entryDelayMs===null?'—':v.entryDelayMs/1000+' sn'} | ${v.rawSpatial?.expectedRoomCount} / ${v.rawSpatial?.packetCount} |`),'',
    '## PDOP eşik deneyi','',
    '| Profil | Elenen kayıtlı paket | Yakalama | Doğru oda | Kesin / tahmini sn | Yanlış oda sn | Koridorda oda sn |','|---|---:|---:|---:|---:|---:|---:|',
    ...r.trials.map(t=>`| ${t.profile} | ${t.filtered} | ${t.caught}/${t.totalVisits} | %${t.roomPercent} | ${t.confirmedSeconds} / ${t.inferredSeconds} | ${t.wrongRoomSeconds} | ${round(t.corridorFalseSeconds)} |`),'',
    `Eksik received_at ${r.dataset.quality.missingReceivedAt}, ölçüm/koordinat eksikliği ${r.dataset.quality.missingMeasurementAt}/${r.dataset.quality.missingCoordinates}, eksik hardware quality ${r.dataset.quality.missingQuality}; >5 sn teslim boşluğu ${r.dataset.quality.largeGaps.length}. Ölçüm→teslim medyanı ${r.timings.measurementToDeliveryMedianMs} ms. PDOP bilinen ${r.dataset.pdop?.knownValues}, eksik ${r.dataset.pdop?.missingValues}.`,'');
}
lines.push('## Yorumlama sınırları','',
  'PDOP >20 paketler canlı alımda kalıcı kayıttan önce eleniyor. Bu yüzden off/current-20 eşitliği filtrenin canlıda etkisiz olduğunu göstermez; bu arşivde >20 girdi bulunmadığını gösterir. İlk testin tüm PDOP değerleri NULL; PDOP kalitesine göre değerlendirme yapılamaz. Daha düşük eşikler yalnız kayıtlı kabul edilmiş verilerin alt kümesinde bir duyarlılık deneyidir.', '',
  'Yakalama herhangi bir doğru IN_REGION/INFERRED_IN_REGION olayıdır; 26 ms gibi anlık tahminler bunu artırabilir. Asıl süre metriği 250 ms adımlarla hesaplanır; bu kısa olay örneklemeye düşmeyebilir. ExactCorrectMs tanısı pozitif karar aralıklarını milisaniye olarak ayrıca toplar. Çıkış gecikmesi 0 olan bazı ziyaretlerde motor zaten odayı bırakmış/kaybetmiştir; bu başarılı çıkış kanıtı değildir.', '',
  'Tüm ham noktalar, teslim saatleri, reason code, motor evidence, sonraki sinyal boşluğu ve kaçırılan ziyaret çevresi <kısa-id>-analysis.json dosyalarında. study.json raw/truth/config/policy SHA-256 ve Git durumunu kaydeder. Ayrıntılı replay JSON/Markdown/HTML dosyaları her profil için ayrı rapor klasörlerindedir.', '',
  '## Hatırlatma','',
  'Karşı odaya/koridora düşen ham koordinatlar, sinyal kesintileri, harita hizası ve kayıt kapsamı birlikte sistem sorunudur. PDOP düşük olsa da bu veri üzerinde yanlış geometrik oda noktaları bulunabilir; motor ayarı, kesin/tahmini doğru süre ve yanlış oda maliyeti birlikte değerlendirilmelidir.');
await writeFile(dir+'/analysis.md',lines.join('\n')+'\n',{flag:'wx'});
