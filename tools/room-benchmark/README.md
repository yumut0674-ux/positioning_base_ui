# Çevrimdışı oda benchmarkı

## 9 Ekim Cuma motoru/ayarları ile 13 Ekim karşılaştırması

[Karşılaştırma HTML](reports/yogun-bakim-friday-vs-current-20261013/analysis.html), [Markdown](reports/yogun-bakim-friday-vs-current-20261013/analysis.md). Dört yoğun bakım datasetinde 11 profil iki kez oynatıldı; 8 Ekim tagı belirsiz dataset puanlanmadı. Cuma kaynaklarının SHA-256 değerleri o günkü raporla eşleşti, eski Hasan kararları ve metrikleri yeniden üretildi. Cuma ilk (2 nokta) / Cuma son (3 nokta) ayrı gösterilir. Bugünkü iki testte Cuma son ayarı aynı oda başarısını verdi; Cuma ilk ayarı yalnız Cafer Oda 2'yi toparladı. Motor/config etkisi ayrı profillerle ölçüldü; üretim ayarları değişmedi.

Tarihsel karşılaştırma yalnız değişmez Git snapshotlarını kullanır; elle uyarlanan ikinci motor oluşturulmaz. Varsayılan `replay` hâlâ aktif `RegionPositionEngine` importudur. Snapshot `.snapshot`, çalıştırma çıktısı `.js` olarak rapor klasöründe tutulur; eski tipler proje typecheck'ine karışmaz. Her yeni deneyde farklı RUN-ID kullan:

```powershell
node tools/room-benchmark/experiments/prepare-icu-friday.cjs YENI-RUN-ID
node --import tsx tools/room-benchmark/experiments/compare-icu-friday.ts YENI-RUN-ID
node tools/room-benchmark/experiments/validate-icu-friday.cjs YENI-RUN-ID
node tools/room-benchmark/experiments/finalize-icu-friday.cjs YENI-RUN-ID
```

Kaynak/çalıştırma/config hash'leri `provenance.json`, profil sonuçları `study.json`, gerçek test/typecheck çıktıları `validation-results.json`, bütünlük ve izolasyon doğrulaması `verification.json` içinde kaydedilir. DB bağlantısı gerekmez. Yeni doğrulamada ilgili kaynağın hash'i değişmişse sonlandırıcı eski test sonucunu kabul etmez.

## 13 Ekim — iki yeni Yoğun Bakım testi

`test-36f6f20f-65cb-49f4-b704-71912f20c01d` (cafer, `9A8FA14BB93426F1`, 255 satır) ve `test-4255236f-db12-4a1c-bc09-5e11c51d5d2a` (bilgisayar, `9C76E417B4CB5ECF`, 299 satır) eklendi. Bağımsız rotalar ayrı puanlandı; UTC milisaniyeleri, truth revizyon 1, 30 sn ısınma ve 60 sn gözlem korunur. İki veri kümesinde received_at ve PDOP mevcut; tüm raw satırlar yoğun bakım haritasına ait.

Güncel `room-evidence-10` / `98a9f1072bbf5a4e`, harita PDOP sınırı 70: cafer 0/2 /%0; bilgisayar 2/2 /%24,545. Mesafe filtresini kapatmak süre sonucunu değiştirmedi. PDOP ≤10/7/5 bilgisayarın Oda 6 ziyaretini kaybettirdi; Servis eşiği yoğun bakıma otomatik taşınmamalı. Giriş iki nokta veya duvar 0,05 m yalnız cafer Oda 2'yi toparladı ve koridor maliyetini artırdı. Eski hasan verisi de aynı aktif motorla farklı config snapshotlarında tekrar oynatıldı; eski motor kopyalanmadı. 8 Ekim belirsiz tag testi puanlanmadı.

