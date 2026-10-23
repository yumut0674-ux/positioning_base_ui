/** Interpretation of the 13 October pattern experiment; immutable reports only. */
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import {pointInPolygon,wallDistance} from '../../../src/server/regionEngine/geometry';
import {readDataset} from '../importer';
import {sha256,round,compareRows,deliveryMs,type Truth} from '../model';
import type {Decision,ReplayResult} from '../replay';
import type {EntryMemoryTrace} from './entry-memory';

const id=process.argv[2];if(!id||!/^[a-zA-Z0-9-]+$/.test(id))throw Error('Existing pattern report ID required');
const root=path.resolve('tools/room-benchmark/reports',id);
const study=JSON.parse(await readFile(path.join(root,'summary.json'),'utf8'));
assert.equal(study.experimentVersion,'entry-pattern-v2');assert.equal(study.engineVersion,'room-evidence-10');
assert.equal(study.maps.find((m:{id:string})=>m.id==='necmettin-servis').configVersion,'a255e5826bbb57d8');
assert.equal(study.maps.find((m:{id:string})=>m.id==='necmettin-yogun-bakim').configVersion,'98a9f1072bbf5a4e');
const main='user-evidence-2-1-2-return3000-window6000',strict='user-exact-2-1-2-return3000-window6000';
const labels:Record<string,string>={
  '344ab34d':'Bilgisayar / 13 Ekim kısa','36f6f20f':'Cafer / yoğun bakım','4192b569':'Servis2 / cihaz',
  '4255236f':'Bilgisayar / yoğun bakım','5c71fd2a':'Mustafa / uzun','9a7debf0':'Bilgisayar / 13 Ekim uzun',
  'bd53fa7f':'Cihaz / koridorlu rota','ca88f73a':'Tansiyon','ce530aaa':'Mustafa / kısa','f6d295ed':'Hasan / 9 Ekim',
};
const name=(testId:string)=>labels[testId.split('-')[1]]??testId;
const fmt=(n:number|null)=>n===null?'—':String(round(n)).replace('.',',');
const sec=(n:number)=>fmt(n/1000);
const datasets=[];
const configCache:Record<string,ReturnType<typeof compileRegionsConfig>>={};
for(const map of study.maps)configCache[map.id]=compileRegionsConfig(JSON.parse(await readFile(path.join(root,map.id+'-config.json'),'utf8')));
for(const test of study.tests){
  const data=await readDataset(test.testId);
  assert.equal(data.manifest.sha256,test.rawSha256);assert.equal(data.truthSha256,test.truthSha256);
  const config=configCache[test.mapId];
  const runs=[];
  for(const profile of ['current',main,strict]){
    const run=JSON.parse(await readFile(path.join(root,test.testId+'-'+profile+'.json'),'utf8')) as ReplayResult&{entryMemoryTrace:EntryMemoryTrace[]};
    const visitDetail=Object.entries(run.metrics.tags).flatMap(([tag,t])=>data.truth.visits.map((v,index)=>{
      const events=run.decisions.filter(d=>d.tagCode===tag),room=config.regions.find(r=>r.id===v.roomId)!;
      const selected=data.rows.filter(r=>r.tag_code===tag&&r.created_at&&r.created_at>=v.from&&r.created_at<v.to).sort(compareRows);
      const allTag=data.rows.filter(r=>r.tag_code===tag).sort(compareRows);
      let confirmedMs=0,inferredMs=0,sampledConfirmedMs=0,sampledInferredMs=0;
      for(let j=0;j<events.length;j++){
        const d=events[j];if(d.roomId!==v.roomId||!['IN_REGION','INFERRED_IN_REGION'].includes(d.state))continue;
        const dt=Math.max(0,Math.min(Date.parse(v.to),Date.parse(events[j+1]?.at??data.truth.test.to))-Math.max(Date.parse(v.from),Date.parse(d.at)));
        if(d.state==='IN_REGION')confirmedMs+=dt;else inferredMs+=dt;
      }
      let i=0,current:Decision|undefined;
      for(let t=Date.parse(data.truth.test.from);t<Date.parse(data.truth.test.to);t+=250){
        const dt=Math.min(250,Date.parse(data.truth.test.to)-t),middle=t+dt/2;
        while(i<events.length&&Date.parse(events[i].at)<=middle)current=events[i++];
        if(middle<Date.parse(v.from)||middle>=Date.parse(v.to)||current?.roomId!==v.roomId)continue;
        if(current.state==='IN_REGION')sampledConfirmedMs+=dt;else if(current.state==='INFERRED_IN_REGION')sampledInferredMs+=dt;
      }
      const timeline=selected.map(row=>{
        const valid=row.x!==null&&row.y!==null;
        const p={x:row.x!,y:row.y!},inside=valid&&pointInPolygon(p,room);
        const shared=inside&&config.regions.some(r=>r.id!==room.id&&wallDistance(p,r)<room.settings.sharedWallBandMeters);
        const band=shared?room.settings.sharedWallBandMeters:room.settings.wallBandMeters;
        const decision=events.find(e=>!e.synthetic&&e.input.measuredAt===row.created_at&&e.input.receivedAt===row.received_at&&e.input.x===row.x&&e.input.y===row.y);
        const preprocessingRejection=run.preprocessing.pdop.rejected.find(r=>r.id===row.id);
        const next=allTag[allTag.findIndex(r=>r.id===row.id)+1];
        return {dbId:row.id,truthRoom:v.roomId,raw:{x:row.x,y:row.y,measuredAt:row.created_at,receivedAt:row.received_at,pdop:row.pdop??null,quality:row.quality},
          classification:!valid?'missing':inside?(wallDistance(p,room)>band?'strong-geometry':'weak-wall-band'):
            config.regions.some(r=>pointInPolygon(p,r))?'other-room':config.corridors.some(r=>pointInPolygon(p,r))?'corridor':'outside-map',
          expectedWallDistance:inside?wallDistance(p,room):null,bandThreshold:inside?band:null,
          decision:decision??null,preprocessingRejection:preprocessingRejection??null,
          nextDeliveryGapMs:next?deliveryMs(next)-deliveryMs(row):null};
      });
      return {tag,index:index+1,...v,...t.visits[index] as {missed:boolean;entryDelayMs:number|null;exitDelayMs:number|null},
        confirmedMs,inferredMs,sampledConfirmedMs,sampledInferredMs,
        nominalStrongGeometryPoints:timeline.filter(t=>t.classification==='strong-geometry').length,
        actualDuringVisitEvents:events.filter(d=>d.at>=v.from&&d.at<v.to),timeline};
    }));
    runs.push({profile,visitDetail,patternMatches:run.entryMemoryTrace.filter(t=>t.action==='confirmed'),
      pdop:{known:run.preprocessing.pdop.knownValues,unknown:run.preprocessing.pdop.unknownValues,rejected:run.preprocessing.pdop.rejected.length},
      decisions:run.decisions});
  }
  datasets.push({testId:test.testId,label:name(test.testId),mapId:test.mapId,truth:data.truth,rawSha256:data.manifest.sha256,
    truthSha256:data.truthSha256,quality:data.manifest.quality,runs});
}
const totals=(mapId:string,profile:string)=>study.summary.find((s:{mapId:string;profile:string})=>s.mapId===mapId&&s.profile===profile);
const cafer=datasets.find(d=>d.testId.startsWith('test-36f6f20f'))!;
const caferRun=cafer.runs.find(r=>r.profile===main)!;
const late=caferRun.patternMatches.find(p=>p.roomId==='room-02')!;
assert.equal(late.at,'2026-10-13T08:55:25.506Z');
const caferVisit=caferRun.visitDetail[0];assert.equal(caferVisit.missed,true);
const lateMs=Date.parse(late.at)-Date.parse(caferVisit.to);assert.equal(lateMs,420);
const evidenceSamples=datasets.flatMap(test=>test.runs.filter(r=>r.profile===main).flatMap(run=>run.patternMatches.map(match=>{
  const config=configCache[test.mapId];
  const room=config.regions.find(r=>r.id===match.roomId)!;
  const accepted=run.decisions.filter(d=>d.tagCode===match.tag&&!d.synthetic&&d.at<=match.at&&d.eventType!=='MEASUREMENT_REJECTED'
    &&Number.isFinite(d.input.x)&&Number.isFinite(d.input.y)).flatMap(d=>{
      const containing=config.regions.filter(r=>pointInPolygon(d.input,r));
      const inside=containing.length===1&&containing[0].id===room.id;
      const shared=inside&&config.regions.some(r=>r.id!==room.id&&wallDistance(d.input,r)<room.settings.sharedWallBandMeters);
      const band=shared?room.settings.sharedWallBandMeters:room.settings.wallBandMeters;
      if(inside&&(wallDistance(d.input,room)<=band
        ||room.settings.reliableEvidenceWeight*Math.min(1,d.input.quality??1)<room.settings.reliableEvidenceWeight))return [];
      return [{kind:inside?'I':containing.length!==1?'O':'OTHER',decision:d}];
    }).slice(-5);
  assert.equal(accepted.map(x=>x.kind).join(''),'IIOII','Matched proof must contain the actual IIOII accepted evidence');
  return {testId:test.testId,label:test.label,...match,withinScoredTest:match.at>=test.truth.test.from&&match.at<test.truth.test.to,
    evidence:accepted,expectedRoomAtDelivery:test.truth.visits.find(v=>v.from<=match.at&&match.at<v.to)?.roomId??null};
})));
const lines:string[]=['# Kullanıcının 2 iç → 1 dış → 2 iç önerisi: hastane analizi','',
  'Ana deneyde iki güvenilir iç kanıt saklanır; tek kabul edilmiş dış nokta bunları silmez. Dıştan sonra iki güvenilir iç nokta beklenir. Zayıf duvar ölçümü iç sayısını artırmaz ve güçlü kanıtı silmez; reddedilen ölçüm kanıt olmaz. En fazla 6 sn pencere ve dış noktadan ikinci güvenilir dönüşe en fazla 3 sn (ölçüm ve teslim saatlerinde ayrı) kullanıldı.','',
  'Normal ardışık giriş yolu aynı kaldı. Serviste normal 2 sn / 5 nokta korunur; sadece IIOII alternatifinde 4 güçlü iç nokta yeterli sayılır. Yoğun bakımda normal 1,5 sn / 3 kalır. Kapı, hız, mesafe, PDOP, kalite, duvar bandı, çıkış ve oda değişimi politikaları korunur. Algoritma yalnız ayrı Node sürecindeki deney adaptörüdür.','',
  '## Güncel motor → senin önerin','',
  '| Alan | Yakalama | Doğru oda süresi oranı | Kesin doğru | Tahmini doğru | Koridorda oda | Odada başka oda | Yanlış doğrulama olayı |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...['necmettin-servis','necmettin-yogun-bakim'].map(map=>{const b=totals(map,'current'),n=totals(map,main);
    return `| ${map} | ${b.caught}/${b.visits} → ${n.caught}/${n.visits} | %${fmt(b.roomPercent)} → %${fmt(n.roomPercent)} | ${sec(b.confirmedMs)} → ${sec(n.confirmedMs)} sn | ${sec(b.inferredMs)} → ${sec(n.inferredMs)} sn | ${sec(b.corridorFalseMs)} → ${sec(n.corridorFalseMs)} sn | ${sec(b.wrongRoomMs)} → ${sec(n.wrongRoomMs)} sn | ${b.falseEntries} → ${n.falseEntries} |`;}),'',
  'Yakalama: gerçek ziyaret sırasında en az bir kesin veya tahmini doğru oda kararı. Süre yüzdesi yalnız gerçek odada geçirilen sürede 250 ms örneklerle doğru oda payıdır; aday, LOCATION_LOST ve EXIT_CANDIDATE başarı sayılmaz. Yanlış doğrulama bir olay sayısıdır, ayrı yanlış ziyaret sayısı değildir.','',
  '## Serviste etkisi','',
  '7 test / 62 ziyaret: +1 ziyaret. +9,25 sn doğru oda (+4,75 sn kesin, +4,5 sn tahmini); katı koridor maliyeti +0,75 sn. Gerçek odadayken başka oda ve yanlış doğrulama olayı sayısı değişmedi. Kazanç sınırlı, bütün kaçırılan odaları çözmüyor.','',
  '- Servis2 / cihaz, room-12: daha önce kaçırılan 2. ziyaret 8,526 sn gecikmeyle doğrulandı. 15:15:36.160Z ve 37.372Z iç; 38.265Z dış; 38.919Z ve 39.431Z iç. Aradaki hız reddi paketleri sayılmadı. Testin yakalaması 1/4 → 2/4, doğru oda oranı %7,958 → %14,324 oldu.',
  '- Mustafa uzun, room-10: ilk yakalama gecikmesi 50,196 → 7,561 sn oldu. Ancak 17:50:12.841Z motor ROOM_EXITED verdi; gerçek çıkış 17:51:04.037Z. Ham noktalar koridor tarafında görünmeye devam ettiği için 42,635 sn daha erken ilk giriş, aynı büyüklükte doğru oda süresi kazandırmıyor.',
  '- Diğer beş Servis testinin oda yakalama sayısı ve doğru oda oranı değişmedi. Mustafa uzun testinde bazı doğrulama süreleri de toparlandı; ayrıntılar visit-details.json dosyasındadır.','',
  '## Yoğun bakımda etkisi','',
  '3 test / 9 ziyaret: yakalama 6/9 kaldı. Hasan testinde room-01 yeniden doğrulamasıyla +1,25 sn kesin doğru oda elde edildi. Bilgisayar testi değişmedi. Cafer’in iki ziyareti yine puanlı aralıkta kaçırıldı.','',
  `Cafer room-02 için IIOII dizisi tamamlanıyor; fakat ikinci dönüş noktası ${late.measuredAt} ölçüm zamanı, ${late.at} teslim zamanına sahip. Gerçek çıkış ${caferVisit.to}. Ölçüm odadayken yapılmış olsa da teslim ${lateMs} ms geç; motor artık koridordayken room-02 doğruluyor.`,
  'Bu nedenle yakalama artmıyor; +1 yanlış doğrulama ve +2,25 sn koridorda oda oluşuyor. İkinci dönüş noktasının ölçüm→teslim gecikmesi 1,181 sn. Bu veri üzerinde yalnız giriş sayacını değiştirmek gecikmeyi düzeltemiyor.',
  'Cafer room-06’da güçlü iç geometri kanıtı yok; oda içindeki noktalar duvar bandında, diğer noktalar koridor tarafında. IIOII gibi kanıt biriktiren bir kural güçlü veri olmadan odayı doğrulayamaz. PDOP tek başına bu sorunu açıklamıyor.','',
  '## Önceki denemeyle fark','',
  'Önceki aday hafızası denemesi ilk dönüşte mevcut sayı şartı yeterliyse doğrulayabiliyordu; iki dönüş noktası ve belirli bir IIOII pencere şekli aramıyordu. O denemenin 42/62 Servis ve 7/9 yoğun bakım sayıları bu önerinin sonucu değildir.',
  'Son 5 kabul edilmiş ham ölçümde tam IIOII arayan daha katı sürüm, zayıf duvar ölçümüne bir pencere yeri ayırır. Serviste 40/62 ve %24,635; yoğun bakımda 6/9 ve %24,677 verir. Cafer’in araya giren zayıf ölçümü bu katı sürümde geç doğrulamayı engeller; yoğun bakım koridor maliyeti 20 sn kalır.',
  'Zayıf iç ölçümün nötr sayıldığı ana öneri Serviste buna göre +1 sn kesin doğru ekler; yoğun bakımda +2,25 sn koridor hatası ekler. Genel 4/5, 1,5/3 sn dönüş, 6/12 sn pencere ve Servis 5 nokta şartını koruyan 5/6 sürümü analysis.html içinde ayrı profillerdir.','',
  '## Sınır toleransı','',
  '| Alan | ±2 sn toleranslı doğru oda, güncel → öneri | Tolerans dışındaki koridorda oda |','|---|---:|---:|',
  ...['necmettin-servis','necmettin-yogun-bakim'].map(map=>{const b=totals(map,'current'),n=totals(map,main);return `| ${map} | %${fmt(b.tolerantRoomPercent)} → %${fmt(n.tolerantRoomPercent)} | ${sec(b.tolerantCorridorMs)} → ${sec(n.tolerantCorridorMs)} sn |`;}),'',
  'Tolerans sadece gerçek giriş/çıkışların ±2 sn çevresini dışlar. Katı sonuçlar yukarıda ayrıca gösterildi; koridor maliyeti bütün test boyunca gizlenmedi.','',
  '## Test bazında','',
  '| Test | Yakalama, güncel → öneri | Doğru oda oranı | Doğru oda kazanımı |','|---|---:|---:|---:|',
  ...study.tests.map((t:any)=>{const b=t.trials[0],n=t.trials.find((p:any)=>p.profile===main);return `| ${name(t.testId)} / ${t.testId.split('-')[1]} | ${b.caught}/${b.visitCount} → ${n.caught}/${n.visitCount} | %${fmt(b.roomPercent)} → %${fmt(n.roomPercent)} | ${sec(n.confirmedMs+n.inferredMs-b.confirmedMs-b.inferredMs)} sn |`;}),'',
  '## Değerlendirme','',
  'Servis için ek giriş yolu olarak kontrollü yeni saha denemesi yapılabilir; eldeki kazanç +1/62 ziyarettir. Aynı kuralı yoğun bakıma doğrudan uygulamayı bu sonuçlar desteklemiyor. Son noktanın teslim gecikmesi ve sinyalin odadan koridora kayması, giriş kanıtı hafızasından ayrı ele alınmalı.',
  'Zayıf ölçümün nötr mü yoksa pencereyi bozucu mu sayılacağı sonuçları etkiliyor. Normal 3/5 nokta şartını azaltmakla, yalnız bu belirli diziye alternatif kanıt eklemek ayrı değişikliklerdir. İkincisi test edildi.','',
  '## Veri ve doğrulama','',
  `Motor ${study.engineVersion}; commit ${study.git.commit}. Yoğun bakım config 98a9f1072bbf5a4e; Servis a255e5826bbb57d8. Deney varyantları ayrı runtime configVersion/fingerprint taşır. Harita geometri dosyaları değişmedi.`,
  `10 doğrulanmış veri kümesi × 8 profil × 2 = ${study.replays} replay; karar, metrik ve aday izleri deterministik. 24 ilgili test geçti. Kapsam typecheck geçti. Genel typecheck önceden mevcut analyze.ts:133 çift roomId TS2783 hatasında kaldı.`,
  '- Tüm saha replaylerinde otomatik interval, listener ve ağ/DB bağlantısı açma çağrıları engellendi. Kaynak/map ve benchmark dışındaki Git diff hashleri aynı; canlı motor/UI/DB yazma akışı değişmedi. Çalışan sunucuya işlem yapılmadı.',
  '- Hazır ham arşivler kullanıldı; yeni DB dışa aktarımı yapılmadı. received_at eksikliği bu 10 veri kümesinde yok. Büyük sinyal aralıkları ve eksik kalite/PDOP alanları summary.json ve aşağıdaki veri tablosunda görünür.',
  '- PDOP yoğun bakım 70; Servis map dosyası olmadığı için ortak varsayılan 20. Eski arşivlerde PDOP yoksa paket geçer; geçmiş canlı filtrede elenen paketler geri üretilemez.',
  ...study.skipped.map((s:{testId:string;reason:string})=>'- Puanlanmadı: '+s.testId+' — '+s.reason),
  '- Bütün sonuçlar geçmiş veri + güncel harita bağlamında; geçmiş canlı performansla eşdeğer değildir. Aynı arşivler ayar seçimi için tekrar kullanıldı, bağımsız yeni saha doğrulaması gereklidir.','',
  '| Veri kümesi | Paket | Eksik received_at | Eksik quality | Zaman anomalisi | >5 sn boşluk |','|---|---:|---:|---:|---:|---:|',
  ...study.tests.map((t:any)=>`| ${name(t.testId)} | ${t.rowCount} | ${t.quality.missingReceivedAt} | ${t.quality.missingQuality} | ${t.quality.timingAnomalies} | ${t.quality.largeGaps.length} |`),'',
  'Tam kararlar ve başarısız ziyaret zaman çizelgeleri her profil JSON’unda; bütün ziyaretlerin ham nokta→ölçüm→teslim→durum→reasonCode→sonraki boşluk zinciri visit-details.json dosyasında; gerçek IIOII örnekleri matched-evidence.json dosyasındadır.','',
  '## Hatırlatma','',
  'Gerçek odadayken ham konumun koridora/başka odaya düşmesi, sinyal kesintileri, teslim gecikmesi ve harita hizası sistem kaynaklı sorunlardır. Bu giriş kuralı kısa bir dış sıçramayı tolere eder; odadan sürekli yanlış konum gelmesini veya güçlü iç verinin hiç üretilmemesini tek başına çözmez.'
];
await writeFile(path.join(root,'interpretation.md'),lines.join('\n')+'\n',{flag:'wx'});
await writeFile(path.join(root,'visit-details.json'),JSON.stringify(datasets,null,2)+'\n',{flag:'wx'});
await writeFile(path.join(root,'matched-evidence.json'),JSON.stringify(evidenceSamples,null,2)+'\n',{flag:'wx'});
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const markup=lines.map(s=>s.startsWith('# ')?'<h1>'+escape(s.slice(2))+'</h1>':s.startsWith('## ')?'<h2>'+escape(s.slice(3))+'</h2>':s.startsWith('|')?s.includes('|---')?'':'<tr>'+s.split('|').slice(1,-1).map(v=>'<td>'+escape(v.trim())+'</td>').join('')+'</tr>':s?'<p>'+escape(s)+'</p>':'').join('\n').replace(/((?:<tr>.*<\/tr>\n?)+)/g,'<div class="scroll"><table>$1</table></div>');
await writeFile(path.join(root,'interpretation.html'),'<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>2 iç, 1 dış, 2 iç: hastane analizi</title><style>body{font:15px system-ui;line-height:1.7;max-width:1200px;margin:30px auto;padding:0 24px;color:#152f42}h1,h2{color:#124565}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px;margin:20px 0}td{border:1px solid #c5d5df;padding:8px}tr:first-child{background:#e1edf5;font-weight:bold}tr:nth-child(even){background:#f3f7fa}</style>'+markup+'</html>',{flag:'wx'});
await writeFile(path.join(root,'validation.json'),JSON.stringify({relatedTests:{passed:24,failed:0},scopedTypecheck:true,
  rootTypecheck:{passed:false,existingError:'TS2783 reports/ui-experience-5c71fd2a-20261013/analyze.ts:133'},
  deterministicReplays:study.replays,isolation:study.isolation,productionUnchanged:study.verifiedSameAfter,
  outsideDiffSha256:study.outsideDiffSha256,summarySha256:await sha256(await readFile(path.join(root,'summary.json'))),
  interpretationSourceSha256:await sha256(await readFile(new URL(import.meta.url)))},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({report:id,matchedExamples:evidenceSamples.length,lateCaferEntryMs:lateMs,main},null,2));
