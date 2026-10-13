import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {sha256} from '../model';
import type {ReplayResult} from '../replay';
import {readDataset} from '../importer';

const id=process.argv[2];if(!id||!/^[a-zA-Z0-9-]+$/.test(id))throw Error('Existing study ID required');
const root=path.resolve('tools/room-benchmark/reports',id);
const study=JSON.parse(await readFile(path.join(root,'summary.json'),'utf8'));
// Fixed interpretation of the 13 October experiment. Fail rather than publish stale numbers.
assert.equal(study.engineVersion,'room-evidence-10');
assert.equal(study.maps.find((m:{id:string})=>m.id==='necmettin-servis').configVersion,'a255e5826bbb57d8');
assert.equal(study.maps.find((m:{id:string})=>m.id==='necmettin-yogun-bakim').configVersion,'98a9f1072bbf5a4e');
assert.equal(study.replays,100);
const expected={
  'necmettin-servis:current':[39,62,65500,335000,217732,79500],
  'necmettin-servis:one-outside-3000-window6000':[42,62,75500,363500,220732,79500],
  'necmettin-yogun-bakim:current':[6,9,30750,20500,20000,1750],
  'necmettin-yogun-bakim:one-outside-3000-window6000':[7,9,32000,20500,22750,1750],
};
for(const [key,values] of Object.entries(expected)){
  const row=study.summary.find((s:{mapId:string;profile:string})=>s.mapId+':'+s.profile===key);
  assert.deepEqual([row.caught,row.visits,row.confirmedMs,row.inferredMs,row.corridorFalseMs,row.wrongRoomMs],values,'Fixed narrative requires matching metrics');
}
const profile='one-outside-3000-window6000';
const results=[];
for(const test of study.tests){
  const {truth,manifest,truthSha256}=await readDataset(test.testId);
  assert.equal(manifest.sha256,test.rawSha256);assert.equal(truthSha256,test.truthSha256);
  const variants=[];
  for(const key of ['current',profile]){
    const result=JSON.parse(await readFile(path.join(root,test.testId+'-'+key+'.json'),'utf8')) as ReplayResult;
    const visits=Object.entries(result.metrics.tags).flatMap(([tag,t])=>truth.visits.map((v,index)=>{
      const events=result.decisions.filter(d=>d.tagCode===tag);
      let confirmedMs=0,inferredMs=0;
      for(let j=0;j<events.length;j++){
        const d=events[j];if(d.roomId!==v.roomId||!['IN_REGION','INFERRED_IN_REGION'].includes(d.state))continue;
        const dt=Math.max(0,Math.min(Date.parse(v.to),Date.parse(events[j+1]?.at??truth.test.to))-Math.max(Date.parse(v.from),Date.parse(d.at)));
        if(d.state==='IN_REGION')confirmedMs+=dt;else inferredMs+=dt;
      }
      return {tag,index:index+1,roomId:v.roomId,...(t.visits[index] as {missed:boolean;entryDelayMs:number|null}),exactConfirmedMs:confirmedMs,exactInferredMs:inferredMs};
    }));
    variants.push({profile:key,visits});
  }
  results.push({testId:test.testId,variants});
}
const cafer=results.find(t=>t.testId.startsWith('test-36f6f20f'))!;
assert.equal(cafer.variants[0].visits[0].missed,true);
assert.equal(cafer.variants[1].visits[0].exactConfirmedMs,124);
const lines=['# Giriş kanıtı hafızası: sonuçların yorumu','',
  'Bu deneyde dış noktayı iç nokta saymadım. Aynı odanın güvenilir iç kanıtını kısa bir dış ölçüm boyunca aday hafızasında tuttum. Dönüşte aktif motor sayı/süre/kapı/filtre gereksinimlerini yeniden değerlendirdi. Canlı motor ve config değişmedi.','',
  '## Nasıl çalışır?','',
  '- `İç1 → İç2 → Dış → İç3`: 3 güvenilir iç nokta ve gerekli süre varsa giriş doğrulanır. Dış noktada oda atanmaz.',
  '- `İç1 → İç2 → Dış → Dış`: aday iptal olur. Başka odadan gelen kabul edilmiş nokta da eski adayın kanıtını taşımaz.',
  '- Pencere 6 sn; tek dış noktadan dönüş 1,5 veya 3 sn; en az %75 güvenilir iç / (güvenilir iç + kabul edilmiş dış) oranı. Ölçüm ve teslim saatleri ayrı korunur.',
  '- Hız/mesafe/PDOP/kalite nedeniyle reddedilen nokta ve duvar bandındaki zayıf ölçüm iç kanıt sayılmaz. Reddedilen paket hafızayı süre sınırı içinde koruyabilir; yeni kanıt eklemez.',
  '- Yoğun bakım 1,5 sn / 3, Servis 2 sn / 5 kalır. Örnekteki toplam 4 iç nokta Servisin 5 nokta eşiğini tek başına karşılamaz.',
  '- Süre, motorun ilk–son iç ölçüm farkıdır; kısa dış aralık da bu farka dahildir. Kesintisiz içeride kalma süresi değildir.','',
  '## Servis','',
  '7 doğrulanmış testte 62 ziyaret: 3 sn dönüş / 6 sn pencere ile 39/62 → 42/62 (%62,90 → %67,74). Gerçek oda süresindeki zaman ağırlıklı doğruluk %24,137 → %26,458; koridorda oda 217,732 → 220,732 sn (+3 sn). Başka oda süresi 79,5 sn kalır. Yanlış doğrulama sayısı 25 kalır; aynı yanlış kararı daha uzun tutmak süre maliyetini artırabilir.','',
  'Doğru oda kazancı +38,5 sn: +10 sn kesin, +28,5 sn tahmini. Kazancın %74,0’ı tahmindir. Bu nedenle 42 yakalama, 42 ziyaretin tamamının güvenilir takip edildiği anlamına gelmez. ±2 sn sınırları dışındaki doğruluk %23,791 → %26,377; koridor maliyeti 128,982 → 129,232 sn (+0,25 sn).','',
  '| Yeni yakalama | Ziyaret | Giriş gecikmesi |',
  '|---|---|---:|',
  '| Servis2 / cihaz / 4192b569 | 2. ziyaret, room-12 | 10,046 sn |',
  '| Mustafa uzun / 5c71fd2a | 6. ziyaret, room-05 | 38,291 sn |',
  '| Bilgisayar / 9a7debf0 | 11. ziyaret, room-13 | 3,977 sn |','',
  'Mustafa uzun testinde room-10 giriş gecikmesi 50,196 → 7,987 sn; room-14 için 31,397 → 27,786 sn. Çoğu ziyarette değişiklik yok; ortak ziyaretlerde medyan gecikme değişimi 0 sn. Yeni yakalamalar dahil medyanın 5,604 → 5,756 sn olması mevcut girişlerin genel olarak yavaşladığı anlamına gelmez.','',
  'Daha dar 1,5 sn dönüş profili 40/62 yakalama, %24,936 doğruluk ve +0,75 sn katı koridor maliyeti verir. Başlangıçta kontrollü denemek için daha ihtiyatlı seçenek budur. 12 sn pencere, tek dış nokta sınırında 6 sn ile aynı sonuç verir; pencereyi büyütmek bu veri üzerinde ek fayda sağlamadı.','',
  '## Yoğun bakım','',
  '3 doğrulanmış testte 9 ziyaret: 3 sn profil 6/9 → 7/9. Gerçek oda süresindeki doğruluk %24,089 → %24,677; kesin doğru +1,25 sn, tahmini değişmedi. Koridorda oda 20 → 22,75 sn.','',
  '**Cafer room-02**: 08:55:19.646Z ilk güçlü iç, 22.400Z ikinci güçlü iç; 22.933Z dış; 22.962Z iç görünmesine rağmen hız reddi; 24.962Z üçüncü geçerli iç. Deney doğrular, ancak gerçek çıkış 25.086Z olduğu için **yalnız 124 ms** doğru odadır. 250 ms zaman ağırlıklı puanda bu kısa kesit örneğe denk gelmedi ve bu testin doğru oda yüzdesi %0 kaldı. Yakalama sayısındaki +1 pratik bir takip başarısı sayılmamalıdır. Ardından +2,75 sn koridorda oda tutulur.','',
  'Cafer room-06’da güçlü iç kanıt yok: ölçümler duvar bandında veya koridorda. Aday hafızasını tutmak bunu çözmez. Bilgisayar yoğun bakım testi değişmez. Hasan testinde +1,25 sn kesin doğru elde edilir; ilk room-05 ziyareti yine kaçırılır.','',
  '1,5 sn dönüş profili yoğun bakımda aynı +1,25 sn kesin doğruyu koridor maliyeti eklemeden verir. Bu arşiv, yoğun bakımda 3 sn geniş toleransı desteklemiyor. Daha serbest birden çok dış nokta kontrolü doğruluğu bir miktar yükseltiyor, fakat sentetik koridor sıçrama testi bu mantığın yanlış oda doğrulayabildiğini gösteriyor; genel ayar olarak önermiyorum.','',
  '## Sınırlar ve doğrulama','',
  '- 100 replay: 10 doğrulanmış veri kümesi × 5 profil × 2 tekrar. Kararlar, metrikler ve aday hafızası izleri eşit.',
  '- 15 ilgili test geçti; kapsam typecheck geçti. Genel typecheck önceden bulunan `reports/ui-experience-5c71fd2a-20261013/analyze.ts:133` çift `roomId` TS2783 hatasında durdu; ilgili eski dosya değiştirilmedi.',
  '- Gerçek saha replayleri boyunca interval, listener ve ağ/DB bağlantısı açma çağrıları engellendi. Kaynak/map ve benchmark dışındaki Git diff hashleri aynı.',
  '- 8 Ekim 2a7fecc4 doğrulanmamış tag nedeniyle; f93aa2c0 ham arşivi olmadığından puanlanmadı. Yeni DB dışa aktarımı gerekmedi.',
  '- Güncel config: yoğun bakım 98a9f1072bbf5a4e, Servis a255e5826bbb57d8; motor room-evidence-10. PDOP yoğun bakım 70; Servis map dosyası bulunmadığından ortak varsayılan 20. Profiller arasında aynı PDOP kullanıldı.',
  '- Bu aday hafızası bir çevrimdışı adaptördür; aktif motorun tanı durumunu yalnız ayrı süreçte geri yükler. Üretim entegrasyonu yapılmadı.',
  '- Ham veri/truth/geometri değişmedi. Bu arşivler ayar seçimi için tekrar kullanılıyor; yeni saha testinde doğrulama gereklidir.','',
  '## Hatırlatma','',
  'Ham konumun gerçek odadan koridora/karşı odaya sıçraması, sinyal kesintileri ve harita hizası sistem sorunudur. Giriş hafızası bu sorunların bir kısmını tolere eder; duvar bandı, verinin gecikmesi ve güçlü oda verisinin hiç gelmemesini tek başına çözmez.'
];
await writeFile(path.join(root,'interpretation.md'),lines.join('\n')+'\n',{flag:'wx'});
await writeFile(path.join(root,'exact-visit-durations.json'),JSON.stringify(results,null,2)+'\n',{flag:'wx'});
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const markup=lines.map(s=>s.startsWith('# ')?'<h1>'+escape(s.slice(2))+'</h1>':s.startsWith('## ')?'<h2>'+escape(s.slice(3))+'</h2>':s.startsWith('|')?s.includes('|---')?'':'<tr>'+s.split('|').slice(1,-1).map(v=>'<td>'+escape(v.trim())+'</td>').join('')+'</tr>':'<p>'+escape(s).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')+'</p>').join('\n').replace(/((?:<tr>.*<\/tr>\n?)+)/g,'<table>$1</table>');
await writeFile(path.join(root,'interpretation.html'),'<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Giriş hafızası sonuçları</title><style>body{font:16px system-ui;line-height:1.6;max-width:1050px;margin:30px auto;padding:0 22px;color:#172d3e}h1,h2{color:#12405e}strong{color:#a33220}table{border-collapse:collapse;width:100%}td{border:1px solid #c8d4df;padding:8px}tr:first-child{font-weight:bold;background:#e3edf5}</style>'+markup+'</html>',{flag:'wx'});
await writeFile(path.join(root,'validation.json'),JSON.stringify({relatedTests:{passed:15,failed:0,command:'node --import tsx --test tools/room-benchmark/experiments/entry-memory.test.ts tools/room-benchmark/benchmark.test.ts'},
  scopedTypecheck:{passed:true,command:'node node_modules/typescript/bin/tsc -p tools/room-benchmark/experiments/tsconfig.entry-memory.json --noEmit'},
  rootTypecheck:{passed:false,command:'node node_modules/typescript/bin/tsc --noEmit --incremental false',existingError:'TS2783 tools/room-benchmark/reports/ui-experience-5c71fd2a-20261013/analyze.ts(133,23)'},
  deterministicReplays:study.replays,isolation:study.isolation,productionUnchanged:study.verifiedSameAfter,
  outsideDiffSha256:study.outsideDiffSha256,summarySha256:await sha256(await readFile(path.join(root,'summary.json')))},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({study:id,caferExactMs:cafer.variants[1].visits[0].exactConfirmedMs,files:['interpretation.md','interpretation.html','exact-visit-durations.json','validation.json']},null,2));