[Neden analizi](reports/yogun-bakim-pdop-two-20261013/interpretation.md), [statik HTML ve dört nokta çizimi](reports/yogun-bakim-pdop-two-20261013/analysis.html). Karar çizelgeleri ve profil JSON'ları aynı klasörde. Yeni replay örneği:

```powershell
node --import tsx tools/room-benchmark/cli.ts replay test-36f6f20f-65cb-49f4-b704-71912f20c01d --config config/maps/necmettin-yogun-bakim/regions.json --run-id YENI-ICU-ID
node --import tsx tools/room-benchmark/cli.ts replay test-4255236f-db12-4a1c-bc09-5e11c51d5d2a --config config/maps/necmettin-yogun-bakim/regions.json --run-id YENI-ICU-ID-2
node node_modules/typescript/bin/tsc -p tools/room-benchmark/experiments/tsconfig.icu-pdop.json --noEmit
```

## 13 Ekim — iki yeni Servis testi ve PDOP

`344ab34d` (5 ziyaret, 429 ham satır) ve `9a7debf0` (14 ziyaret, 580 satır) veri kümeleri eklendi. Kullanıcının belirttiği `9C76E417B4CB5ECF` kodu DB'de `bilgisayar` adıyla kayıtlı; başka aday tag puanlanmaz. Kaynak UTC milisaniyeleri, truth revizyon 1, 30 sn ısınma ve 60 sn gözlem korunur. İlk testte tüm PDOP alanları NULL; ikinci testte 579/580 satırda PDOP vardır.

Ziyaret tabloları ve eşik deneyleri: [sonuçlar](reports/servis-pdop-two-latest-20261013/analysis.md). Kaçırılma nedenleri ve öneriler: [yorum](reports/servis-pdop-two-latest-20261013/interpretation.md). Açılabilir rapor: [HTML](reports/servis-pdop-two-latest-20261013/analysis.html). Güncel motor `room-evidence-10`, Servis configVersion `a255e5826bbb57d8`; 3/5 ve 9/14 yakalama. Uzun testte Oda 8 yalnız 26 ms tahminle yakalanmış sayılır; süreye göre başarısı %0'dır. Bunu kalıcı başarı olarak yorumlamayın.

İçe aktarım `pdop` sütununu SELECT ile algılar; eski DB/JSONL girdilerinde eksik PDOP kabul edilir ve bilinmeyen olarak raporlanır. Replay, mevcut saf `isPositionPdopAccepted` kuralını motora teslimden önce uygular; elenmiş pakette de sanal tick ilerler. Harita config'inin yanındaki `tracking-filter.json` salt okunur yüklenir; yoksa shared varsayılan kullanılır. Şema/kural hatası sessizce varsayılana dönmez. Komut seçenekleri yalnız çevrimdışı deneyi değiştirir:

```powershell
node --import tsx tools/room-benchmark/cli.ts replay test-9a7debf0-57ad-4df2-802b-ae92e4c20b13 --config config/maps/necmettin-servis/regions.json --run-id YENI-RUN-ID
node --import tsx tools/room-benchmark/cli.ts replay test-9a7debf0-57ad-4df2-802b-ae92e4c20b13 --config config/maps/necmettin-servis/regions.json --pdop-max 7 --run-id YENI-PDOP-7-ID
node --import tsx tools/room-benchmark/cli.ts replay test-9a7debf0-57ad-4df2-802b-ae92e4c20b13 --config config/maps/necmettin-servis/regions.json --pdop-off --run-id YENI-OFF-ID
node --import tsx --test tools/room-benchmark/benchmark.test.ts tools/room-benchmark/pdop.test.ts
node node_modules/typescript/bin/tsc -p tools/room-benchmark/experiments/tsconfig.service-pdop.json --noEmit
```

