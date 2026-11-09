# Terminalden yerel benchmark veri arşivi

Proje kökünde çalıştırın:

```powershell
npm.cmd run export:data
```

1. Başlangıç tarihi ve saati girin: `2026-10-13 09:00` veya `13.10.2026 09:00`.
2. Bitiş tarihi ve saati girin; `şimdi` de kabul edilir.
3. Listelenen tagı numarasıyla veya koduyla seçin. `1,3` çoklu seçim,
   `tümü` bütün taglar demektir.
4. Gösterilen `.data/exports/<arşiv-id>/` klasörünü açın.

Saat dilimi belirtilmemiş tarihler Türkiye saati (`Europe/Istanbul`, `+03:00`)
olarak yorumlanır. ISO-8601 `Z` / `+03:00`, saniye ve milisaniye desteklenir.
Başlangıç dahil, bitiş hariçtir: `[from,to)`.

Tag listesi seçilen aralıkta konum, motor kararı veya alan olayı bulunan
taglardan oluşur. Tagın güncel listede bulunması gerekmez; silinmiş tagların
geçmişi de alınabilir. Motor kaydı olup ham kaydı olmayan taglar da görünür,
ancak ham replay yapılamayacağı raporlanır.

## Gereksinimler

- Projenin Node.js sürümü (`>=22.13.0`) ve kurulu bağımlılıkları.
- Çalışan PostgreSQL. Web uygulamasının ve arayüzün açık olması gerekmez.
- Mevcut `.env.local` dosyasındaki `POSTGRES_*` ayarları veya önceden
  tanımlanmış ortam değişkenleri.

Komut `.env.local` varsa yükler; yoksa uygulamanın PostgreSQL varsayılanlarını
kullanır. Parola çıktılara yazılmaz. Terminal işlemi web admin oturumunu
kullanmaz; mümkünse salt okunur DB kullanıcısı ile çalıştırın.

## Otomatik kullanım

```powershell
npm.cmd run export:data -- --from "2026-10-13 09:00" --to "2026-10-13 10:00" --list
npm.cmd run export:data -- --from "2026-10-13 09:00" --to "2026-10-13 10:00" --tags "TAG1,TAG2"
npm.cmd run export:data -- --from "2026-10-13 09:00" --to şimdi --tags "TAG1" --warmup-seconds 0 --observation-seconds 0
npm.cmd run export:data -- --help
```

| Seçenek | Varsayılan | Anlam |
|---|---:|---|
| `--warmup-seconds` | 30 | Isınma için aralıktan önceki kayıtlar; 0–3600 |
| `--observation-seconds` | 60 | Son gözlem için aralıktan sonraki kayıtlar; 0–3600 |
| `--batch-size` | 1000 | Cursor başına kayıt; 1–10000 |
| `--timeout-seconds` | 60 | Dışa aktarım sorgusu zaman aşımı; 1–600 |
| `--no-csv` | kapalı | Yalnız JSONL üret |
| `--list` | kapalı | Tagları listele ve çık |

Liste sayıları yalnız seçilen aralığı gösterir. Dosyalarda ön/son pencere de
bulunabilir; dosya başına `windows` alanı seçilen aralık / önce / sonra
sayılarını ayırır. Tam seçilen aralığı almak için iki pencereyi de `0` yapın.

## Dosyalar

Her çalıştırma benzersiz klasör üretir; önceki arşivin üzerine yazmaz.

| Dosya | İçerik / zaman filtresi |
|---|---|
| `raw.jsonl` | Bütün kayıtlı konum ölçümleri; `created_at` |
| `decisions.jsonl` | Bütün kayıtlı motor kararları, tam `payload`, neden/kanıt/state alanları; `published_at` |
| `area-events.jsonl` | Alan giriş/çıkış olayları, tam `payload`; `decided_at` |
| `decision-seeds.jsonl` | Ön pencerenin öncesindeki son karar, tag başına |
| `area-event-seeds.jsonl` | Ön pencerenin öncesindeki son olay, tag/harita/alan başına |
| `area-state-current.jsonl` | DB snapshot anındaki güncel alan durumları; geçmiş durum değildir |
| `tags-current.jsonl` | Seçilen tagların güncel tanımları; geçmiş isim/atama garantisi vermez |
| `room-tests.jsonl` | Taglarla ilişkili, aralıkla örtüşen saha testleri; plan/config ve olaylar |
| `room-test-actions.jsonl` | Bu testlerin kayıtlı aksiyonları |
| `*.csv` | Aynı kayıtların Excel kopyası; UTF-8 BOM, `;` ayracı |
| `config-current/config/maps/...` | İlgili haritaların mevcut disk config'leri |
| `source-fingerprints.json` | Mevcut motor kaynaklarının SHA-256 özetleri |
| `manifest.json` | Tarihler, DB snapshot, sayılar/özetler, şema, sürümler ve eksik veri notları |

