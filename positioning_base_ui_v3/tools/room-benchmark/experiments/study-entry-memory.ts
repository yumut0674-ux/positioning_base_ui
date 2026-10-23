/** Current ICU/Servis engine, bounded entry-memory sensitivity study. No DB queries. */
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Server,Socket} from 'node:net';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import {ROOM_ENGINE_VERSION} from '../../../src/server/regionEngine/RegionPositionEngine';
import {readDataset} from '../importer';
import {sha256,round,type Truth} from '../model';
import {replayRows,readReplayPdopSettings,type ReplayResult} from '../replay';
import {spatialEvidence} from '../spatialEvidence';
import {entryMemoryFactory,ENTRY_MEMORY_POLICIES,ENTRY_PATTERN_POLICIES,entryMemoryConfigVersion,type EntryMemoryTrace} from './entry-memory';
import {locationLostSeconds} from './study-metrics';

const runId=process.argv[2];
if(!runId||!/^[a-zA-Z0-9-]+$/.test(runId))throw Error('A new unique run ID is required');
const mode=process.argv[3]??'memory';if(!['memory','pattern'].includes(mode))throw Error('Mode must be memory or pattern');
const experimentVersion=mode==='pattern'?'entry-pattern-v2':'entry-memory-v1';
const root=path.resolve('tools/room-benchmark'),out=path.join(root,'reports',runId);
await mkdir(out);
const git=(args:string[])=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
const originalGit={commit:git(['rev-parse','HEAD']),status:git(['status','--short'])};
const outsideDiffSha256=await sha256(Buffer.from(git(['diff','--binary','--','.',':(exclude)tools/room-benchmark'])));
const mapIds=['necmettin-yogun-bakim','necmettin-servis'];
const protectedPaths=[...new Set([
  'src/server/regionEngine/RegionPositionEngine.ts','src/server/regionEngine/StepDistanceFilter.ts','src/server/regionEngine/controller.ts',
  'src/server/regionEngine/configLoader.ts','src/server/regionEngine/geometry.ts','src/server/trackingBuffer.ts',
  'src/server/location/roomDecisionRepository.ts','src/shared/tracking/pdop.ts',
  'src/features/regions/config/regionInferenceSettings.ts',
  ...mapIds.flatMap(id=>[`config/maps/${id}/regions.json`,`config/maps/${id}/tracking-filter.json`]),
  ...git(['diff','--name-only','--','.',':(exclude)tools/room-benchmark']).split('\n').filter(Boolean),
])];
const hashFiles=async()=>Object.fromEntries(await Promise.all(protectedPaths.map(async file=>{
  try{return [file,await sha256(await readFile(file))];}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&file.endsWith('/tracking-filter.json'))return [file,'absent; shared default'];throw error;}
})));
const before=await hashFiles();
const maps=[];
for(const id of mapIds){
  const file=`config/maps/${id}/regions.json`,bytes=await readFile(file),compiled=compileRegionsConfig(JSON.parse(bytes.toString()));
  const pdop=await readReplayPdopSettings(file);
  await writeFile(path.join(out,id+'-config.json'),bytes,{flag:'wx'});
  maps.push({id,path:path.resolve(file),sha256:await sha256(bytes),compiled,pdop,
    parameters:{entryMs:compiled.rules.entryEvidenceDurationMs,entryPoints:compiled.rules.entryConfirmationCount,
      exitMs:compiled.rules.exitEvidenceDurationMs,exitPoints:compiled.rules.exitConfirmationCount,
      speed:compiled.rules.maximumSpeedMetersPerSecond,wallBand:compiled.rules.wallBandMeters,sharedWallBand:compiled.rules.sharedWallBandMeters}});
}
const policies=mode==='pattern'?[ENTRY_MEMORY_POLICIES[1],...ENTRY_PATTERN_POLICIES]:ENTRY_MEMORY_POLICIES;
const profiles=[{id:'current',policy:null},...policies.map(policy=>({id:policy.id,policy}))];
const median=(values:number[])=>{if(!values.length)return null;const x=[...values].sort((a,b)=>a-b),mid=Math.floor(x.length/2);return round(x.length%2?x[mid]:(x[mid-1]+x[mid])/2);};
type Visit={tag:string;index:number;roomId:string;from:string;to:string;missed:boolean;entryDelayMs:number|null;exitDelayMs:number|null};
function measure(result:ReplayResult,truth:Truth){
  const visits=Object.entries(result.metrics.tags).flatMap(([tag,t])=>(t.visits as Omit<Visit,'tag'>[]).map(v=>({...v,tag,timeline:undefined})));
  const s=result.metrics.summary;
  const falseEntries=result.decisions.filter(d=>d.at>=truth.test.from&&d.at<truth.test.to&&result.metrics.tags[d.tagCode]
    &&['ROOM_CONFIRMED','ROOM_TRANSITIONED'].includes(d.eventType??'')
    &&truth.visits.find(v=>v.from<=d.at&&d.at<v.to)?.roomId!==d.roomId)
    .map(d=>({tag:d.tagCode,at:d.at,roomId:d.roomId,actualRoomId:truth.visits.find(v=>v.from<=d.at&&d.at<v.to)?.roomId??null}));
  const tolerantRooms=Object.values(result.metrics.tags).flatMap(t=>Object.values(t.roomsTolerant));
  const tolerantRoomMs=tolerantRooms.reduce((s,r)=>s+r.totalMs,0),tolerantCorrectMs=tolerantRooms.reduce((s,r)=>s+r.correctConfirmedMs+r.correctInferredMs,0);
  const tolerantCorridorMs=Object.values(result.metrics.tags).reduce((s,t)=>s+t.tolerant.corridorFalseRoomMs,0);
  return {caught:visits.filter(v=>!v.missed).length,visitCount:visits.length,actualRoomMs:result.metrics.actualRoomMs,
    roomPercent:result.metrics.roomOnlySuccessPercent,confirmedMs:s.correctConfirmedMs,inferredMs:s.correctInferredMs,
    wrongRoomMs:s.wrongRoomMs,corridorFalseMs:s.corridorFalseRoomMs,uncertainMs:s.lostOrUncertainMs,
    lostSeconds:locationLostSeconds(result.decisions,Object.keys(result.metrics.tags),truth.test.from,truth.test.to),
    tolerantRoomMs,tolerantCorrectMs,tolerantCorridorMs,
    entryDelayMedianMs:median(visits.flatMap(v=>v.entryDelayMs===null?[]:[v.entryDelayMs])),falseEntries,visits};
}
type Measurement=ReturnType<typeof measure>;
const totals=maps.flatMap(map=>profiles.map(profile=>({mapId:map.id,profile:profile.id,caught:0,visits:0,actualRoomMs:0,
  confirmedMs:0,inferredMs:0,wrongRoomMs:0,corridorFalseMs:0,uncertainMs:0,lostSeconds:0,falseEntries:0,
  tolerantRoomMs:0,tolerantCorrectMs:0,tolerantCorridorMs:0,entryDelays:[] as number[],pairedEntryDeltas:[] as number[]})));