Canlıda PDOP yüzünden elenen paketler DB geçmişine yazılmadan atılır. `--pdop-off` bunları geri getiremez; sadece kayıtlı veride eşik etkisi karşılaştırılır. Kural SHA, harita PDOP dosyası SHA/yokluğu, etkinlik/eşik rapora kaydedilir; `compare` farklı PDOP politikalarını aynı deney diye kıyaslamaz. Testte PDOP ≤7 yakalamayı 10/14'e çıkardı; ≤5 yanlış oda sürelerini daha fazla azaltırken yakalamayı 8/14'e indirdi. Henüz genel canlı ayar önerisi değildir.

## Servis çıkış eşiği deneyi (13 Ekim 2026)

`node --import tsx tools/room-benchmark/experiments/study-service-exit.ts YENI-RUN-ID` yalnız kayıtlı ve tag eşleşmesi doğrulanmış Servis veri kümelerini güncel motorla oynatır. Güncel ayar, 2,5 sn / 3, 1,5 sn / 4, 2,5 sn / 4 ve 3 sn / 4 profilleri yerel config kopyalarında kıyaslanır; her koşu iki kez doğrulanır. Üretim config'i değişmez; veri/truth/config SHA-256, motor/commit ve zamanlama bilgileri rapora yazılır. Raw/manifest olmayan testler açıkça dışlanır. Typecheck: `node node_modules/typescript/bin/tsc -p tools/room-benchmark/experiments/tsconfig.service-exit.json --noEmit`. İlk çalışma: [analiz](reports/servis-exit-harder-20261013/analysis.md), [yorum](reports/servis-exit-harder-20261013/interpretation.md). Beş Servis testinde 27/43 yakalama değişmedi; 2,5 sn / 3 yalnız 1,25 sn doğru tahmin kazandırırken koridorda oda süresini 135 → 160,25 sn artırdı. Bu çalışma çıkışı genel olarak zorlaştırmayı desteklemiyor.

## Entegre filtre parametre taraması (13 Ekim 2026)

`experiments/sweep-integrated-filter.ts`, gerçek güncel motor ile Servis/yoğun bakımın doğrulanmış veri kümelerinde 19 ayrı filtre profilini iki kez oynatır. Komut: `node --import tsx tools/room-benchmark/experiments/sweep-integrated-filter.ts YENI-RUN-ID`. Her koşuda aynı veri/truth/harita korunur; yalnız mesafe, küme, sayı, süre, aday boşluğu veya pencere parametreleri yerel config kopyasında değişir. Snapshotlar ayrı SHA/configVersion ile kaydedilir. Kaynak ve harita hash'leri değişirse deney geçersiz olur. Seçilen profillerin tam karar raporlarını aynı fingerprint ile tekrar üretmek için `experiments/replay-sweep-selection.ts` kullanılır.

19 profillik çalışma: [analiz](reports/integrated-filter-parameter-sweep-20261013/analysis.md), [HTML](reports/integrated-filter-parameter-sweep-20261013/analysis.html). Bu veri üzerinde en iyi tek değişiklik Servis mesafe sınırını 5 → 10 m yapmak oldu: 25/43 → 27/43 yakalama, 80,75 → 39,75 sn yanlış oda. Tansiyon testindeki bir tahmini ziyaret kazanımı kayboldu; filtresiz temel sonuçla kıyas ve diğer hata türleri raporda gösterilir. Alternatif 5 m / 2 m küme / 2 nokta / 1 sn / 4 sn boşluk / 6 sn pencere koridor yanlış gösterimini daha fazla azaltır, fakat doğru oda süresi daha düşüktür. Bunlar çevrimdışı önerilerdir; canlı config değiştirilmedi. Puanlı yoğun bakım testinde bütün profiller aynı sonucu verdi; yeni veriyle doğrulama gerekir.

## Entegre filtre / hastane analizi (13 Ekim 2026)