JSONL asıl benchmark verisidir: bir satır bir tam DB kaydıdır; JSONB payload
nesneleri ve yeni sütunlar korunur. BIGINT/NUMERIC metin olarak saklanır,
sayı hassasiyeti kaybolmaz. DB zamanları UTC ve mikro saniye hassasiyetinde
saklanır; mevcut benchmark sanal saati milisaniye kullanır. Eksik eski PDOP
ve teslim zamanı uydurulmaz.

CSV'de nesneler tek hücrede JSON metnidir. Formül gibi başlayan metinler ve
uzun sayısal kodlar Excel için metne çevrilir; JSONL değerleri değişmez.
Excel gerekirse **Veri → Metin/CSV'den**, UTF-8 ve noktalı virgül ile açılır.
Eski şemada bulunmayan isteğe bağlı tablonun dosyası üretilmez; bu durum
manifest'te belirtilir. Şema değişikliği veya migration çalıştırılmaz.

## Git, tutarlılık ve kesintiler

`.data/` kök `.gitignore` tarafından dışlanır. Bütün arşiv ve kısmi dosyalar
push/pull dışında kalır. Başka bilgisayara almak için klasörü ayrıca kopyalayın.

```powershell
git check-ignore .data/exports/ORNEK-ARSIV/raw.jsonl
```

DB okumaları tek bağlantıda REPEATABLE READ READ ONLY snapshot'ı kullanır.
Cursor sınırlı parçalar alır; örnekleme veya sabit toplam kayıt limiti
uygulanmaz. Snapshot sonrasında kalıcı yazılan kayıtlar sonraki aktarımı gerektirir.

Dosyalar önce `.partial-<id>` altında yazılır. DB işlemi, config kopyaları ve
manifest tamamlandıktan sonra klasör nihai adına taşınır. Ctrl+C, disk veya
bağlantı hatasında kalan klasör `incomplete.json` ile işaretlenir; tamamlanmış
arşiv sayılmaz. Yeni komutla tekrar üretin. Otomatik silme uygulanmaz.

## Benchmark'a DB olmadan aktarma

Mevcut benchmarkın bağımsız `truth.json` dosyası ve doğrulanmış tag eşleşmesi
hazırsa arşivden içe aktarabilirsiniz:

```powershell
node --import tsx tools/room-benchmark/cli.ts import test-GERCEK-UUID --tags TAG1 --archive ".data/exports/ARSIV-ID"
node --import tsx tools/room-benchmark/cli.ts replay test-GERCEK-UUID --config ".data/exports/ARSIV-ID/config-current/config/maps/necmettin-servis/regions.json" --run-id YENI-RUN-ID
```

Yer tutucuları gerçek değerlerle değiştirin. Import DB'ye bağlanmaz; ham
dosyanın SHA-256, boyut ve satır sayısını doğrular. Arşiv testin 30 sn öncesi /
60 sn sonrasını kapsamalıdır; gerekirse import'ta `--warmup-ms` ve
`--observation-ms` ayarlanabilir. Mevcut datasetler üzerine yazılmaz.

Gerçek motor çıktıları `decisions.jsonl` içinde, tam nesne `record.payload`
altındadır. Replay yeniden hesaplanan çıktıdır. Motor/config sürümleri
manifest'te bulunur. Config-current dışa aktarım anındaki disk kopyasıdır;
geçmişte çalışan motorun ayarları olduğu varsayılmaz. Test payload'larında
tarihsel plan/config varsa ayrıca incelenebilir. Eski motoru yeniden
üretmek için ilgili kaynak versiyonu da gerekir.

## Arşivin sınırları

Henüz kalıcı yazılmamış bellek/disk kuyruğu, kayıt öncesi PDOP filtresinin
attığı paketler, hiç kaydedilmemiş tag geçmişi ve DB'nin tekilleştirdiği
tekrarlanan sentetik merkez yayınları arşivde bulunmaz. Araç bunları
yeniden üretmez. Motor kararından gerçek rota çıkartılmaz; doğruluk
puanlamak için bağımsız, doğrulanmış saha truth'u gerekir.

## Doğrulama

```powershell
npm.cmd run test:data-export
npm.cmd run typecheck:data-export
```

Testler tarih/tag doğrulamasını, kayıt sınırlarını, bağlam pencerelerini,
tam payload ve dosya bütünlüğünü, eksik şemaları, kısmi arşivleri,
cursor/timeout/iptali ve çevrimdışı benchmark içe aktarımını doğrular.
Protokol testleri yalnız loopback üzerinde geçici sunucu açar; gerçek DB'ye yazmaz.
