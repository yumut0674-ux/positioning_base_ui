import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import type {RegionsConfig} from '../../../src/features/regions/types/region.types';
import {sha256} from '../model';

const id='test-f93aa2c0-e0fc-4130-b0c5-3d1207fd120a';
const dir='tools/room-benchmark/reports/servis-f93aa2c0-audit-20261013';
const dataset='tools/room-benchmark/datasets/'+id;
const sourceBytes=await readFile(dataset+'/source.json'),truthBytes=await readFile(dataset+'/truth.json');
const source=JSON.parse(sourceBytes.toString()),truth=JSON.parse(truthBytes.toString());
const diagnostic=JSON.parse(await readFile(dir+'/data-diagnostic.json','utf8'));
const audit=JSON.parse(await readFile(dir+'/session-audit.json','utf8'));
assert.equal(source.ended_at,null);
assert.equal(truth.evaluationIsPartial,true);
assert.equal(truth.test.to,source.rooms.at(-1).exited_at);
assert.equal(Number(diagnostic.rawAllTime[0].count),0);
assert.equal(Number(diagnostic.decisionsAllTime[0].count),0);
assert.equal(diagnostic.registry.length,0);
const local=(time:string)=>new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3}).format(new Date(time));
const visits=source.rooms.map((v:{room:string;entered_at:string;exited_at:string;duration_seconds:number},index:number)=>({
  index:index+1,roomId:v.room,roomName:diagnostic.config.rooms.find((r:{id:string})=>r.id===v.room)?.name??v.room,
  from:v.entered_at,to:v.exited_at,durationSeconds:v.duration_seconds,status:'unscored-missing-raw',
  captured:null,correctConfirmedSeconds:null,correctInferredSeconds:null,accuracyPercent:null,
  entryDelaySeconds:null,exitDelaySeconds:null,reason:'Tag için ham geçmiş ve kayıtlı motor kararı yok; gerçek kaçırılmış ziyaret olarak sayılamaz.'}));
const historicSource=audit.session.plan.floors.find((f:{mapId:string})=>f.mapId==='necmettin-servis').config as RegionsConfig;
const historic=compileRegionsConfig(historicSource);
const currentSource=JSON.parse(await readFile(diagnostic.config.path,'utf8'));
const changedFields:{path:string;recorded:unknown;current:unknown}[]=[];
const diff=(a:unknown,b:unknown,p:string)=>{
  if(JSON.stringify(a)===JSON.stringify(b))return;
  if(a&&b&&typeof a==='object'&&typeof b==='object'){
    const left=a as Record<string,unknown>,right=b as Record<string,unknown>;
    for(const key of new Set([...Object.keys(left),...Object.keys(right)]))diff(left[key],right[key],p+'.'+key);
  }else changedFields.push({path:p,recorded:a??null,current:b??null});
};
diff(historicSource,currentSource,'config');
await writeFile(dir+'/recorded-plan-config.json',JSON.stringify(historicSource,null,2)+'\n',{flag:'wx'});
await writeFile(dir+'/current-config.json',JSON.stringify(currentSource,null,2)+'\n',{flag:'wx'});
const availability={testId:id,status:'unscored-missing-raw',sourceEndedAt:null,evaluationIsPartial:true,evaluationCutoff:truth.test.to,
  selectedTag:source.tag_id,tagMatch:'user-explicit-and-test-session-verified',registeredInTagsAtInspection:false,
  rawRowCount:0,recordedDecisionCount:0,rawSha256:null,timing:'unavailable',quality:'unavailable',
  truthRevision:truth.revision,truthSha256:await sha256(truthBytes),sourceSha256:await sha256(sourceBytes),
  note:'Kaynak/truth hazırdır. raw.jsonl ve manifest.json oluşturulmadı; boş veri seti başarılı aktarım veya %0 doğruluk olarak sunulmaz.'};
