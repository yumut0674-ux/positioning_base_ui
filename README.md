# GEKON IPS Control

GEKON IPS Control, UWB tag konumlarını canlı izlemek, tag/anchor kayıtlarını
yönetmek, oda/bölge çıkarımı yapmak ve konum geçmişini REST/MCP üzerinden
okutmak için geliştirilmiş bir Vinext/Next tabanlı operasyon uygulamasıdır.

Bu doküman operasyon ekibinin yerel kurulum, PostgreSQL hazırlığı, ingest
payload sözleşmesi, port yönetimi, region engine kullanımı, yedekleme, servis
başlatma ve hata giderme adımlarını tek yerden takip edebilmesi için yazıldı.

Terminalden tarih/saat aralığı ve tag seçerek bütün kayıtlı konum/motor
verilerini Git dışındaki `.data/exports` klasörüne almak için
`npm run export:data` çalıştırın. [Yerel benchmark veri arşivi rehberi](tools/data-export/README.md)
JSONL/CSV dosyalarını ve veritabanına yeniden bağlanmadan benchmark'a aktarmayı açıklar.

## İçindekiler

- [Sistem özeti](#sistem-özeti)
- [Hızlı başlangıç](#hızlı-başlangıç)
- [Ortam değişkenleri](#ortam-değişkenleri)
- [PostgreSQL kurulumu ve şema](#postgresql-kurulumu-ve-şema)
- [Servisler ve portlar](#servisler-ve-portlar)
- [Tracking ingest sözleşmesi](#tracking-ingest-sözleşmesi)
- [Region Position Engine](#region-position-engine)
- [REST API özeti](#rest-api-özeti)
- [MCP ve rota geçmişi asistanı](#mcp-ve-rota-geçmişi-asistanı)
- [Domain üzerinden geçici paylaşım](#domain-üzerinden-geçici-paylaşım)
- [Yedekleme ve geri dönüş](#yedekleme-ve-geri-dönüş)
- [Servis başlatma örnekleri](#servis-başlatma-örnekleri)
- [Test ve doğrulama](#test-ve-doğrulama)
- [Hata giderme](#hata-giderme)
- [Operasyon notları](#operasyon-notları)

## Sistem özeti

Uygulama ana akışta şu bileşenlerden oluşur:

```text
UWB kaynakları / simülatör
  -> POST /api/tracking/ingest
  -> memory trackingBuffer
  -> raw SSE: /api/tracking/ingest veya /api/tracking/stream
  -> PostgreSQL: tag_location_history

Region engine açıkken:
raw position event
  -> RegionPositionEngine
  -> loopback processed SSE: REGION_POSITION_PORT /api/tracking/stream
  -> same-origin proxy: /api/tracking/processed

Operasyon UI
  -> /api/tags, /api/anchors, /api/maps/{mapId}/regions, /api/location/*
  -> PostgreSQL ve config/maps/{mapId}/regions.json

Opsiyonel asistan:
History chat UI
  -> POST /api/assistant
  -> cookie-bound session namespace + deterministic safety policy
  -> local FastAPI chatbot service
  -> stdio MCP server
  -> /api/location/*
```

Temel özellikler:

- Canlı tag konumu ingest ve SSE yayını.
- Kayıtlı tag'ler için PostgreSQL konum geçmişi.
- Tag ve anchor yönetimi.
- Anchor sağlık logları.
- Region editor ve oda tespit modu.
- Raw konumu bozmadan processed region-center akışı.
- Konum geçmişi için REST ve salt-okunur MCP tool'ları.
- Opsiyonel Gemini destekli yerel rota geçmişi asistanı.
- Sentetik veriyle AI güvenlik regresyon paketi (`tests/ai-evaluation`).

## Hızlı başlangıç

Gereksinimler:

- Node.js `>=22.13.0`
- npm
- PostgreSQL sunucusu
- Opsiyonel asistan için Python sanal ortamı ve `mcp/requirements-agent.txt`

Yerel geliştirme:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Varsayılan UI ve raw ingest adresi:

```text
http://127.0.0.1:3000
```

İlk canlı veri testi:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:3000/api/tracking/ingest" `
  -ContentType "application/json" `
  -Body '{"type":"position","tag_id":"TAG-001","x":8.8,"y":7.8,"pdop":1.83,"zone_id":"zone-a","zone_name":"Bölge A","timestamp":"2026-07-26T12:00:00+03:00"}'
```

Beklenen cevap: gövdesiz `204 No Content`.

PDOP değeri kaynak haritanın üst sınırından büyükse paket işlenmeden atılır
ve yine `204` döner. Varsayılan sınır 20, Yoğun Bakım haritasında 70'tir.
Kabul edilen paket canlı SSE'ye yayınlanır; PostgreSQL geçmişine yazılması
için tag'i UI üzerinden veya `POST /api/tags` ile kaydedin.

## Ortam değişkenleri

`.env.local` gerçek çalışma ortamı için kullanılır ve git'e eklenmemelidir.
`.env.example` güvenli varsayılanları gösterir.

| Değişken | Varsayılan | Açıklama |
|---|---:|---|
| `PORT` | `3000` | Vinext/Next uygulama portu. |
| `RAW_POSITION_PORT` | `PORT` veya `3000` | Raw ingest ve raw SSE portu. `PORT` değişirse bunu da aynı değere çekin. |
| `REGION_POSITION_HOST` | `127.0.0.1` | Processed SSE listener bind adresi. Bilinçli bir gerekçe yoksa değiştirmeyin. |
| `REGION_POSITION_PORT` | `3001` | Processed SSE listener portu. `RAW_POSITION_PORT` ile aynı olamaz. |
| `REGION_BROADCAST_INTERVAL_MS` | `1000` | Region içinde kalan araçlar için inferred publish aralığı. 100 ile 60000 ms arasında olmalı. |
| `REGION_POSITION_ALLOWED_ORIGIN` | `http://127.0.0.1:3000` | Loopback processed SSE CORS origin'i; tarayıcı normalde same-origin proxy kullanır. |
| `POSTGRES_HOST` | `127.0.0.1` | PostgreSQL host. Demo paylaşımında loopback kalmalı. |
| `POSTGRES_PORT` | `5432` | PostgreSQL port. |
| `POSTGRES_DB` | `uwb_db` | Uygulama veritabanı. |
| `POSTGRES_USER` | `uwb_user` | Uygulama kullanıcısı. |
| `POSTGRES_PASSWORD` | `CHANGE_ME` | Yalnızca yerel `.env.local` içinde gerçek parola ile değiştirilecek placeholder. |
| `CHATBOT_SERVICE_URL` | boş | Opsiyonel `/api/assistant` proxy hedefi; etkinse `http://127.0.0.1:8000` kullanın. |
| `UWB_LOCATION_API_BASE_URL` | `http://127.0.0.1:3000` | MCP ve asistanın okuyacağı uygulama REST API kökü. |
| `UWB_LOCATION_API_TOKEN` | boş | Opsiyonel Bearer token. API tarafında doğrulama eklenirse kullanılır. |
| `UWB_LOCATION_API_TIMEOUT_MS` | `5000` | MCP HTTP timeout değeri. 100 ile 60000 ms arasında olmalı. |
| `UWB_LIVE_THRESHOLD_SECONDS` | `30` | Güncel konumun `live` sayılacağı üst sınır. |
| `UWB_OFFLINE_THRESHOLD_SECONDS` | `300` | Bu değerin üstü `offline` kabul edilir. |
| `UWB_HISTORY_MAX_DAYS` | `7` | History sorgularında izin verilen maksimum tarih aralığı. Üst sınır 31 gündür. |
| `UWB_HISTORY_MAX_POINTS` | `2000` | `route_points` cevabında döndürülecek maksimum nokta. |
| `UWB_HISTORY_PROCESSING_MAX_POINTS` | `100000` | `zone_timeline` üretirken işlenecek ham kayıt güvenlik sınırı. |
| `GEMINI_API_KEY` veya `GOOGLE_API_KEY` | boş | Opsiyonel Gemini asistanı için provider anahtarı. |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Opsiyonel asistan modeli. |
| `UWB_NODE_COMMAND` | `node` | Python asistanı Node'u PATH'te bulamazsa tam `node.exe` yolu. |
| `TRACKING_INGEST_URL` | `http://localhost:3000/api/tracking/ingest` | Simülatör hedef endpoint'i. |
| `SIMULATOR_MIN_INTERVAL_MS` | `1000` | Simülatör minimum gönderim aralığı. |
| `SIMULATOR_MAX_INTERVAL_MS` | `1000` | Simülatör maksimum gönderim aralığı. |

Örnek `.env.local`:

```dotenv
PORT=3000
RAW_POSITION_PORT=3000
REGION_POSITION_HOST=127.0.0.1
REGION_POSITION_PORT=3001
REGION_BROADCAST_INTERVAL_MS=1000
REGION_POSITION_ALLOWED_ORIGIN=http://127.0.0.1:3000

POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=uwb_db
POSTGRES_USER=uwb_user
POSTGRES_PASSWORD=CHANGE_ME

CHATBOT_SERVICE_URL=
UWB_LOCATION_API_BASE_URL=http://127.0.0.1:3000
```

## PostgreSQL kurulumu ve şema

Uygulama PostgreSQL'e `src/server/postgresClient.ts` içindeki hafif TCP istemci
ile bağlanır. Desteklenen auth tipleri cleartext, MD5 ve SCRAM-SHA-256'dır.
İstemci şu anda TLS açmaz; prod ortamda uygulama ile PostgreSQL'i aynı güvenli
özel ağda çalıştırın veya TLS desteği eklenmeden genel ağ üzerinden bağlamayın.

Yerel veritabanı ve kullanıcı hazırlığı:

```powershell
psql -U postgres
```

```sql
CREATE USER uwb_user WITH PASSWORD 'uwb_local_123456';
CREATE DATABASE uwb_db OWNER uwb_user;
GRANT ALL PRIVILEGES ON DATABASE uwb_db TO uwb_user;
```

Uygulamanın kullandığı ana tablolar:

| Tablo | Kaynak | Amaç |
|---|---|---|
| `tags` | `app/api/tags/route.ts` | Tag registry. Ingest persistence için tag burada kayıtlı olmalı. |
| `tag_location_history` | `src/server/trackingBuffer.ts` | Kayıtlı tag konum geçmişi. |
| `anchors` | `app/api/anchors/route.ts` | Anchor tanımları ve harita koordinatları. |
| `anchor_health_logs` | `app/api/anchors/*` | Anchor durum geçmişi. |
| `support_messages` | `app/api/support/route.ts` | UI destek/öneri/bug mesajları. |
| `tracked_entities` | `drizzle/0001_tracked_entities_and_tag_assignments.sql` | Ürün/varlık modeli. Manuel migration ile gelir. |
| `tag_assignments` | `drizzle/0001_tracked_entities_and_tag_assignments.sql` | Varlık ve tag atama geçmişi. Manuel migration ile gelir. |

`tags`, `anchors`, `anchor_health_logs`, `support_messages` ve
`tag_location_history` tabloları ilgili endpoint ilk çalıştığında
`CREATE TABLE IF NOT EXISTS` ile oluşturulur. Buna rağmen operasyon ortamında
ilk açılıştan önce bağlantıyı test etmek ve şemayı kontrollü oluşturmak daha
sağlıklıdır.

Entity/tag assignment ve çok katlı tracking migration'ları otomatik uygulanmaz. Önce yedek alın,
bakım penceresini doğrulayın, sonra manuel çalıştırın:

```powershell
$env:PGPASSWORD="uwb_local_123456"
psql -h 127.0.0.1 -p 5432 -U uwb_user -d uwb_db -f drizzle\0001_tracked_entities_and_tag_assignments.sql
psql -h 127.0.0.1 -p 5432 -U uwb_user -d uwb_db -f drizzle\0002_tag_location_history.sql
psql -h 127.0.0.1 -p 5432 -U uwb_user -d uwb_db -f drizzle\0003_room_decisions.sql
psql -h 127.0.0.1 -p 5432 -U uwb_user -d uwb_db -f drizzle\0004_multifloor_tracking.sql
```

Migration sonrası hızlı kontrol:

```powershell
psql -h 127.0.0.1 -p 5432 -U uwb_user -d uwb_db -c "SELECT COUNT(*) AS tags FROM tags;"
psql -h 127.0.0.1 -p 5432 -U uwb_user -d uwb_db -c "SELECT COUNT(*) AS entities FROM tracked_entities;"
psql -h 127.0.0.1 -p 5432 -U uwb_user -d uwb_db -c "SELECT COUNT(*) AS assignments FROM tag_assignments;"
```

Not: `db/schema.ts` ve `drizzle.config.ts` bu projede ana PostgreSQL şema
kaynağı değildir. Drizzle config eski D1/SQLite kurulum mirasından kalmıştır;
aktif PostgreSQL sorguları `app/api/*` ve `src/server/location/*Repository.ts`
dosyalarındadır.

`0004_multifloor_tracking.sql` idempotent ve expand-only'dir: konum geçmişine
`zone_id`, `zone_name`, `map_id`; room decision kayıtlarına `zone_id`, `map_id`;
anchor kayıtlarına `map_id` nullable sütunlarını ve sorgu indekslerini ekler.
Eski kayıtlar kanıt olmadan bir kata bağlanmaz. Backfill gerekiyorsa önce yalnız
`SELECT tag_code, created_at, zone_id, map_id ... WHERE map_id IS NULL` ile dry-run
raporu alın; doğrulanmış zaman/zone aralıkları olmadan `UPDATE` çalıştırmayın.

## Servisler ve portlar

| Port | Servis | Varsayılan erişim | Not |
|---:|---|---|---|
| `3000` | Vinext/Next uygulama, REST API, raw ingest, raw SSE | `http://127.0.0.1:3000` | `PORT` ve `RAW_POSITION_PORT` aynı tutulmalı. |
| `3001` | Processed region SSE | yalnızca `127.0.0.1` | Tarayıcı `/api/tracking/processed` proxy yolunu kullanır. |
| `5432` | PostgreSQL | yalnızca `127.0.0.1` | Genel internete açmayın. |
| `8000` | Opsiyonel FastAPI chatbot service | `http://127.0.0.1:8000` | Sadece local loopback önerilir. |

Firewall önerisi:

- UWB kaynakları yalnızca `3000/api/tracking/ingest` yoluna erişebilmelidir.
- Tarayıcı kullanıcıları `3000` portuna erişmelidir.
- `3001` dışarı açılmamalıdır; ana uygulama bu akışı server-side proxy eder.
- `5432` ve `8000` genel ağa açılmamalıdır.

## Tracking ingest sözleşmesi

Endpoint:

```http
POST /api/tracking/ingest
Content-Type: application/json
```

Her istekte tek bir konum kaydı gönderilir:

```json
{
  "type": "position",
  "tag_id": "AAAABBBBCCCCDDDD",
  "x": 12.48,
  "y": 7.32,
  "zone_id": "zone-a",
  "zone_name": "Bölge A",
  "timestamp": "2026-10-15T14:30:15.123+03:00",
  "motion_label": "moving"
}
```

Kurallar:

- `Content-Type` `application/json` olmalıdır.
- JSON gövdesi tek nesne olmalıdır.
- Tanımlanmamış ek alan kabul edilmez. Mevcut `quality` alanı isteğe bağlı olarak 0–1 aralığında desteklenir; PDOP ile ayrı değerlerdir.
- Yeni producer sözleşmesinde `zone_id` ve `zone_name` key'leri de gönderilir. Expand/migrate rollout aşamasında eski producer payload'ları bu iki alan yokmuş gibi `null` kabul edilir; producer geçişi ve metrik izlemesi tamamlanınca strict enforcement açılabilir.
- `type` yalnızca `"position"` olabilir.
- `tag_id` boş olmayan string olmalı, en fazla 100 karakter olmalıdır.
- `tag_id` trim edilir ve uppercase normalize edilir.
- `x` ve `y` sonlu number olmalıdır; metre cinsinden ortak UWB harita koordinatlarıdır, enlem/boylam değildir. Alıcı koordinatları değiştirmeden taşır.
- `motion_label` yalnızca `"moving"`, `"stationary"` veya `"unknown"` olabilir. Eski göndericiler alanı göndermediğinde `"unknown"` kabul edilir. Etiket canlı konum verisinde `motionLabel` metadata alanı olarak taşınır; motorun hız, mesafe, oda/bölge kararları veya kaynak sağlık/geçerlilik kontrollerinde kullanılmaz.
- `pdop` sonlu number veya `null` olmalıdır. Eski göndericilerde alan eksikse `null` kabul edilir; hiçbir aşamada `0` değerine dönüştürülmez.
- Paket önce `zone_id` ile haritaya çözülür. Haritanın PDOP filtresi açıksa üst sınırdan büyük paketler SSE, oda/bölge motoru ve geçmiş kuyruğundan önce tamamen elenir. Sınıra eşit değerler ve `null`, mevcut diğer filtrelere devam eder. Elenen paket tag'ın son kabul edilmiş konumunu, PDOP değerini veya son veri zamanını güncellemez.
- PDOP filtresi harita bazında açılıp kapatılır ve üst sınırı değiştirilir. Varsayılan `enabled:true, maximumPdop:20`; `necmettin-yogun-bakim` için başlangıç sınırı 70'tir. Haritası bilinmeyen/null zone için varsayılan 20 filtresi uygulanır.
- Kabul edilen konum ve PDOP, aynı string `tag_id` üzerinden birlikte güncellenir; canlı ham/işlenmiş akışlarda ve geçmişte `pdop` olarak taşınır.
- `zone_id` string veya `null`, en fazla 100 karakterdir; `zone_name` string veya `null`, en fazla 160 karakterdir. String değerler trim edilir ve boş string `null` olur.
- `zone_id`, `config/maps/catalog.json` içindeki aktif/seçilebilir map'in `trackingZoneIds` listesi üzerinden `mapId` değerine çözülür. `zone_name` eşleme için kullanılmaz; yalnız kaynak snapshot açıklamasıdır.
- Null veya bilinmeyen zone yapısal olarak geçerliyse kabul edilir, `mapId:null` olur, listede “Kat belirlenemedi” görünür ve hiçbir haritada çizilmez.
- `timestamp` timezone içeren ISO-8601 olmalıdır. Örnek: `Z` veya `+03:00`.

Katalog eşlemesi map başına birden fazla kaynak zone kabul eder; aynı zone iki
etkin map'te tanımlanamaz:

```json
{
  "id": "kat1-ortopedi",
  "liveTrackingEnabled": true,
  "trackingZoneIds": ["zone-b", "uwb-floor-2"],
  "regionsConfigPath": "kat1-ortopedi/regions.json"
}
```

`liveTrackingMapId` yalnız eski istemciler için geçici compatibility alanıdır;
canlılık kararı her katalog girdisinin kendi `liveTrackingEnabled` değerinden
verilir.

Başarılı cevap: gövdesiz `204 No Content`. PDOP nedeniyle elenen geçerli
paketler de `204` ile sonlandırılır. Konum istekleri Authorization veya API
anahtarı gerektirmez. Göndericinin varsayılan zaman aşımı 2 saniyedir ve
başarısız HTTP gönderimleri otomatik tekrar denenmez.

PDOP filtresini geçen paketler canlı SSE'ye yayınlanır. Tag registry içinde
bulunanlar PostgreSQL'e yazılmak üzere kuyruğa alınır; kayıtlı olmayanlar
geçmişe yazılmaz. Yapısal olarak geçersiz payload `400` döndürür.

### Harita PDOP filtresini yönetme

Haritayı seçin, **Oda/Bölge Paneli → Harita filtreleri → Harita PDOP filtresi** alanında Açık/Kapalı
ve PDOP üst sınırını seçin, **PDOP filtresini kaydet** düğmesine basın.
Bu kayıt yalnız seçili haritanın yeni konum paketlerine uygulanır. Motor
yeniden başlatılmaz; mevcut oda kararları, kanıt sayıları ve hareket
referansları sıfırlanmaz. PDOP filtresi kapalıyken hız, mesafe ve oda/kapı
filtreleri normal çalışmaya devam eder. Önceden elenen paketler geri işlenmez.

**Harita filtreleri** paneli ve alt grupları başlangıçta kapalıdır. Açık panelin
içeriği kendi içinde kaydırılır; oda ve büyük alan listeleri için alan korunur.
Aynı panelde mevcut mesafe eşiği, yeni konum doğrulama ölçümü/süresi ve aday
ayarları, azami hız, hareket toleransı, asgari donanım kalitesi ve alan dışı
gösterim bekleme süresi düzenlenebilir. Bunlar seçili haritanın mevcut `engine`
ve `mapDisplay` ayarlarına bağlıdır; üstteki **Kaydet** ile mevcut doğrulama ve
uygulama akışından geçer. Oda bazındaki özel hız/kalite ayarları korunur.
Mesafe eşiğinde `0`, mevcut davranışa uygun olarak filtreyi kapatır.

Ayarlar oda motoru config'inden bağımsız olarak
`config/maps/<mapId>/tracking-filter.json` dosyasında kalıcı saklanır.
Panelden kaydetme aynı sunucuda hemen uygulanır; dosyanın elle değiştirilmesi
en fazla bir saniyelik cache sonrasında okunur. Geçersiz filtre dosyası sessizce
yok sayılmaz; konum isteği `503` döndürür ve konum işlemez.

```http
GET /api/maps/necmettin-yogun-bakim/tracking-filter
PUT /api/maps/necmettin-yogun-bakim/tracking-filter
Content-Type: application/json
```

```json
{
  "enabled": true,
  "maximumPdop": 70
}
```

Üst sınır sıfır veya daha büyük sonlu sayı olmalıdır. `pdop` API alanı
değişmez; ayrıca `hdop` alanı beklenmez. Filtreyi kapatmak için `enabled:false`
kaydedilir, son üst sınır değeri korunur.

Tracking buffer davranışı:

- Buffer her 5 saniyede bir toplu insert dener.
- `tag_location_history.pdop` nullable `DOUBLE PRECISION` olarak saklanır. Mevcut veriler `NULL` kalır. `npm run migrate:rooms` yeni `0010_tracking_pdop.sql` migration'ını da uygular; buffer flush sırasında sütunu idempotent olarak oluşturur.
- PostgreSQL insert başarısız olursa batch memory kuyruğuna geri alınır.
- Process kapanırsa memory kuyruğundaki henüz flush edilmemiş kayıtlar kaybolabilir.
- Kayıtlı tag listesi 30 saniye cache'lenir. Yeni tag eklendikten sonra cache
  invalidation için `/api/tags` endpoint'i zaten çağrılır; manuel DB insert
  yapıldıysa kısa bir gecikme görülebilir.

Raw SSE endpoint'leri:

```http
GET /api/tracking/ingest
GET /api/tracking/stream
```

SSE event adı `position` değeridir. Event data shape:

```json
{
  "tagCode": "TAG-001",
  "x": 8.8,
  "y": 7.8,
  "pdop": 1.83,
  "timestamp": "2026-07-26T12:00:00+03:00",
  "sourceZoneId": "zone-a",
  "sourceZoneName": "Bölge A",
  "mapId": "spor-koridor"
}
```

Yerel simülatör:

```powershell
node test_api\simulate_tags.js
```

Bu komut varsayılan olarak tüm canlı oda hata profillerini seed `42` ile çalıştırır.

Canlı oda hata senaryolarını sürekli olarak API'ye göndermek için:

```powershell
npm run simulate:rooms -- --scenario all --seed 42
```

Bu komut Ctrl+C ile durdurulana kadar çalışır. `all` profilinde dört tag sırasıyla
normal hareket, kapı girişinde veri kesintisi, oda içinde uzun veri kesintisi ve
komşu odaya kısa ölçüm sıçraması üretir. Tek davranış için `normal`, `entry-gap`,
`inside-long-gap` veya `neighbor-jumps` seçilebilir.

Çok katlı ve zone hata profilleri:

```powershell
npm run simulate:rooms -- --scenario multi-floor --map spor-koridor --zone-id zone-a --zone-name "Spor Koridoru" --seed 42
npm run simulate:rooms -- --scenario null-zone --seed 42
npm run simulate:rooms -- --scenario unknown-zone --seed 42
npm run simulate:rooms -- --scenario delayed-old-floor-event --seed 42
npm run simulate:rooms -- --scenario same-coordinate-different-floor --seed 42
```

`multi-floor` aynı tag'i Zone A/Map A'dan Zone B/Map B'ye geçirir ve ikinci map'in yerel koordinatlarını kullanır. `delayed-old-floor-event` yeni kata geçişten sonra eski kata ait gecikmiş timestamp üretir. Seed aynı kaldığında payload dizisi deterministiktir.

Gerekirse hedef endpoint:

```powershell
$env:TRACKING_INGEST_URL="http://127.0.0.1:3000/api/tracking/ingest"
node test_api\simulate_tags.js
```

## Region Position Engine

Region engine, raw ingest akışını değiştirmeden oda/bölge çıkarımı yapar.
Sunucu başlatma kancası (`instrumentation.ts`) motoru ilk sayfa veya API isteği
işlenmeden önce otomatik açar; oda/bölge panelini açmak gerekmez. UI'daki
"Oda Tespit Modu" veya API ile çalışma sırasında kapatılıp tekrar açılabilir.
Sistem yeniden başlatıldığında motor tekrar açık başlar. Motor açıldığında:

1. Her canlı map için `config/maps/{mapId}/regions.json` okunur ve ayrı world-coordinate polygon index'i/state machine oluşturulur.
2. Raw position event'leri memory state machine tarafından tüketilir.
3. Araç oda içinde doğrulanırsa processed event room center koordinatıyla yayınlanır.
4. Raw koordinatlar PostgreSQL'e aynen yazılmaya devam eder.
5. Processed event'ler ayrı porttan SSE olarak yayınlanır.

Kontrol endpoint'i:

```http
GET /api/region-engine/status
PUT /api/region-engine/status
Content-Type: application/json

{"enabled":true}
```

Status cevabı:

```json
{
  "enabled": true,
  "rawPort": 3000,
  "processedPort": 3001,
  "activeVehicleCount": 1,
  "vehiclesInRegions": 1,
  "configLoaded": true
}
```

Processed SSE adresi:

```text
/api/tracking/processed
```

Tarayıcı bu same-origin yolu kullanır. Uygulama sunucusu akışı loopback üzerindeki
`http://127.0.0.1:3001/api/tracking/stream` upstream'inden kesintisiz aktarır.

Processed event ek alanları:

```json
{
  "tagCode": "TAG-001",
  "x": 18.513,
  "y": 17.937,
  "timestamp": "2026-07-26T12:00:00+03:00",
  "positionSource": "REGION_CENTER",
  "regionInference": {
    "enabled": true,
    "state": "IN_REGION",
    "regionId": "zone-91d9e84c",
    "confidence": 1
  },
  "rawPosition": {
    "tagCode": "TAG-001",
    "x": 18.4,
    "y": 17.8,
    "timestamp": "2026-07-26T12:00:00+03:00"
  },
  "lastRawDataTimestamp": "2026-07-26T12:00:00+03:00"
}
```

`positionSource` değerleri:

- `RAW`: Çözülmüş konum raw koordinattır.
- `REGION_CENTER`: Araç region içinde doğrulanmış ve oda merkezine sabitlenmiştir.

State değerleri:

- `TRACKING_OUTSIDE`: Herhangi bir region içinde değil.
- `ENTRY_CANDIDATE`: Region içine giriş için confirmation bekleniyor.
- `IN_REGION`: Region içinde doğrulandı.
- `INFERRED_IN_REGION`: Yeni raw event gelmese de son bilinen region içi konum yayınlanıyor.
- `EXIT_CANDIDATE`: Region dışına çıkış için confirmation bekleniyor.
- `LOCATION_LOST`: Yeterince uzun süre raw veri gelmedi.

`config/maps/{mapId}/regions.json` ana bölümleri:

- `map`: Kat planı görseli, pixel/world kalibrasyonu ve map kimliği.
- `engine`: Entry/exit confirmation ve çıkış toleransı.
- `positionAnimation`: UI tarafı interpolasyon ve stale/teleport ayarları.
- `regions`: Polygon, room center ve giriş noktası tanımları.

Engine tuning örneği:

```json
{
  "engine": {
    "entryConfirmationCount": 2,
    "exitConfirmationCount": 2,
    "exitMarginMeters": 0.5
  }
}
```

Kurallar:

- Region ID boş veya tekrar eden olamaz.
- Polygon en az 3 world point içermelidir.
- `roomCenter` olmayan region editörde durabilir fakat inference dışında kalır.
- `exitMarginMeters` 0 ile 100 arasında olmalıdır.
- `entryConfirmationCount` ve `exitConfirmationCount` 1 ile 100 arasında tam sayı olmalıdır.

Local geliştirme farkı:

- Vite middleware `REGION_POSITION_PORT` için processed SSE listener'ı dev server
  açılışında `REGION_POSITION_HOST` üzerinde başlatır.
- Port doluysa `npm run dev` erken hata verir.
- `/api/maps/{mapId}/regions` yalnız ilgili map'in dosyasını atomic temp+rename ile günceller; `/api/regions` geçici default-map compatibility endpoint'idir.

Normal Node runtime farkı:

- Processed listener region engine enable edildiğinde açılır.
- Port doluysa enable isteği HTTP 409 döner.
- Engine kapatıldığında listener ve memory state temizlenir.

Her iki çalışma biçiminde de varsayılan host `127.0.0.1` olduğu için processed
port yerel ağ arayüzlerinde dinlemez.

## REST API özeti

Operasyon endpoint'leri:

| Endpoint | Method | Açıklama |
|---|---|---|
| `/api/tracking/ingest` | `POST` | UWB position ingest. |
| `/api/tracking/ingest` | `GET` | Raw SSE stream. |
| `/api/tracking/stream` | `GET` | Raw SSE stream alias. |
| `/api/tags` | `GET` | Kayıtlı tag listesini getirir; otomatik örnek tag eklemez. |
| `/api/tags` | `POST`, `PUT` | Tag ekler veya günceller. |
| `/api/tags?id=TAG-001` | `DELETE` | Tag siler. |
| `/api/anchors` | `GET` | Anchor listesini getirir, yoksa default anchor'ları seed eder. |
| `/api/anchors` | `POST`, `PUT` | Anchor ekler veya günceller. |
| `/api/anchors?id=A-001` | `DELETE` | Anchor siler. |
| `/api/anchors/{id}/logs?limit=100` | `GET` | Anchor health loglarını getirir. |
| `/api/regions` | `GET`, `PUT` | Region config okur veya kaydeder. |
| `/api/maps/{mapId}/regions` | `GET`, `PUT` | Map bazlı region config okur veya atomic kaydeder. |
| `/api/maps/{mapId}/tracking-filter` | `GET`, `PUT` | Haritanın PDOP filtresini motoru reload etmeden okur veya kaydeder. |
| `/api/maps/{mapId}/regions/validate` | `POST` | URL mapId/config mapId eşleşmesi dahil config doğrular. |
| `/api/region-engine/status` | `GET`, `PUT` | Region engine durumunu okur veya değiştirir. |
| `/api/region-engine/config` | `PUT` | Çalışan engine config'ini reload eder. |
| `/api/location/entities/search?q=TAG&limit=10` | `GET` | Entity/tag araması. |
| `/api/location/entities/{entityId}/current` | `GET` | Güncel konum. |
| `/api/location/entities/{entityId}/at?at=...&toleranceSeconds=300` | `GET` | Belirli zamandaki en yakın konum. |
| `/api/location/entities/{entityId}/history?from=...&to=...&format=route_points&limit=2000` | `GET` | Rota noktaları veya zone timeline. |
| `/api/support` | `POST` | Destek/öneri/bug mesajı kaydı. |
| `/api/assistant` | `POST`, `DELETE` | Opsiyonel yerel asistan proxy'si. |

Location API cevapları başarılı durumda `{ data, meta }`, hata durumunda
`{ error, meta }` envelope'u döndürür. Tarihler `Europe/Istanbul` için `+03:00`
formatına normalize edilir.

### Çok katlı geçmiş

`route_points` noktaları `mapId`, `floorPlanId`, `sourceZoneId` ve
`sourceZoneName` taşır. History sorgusunda `mapId` opsiyonel filtredir. Arayüz
noktaları ardışık `mapId` segmentlerine böler, yalnız seçilen segmenti kendi
planında çizer ve kat değişimleri arasındaki koordinat farkını toplam mesafeye
eklemez. `mapId:null` kayıtlar “Kat belirlenemedi” grubunda kalır ve plana
çizilmez. Zone timeline aynı oda adı kullanılsa bile map değişiminde yeni kalış
başlatır.

### Rollout ve rollback

Önerilen sıra expand → migrate → enforce'tur: önce nullable `0004` sütunlarını
ekleyin; sonra yeni reader/ingest ve producer/simülatörü yayınlayın; ardından
birden fazla `liveTrackingEnabled` map'i açın; son olarak health çıktısındaki
`nullZoneCount` ve `unresolvedZoneCount` sayaçları sıfıra yaklaştığında eksik
zone key'lerini producer tarafında zorunlu hale getirin. Rollback veri silmez:
yeni sütunlar nullable, `liveTrackingMapId` geçici compatibility alanı ve eski
`/api/regions` default-map wrapper'ı korunur. DROP içeren rollback hazırlamayın.

## MCP ve rota geçmişi asistanı

MCP sunucusu salt-okunurdur ve SQL çalıştırmaz. Sadece uygulamanın
`/api/location/*` endpoint'lerini çağırır.

MCP smoke:

```powershell
npm run mcp:start -- --smoke
```

MCP stdio server:

```powershell
npm run mcp:start
```

Python/Gemini terminal asistanı için:

```powershell
py -m venv mcp\.venv
mcp\.venv\Scripts\python.exe -m pip install -r mcp\requirements-agent.txt
$env:GEMINI_API_KEY="..."
npm run dev
mcp\.venv\Scripts\python.exe mcp\location_agent_cli.py
```

History sayfasındaki web chat için FastAPI bridge:

```powershell
$env:GEMINI_API_KEY="..."
$env:CHATBOT_SERVICE_URL="http://127.0.0.1:8000"
$env:UWB_LOCATION_API_BASE_URL="http://127.0.0.1:3000"
mcp\.venv\Scripts\python.exe -m uvicorn chat_api:app --app-dir mcp --host 127.0.0.1 --port 8000
```

Asistan servisini prod ortamda genel ağa açmayın. `/api/assistant` proxy'si
genel yardım sorularını bu servise iletir; “en son/şu an nerede” sorularını
yerel konum servisinden yanıtlar. Provider anahtarları tarayıcıya gönderilmez.
Konum yanıtlarını sınamak için `npm run test:ai:location` ve kayıtlı bir test
varlığıyla `npm run test:ai:location:live -- --entity-name <ad>` kullanın.

## Domain üzerinden geçici paylaşım

Uygulamayı kendi Windows bilgisayarınızda çalıştırırken Cloudflare Tunnel ve
Cloudflare Access arkasından belirli e-postalara geçici olarak açabilirsiniz.
Tunnel yalnızca `127.0.0.1:3000` hedefine bağlanır; `3001`, `5432` ve `8000`
internete açılmaz. Build sonrasında güvenli loopback listener için:

```powershell
npm.cmd run start:share
```

Named Tunnel, DNS, Windows service, tüm hostname'i kapsayan Access allowlist/OTP
politikası, durdurma ve güvenlik kontrolleri için [ayrıntılı Türkçe rehberi](docs/demo-sharing.md)
izleyin. Repoya gerçek domain, e-posta, tunnel token veya credential JSON eklemeyin.

## Yedekleme ve geri dönüş

Yedek almadan önce:

- Uygulama versiyonunu ve git commit'ini kaydedin.
- `.env.local` değerlerini güvenli bir secret store'da doğrulayın.
- Her aktif map için `config/maps/{mapId}/regions.json` dosyasını ayrıca yedekleyin. `config/regions.json` yalnız compatibility wrapper'ının legacy kopyasıdır.
- Migration veya bulk veri değişikliği için bakım penceresi açın.

PostgreSQL custom-format backup:

```powershell
New-Item -ItemType Directory -Force backups
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$env:PGPASSWORD="uwb_local_123456"
pg_dump -h 127.0.0.1 -p 5432 -U uwb_user -d uwb_db -Fc -f "backups\uwb_db-$stamp.dump"
```

Plain SQL backup alternatifi:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$env:PGPASSWORD="uwb_local_123456"
pg_dump -h 127.0.0.1 -p 5432 -U uwb_user -d uwb_db -f "backups\uwb_db-$stamp.sql"
```

Region config backup:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item config\maps\spor-koridor\regions.json "backups\spor-koridor-regions-$stamp.json"
Copy-Item config\maps\kat1-ortopedi\regions.json "backups\kat1-ortopedi-regions-$stamp.json"
```

Geri dönüş için önce ayrı restore DB üzerinde test edin:

```powershell
$env:PGPASSWORD="uwb_local_123456"
createdb -h 127.0.0.1 -p 5432 -U uwb_user uwb_db_restore
pg_restore -h 127.0.0.1 -p 5432 -U uwb_user -d uwb_db_restore --clean --if-exists "backups\uwb_db-YYYYMMDD-HHMMSS.dump"
```

Prod restore sırasında önerilen sıra:

1. Uygulama servislerini durdurun.
2. Mevcut DB'nin son bir snapshot'ını alın.
3. Restore'u ayrı DB'de test edin.
4. Uygulama connection env'ini restore DB'ye yönlendirin veya hedef DB'ye kontrollü restore yapın.
5. Servisi başlatın.
6. Smoke testleri çalıştırın.
7. Ingest ve history sorgularını doğrulayın.

## Servis başlatma örnekleri

Yerel geliştirme:

```powershell
npm run dev
```

Production build:

```powershell
npm install
npm run build
$env:PORT="3000"
$env:RAW_POSITION_PORT="3000"
$env:REGION_POSITION_HOST="127.0.0.1"
$env:REGION_POSITION_PORT="3001"
npm run start
```

Linux systemd örneği:

```ini
[Unit]
Description=GEKON IPS Control
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/gekon-ips-control
EnvironmentFile=/etc/gekon-ips-control.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
User=gekon
Group=gekon

[Install]
WantedBy=multi-user.target
```

Örnek `/etc/gekon-ips-control.env`:

```dotenv
PORT=3000
RAW_POSITION_PORT=3000
REGION_POSITION_HOST=127.0.0.1
REGION_POSITION_PORT=3001
REGION_POSITION_ALLOWED_ORIGIN=https://ips.example.internal
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=uwb_db
POSTGRES_USER=uwb_user
POSTGRES_PASSWORD=change-this-password
CHATBOT_SERVICE_URL=http://127.0.0.1:8000
UWB_LOCATION_API_BASE_URL=http://127.0.0.1:3000
```

Systemd komutları:

```bash
sudo systemctl daemon-reload
sudo systemctl enable gekon-ips-control
sudo systemctl start gekon-ips-control
sudo systemctl status gekon-ips-control
```

Opsiyonel FastAPI asistanı ayrı servis olarak çalıştırılmalıdır. Aynı process
içinde başlamaz.

## Test ve doğrulama

Kod doğrulama:

```powershell
npm run typecheck
npm run lint
npm run test
npm run test:tracking
npm run test:maps
npm run test:mcp
```

`test:maps`, Servis ve Yoğun Bakım'ın birbirinden bağımsız harita ayarlarını
doğrular. Servis çıkış doğrulamasında 3, Yoğun Bakım'da 2 ölçüm kullanılır;
testler haritaların diğer ayarlarının eşit olmasını gerektirmez. Artık
kullanılmayan spor koridorun eski geometri testleri bu pakete dahil değildir;
ayrı `npm run test:maps:legacy` komutunda korunur.

Temel servis smoke testleri:

```powershell
Invoke-RestMethod "http://127.0.0.1:3000/api/tags"
Invoke-RestMethod "http://127.0.0.1:3000/api/anchors"
Invoke-RestMethod "http://127.0.0.1:3000/api/region-engine/status"
```

Region engine enable testi:

```powershell
Invoke-RestMethod `
  -Method Put `
  -Uri "http://127.0.0.1:3000/api/region-engine/status" `
  -ContentType "application/json" `
  -Body '{"enabled":true}'
```

Processed SSE proxy testi, local dev output server açıksa veya engine enable
edildiyse:

```powershell
Invoke-WebRequest "http://127.0.0.1:3000/api/tracking/processed" -UseBasicParsing
```

History API örneği:

```powershell
Invoke-RestMethod "http://127.0.0.1:3000/api/location/entities/search?q=TAG-001&limit=10"
```

## Hata giderme

### `npm run dev` port hatasıyla açılmıyor

- `3000` doluysa `PORT` ve `RAW_POSITION_PORT` değerlerini birlikte değiştirin.
- `3001` doluysa `REGION_POSITION_PORT` için boş bir port seçin.
- `REGION_POSITION_PORT`, `RAW_POSITION_PORT` ile aynı olamaz.

### PostgreSQL bağlantısı zaman aşımına düşüyor

- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER` ve
  `POSTGRES_PASSWORD` değerlerini kontrol edin.
- PostgreSQL servisinin çalıştığını doğrulayın.
- `pg_hba.conf` ve `listen_addresses` ayarlarının uygulama host'una izin
  verdiğini doğrulayın.
- Bu istemci TLS kullanmadığı için TLS zorunlu endpoint'lere doğrudan bağlanamaz.

### Ingest `204` dönüyor fakat geçmiş kaydı oluşmuyor

- Haritanın etkin PDOP üst sınırını aşan paketler canlı yayına ve geçmişe alınmaz; bu paketlerin `204` dönmesi beklenen davranıştır.
- PDOP filtresini geçen geçerli payload canlı SSE'ye yayınlanır.
- Tag `tags` tablosunda kayıtlı olmadığı için geçmişe yazılmadı.
- UI'dan tag ekleyin veya `POST /api/tags` kullanın.
- Manuel DB insert yaptıysanız tag cache için en fazla 30 saniye bekleyin veya
  `/api/tags` çağrısıyla cache invalidation tetikleyin.

### UI canlı veri göstermiyor

- UWB kaynağının `POST /api/tracking/ingest` adresine ulaştığını kontrol edin.
- Tarayıcı network panelinde SSE bağlantısının açık kaldığını doğrulayın.
- Reverse proxy kullanıyorsanız buffering kapalı olmalıdır.
- Event payload'ında `timestamp` timezone içeriyor olmalıdır.

### Konum geçmişi boş geliyor

- Entity/tag assignment var mı kontrol edin.
- Legacy modda aktif tag'ler entity gibi kullanılır, tarihsel yeniden atama
  garantisi yoktur.
- `from` ve `to` ISO-8601 timezone içermelidir.
- Aralık `UWB_HISTORY_MAX_DAYS` sınırını aşmamalıdır.
- `tag_location_history` içinde ilgili tag ve zaman aralığı için kayıt olduğunu
  doğrulayın.

### Region engine açılmıyor

- `GET /api/region-engine/status` ile mevcut durumu okuyun.
- İlgili `config/maps/{mapId}/regions.json` içinde tekrar eden region ID, eksik polygon,
  geçersiz world koordinatı veya geçersiz `roomCenter` olup olmadığını kontrol edin.
- `REGION_POSITION_PORT` kullanımda ise enable isteği 409 döner.
- Loglarda `REGION_ENGINE_CONFIG_ERROR` veya `PROCESSED_PORT_CONNECTION_ERROR`
  kayıtlarını arayın.

### Processed stream veri üretmiyor

- Region engine enabled mı kontrol edin.
- Raw ingest akışının gerçekten event aldığını doğrulayın.
- İlgili region'da `roomCenter` tanımlı olmalıdır.
- Entry confirmation sayısı kadar ardışık içeride ölçüm gelmelidir.
- Tarayıcı network panelinde `/api/tracking/processed` bağlantısını kontrol edin;
  tarayıcı doğrudan `3001` portuna bağlanmamalıdır.

### Asistan "çevrimdışı" görünüyor

- FastAPI bridge servisinin `127.0.0.1:8000` üzerinde çalıştığını kontrol edin.
- `CHATBOT_SERVICE_URL` değerini uygulama process'inde doğrulayın.
- `GEMINI_API_KEY` veya `GOOGLE_API_KEY` tanımlı olmalıdır.
- MCP smoke testini çalıştırın: `npm run mcp:start -- --smoke`.
- `UWB_LOCATION_API_BASE_URL` ana uygulama API kökünü göstermelidir.

## Operasyon notları

- Secret değerlerini README, test fixture veya log çıktısına yazmayın.
- `.env.local` ve yedekleri git dışında, erişimi sınırlı bir yerde tutun.
- PostgreSQL backup almadan migration çalıştırmayın.
- Region config değişikliklerinde ilgili `config/maps/{mapId}/regions.json`
  dosyasını ayrıca versiyonlayın veya yedekleyin.
- Region engine memory state process restart ile sıfırlanır.
- Tracking buffer memory queue process crash durumunda son flush öncesi event'leri
  kaybedebilir.
- Raw konumlar veritabanında değiştirilmez; oda merkezine sabitleme yalnızca
  processed SSE event'lerinde görülür.
- Reverse proxy arkasında SSE için response buffering kapalı olmalıdır.
- `REGION_POSITION_HOST=127.0.0.1` varsayılanını koruyun; processed SSE dışarı
  açılmamalıdır.

## Oda çıkarımı ve deterministik simülasyon

Yeni motor, harita/kapı alanları, ölçüm–karar–görüntüleme sözleşmesi, migration ve gölge/geri dönüş kullanımı: [oda çıkarımı dokümanı](docs/room-inference.md).

```powershell
npm run evaluate:rooms -- --scenario all --seed 42
npm run test:tracking
```

`evaluate:rooms` senaryo değerlendirmesi ağ isteği yapmadan sanal saatle çalışır; [temel metrikler](test_api/results/room-metrics.md) ve [paket kayıplı stres metrikleri](test_api/results/stress/room-metrics.md) ayrı raporlanır.
