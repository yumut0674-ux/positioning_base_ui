# Çevrimdışı oda benchmarkı

Bu araç ayrı bir Node sürecinde **mevcut** `RegionPositionEngine` sınıfını kullanır. Canlı controller, API, SSE, `trackingBuffer` ve veritabanı yazma kodu yüklenmez. `import` dışında veritabanına bağlanmaz. DB dışa aktarımı yalnızca `SELECT` kullanır; mümkünse sadece okuma yetkili `POSTGRES_USER` ile çalıştırın. DB geçmişi yalnız kayıtlı tag'ları içeriyor olabilir ve canlı motorun gördüğü her ham olayı kapsadığı varsayılmaz.

## Yeni test

1. `datasets/<test-id>/truth.json` oluşturun. `test.from/to` ve `visits` açık UTC/ISO olmalı; yerel kayıt saatini `Europe/Istanbul` (+03:00) kabul edin. Oda aralıkları arasındaki zaman koridordur. `revision` ve `revisionReason` zorunludur.
2. `node --env-file=.env.local --import tsx tools/room-benchmark/cli.ts candidates <test-id>` ile 30 saniye ısınma ve 60 saniye gözlem dahil aday tag sayısını görün. Farklı pencere için `--warmup-ms`, `--observation-ms` kullanın.
3. Hangi tag'ın taşındığını saha kaydıyla doğrulayın. Aynı rota üzerinde birlikte taşınan tag'ları tek gruba koyun: `"groups":[{"id":"rota-1","tagCodes":["TAG-A","TAG-B"]}]`. Emin olmadıklarınızı gruba eklemeyin. Gruplandırılmayan tag puanlanmaz.
4. `node --env-file=.env.local --import tsx tools/room-benchmark/cli.ts import <test-id> --tags TAG-A,TAG-B` komutunu bir kez çalıştırın. Aday sayıları önce yazdırılır. Komut mevcut `raw.jsonl` üzerine yazmaz. Veriler tam çözünürlüklü JSONL ve SHA-256 manifestidir. `received_at` eksikse zamanlama `approximate` olur.
5. `node --import tsx tools/room-benchmark/cli.ts replay <test-id> --config config/maps/spor-koridor/regions.json` ile rapor üretin. `--tick-ms` (varsayılan 1000), `--sample-ms` (250), `--tolerance-ms` (2000), `--run-id` ayarlanabilir. Harita geçmiş snapshotı yoksa rapor açıkça “geçmiş veri + güncel harita” der.
6. `node --import tsx tools/room-benchmark/cli.ts compare reports/ESKI/report.json reports/YENI/report.json` ile aynı veri, truth, config ve zamanlama ayarlarındaki motorları kıyaslayın. `report` komutu JSON'dan Markdown özetini yeniden yazdırır.

Dokuz başlangıç testinin truth dosyaları katalogdan üretildi. 2026-09-25 kullanıcı doğrulamasıyla ilk dört testte tek tag, 5–7. testlerde üç tag birlikte aynı rota grubu olarak kaydedildi; 8 ve 9. testin üçlü eşleşmesi önceki kullanıcı kaydına dayanır. Dokuz truth dosyası da revizyon 2'dir. Gerçek konum veya tag düzeltmesinde `raw.jsonl` dosyasını değiştirmeyin; `truth.json` revizyonunu artırıp düzeltme nedenini yazın. Raporlar truth SHA ve revizyonunu kaydeder.

Replay sırası `received_at`, eşitlikte DB `id`; ölçüm kanıt zamanı `created_at` olarak kalır. Eksik `received_at` için teslim yaklaşık olarak `created_at` sayılır. İlk tick ısınma başlangıcından bir yayın aralığı sonradır; aynı milisaniyede tick önce işlenir. Test sonrası gözlemde paket ve tick çalışır ancak doğruluk yalnız test aralığında puanlanır. Rapor giriş/çıkış gecikmesi, kaçırılan ziyaret, katı ve sınır toleranslı doğruluk, kararlar, reason code'lar, ham boşluklar ve reddedilen ölçümleri içerir. Sınır toleransı yalnız kapı geçişlerinin çevresindeki örnekleri dışlar.

Test: `node --import tsx --test tools/room-benchmark/benchmark.test.ts`. Proje typecheck: `npm run typecheck`.

Tag eşleşmesi belirsizse `node --import tsx tools/room-benchmark/auditTagEvidence.ts` komutu her adayın gerçek oda aralıklarındaki ham nokta kanıtını ve eşzamanlı tag'lar arası uzaklığı çıkarır. Bu çıktı fiziksel taşıma doğrulaması yerine geçmez; resmi puanlama `truth.json` içindeki doğrulanmış `groups` üzerinden yapılır. Gruplar boşsa replay karar izini üretir ve raporda açıkça `puanlanmadı` yazar.

Anonim örnek veri kümesi `datasets/test-00000000-0000-0000-0000-000000000001/` altındadır; `node --import tsx tools/room-benchmark/create-fixture.ts` ile yeniden üretilebilir. Bu veri gerçek saha performansını temsil etmez.
