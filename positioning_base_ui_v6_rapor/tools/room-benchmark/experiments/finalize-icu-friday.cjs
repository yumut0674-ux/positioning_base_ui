const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const runId=process.argv[2];
if(!runId||!/^[a-zA-Z0-9_-]+$/.test(runId))throw Error('RUN-ID required');
const root=path.resolve('tools/room-benchmark/reports',runId);
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const inline=s=>esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
const number=n=>n===null||n===undefined?'—':Number(n).toLocaleString('tr-TR',{maximumFractionDigits:3});
const percent=n=>n===null?'puanlanmadı':'%'+number(n);
const caught=t=>t.caught===null?'puanlanmadı':`${t.caught}/${t.totalVisits}`;
const profiles={'friday-initial':'Cuma ilk: 2 nokta','friday-final':'Cuma son: 3 nokta',current:'Bugün',
  'old-engine-current-settings':'Cuma motoru + bugünkü ayarlar','current-engine-friday-initial':'Bugünkü motor + Cuma ilk ayarlar','current-engine-friday-final':'Bugünkü motor + Cuma son ayarlar',
  'friday-final-pdop70':'Cuma son + PDOP 70','current-pdop-off':'Bugün, PDOP kapalı','current-exit1500':'Bugün, yalnız çıkış 1,5 sn','current-silent8':'Bugün, yalnız silent çarpanı 8','current-entry2':'Bugün, yalnız giriş 2 nokta'};