Güncel `room-evidence-10` ve gerçek `StepDistanceFilter`, Servis ile yoğun bakımın 7 veri kümesinde yeniden oynatıldı. 6 test puanlandı; doğrulanmamış `2a7fecc4` yalnız karar raporu üretir. Komut: `node --import tsx tools/room-benchmark/experiments/run-integrated-filter-study.ts YENI-RUN-ID`. Aynı motor/config için güncel filtre ve yalnız rapor klasöründeki kopyada kapatılmış filtre karşılaştırılır. Eski deney adaptörü kullanılmaz; her koşu iki kez doğrulanır. Replay raporları artık motorun `evidence` tanı alanını (mesafe adayı ve giriş süreleri dahil) saklar; skor algoritması değişmedi.

Analiz: [Markdown](reports/integrated-filter-hospital-20261013/analysis.md), [HTML](reports/integrated-filter-hospital-20261013/analysis.html). Ayrıntılı koşular `reports/integrated-filter-hospital-20261013-<test-kısa-id>-current/` ve `-filter-off/` içindedir. 5 m / 2 nokta / 1,5 sn ayarında Servis yakalama 27/43 → 25/43; yanlış oda 41,5 → 80,75 sn oldu. Puanlı yoğun bakım testinde mesafe reddi oluşmadı, sonuç değişmedi. Reddedilen ölçümün eski odayı canlandırması ve aday expiry saatleri için iki karakterizasyon testi `experiments/integrated-filter-probes.test.ts` içindedir; bu davranışlar üretimde değiştirilmedi. Genel doğrulamada 97 testten 95'i geçti; iki motor rota regresyonu ve genel typecheck'in takıldığı mevcut rapor dosyası analizde açıklanır. Çalışma kapsamının typecheck'i: `node node_modules/typescript/bin/tsc -p tools/room-benchmark/experiments/tsconfig.integrated-study.json --noEmit`.

## Mesafe filtresi deneyi (13 Ekim 2026)

`experiments/distance-relocation.ts`, aktif motoru import eden çevrimdışı mesafe/yeniden konumlanma prototipidir. Üretim motoruna entegre değildir. Parametreler: D=3 m, ilk aday çevresinde R=1 m, N=3, T=1.500 ms, G=2.000 ms, W=6.000 ms. Aday B/C/D oda kanıtı olmaz; D yalnız filtre referansını değiştirir ve public `removeVehicle` ile eski motor kanıtını temizler. E yeni oda kanıtını başlatır. Mesafe reddi için kullanılan deney adaptörü ve sonuçların sınırları raporda açıklanır.

Yeni ve boş bir run ID ile çalıştırın:

```powershell
node --import tsx tools/room-benchmark/experiments/run-distance-study.ts --scope service --run-id YENI-SERVIS-ID
node --import tsx tools/room-benchmark/experiments/run-distance-study.ts --scope other --run-id YENI-DIGER-ID
node --import tsx --test tools/room-benchmark/experiments/distance-relocation.test.ts
```

Servis koşusu D=2/3/5 m, R=0,5/1,5 m, daha hızlı/yavaş aday onayı ve ön-kontrol profilini karşılaştırır; diğer haritalar off/D3/D5 kullanır. Senaryolar iki kez replay edilerek karar/metrik eşitliği doğrulanır. DB bağlantısı gerekmez. Aynı ham veri, truth ve harita üzerinde her koşunun yeni temel sonucu hesaplanır; motor/harita hash değişimi koşuyu geçersiz kılar. Parametreleri değiştirerek yeni deney yapılabilir; eski rapor klasörü üzerine yazılmaz.

Nihai analiz: [Markdown](reports/distance-relocation-analysis-20261013.md), [statik HTML](reports/distance-relocation-analysis-20261013.html). Ayrıntılar `reports/distance-relocation-servis-final-20261013/` ve `reports/distance-relocation-other-final-20261013/` içindedir. Rapor üreticisi `experiments/report-distance-study.cjs` bu sabit çalışmanın yorumlarını içerir; farklı sonuçlar için yorumlar yeniden incelenmelidir. Bu deneyde 3 m profilinde Servis yakalaması 27/43 → 22/43 oldu; global uygulama önerilmedi. Ham veriler ve üretilmiş raporlar klasörün `.gitignore` kurallarıyla korunur.