await writeFile(dataset+'/availability.json',JSON.stringify(availability,null,2)+'\n',{flag:'wx'});
const report={schemaVersion:1,testId:id,status:availability.status,benchmarkExecuted:false,availability,
  actualRoomSeconds:source.rooms.reduce((s:number,v:{duration_seconds:number})=>s+v.duration_seconds,0),visits,
  captureRatePercent:null,roomAccuracyPercent:null,missedVisits:null,
  engine:{currentSourceVersion:diagnostic.engineVersion,git:diagnostic.git,
    sourceSha256:await sha256(await readFile('src/server/regionEngine/RegionPositionEngine.ts')),
    filterSha256:await sha256(await readFile('src/server/regionEngine/StepDistanceFilter.ts')),
    historicalRunningEngineVersion:null},
  configs:{current:{path:diagnostic.config.path,version:diagnostic.config.version,sha256:diagnostic.config.sha256},
    recordedTestPlan:{version:historic.version,sha256:await sha256(Buffer.from(JSON.stringify(historicSource,null,2)+'\n')),planHash:audit.session.configHash},changedFields},
  intendedReplaySettings:{warmupMs:30000,observationMs:60000,tickMs:1000,sampleMs:250,boundaryToleranceMs:2000},
  findings:{databaseRawRecordsForTag:0,databaseDecisionRecordsForTag:0,currentTagRegistryRecord:false,
    userSawTagMove:true,storedSessionTagVerified:true,sourceAndRecordedVisitsMatch:true,
    confirmed:'Mevcut kalıcı kayıt ve tag kaydı yok. Kaynak kod kayıtlı olmayan tagın ham geçmişini ve kararlarını kalıcı kayda dahil etmez.',
    inference:'Panelde hareket gözlemiyle birlikte en güçlü açıklama tagın kalıcı kayıt kapsamına alınmamış olmasıdır. Test anındaki tag kayıt listesi arşivi olmadığından o andaki kayıt durumu kesin ispatlanamaz.',
    unknown:'Geçmiş oda yakalama, hız/mesafe reddi, duvar bandı, koridor sıçraması, sinyal boşluğu, giriş/çıkış gecikmesi bu tag için ölçülemez.'}};