function body(md){
  let table=false;const out=[];
  for(const line of md.trimEnd().split('\n')){
    if(line.startsWith('|')){
      if(/^\|[-:| ]+\|$/.test(line))continue;
      if(!table){out.push('<div class="table"><table>');table=true;}
      out.push('<tr>'+line.slice(1,-1).split('|').map(s=>'<td>'+inline(s.trim())+'</td>').join('')+'</tr>');continue;
    }
    if(table){out.push('</table></div>');table=false;}
    if(!line.trim())continue;
    const h=line.match(/^(#{1,3}) /);
    out.push(h?`<h${h[1].length}>${inline(line.slice(h[0].length))}</h${h[1].length}>`:'<p>'+inline(line)+'</p>');
  }
  if(table)out.push('</table></div>');return out.join('\n');
}
function chart(study){
  const labels=[['friday-initial','#b76800'],['friday-final','#2660ad'],['current','#12805c']];
  const datasets=study.datasets.filter(d=>d.scored),out=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 370" role="img" aria-labelledby="chart-title chart-desc"><title id="chart-title">Aynı yoğun bakım verisinde doğru oda süresi karşılaştırması</title><desc id="chart-desc">Üç testte Cuma ilk, Cuma son ve bugünkü motor ile ayarlar. Değerler gerçek oda zamanında doğru oda yüzdesidir, yakalama yüzdesi değildir.</desc><rect width="920" height="370" fill="white"/><g font-family="system-ui" font-size="13" fill="#172a3a">'];
  for(let i=0;i<datasets.length;i++){
    const y=45+i*88;out.push(`<text x="20" y="${y+23}">${esc(datasets[i].name)}</text>`);
    labels.forEach(([profile,color],j)=>{
      const value=datasets[i].trials.find(t=>t.profile===profile).roomPercent,barY=y+j*22;
      out.push(`<rect x="220" y="${barY}" width="${value*16}" height="16" fill="${color}"/><text x="${230+value*16}" y="${barY+13}">${percent(value)}</text>`);
    });
  }
  labels.forEach(([profile,color],i)=>out.push(`<rect x="${20+i*290}" y="325" width="14" height="14" fill="${color}"/><text x="${40+i*290}" y="337">${esc(profiles[profile])}</text>`));
  out.push('<text x="220" y="24">Doğru oda zamanı — %0–35 ölçeği</text></g></svg>');return out.join('\n');
}
(async()=>{
  const study=await readJson(path.join(root,'study.json')),p=await readJson(path.join(root,'provenance.json'));
  const archivedAnalysis=await readJson(p.historicalEvidence.archivedAnalysis);
  p.historicalEvidence.recordedDatabaseVersions=archivedAnalysis.historicalVersions;
  assert.ok(archivedAnalysis.historicalVersions.some(v=>v.engine_version==='room-evidence-9'&&v.config_version==='db4d1a246b950588'),'Friday live decision versions are not confirmed');
  await fs.writeFile(path.join(root,'provenance.json'),JSON.stringify(p,null,2)+'\n');
  const validation=await readJson(path.join(root,'validation-results.json'));
  for(const [file,digest]of Object.entries(validation.sourceHashes))assert.equal(hash(await fs.readFile(file)),digest,'Validation is stale; rerun validate-icu-friday: '+file);
  const gates=validation.results;
  assert.equal(study.archivedFridayReplayMatched,true);assert.equal(study.deterministic,true);assert.equal(study.geometrySame,true);
  const before=await readJson(path.join(root,'source-hashes-before.json')),changes=[];
  for(const [file,digest]of Object.entries(before)){
    let after;try{after=hash(await fs.readFile(file));}catch(e){if(e.code!=='ENOENT')throw e;after='missing';}
    if(after!==digest)changes.push({path:file,before:digest,after});
  }
  const critical=[];
  for(const [file,digest]of Object.entries({
    'src/server/regionEngine/RegionPositionEngine.ts':p.currentEngineSha256,
    'src/server/regionEngine/controller.ts':before['src/server/regionEngine/controller.ts'],
    'src/server/trackingBuffer.ts':before['src/server/trackingBuffer.ts'],
    'config/maps/necmettin-yogun-bakim/regions.json':p.currentConfigSha256,
    'config/maps/necmettin-yogun-bakim/tracking-filter.json':p.currentTrackingFilterSha256,
  })){
    const after=hash(await fs.readFile(file));assert.equal(after,digest);critical.push({path:file,sha256:after,unchanged:true});
  }
  const datasets=[];
  for(const d of study.datasets){
    const dir=path.resolve('tools/room-benchmark/datasets',d.testId),raw=hash(await fs.readFile(path.join(dir,'raw.jsonl'))),truth=hash(await fs.readFile(path.join(dir,'truth.json')));
    assert.equal(raw,d.dataset.sha256);assert.equal(truth,d.dataset.truthSha256);
    datasets.push({testId:d.testId,rawSha256:raw,truthSha256:truth,truthRevision:d.dataset.truthRevision,unchangedSinceReplay:true});
  }
  for(const s of p.sources)assert.equal(hash(await fs.readFile(s.storedPath)),s.sha256);
  for(const s of p.transpilation.outputs)assert.equal(hash(await fs.readFile(s.path)),s.sha256);
  const verification={scope:'All writes in tools/room-benchmark; no production/config/DB changes',outsideFilesChecked:Object.keys(before).length,outsideChanges:changes,criticalSources:critical,datasets,
    originalFridaySourceHashesMatched:3,archivedFridayDecisionsAndMetricsMatched:true,archivedSchemaParity:study.archivedParityPolicy,
    profiles:study.profiles.length,datasetsReplayed:study.datasets.length,scoredDatasets:study.datasets.filter(d=>d.scored).length,deterministicReplays:study.profiles.length*study.datasets.length*2,
    tests:{total:gates.tests.tests,passed:gates.tests.pass,failed:gates.tests.fail,skipped:gates.tests.skipped,skipReason:'DB-writing integration test disabled with TRACKING_PDOP_DATABASE_TEST=0'},
    typecheck:{benchmark:gates['benchmark-typecheck'].exitCode===0?'passed':'failed',project:gates['project-typecheck'].exitCode===0?'passed':'failed',projectError:gates['project-typecheck'].diagnostics},
    concurrentOutsideChangesCaveat:'Outside changes happened during this experiment and were preserved. This task wrote only benchmark files. Critical motor/controller/tracking and ICU settings hashes stayed unchanged.',
    isolation:{noDatabaseConnection:true,noDatabaseWrite:true,noLiveApiReplay:true,noLiveListenerOrSse:true,noServerRestartOrStop:true,inMemoryPublish:true,automaticTimersDisabled:true,virtualClock:true},
    gitCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),gitStatus:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim()};
  await fs.writeFile(path.join(root,'verification.json'),JSON.stringify(verification,null,2)+'\n');
  const selected=['friday-initial','friday-final','current'];
  const md=['# Yoğun Bakım: Cuma motoru ve ayarları → bugün','',
    '**Sonuç:** Cuma gününün son motoru/ayarları bugünkü iki testte daha iyi oda süresi üretmedi. Cuma ilk ayarındaki 2 nokta şartı yalnız Cafer Oda 2 ziyaretini geri kazandırıyor; aynı kazanım bugünkü motorla da oluşuyor. Eski Hasan verisindeki küçük süre kaybı çıkış eşiğine bağlı; yeni motor kodunu geri almak bu arşivlerde kazanım sağlamadı.','',
    '## Hangi Cuma sürümü?','',
    'Cuma = 9 Ekim 2026. Git 4e2136f21a27559883e5e7e1ac7379d8c5927b03, saat 15:14:24 Europe/Istanbul; motor room-evidence-9. O gün ilk rapor dirty 659d846 checkout üzerinden alınmıştı. Bu ref tek başına room-evidence-8 ve boş yoğun bakım bölgeleri içerdiği için kullanılmadı. İlk raporda kayıtlı motor, configLoader ve geometry SHA-256 değerleri 4e2136f Git bloblarıyla tam eşleşti.','',
    'Eski motor gerçekten çalıştırıldı: değişmeden alınan Git kaynakları ve o sürümün configLoader/varsayılanları kullanıldı. Yeniden yazılmış motor veya yalnız yeni motorun filtre-kapalı seçeneğiyle eski motor benzetimi yapılmadı. Salt deney snapshotı .snapshot uzantısında tutulur; TypeScript 5.9.3 ile aynı kaynak CommonJS/ES2022 JavaScript’e çevrilir. Kaynak, Git blob ve çalıştırılan JS hash’leri provenance.json içinde. Canlı benchmark varsayılanı aktif RegionPositionEngine importudur.','',
    '9 Ekim Hasan testinin Cuma ilk ayarında bütün kayıtlı karar alanları (decisionId dahil) ve metrikleri eski raporla eşleşti. Eski raporun saklamadığı sonraki PDOP/evidence açıklamaları yalnız şema eşitliği kontrolünde dışlandı; yeni raporlarda korunur. Cuma son ayarını aynı günün Git config’i doğrular. İki Cuma ayarı, giriş nokta sayısı 2 →3 olduğundan ayrı gösterilir.','',
    'Kaydedilmiş canlı DB kararlarının 456’sında motor room-evidence-9 ve configVersion db4d1a246b950588 görülüyor. Dolayısıyla Hasan testinin fiilen alındığı Cuma ayarı ilk/2 noktalı profildir. Cuma son profili eldeki 15:14 Git snapshotıdır; bütün günün son canlı process durumunun kanıtı olarak sunulmaz.','',
    '| Parametre | Cuma ilk | Cuma son | Bugün |','|---|---|---|---|',
    '| Motor | room-evidence-9 | room-evidence-9 | room-evidence-10 |',
    '| ConfigVersion | db4d1a246b950588 | e93540bc005cc410 | 98a9f1072bbf5a4e |',
    '| Giriş | 1,5 sn / 2 nokta | 1,5 sn / 3 nokta | 1,5 sn / 3 nokta |',
    '| Çıkış | 1,5 sn / 2 nokta | 1,5 sn / 2 nokta | 1 sn / 2 nokta |',
    '| Hız | 8 m/s | 8 m/s | 8 m/s |',
    '| Duvar / ortak duvar | 0,35 / 0,65 m | 0,35 / 0,65 m | 0,35 / 0,65 m |',
    '| silentCoverageStaleMultiplier | 8 | 8 | 3 |',
    '| Mesafe / yeniden konumlanma filtresi | Yok | Yok | 10 m / 2 nokta |',
    '| PDOP ön filtresi | Yok | Yok | Açık, 70 |','',
    'Oda poligonları, kapılar ve geometrik bölge tanımları aynıdır. Derlenmiş odalar regular coverage; silent çarpanının 8 →3 değişimi bu testlerin oda başarısını değiştirmedi. Kaynak harita dosyalarının hash/configVersion farkları gizlenmedi.','',
    '## Test bazında sonuç','',
    '| Veri | Cuma ilk: yakalama / doğru oda | Cuma son: yakalama / doğru oda | Bugün: yakalama / doğru oda |','|---|---:|---:|---:|',
    ...study.datasets.map(d=>'| '+d.name+' | '+selected.map(name=>{const t=d.trials.find(t=>t.profile===name);return caught(t)+' / '+percent(t.roomPercent);}).join(' | ')+' |'),' ',
    'Yakalama: ziyaret sırasında en az bir IN_REGION veya INFERRED_IN_REGION doğru oda kararı. Doğru oda yüzdesi: gerçek oda aralıklarında doğrulanmış+tahmini doğru süre / gerçek oda süresi. ENTRY_CANDIDATE, EXIT_CANDIDATE ve LOCATION_LOST başarı sayılmaz. Bu iki metrik birbirinin yerine kullanılmaz. 8 Ekim testinin taşınan tagı hâlâ belirsiz; bütün profillerde replay edildi, başarı puanlanmadı.','',
    '## Toplam maliyet ve kazanım: 3 puanlı test, 9 ziyaret','',
    '| Profil | Yakalama | Doğru oda | Kesin / tahmini doğru sn | Yanlış oda sn | Koridorda oda sn |','|---|---:|---:|---:|---:|---:|',
    ...study.combined.filter(t=>selected.includes(t.profile)||['current-entry2','current-exit1500'].includes(t.profile)).map(t=>`| ${profiles[t.profile]} | ${caught(t)} | ${percent(t.roomPercent)} | ${number(t.confirmedSeconds)} / ${number(t.inferredSeconds)} | ${number(t.wrongRoomSeconds)} | ${number(t.corridorFalseSeconds)} |`),'',
    'Toplam yüzdeler zaman ağırlıklıdır; üç yüzde aritmetik ortalama alınmadı. 250 ms örnek paydası 212,75 sn, gerçek etiket aralıklarının tam toplamı 213,377 sn. Ziyaret yüzdeleri de aynı sabit örnek takvimini kullanır.','',
    'Cuma son → bugün: doğrulanmış doğru süre 31,75 →30,75 sn, tahmini 21 →20,5 sn; toplam doğru oda 1,5 sn azalıyor. Yanlış oda 5,5 →1,75 sn ve koridorda oda 22,75 →20 sn azalıyor. Başarı kaybı ile yanlış oda azalması birlikte değerlendirilmelidir.','',
    '## Motor ve ayar etkisini ayıran deney','',
    'Cuma motoru + bugünkü ayarlar, üç puanlı testte bugünkü motor + bugünkü ayarların yakalama/doğru süre/yanlış oda/koridor metriklerini aynı üretti. Bugünkü motor + Cuma ayarları da gerçek Cuma motorunun aynı ayarlardaki metriklerini üretti. Bu arşivlerde görülen fark motor kodu sürümünden kaynaklanmıyor. Bu sonuç bütün olası rotalarda iki algoritmanın eşdeğer olduğu anlamına gelmez.','',
    'Yalnız çıkışı 1000 →1500 ms yapmak Hasan oranını %27,061 →%28,136 ve doğru süreyi 37,75 →39,25 sn taşıdı. Yanlış oda 1,75 →5,5 sn, koridorda oda 15,5 →17,75 sn oldu. Diğer iki testte doğru oda süresi artmadı. Cuma’ya dönmek isteniyorsa eski motoru kurmak gerekmiyor; ölçülen küçük fark çıkış parametresiyle oluşuyor.','',
    'Yalnız girişi 3 →2 nokta yapmak Cafer Oda 2’yi geri getiriyor: ziyaret doğru oda %30,303, test oda oranı %13,699; 0,5 sn kesin +2 sn tahmini doğru süre. Oda 6 yine kaçıyor. Cafer koridor maliyeti 0 →2,75 sn; diğer iki testin oda/yanlış oda/koridor metrikleri değişmiyor. Cuma ilk ayarlarının tamamını geri almak yerine bu tek parametre, daha dar bir çevrimdışı deneme adayıdır. Yeni yanlış giriş örnekleriyle doğrulanmadan genel iyileşme olarak sunulmaz.','',
    'PDOP açık/70 ile kapalı bütün arşivlerde oda metriklerini aynı verdi. Yeni ham kayıtlarda PDOP 20’nin altında; eski ham veride PDOP yok. Canlı filtre DB’den önce elenmiş paketleri bu deney geri getirmez; gerçek filtre öncesi canlı kapsamı için ayrı kayıt gerekir.','',
    '## Bugünkü ziyaretlerin sorunları Cuma motoruyla çözülüyor mu?','',
    'Cafer Oda 2: Cuma ilk ayarında 5,644 sn sonra yakalanıyor; Cuma son ve bugün kaçırıyor. Süre kanıtı var ama üç güvenilir nokta yok; koridor ölçümü adayı sıfırlıyor. Cafer Oda 6: bütün sürüm/ayarlar kaçırıyor; içerideki noktalar duvar/ortak duvar bandında zayıf ve bazıları gerçek çıkıştan sonra teslim ediliyor.','',
    'Bilgisayar Oda 6: bütün üç temel profilde giriş gecikmesi 24,421 sn. 17,126 sn teslim boşluğu ve dönüşte yeniden giriş kanıtı beklemesi Cuma koduyla da aynı. Oda 2: bütün üç temel profilde giriş 6,996 sn ve gerçek çıkıştan 7,829 sn önce odayı bırakma var. Cuma motoruna dönmek bu erken çıkışı çözmüyor.','',
    'Eski Hasan testinin ilk Oda 5 ziyareti Cuma ilk/Cuma son/bugün kaçırılıyor. Eski motor bu sorunu da çözmüyor. Oda 1 doğru oranı %24,074 →%18,519; eski çıkış 1,5 sn parametresi bu farkı geri getirirken yanlış oda maliyetini de yükseltiyor.','',
    '## Ziyaret bazında aynı ham veride karşılaştırma','',
    '| Veri / ziyaret | Oda | Cuma ilk doğru oda / giriş | Cuma son doğru oda / giriş | Bugün doğru oda / giriş |','|---|---|---:|---:|---:|'];
  for(const d of study.datasets.filter(d=>d.scored)){
    const current=d.trials.find(t=>t.profile==='current');
    for(const v of current.visits)md.push(`| ${d.name} / ${v.index} | ${v.roomId} | `+selected.map(name=>{const old=d.trials.find(t=>t.profile===name).visits.find(x=>x.index===v.index);return percent(old.roomPercent)+' / '+(old.missed?'kaçırıldı':number(old.entryDelayMs/1000)+' sn');}).join(' | ')+' |');
  }
  md.push('','## Bütün kontrollü profiller','');
  for(const d of study.datasets){
    md.push('### '+d.name,'',`Test ${d.testId}; raw ${d.dataset.rowCount} satır / SHA-256 ${d.dataset.sha256}; truth rev ${d.dataset.truthRevision} / SHA-256 ${d.dataset.truthSha256}.`,'',
      '| Profil | Motor / configVersion | Yakalama | Katı / ±2 sn doğru oda | Kesin / tahmini sn | Yanlış oda sn | Koridorda oda sn |','|---|---|---:|---:|---:|---:|---:|',
      ...d.trials.map(t=>`| ${profiles[t.profile]} | ${t.engineVersion} / ${t.config.version} | ${caught(t)} | ${percent(t.roomPercent)} / ${percent(t.tolerantRoomPercent)} | ${number(t.confirmedSeconds)} / ${number(t.inferredSeconds)} | ${number(t.wrongRoomSeconds)} | ${number(t.corridorFalseSeconds)} |`),'');
  }
  md.push('## Zamanlama, kapsam ve doğrulama','',
    'Aynı raw/truth, 30 sn ısınma, 60 sn gözlem; test aralığı dışı puanlanmaz. created_at ölçüm/hız kanıtı, received_at teslim zamanı; eşit milisaniyede tick önce, sonra DB id. Tick 1000 ms, örnek 250 ms; tolerans ±2 sn yalnız oda giriş/çıkış sınırlarını dışlar. Europe/Istanbul gösterimi, dosyalarda UTC/ISO. Testlerin ham verisi/truth değişmedi; received_at eksik değil. Yeni iki testte bütün PDOP alanları var, hardware quality boş; Bilgisayar testinde iki büyük boşluk vardır.','',
    `11 profil ×4 veri kümesi, her biri iki kez: **${verification.deterministicReplays} deterministik replay**. Dört datasetten üçü puanlı; belirsiz eşleşmeye tag uydurulmadı. ${verification.outsideFilesChecked} benchmark dışı takipli dosyanın hash’i denetlendi; eşzamanlı başka çalışma sırasında değişen ${changes.length}: ${changes.map(c=>c.path).join(', ')||'yok'}. Bu değişiklikler korunur; bu çalışma benchmark dışına yazmadı. Karşılaştırmada kullanılan motor/controller/trackingBuffer ve yoğun bakım harita/PDOP dosyaları aynı kaldı. DB bağlantısı dahi açılmadı; mevcut değişmez dosyalar kullanıldı. Listener/SSE/HTTP replay yok; çalışan sunucu durdurulmadı veya yeniden başlatılmadı.`,'',
    `Testler **${verification.tests.passed} geçti, ${verification.tests.failed} başarısız, ${verification.tests.skipped} atlandı** (DB’ye yazan entegrasyon kapalı). Benchmark typecheck: ${verification.typecheck.benchmark}. Genel proje typecheck: ${verification.typecheck.project}. ${verification.typecheck.projectError||'Tanı yok.'} İlgisiz dosyalar korunur. Snapshot kaynakları .snapshot ve runtime .js olduğundan proje TypeScript taramasına tarihsel tipler eklenmez.`,'',
    'provenance.json Git kaynaklarını/derleyiciyi; study.json profil sonuçları, config SHA ve standart rapor yollarını; verification.json kaynak/veri hash’lerini ve doğrulama sonuçlarını içerir. Her puanlı ziyaretin ham nokta → ölçüm → teslim → motor durumu/reason → sonraki boşluk çizelgesi kısa-id-profil-visit-details.json dosyalarındadır. Standart JSON/Markdown/HTML raporlar ilgili profil klasörlerinde kayıtlıdır.','',
    '## Yeni koşu komutları','',
    'node tools/room-benchmark/experiments/prepare-icu-friday.cjs YENI-RUN-ID','',
    'node --import tsx tools/room-benchmark/experiments/compare-icu-friday.ts YENI-RUN-ID','',
    'node tools/room-benchmark/experiments/validate-icu-friday.cjs YENI-RUN-ID','',
    'node tools/room-benchmark/experiments/finalize-icu-friday.cjs YENI-RUN-ID','',
    'Her yeni deney için farklı RUN-ID kullan. Mevcut datasetlere yazılmaz; yeni rapor ve doğrulanmış Git snapshotı yalnız tools/room-benchmark/reports altında oluşur. validate komutu test/typecheck çıktılarını validation-results.json ve log dosyalarına kaydeder. Sonlandırıcı bu kaynak hash’lerini denetler; kaynak değiştiyse eski doğrulama sonucunu kullanmayı reddeder.','',
    '## Hatırlatma','',
    'Gerçekte odadayken ham noktaların koridora/harita dışına düşmesi ve sinyal boşluğu konum üretimi, harita hizası veya filtre/kayıt zincirinde de incelenmelidir. Cuma motoruna dönmek bu veri sorunlarını çözmedi. Parametre kazanımını doğrulanmış doğru süre, tahmini doğru süre, yanlış oda ve koridor maliyetiyle birlikte değerlendir.');
  const markdown=md.join('\n')+'\n';await fs.writeFile(path.join(root,'analysis.md'),markdown);
  const svg=chart(study);await fs.writeFile(path.join(root,'comparison.svg'),svg);
  const standardLinks=study.datasets.filter(d=>d.scored).flatMap(d=>selected.map(profile=>{
    const t=d.trials.find(t=>t.profile===profile),link=path.relative(root,path.join(t.reportPath,'report.html')).replaceAll('\\','/');
    return {link,label:d.name+' — '+profiles[profile]};
  }));
  for(const item of standardLinks)await fs.access(path.resolve(root,item.link));
  const html='<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yoğun Bakım — Cuma ve bugün</title><style>body{font:16px system-ui;line-height:1.55;background:#f3f6f8;color:#172a3a;max-width:1180px;margin:30px auto;padding:0 18px}main{background:white;padding:28px;border-radius:14px}h1{font-size:27px}h2{margin-top:32px;color:#174b64}h3{font-size:20px}a{color:#085b9a}code{background:#edf2f5;padding:2px 4px;overflow-wrap:anywhere}.table{overflow:auto;margin:20px 0}table{border-collapse:collapse;font-size:14px;width:100%}td{padding:9px;border:1px solid #d2dbe2;vertical-align:top}tr:first-child{font-weight:700;background:#e8f1f5}summary{cursor:pointer;font-weight:700}details{margin:20px 0}nav{margin-bottom:25px}strong{color:#174b64}svg{width:100%;height:auto}p{overflow-wrap:anywhere}@media print{body{background:white}main{padding:0}.table{overflow:visible}}</style></head><body><main><nav><a href="analysis.md">Markdown</a> · <a href="study.json">Tüm deney JSON</a> · <a href="provenance.json">Cuma kaynak kanıtı</a> · <a href="verification.json">Doğrulama</a> · <a href="comparison.svg" download>Grafik SVG</a></nav>'+svg+body(markdown)+'<details><summary>Standart profil raporları</summary><ul>'+standardLinks.map(l=>`<li><a href="${esc(l.link)}">${esc(l.label)}</a></li>`).join('')+'</ul></details></main></body></html>';
  await fs.writeFile(path.join(root,'analysis.html'),html);
  console.log(JSON.stringify({report:path.join(root,'analysis.html'),profiles:verification.profiles,deterministicReplays:verification.deterministicReplays,archivedFridayReplayMatched:true,outsideChanges:changes.map(c=>c.path),verifiedDatasets:datasets.length,combined:study.combined.filter(t=>selected.includes(t.profile)||['current-entry2','current-exit1500'].includes(t.profile))}));
})().catch(e=>{console.error(e);process.exitCode=1;});