Bu araç ayrı bir Node sürecinde **mevcut** `RegionPositionEngine` sınıfını kullanır. Canlı controller, API, SSE, `trackingBuffer` ve veritabanı yazma kodu yüklenmez. `import` dışında veritabanına bağlanmaz. DB dışa aktarımı yalnızca `SELECT` kullanır; mümkünse sadece okuma yetkili `POSTGRES_USER` ile çalıştırın. DB geçmişi yalnız kayıtlı tag'ları içeriyor olabilir ve canlı motorun gördüğü her ham olayı kapsadığı varsayılmaz.

## Yeni test

13 Ekim Servis `test-f93aa2c0-e0fc-4130-b0c5-3d1207fd120a`: 13 oda ziyareti, açık tag `9C76E417B4CB5ECF`, kaynak UTC saatleri ve truth revizyon 1 eklendi. `ended_at:null` ve kayıtlı oturum `running`; truth değerlendirme sınırı son kapanmış oda çıkışı `07:14:54.157Z`, gerçek test bitişi değildir. Tagın ham geçmişi, kayıtlı motor kararı ve güncel tag kaydı bulunmadı. `availability.json` durumu `unscored-missing-raw`; raw/manifest oluşturulmadı ve %0 başarı sayılmadı. Kullanıcı panelde hareket gördüğünü doğruladı. Kayıtlı olmayan taglar panele/motora iletilebilir, ancak mevcut kalıcı kayıt akışı bunları arşivlemez. İnceleme: [Markdown](reports/servis-f93aa2c0-audit-20261013/analysis.md), [HTML](reports/servis-f93aa2c0-audit-20261013/analysis.html). Oturumdaki harita snapshotı `59c473fecb97678f`, güncel harita `7a7a74d7f8c40ac0`; tek fark mesafe sınırı 5 → 10 m. Geçmiş ham arşiv bulunursa SELECT import/replay yapılabilir; tagı sonradan kaydetmek kaybolan geçmişi geri getirmez.

12 Ekim akşamı Servis testleri: `test-5c71fd2a-af35-40d8-ba88-ade771f2c493` (Mustafa, `AD5D457F2924852A`, 17 ziyaret, 1.086 ham paket) ve `test-bd53fa7f-9d16-4f10-8471-6e1f50664d85` (cihaz, `EA0FC8F8CA447FF5`, 7 oda ziyareti + 9 açık koridor aralığı, 450 paket). Açık tag kodları ve UTC milisaniyeleri korundu; truth revizyon 1. Koridor etiketleri source/truth içinde saklandı ve oda ziyareti sayılmadı. Güncel `room-evidence-9` / Servis `aed0c3f67f66ef77` sabit replay raporları `reports/necmettin-servis-5c71fd2a-current-20261012/` ve `reports/necmettin-servis-bd53fa7f-current-20261012/` altında; ortak ziyaret/ham veri/karar/parametre analizi `reports/servis-late-two-20261012-analysis.md`. Canlı kayıtlı config sürümleri ayrıca gösterilir; farklı config'ler eşdeğer deney sayılmaz. Hız 4, giriş 1,5 sn / 3 ve yaklaşma 2 m deneyleri yalnız çevrimdışı kopyalarda yapıldı; canlı ayarlar değiştirilmedi.