const tests:{testId:string;mapId:string;rawSha256:string;truthSha256:string;truthRevision:number;rowCount:number;timing:string;
  quality:unknown;trials:(Measurement&{profile:string;resultSha256:string;newCaptures:Visit[];lostCaptures:Visit[]})[]}[]=[];
const skipped:{testId:string;reason:string}[]=[];
const nativeTimer=globalThis.setInterval,nativeListen=Server.prototype.listen,nativeConnect=Socket.prototype.connect;
globalThis.setInterval=(()=>{throw Error('Offline benchmark cannot start an automatic interval');}) as typeof nativeTimer;
Server.prototype.listen=(()=>{throw Error('Offline benchmark cannot open a listener');}) as typeof nativeListen;
Socket.prototype.connect=(()=>{throw Error('Offline benchmark cannot connect to network / DB');}) as typeof nativeConnect;
try{
for(const id of (await readdir(path.join(root,'datasets'))).sort()){
  let data:Awaited<ReturnType<typeof readDataset>>,map:typeof maps[number]|undefined;
  try{
    const manifest=JSON.parse(await readFile(path.join(root,'datasets',id,'manifest.json'),'utf8'));
    map=maps.find(m=>Object.keys(manifest.mapIds).length===1&&manifest.mapIds[m.id]);if(!map)continue;
    data=await readDataset(id);
  }catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    const truth=JSON.parse(await readFile(path.join(root,'datasets',id,'truth.json'),'utf8'));
    if(/Servis|Yoğun|yogun|servis/i.test(truth.site??''))skipped.push({testId:id,reason:'raw/manifest missing; not scored as zero'});
    continue;
  }
  const {rows,truth,manifest,truthSha256}=data;
  if(!truth.groups.some(g=>g.tagCodes.length)){skipped.push({testId:id,reason:'carried tag not confirmed; not scored'});continue;}
  const settings={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:manifest.warmupMs,observationMs:manifest.observationMs,
    pdopEnabled:map.pdop.settings.enabled,pdopMax:map.pdop.settings.maximumPdop};
  const trials:typeof tests[number]['trials']=[];
  let baseline:Measurement|undefined;
  for(const profile of profiles){
    const trace:EntryMemoryTrace[]=[],traceAgain:EntryMemoryTrace[]=[];
    const result=replayRows(rows,truth,map.compiled,settings,profile.policy?entryMemoryFactory(profile.policy,trace):undefined);
    const repeat=replayRows(rows,truth,map.compiled,settings,profile.policy?entryMemoryFactory(profile.policy,traceAgain):undefined);
    assert.deepEqual(result,repeat,'Decision and metric determinism');assert.deepEqual(trace,traceAgain,'Memory trace determinism');
    const metrics=measure(result,truth);baseline??=metrics;
    const counterpart=(v:Visit)=>baseline!.visits.find(b=>b.tag===v.tag&&b.index===v.index)!;
    const newCaptures=metrics.visits.filter(v=>!v.missed&&counterpart(v).missed);
    const lostCaptures=metrics.visits.filter(v=>v.missed&&!counterpart(v).missed);
    const resultSha256=await sha256(Buffer.from(JSON.stringify(result)));
    trials.push({...metrics,profile:profile.id,resultSha256,newCaptures,lostCaptures});
    const total=totals.find(t=>t.mapId===map!.id&&t.profile===profile.id)!;
    total.caught+=metrics.caught;total.visits+=metrics.visitCount;total.falseEntries+=metrics.falseEntries.length;
    for(const key of ['actualRoomMs','confirmedMs','inferredMs','wrongRoomMs','corridorFalseMs','uncertainMs','lostSeconds','tolerantRoomMs','tolerantCorrectMs','tolerantCorridorMs'] as const)total[key]+=metrics[key];
    total.entryDelays.push(...metrics.visits.flatMap(v=>v.entryDelayMs===null?[]:[v.entryDelayMs]));
    total.pairedEntryDeltas.push(...metrics.visits.flatMap(v=>v.entryDelayMs!==null&&counterpart(v).entryDelayMs!==null?[v.entryDelayMs-counterpart(v).entryDelayMs!]:[]));
    await writeFile(path.join(out,id+'-'+profile.id+'.json'),JSON.stringify({engineVersion:ROOM_ENGINE_VERSION,
      experimentVersion,profile,git:originalGit,baseConfigVersion:map.compiled.version,configSha256:map.sha256,
      configVersion:profile.policy?entryMemoryConfigVersion(map.compiled.version,profile.policy):map.compiled.version,
      overlay:profile.policy?.sequence?{onlyQualifyingPattern:true,alternativeCount:profile.policy.sequence.minimumInsidePoints,
        normalEntryPoints:map.compiled.rules.entryConfirmationCount}:null,
      pdop:{settings:map.pdop.settings,sha256:map.pdop.sha256},rawSha256:manifest.sha256,truthRevision:truth.revision,truthSha256,
      settings,context:'geçmiş veri + güncel harita; çevrimdışı aday kanıtı adaptörü',...result,entryMemoryTrace:trace,
      rawSpatialEvidence:spatialEvidence(rows,truth,map.compiled)},null,2)+'\n',{flag:'wx'});
  }
  tests.push({testId:id,mapId:map.id,rawSha256:manifest.sha256,truthSha256,truthRevision:truth.revision,rowCount:rows.length,
    timing:manifest.timing,quality:manifest.quality,trials});
  const check=await readDataset(id);assert.equal(check.manifest.sha256,manifest.sha256);assert.equal(check.truthSha256,truthSha256);
}
}finally{globalThis.setInterval=nativeTimer;Server.prototype.listen=nativeListen;Socket.prototype.connect=nativeConnect;}
const summary=totals.map(({entryDelays,pairedEntryDeltas,...t})=>({...t,roomPercent:t.actualRoomMs?round(100*(t.confirmedMs+t.inferredMs)/t.actualRoomMs):null,
  tolerantRoomPercent:t.tolerantRoomMs?round(100*t.tolerantCorrectMs/t.tolerantRoomMs):null,
  entryDelayMedianMs:median(entryDelays),pairedEntryDeltaMedianMs:median(pairedEntryDeltas)}));