await writeFile(dir+'/analysis.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
const lines:string[]=[
  '# Servis — 13 Ekim 2026 — f93aa2c0', '',
  '## Sonuç', '',
  '**13 ziyaret kaydedildi; motor başarısı puanlanamadı. Bu %0 veya 0/13 sonucu değildir.** Seçili tag `9C76E417B4CB5ECF` için ham geçmiş 0 satır, kayıtlı motor kararı 0 satır ve güncel `tags` kaydı 0. Kullanıcı bu tagın test sırasında Tag Panel’de hareket ettiğini doğruladı. Ham arşiv yokken sentetik noktalarla bu saha testinin sonucu üretilmedi.', '',
  `Test yerel başlangıcı ${local(source.started_at)}, değerlendirme üst sınırı ${local(truth.test.to)} (13 Ekim, Europe/Istanbul). Kaynak ended_at:null; SELECT ile alınan oturum da running. Son oda çıkışı gerçek test bitişi olarak kabul edilmez. 13 kapanmış oda ziyareti (${report.actualRoomSeconds.toFixed(3)} sn) için kısmi truth hazırlandı; sonrasındaki bilinmeyen süre puanlanmaz. Kaynak UTC saatleri ve milisaniyeler korunmuştur.`, '',
  '## Her ziyaret', '',
  '| # | Oda | Giriş – çıkış, İstanbul | Süre | Yakalama / doğruluk |',
  '|---|---|---|---:|---|',
  ...visits.map((v:{index:number;roomId:string;roomName:string;from:string;to:string;durationSeconds:number})=>`| ${v.index} | ${v.roomId} (${v.roomName}) | ${local(v.from)} – ${local(v.to)} | ${v.durationSeconds.toFixed(3)} sn | Ölçülemedi; ham/karar yok |`), '',
  'Tekrarlanan room-08, room-07 ve room-17 ziyaretleri bağımsız tutuldu. IN_REGION / INFERRED_IN_REGION doğru süreleri, giriş/çıkış gecikmeleri, yanlış oda ve koridor süreleri, LOCATION_LOST süresi bilinmiyor. Eksik gözlem yanlış/başarısız motor kararıyla aynı kabul edilmez.', '',
  '## Veri neden yok?', '',
  '1. `TrackingBuffer.ingest()` önce `position` olayını yayınlıyor, sonra tag kayıt listesini kontrol ediyor (`src/server/trackingBuffer.ts:69–71`). Listede yoksa paket kalıcı geçmiş kuyruğuna girmiyor. Panel hareketi ile boş DB geçmişi bu akışta aynı anda mümkün.',
  '2. Motor kararlarını yazan SQL de `tags` tablosunda eşleşme koşulu kullanıyor (`src/server/location/roomDecisionRepository.ts:131`). Ham paket ve karar arşivi bu tag için birlikte eksik olabilir.',
  '3. Test oturumundaki `tagVerified:true` fiziksel tag eşleşmesine ilişkin saha beyanıdır; `tags` tablosuna kayıt eklemiyor (`src/features/roomTests/services/roomTestModel.ts`). Test ekranında tag seçmek kalıcı takip kaydını garanti etmiyor.',
  '4. Kontrolde büyük/küçük harf, boşluk/ayraç varyasyonları, ölçüm ve teslim zamanı aralığı ayrıca kontrol edildi. Tagın tüm DB geçmişi 0; yalnız yanlış saat aralığıyla açıklanmıyor. Aynı aralıkta başka bir tagın Servis haritasında 74 kaydı var. Bu başka tag bu teste atanmadı.', '',
  '**En güçlü açıklama kalıcı kayıt kapsamı eksikliği.** Test anında tag kaydının bulunmadığını kanıtlayan tarihçeli kayıt listesi yok; başka DB veya harici arşiv olasılığı dışlanmış değildir. Panelde hareket görülmesi geçmişte hangi odanın seçildiğini veya motorun hangi ölçümleri reddettiğini kanıtlamaz. Yerel loglarda bu tag için ham paket arşivi bulunamadı.', '',
  '## Motor / harita ve zamanlama', '',
  `Güncel disk motoru **${diagnostic.engineVersion}**; Git **${diagnostic.git.commit}**, çalışma ağacı kirli. Güncel Servis configVersion **${diagnostic.config.version}**, dosya SHA-256 **${diagnostic.config.sha256}**. Bu bilgi canlı sunucunun aynı ayarları yüklediğini doğrulamaz. Test sırasında çalışan motor sürümü için kayıtlı karar yok.`, '',
  `Oturum planında özgün bölge config snapshotı bulundu: derlenmiş sürüm **${historic.version}**, plan hash **${audit.session.configHash}**. Güncel haritayla aynı deney sayılmadı. Farklar analysis.json/configs.changedFields içinde; snapshotlar bu rapor klasöründe.`, '',
  `Güncel ayarlar: giriş ${diagnostic.config.rules.entryEvidenceDurationMs/1000} sn / ${diagnostic.config.rules.entryConfirmationCount} nokta; çıkış ${diagnostic.config.rules.exitEvidenceDurationMs/1000} sn / ${diagnostic.config.rules.exitConfirmationCount} nokta; hız ${diagnostic.config.rules.maximumSpeedMetersPerSecond} m/sn; mesafe filtresi ${diagnostic.config.rules.maximumStepDistanceMeters} m. Kaydedilmiş planın mesafe filtresi ${historic.rules.maximumStepDistanceMeters} m. Geometri derleme uyarısı yok; bu, geometrinin sahayla hizalandığını kanıtlamaz.`, '',
  'Replay henüz yapılmadı. Hazır ayarlar: 30 sn ısınma, 60 sn gözlem, sanal tick 1000 ms, örnek 250 ms, ±2 sn yalnız sınır toleransı. Ölçüm created_at, teslim received_at olmalıdır. received_at eksikliği, kalite ve gerçek sinyal boşlukları için veri bulunmadığından “yok” veya “tam” denemez. Ham SHA-256 mevcut değil; truth/source SHA-256 analysis.json içinde.', '',
  '## Bu testi kurtarma ve sonraki test', '',
  '- Bu zaman aralığına ait ağ geçidi/UWB yazılımı paket arşivi veya başka veritabanı varsa aynı tag kodunun tam çözünürlüklü x/y, ölçüm ve teslim saatleriyle alınması gerekir. Sonradan tag eklemek kaydedilmemiş geçmişi geri getirmez. Teslim saati yoksa yaklaşık zamanlama açıkça belirtilmelidir.',
  '- Sonraki saha testinden önce tagı uygulamanın kayıtlı tag listesine ekleyip birkaç paketlik pilotta hem ham geçmişin hem motor kararının oluştuğunu doğrulayın. Kayıt listesi cache süresi 30 sn; ekleme sonrası pilotla doğrulama yapın. Bu çalışma DB’ye tag eklemedi.',
  '- Testi bitirme eylemiyle ended_at kaydını kapatın. Daha sonra truth aralığı değişirse revizyon ve neden kaydedin; raw arşivi değişmez kalır.',
  '- Kayıtlı olmayan tag seçildiğinde test ekranında uyarı veya test öncesi kayıt kontrolü sistem geliştirme adayıdır. Üretim kodu bu çalışma kapsamında değiştirilmedi.', '',
  '## Dosyalar / komutlar', '',
  `Kaynak, truth ve erişilebilirlik: datasets/${id}/. Raw/manifest oluşturulmadı. Özel SELECT audit çıktıları reports/servis-f93aa2c0-audit-20261013/ altında.`, '',
  '`node --env-file=.env.local --import tsx tools/room-benchmark/cli.ts candidates '+id+'`',
  '`node --env-file=.env.local --import tsx tools/room-benchmark/cli.ts import '+id+' --tags 9C76E417B4CB5ECF` (yalnız gerçek geçmiş erişilebilir olduğunda)',
  '`node --import tsx tools/room-benchmark/cli.ts replay '+id+' --config config/maps/necmettin-servis/regions.json --run-id YENI-RUN-ID` (raw/manifest oluşturulduktan sonra)', '',
  '## Doğrulama', '',
  'DB sorguları yalnız SELECT. Canlı controller, SSE, ingest endpoint veya port başlatılmadı. Çalışan sunucu durdurulmadı/yeniden başlatılmadı. Mevcut kullanıcı dosyaları çalışma öncesi/sonrası SHA-256 ile kontrol edildi; verification.json ve verification.md ayrıntıları içerir.', '',
  '## Sonraki ayar değerlendirmeleri için hatırlatma', '',
  'Konum üretimi, paket kaydı, sinyal kesintisi ve harita hizası sistemin parçasıdır. Eksik ham arşivi giriş süresi/nokta sayısını veya bölge sınırlarını değiştirerek değerlendiremeyiz. Bu testte belirli bir odayı kaçırmanın nedeni hız filtresi, duvar bandı veya koridor sıçraması diye çıkarılamaz; önce gerçek ham/karar arşivi gerekir.'
];
const md=lines.join('\n')+'\n';
await writeFile(dir+'/analysis.md',md,{flag:'wx'});
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const htmlLines:string[]=[];let table=false;
for(const line of lines){
  if(line.startsWith('|')){if(/^\|[-|: ]+\|$/.test(line))continue;if(!table){htmlLines.push('<table>');table=true;}
    htmlLines.push('<tr>'+line.slice(1,-1).split('|').map(c=>'<td>'+escape(c.trim())+'</td>').join('')+'</tr>');continue;}
  if(table){htmlLines.push('</table>');table=false;}
  const heading=line.match(/^(#{1,3}) /);if(heading)htmlLines.push(`<h${heading[1].length}>${escape(line.slice(heading[0].length))}</h${heading[1].length}>`);
  else if(line.trim())htmlLines.push('<p>'+escape(line)+'</p>');
}
if(table)htmlLines.push('</table>');
await writeFile(dir+'/analysis.html','<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Servis f93aa2c0 — veri eksikliği</title><style>body{font:16px system-ui;max-width:1100px;margin:auto;padding:28px;color:#192735;background:#fafafa;line-height:1.5}table{border-collapse:collapse;width:100%;font-size:14px}td{border:1px solid #ccd5dd;padding:8px}tr:nth-child(even){background:#eef2f6}h1,h2{color:#133c5f}p{overflow-wrap:anywhere}</style>'+htmlLines.join('\n')+'</html>\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,visits:visits.length,actualRoomSeconds:report.actualRoomSeconds,changedConfigFields:changedFields.length,currentVersion:diagnostic.config.version,historicalVersion:historic.version}));