12 Ekim Servis ek testleri: `test-ce530aaa-a117-4075-8191-7169508dec93` (Mustafa, `AD5D457F2924852A`, 531 paket) ve `test-ca88f73a-7a97-48ba-b6b5-de227bfb0124` (Tansiyon, `EC27D9C145F838EB`, 406 paket). Kullanıcı kodları açıkça verdi; bağımsız rotalar ayrı gruplarda, truth revizyon 1. Güncel Servis config'iyle replay edilmelidir. İlgili JSON/Markdown/HTML raporları `reports/necmettin-servis-ce530aaa-current-20261012/` ve `reports/necmettin-servis-ca88f73a-current-20261012/` içinde; ortak analiz `reports/servis-two-20261012-analysis.md`. Canlı testlerin ortasında config değişmiştir; ortak analiz bunu güncel ayarların sabit replay'inden ayrı gösterir.

12 Ekim Servis `servis2` testi: `test-4192b569-b345-4a41-a028-32b342ab4710`. Kullanıcının belirttiği `cihaz` adı DB'de `EA0FC8F8CA447FF5` koduyla eşleştirildi; 344 ham paket aktarıldı. Kaynağın `Z` saatleri UTC olarak korundu, saat kaydırılmadı; katı ve ±2 saniye sınır toleranslı sonuç üretildi. Replay komutu: `node --import tsx tools/room-benchmark/cli.ts replay test-4192b569-b345-4a41-a028-32b342ab4710 --config config/maps/necmettin-servis/regions.json`. İlk rapor ve parametre incelemesi `reports/necmettin-servis-servis2-4192b569-20261012/analysis.md` içinde. Servis ayarları yoğun bakım ayarlarından ayrıdır.

1. `datasets/<test-id>/truth.json` oluşturun. `test.from/to` ve `visits` açık UTC/ISO olmalı; yerel kayıt saatini `Europe/Istanbul` (+03:00) kabul edin. Oda aralıkları arasındaki zaman koridordur. `revision` ve `revisionReason` zorunludur.
2. `node --env-file=.env.local --import tsx tools/room-benchmark/cli.ts candidates <test-id>` ile 30 saniye ısınma ve 60 saniye gözlem dahil aday tag sayısını görün. Farklı pencere için `--warmup-ms`, `--observation-ms` kullanın.
3. Hangi tag'ın taşındığını saha kaydıyla doğrulayın. Aynı rota üzerinde birlikte taşınan tag'ları tek gruba koyun: `"groups":[{"id":"rota-1","tagCodes":["TAG-A","TAG-B"]}]`. Emin olmadıklarınızı gruba eklemeyin. Gruplandırılmayan tag puanlanmaz.
4. `node --env-file=.env.local --import tsx tools/room-benchmark/cli.ts import <test-id> --tags TAG-A,TAG-B` komutunu bir kez çalıştırın. Aday sayıları önce yazdırılır. Komut mevcut `raw.jsonl` üzerine yazmaz. Veriler tam çözünürlüklü JSONL ve SHA-256 manifestidir. `received_at` eksikse zamanlama `approximate` olur.
5. `node --import tsx tools/room-benchmark/cli.ts replay <test-id> --config config/maps/spor-koridor/regions.json` ile rapor üretin. `--tick-ms` (varsayılan 1000), `--sample-ms` (250), `--tolerance-ms` (2000), `--run-id` ayarlanabilir. Harita geçmiş snapshotı yoksa rapor açıkça “geçmiş veri + güncel harita” der.
6. `node --import tsx tools/room-benchmark/cli.ts compare reports/ESKI/report.json reports/YENI/report.json` ile aynı veri, truth, config ve zamanlama ayarlarındaki motorları kıyaslayın. `report` komutu JSON'dan Markdown özetini yeniden yazdırır.

Yoğun bakım gibi başka bir haritada test yaparken replay'e ilgili haritayı açıkça verin: `node --import tsx tools/room-benchmark/cli.ts replay <test-id> --config config/maps/necmettin-yogun-bakim/regions.json`. Varsayılan config spor koridorudur. `test-2a7fecc4-d625-4091-8b6c-a5a056302913` Necmettin Hastanesi Yoğun Bakım testidir; taşınan tek tag'ın kodu kullanıcı tarafından doğrulanmadığından resmî oda doğruluğu puanlanmaz. Karar izi ve veri/bölge incelemesi `reports/necmettin-yogun-bakim-2a7fecc4-analysis.md` dosyasındadır.