const after=await hashFiles();assert.deepEqual(after,before,'Production sources/maps/unrelated changes modified during experiment');
assert.equal(await sha256(Buffer.from(git(['diff','--binary','--','.',':(exclude)tools/room-benchmark']))),outsideDiffSha256,'Changes outside benchmark differ');
const experimentFiles=['entry-memory.ts','entry-memory.test.ts','study-entry-memory.ts',...(mode==='pattern'?['entry-pattern.test.ts']:[])];
const experimentHashes=Object.fromEntries(await Promise.all(experimentFiles.map(async p=>[p,await sha256(await readFile(path.join(root,'experiments',p)))])));
const report={engineVersion:ROOM_ENGINE_VERSION,experimentVersion,mode,git:originalGit,
  maps:maps.map(({compiled,pdop,...map})=>({...map,configVersion:compiled.version,pdop:{settings:pdop.settings,sha256:pdop.sha256},
    resolvedRoomSettings:compiled.regions.map(r=>({id:r.id,settings:r.settings}))})),
  profiles,sourceHashes:before,verifiedSameAfter:true,outsideDiffSha256,experimentHashes,deterministic:true,replays:tests.length*profiles.length*2,
  runtimeVersions:maps.map(map=>({mapId:map.id,variants:profiles.map(profile=>({profile:profile.id,
    version:profile.policy?entryMemoryConfigVersion(map.compiled.version,profile.policy):map.compiled.version}))})),
  isolation:{automaticIntervals:'blocked',listeners:'blocked',networkAndDatabaseConnections:'blocked',scope:'all field-data replays'},
  simulation:{tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,equalTimeOrder:'tick, then packet sorted by received_at and database id'},
  summary,tests,skipped,caveats:[
    'Sadece henüz oda atanmamış giriş adayı değişir; aktif oda, room-switch, çıkış ve native tick algoritması aynı kalır.',
    'Hız, mesafe, tazelik, kalite, PDOP ve duvar bandı kontrolleri aynıdır. Reddedilen veya dış noktalar iç kanıt sayılmaz.',
    'Dış nokta sınırı tüm aday penceresi boyunca uygulanır. İlk dış noktadan dönüş için iki saat ekseninde de sınır vardır.',
    'Asgari iç oranı güvenilir iç / (güvenilir iç + kabul edilen dış) olarak hesaplanır; zayıf iç ölçümler bu oranda yoktur.',
    'Mevcut motorun süre kanıtı ilk ve son güvenilir iç ölçüm timestamp farkıdır; aradaki kısa dış aralık bu süre farkına dahildir. İçeride fiilen geçirilen kesintisiz süre olarak yorumlanmamalıdır.',
    'Prototip aktif motorun public getVehicleState tanı nesnesindeki candidateRegionId/candidateSince değerlerini yalnız izole süreçte geri yükler; üretim entegrasyonu değildir.',
    'Native neden metnindeki sürekli iç ölçüm ifadesi deneyde kesintisiz dizi anlamına gelmez; EXPERIMENT_ENTRY_MEMORY_RESUMED ve entryMemoryTrace yeniden kullanılan kanıtı işaretler.',
    'Yakalama bir ziyaret içinde en az bir IN_REGION veya INFERRED_IN_REGION kararıdır; bütün ziyaret boyunca doğruluk değildir. Aday/belirsiz başarı sayılmaz.',
    'Doğru oda yüzdesi yalnız gerçek oda süresindeki zaman ağırlıklı kesin+tahmini doğrudur; iki bileşen ayrıca raporlanır.',
    'Sınır toleransı ±2 saniyede sadece giriş/çıkış çevresini dışlar; katı koridor/yanlış oda sonuçları da görünür.',
    'Aynı arşivler ayar seçimi için tekrar kullanılıyor; yeni sahada doğrulama gerekir. DB arşivi canlıdaki bütün ham olayları içermeyebilir.',
    ...(mode==='pattern'?[
      'Kullanıcı dizisi: son 5 kabul edilmiş ölçümde aynı odada 4 güvenilir iç ve 1 dış; son 2 ölçüm güvenilir iç. Zayıf duvar ölçümü pencereye W olarak girer ve 4/5 kuralını sağlamaz. Reddedilen paket pencereye girmez.',
      'Normal ardışık giriş yolu aynıdır. Alternatif 4/5 yolu Serviste yalnız eşleşen pakette 5 yerine 4 güçlü ölçümü yeterli sayar; kapı/süre/hız/kalite kontrolleri korunur. Bunun ayrı runtime configVersion değeri vardır.',
      'map-count-preserved profili min=max(4,oda giriş sayısı), pencere=min+1, son iki iç kullanır: yoğun bakım 4/5, Servis 5/6. Kullanıcının 2+1+2 örneği bu Servis varyantında yeterli değildir.',
      'user-exact-2-1-2 profili ek olarak dış noktanın son beş ölçümün tam ortasında olmasını ister: IIOII. Genel 4/5 profili IOIII veya OIIII gibi başka dizileri de kabul edebilir.',
      'user-evidence-2-1-2 aynı IIOII kuralını güçlü iç/dış kanıt dizisine uygular. Aynı odanın zayıf duvar ölçümü iç sayısını artırmaz ve güçlü diziyi silmez; zaman/gap sınırları devam eder. Her kabul edilmiş dış nokta negatif kanıttır.',
    ]:[]),
  ]};
await writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
const sec=(ms:number)=>round(ms/1000);
const lines=[mode==='pattern'?'# Kullanıcının 2 iç → dış → 2 iç giriş deneyi':'# Tek dış ölçüme toleranslı giriş deneyi — 13 Ekim 2026','',
  `Motor: ${ROOM_ENGINE_VERSION}. Commit: ${originalGit.commit}. Her senaryo iki kez oynatıldı (${report.replays} replay). Üretim dosyalarının hashleri değişmedi.`,'',
  mode==='pattern'
    ?'Ana deney: `İç → İç → Dış → İç → İç`. Son 5 kabul edilmiş ölçümde 4 güvenilir iç, en fazla 1 dış ve son 2 ölçüm iç olunca ayrı giriş yolu açılır. Normal ardışık eşikler korunur; Serviste bu alternatif yol 4 güçlü iç ölçümü yeterli sayar. Süre ve diğer kontroller korunur. map-count-preserved varyantı Serviste 5/6 ister.'
    :'Örnek `İç1 → İç2 → Dış → İç3`, mevcut sayı ve süre eşiği tamamlanınca doğrulanabilir. Dış nokta sayı artırmaz; korunmuş kanıt başka odaya taşınmaz. Yoğun bakım 1,5 sn / 3; Servis 2 sn / 5 kalır. Bu örnekte Servis henüz doğrulanmaz.','',
  '| Alan / profil | Yakalama | Doğru oda | Kesin / tahmini doğru | Koridorda oda | Odada yanlış oda | Yanlış doğrulama | Giriş medyanı |','|---|---:|---:|---:|---:|---:|---:|---:|',
  ...summary.map(t=>`| ${t.mapId} / ${t.profile} | ${t.caught}/${t.visits} | %${t.roomPercent} | ${sec(t.confirmedMs)} / ${sec(t.inferredMs)} sn | ${sec(t.corridorFalseMs)} sn | ${sec(t.wrongRoomMs)} sn | ${t.falseEntries} | ${t.entryDelayMedianMs===null?'—':sec(t.entryDelayMedianMs)+' sn'} |`),'',
  'Yanlış doğrulama: test aralığında ROOM_CONFIRMED/ROOM_TRANSITIONED anında beklenen oda farklı veya gerçek konum koridor. Zaman toplamı daha kalıcı maliyeti de gösterir.','',
  '## Sınır toleranslı sonuç','',
  '| Alan / profil | ±2 sn toleranslı doğru oda | Tolerans dışındaki koridorda oda | Ortak yakalanan ziyaretlerde giriş gecikmesi değişimi, medyan |','|---|---:|---:|---:|',
  ...summary.map(t=>`| ${t.mapId} / ${t.profile} | %${t.tolerantRoomPercent} | ${sec(t.tolerantCorridorMs)} sn | ${t.pairedEntryDeltaMedianMs===null?'—':sec(t.pairedEntryDeltaMedianMs)+' sn'} |`),'',
  '## Test bazında','',
  ...tests.flatMap(t=>['### '+t.testId+' / '+t.mapId,'',
    '| Profil | Yakalama | Doğru oda | Koridorda oda | Odada yanlış oda | Yeni / kaybedilen ziyaret |','|---|---:|---:|---:|---:|---|',
    ...t.trials.map(p=>`| ${p.profile} | ${p.caught}/${p.visitCount} | %${p.roomPercent} | ${sec(p.corridorFalseMs)} sn | ${sec(p.wrongRoomMs)} sn | ${p.newCaptures.map(v=>v.index+':'+v.roomId).join(', ')||'—'} / ${p.lostCaptures.map(v=>v.index+':'+v.roomId).join(', ')||'—'} |`),'']),
  '## Puanlanmayanlar','',...skipped.map(s=>'- '+s.testId+': '+s.reason),'',
  '## Yöntem ve sınırlar','',...report.caveats.map(s=>'- '+s),'',
  'Tam kararlar, başarısız ziyaret zaman çizelgeleri, deney kanıt izi, ham mekânsal sayımlar, veri/truth SHA-256 ve config snapshotları aynı rapor klasöründedir.','',
  '## Hatırlatma','',
  'Oda içindeyken koridora/karşı odaya düşen ham noktalar, sinyal kesintileri ve harita hizası sistemin ürettiği verilerle ilgilidir. Giriş toleransı bunları maskeleyebilir; kazanımı koridorda yanlış oda süresi ve kesin/tahmini ayrımıyla birlikte değerlendirin.'
];
await writeFile(path.join(out,'analysis.md'),lines.join('\n')+'\n',{flag:'wx'});
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const render=(md:string)=>md.split('\n').map(line=>line.startsWith('# ')?'<h1>'+escape(line.slice(2))+'</h1>':line.startsWith('## ')?'<h2>'+escape(line.slice(3))+'</h2>':line.startsWith('### ')?'<h3>'+escape(line.slice(4))+'</h3>':line.startsWith('|')?line.includes('|---')?'':'<tr>'+line.split('|').slice(1,-1).map(c=>'<td>'+escape(c.trim())+'</td>').join('')+'</tr>':line?'<p>'+escape(line)+'</p>':'').join('\n').replace(/((?:<tr>.*<\/tr>\n?)+)/g,'<div class="scroll"><table>$1</table></div>');
await writeFile(path.join(out,'analysis.html'),'<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Giriş kanıtı toleransı</title><style>body{font:15px system-ui;margin:32px auto;max-width:1350px;padding:0 20px;line-height:1.6;color:#142534}h1,h2{color:#123c56}.scroll{overflow:auto}table{border-collapse:collapse;font-size:13px;width:100%;margin:20px 0}td{border:1px solid #c9d5dc;padding:8px}tr:first-child{font-weight:bold;background:#dceaf3}tr:nth-child(even){background:#f3f6f8}p{max-width:1000px}</style>'+render(lines.join('\n'))+'</html>',{flag:'wx'});
console.log(JSON.stringify({runId,engineVersion:ROOM_ENGINE_VERSION,summary,skipped,replays:report.replays},null,2));