Dokuz başlangıç testinin truth dosyaları katalogdan üretildi. 2026-09-25 kullanıcı doğrulamasıyla ilk dört testte tek tag, 5–7. testlerde üç tag birlikte aynı rota grubu olarak kaydedildi; 8 ve 9. testin üçlü eşleşmesi önceki kullanıcı kaydına dayanır. Dokuz truth dosyası da revizyon 2'dir. Gerçek konum veya tag düzeltmesinde `raw.jsonl` dosyasını değiştirmeyin; `truth.json` revizyonunu artırıp düzeltme nedenini yazın. Raporlar truth SHA ve revizyonunu kaydeder.

Replay sırası `received_at`, eşitlikte DB `id`; ölçüm kanıt zamanı `created_at` olarak kalır. Eksik `received_at` için teslim yaklaşık olarak `created_at` sayılır. İlk tick ısınma başlangıcından bir yayın aralığı sonradır; aynı milisaniyede tick önce işlenir. Test sonrası gözlemde paket ve tick çalışır ancak doğruluk yalnız test aralığında puanlanır. Rapor giriş/çıkış gecikmesi, kaçırılan ziyaret, katı ve sınır toleranslı doğruluk, kararlar, reason code'lar, ham boşluklar ve reddedilen ölçümleri içerir. Sınır toleransı yalnız kapı geçişlerinin çevresindeki örnekleri dışlar.

Her yeni JSON/Markdown/HTML raporu, gerçek oda ziyareti sırasında ham koordinatların beklenen odada, başka odada, koridorda veya harita dışında sayısını da içerir. Raporun sonundaki hatırlatma, motor ayarı değişikliklerini yorumlarken konum üretimi, harita hizası ve DB kayıt kapsamındaki olası sorunları ayrı değerlendirmeyi söyler. Bu sayım `created_at` ölçüm zamanını ve replay için yüklenen haritayı kullanır; tek başına hata kaynağını kanıtlamaz. Eski raporlar değişmez; yeni alanı görmek için aynı veri kümesini yeniden replay edin.

Test: `node --import tsx --test tools/room-benchmark/benchmark.test.ts`. Proje typecheck: `npm run typecheck`.

9 Ekim hastane testi `test-f6d295ed-38a9-4e8f-a8d2-f5f6ba4b1d06`: kullanıcı taşınan tag adını `hasan` olarak doğruladı; DB adı `06F0623201E95CE8` koduyla eşleştirildi, truth revizyon 2. Yoğun bakım config'iyle replay edilmelidir. 456 ham paket aktarılmıştır. Sonuç ve parametre incelemesi `reports/necmettin-yogun-bakim-f6d295ed-20261009/analysis.md`, standart JSON/Markdown/HTML raporları aynı klasördedir. Bu doğrulama 8 Ekim testinin belirsiz eşleşmesini değiştirmez.

Tag eşleşmesi belirsizse `node --import tsx tools/room-benchmark/auditTagEvidence.ts` komutu her adayın gerçek oda aralıklarındaki ham nokta kanıtını ve eşzamanlı tag'lar arası uzaklığı çıkarır. Bu çıktı fiziksel taşıma doğrulaması yerine geçmez; resmi puanlama `truth.json` içindeki doğrulanmış `groups` üzerinden yapılır. Gruplar boşsa replay karar izini üretir ve raporda açıkça `puanlanmadı` yazar.

Anonim örnek veri kümesi `datasets/test-00000000-0000-0000-0000-000000000001/` altındadır; `node --import tsx tools/room-benchmark/create-fixture.ts` ile yeniden üretilebilir. Bu veri gerçek saha performansını temsil etmez.
