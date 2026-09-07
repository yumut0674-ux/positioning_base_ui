# UWB Base Proje Plani

Bu planin amaci, her yeni UWB uygulama alani icin sifirdan arayuz yazma ihtiyacini azaltmak ve teknik gelisimi ortak bir cekirdekte toplamak.

## 1. Mevcut Durumdan Cikan Dersler

Incelenen projelerde iki ana damar var:

- `KOD*`: UWB canli konum sunucusu. UDP/seri veri alma, X/Y parse etme, filtreleme, anchor/zone konfigi ve basit HTTP API tek Python dosyasinda.
- `emlak_new_ui`: Is uygulamasi arayuzu. Harita/plan yukleme, bolge cizme, personel/makine/ekipman, alarm, rapor ve AI soru-cevap akislari buyuk oranda frontend icinde ve `localStorage`/`IndexedDB` uzerinde.

Ana problem:

- UWB veri cekirdegi, UI ve uygulama alani birbirine karisiyor.
- Her yeni sektor icin ayni harita, zone, takip, alarm ve rapor mantigi yeniden yaziliyor.
- Kalici veritabani ve servis katmani olmadigi icin demo kodu ile gercek urun kodu arasindaki mesafe buyuyor.

## 2. Base Projenin Hedefi

Base proje su soruya cevap vermeli:

> Yeni bir uygulama alani geldiginde sadece domain modulu, ekran metinleri, veri tipleri ve kurallar degissin; UWB altyapisi, harita, servisler ve veritabani ayni kalsin.

Base proje sunlari icermeli:

- Kalici veritabani
- UWB veri alma servisleri
- Realtime konum yayini
- Harita/kat/plani yonetimi
- Anchor, tag, entity ve zone yonetimi
- Alarm/kural motoru
- Ortak dashboard ve raporlama altyapisi
- Yeni uygulama alani ekleme sablonu

## 3. Onerilen Teknik Mimari

### Backend

Onerilen cekirdek: `Python + FastAPI`

Neden:

- Mevcut UWB veri alma kodu Python tarafinda.
- UDP, seri port, test simulatoru ve AI servisleri Python ile daha dogal entegre olur.
- REST + WebSocket/SSE tek backend icinde temiz kurulabilir.

Backend katmanlari:

- `api`: REST ve realtime endpointler
- `services`: UWB ingestion, filtering, rules, alarms, reports
- `models`: veritabani modelleri
- `repositories`: DB erisim katmani
- `domain_modules`: emlak, fabrika, depo, hastane gibi uygulama modulleri
- `integrations`: ESP32, MQTT, AI, dis sistemler

### Veritabani

Baslangic icin:

- Lokal/demo: SQLite
- Uretim: PostgreSQL

ORM:

- SQLAlchemy veya SQLModel
- Migration icin Alembic

### Frontend

Onerilen cekirdek: `Vite + React + TypeScript`

Neden:

- Mevcut tek dosya JS buyudukce yonetimi zorlasiyor.
- Harita, tablo, modal, filtre, dashboard gibi tekrar eden parcalar component olarak ayrilabilir.
- Yeni uygulama alanlari icin ekran modulu eklemek kolaylasir.

Eger daha dusuk karmaşıklik istenirse ilk surum `Vite + vanilla TypeScript` ile de baslayabilir. Ancak orta vadede React daha surdurulebilir.

## 4. Cekirdek Veri Modeli

Ilk surum icin minimum tablolar:

- `projects`
  - Uygulama/proje kaydi.
- `sites`
  - Saha, bina, santiye, fabrika, depo vb.
- `floors`
  - Kat veya alan.
- `map_assets`
  - Yuklenen plan gorselleri ve olcek bilgisi.
- `anchors`
  - Anchor ID, x/y/z konumu, aktiflik, site/floor baglantisi.
- `tags`
  - UWB tag cihazlari.
- `tracked_entities`
  - Personel, makine, ekipman, arac gibi takip edilen varliklar.
- `entity_types`
  - Uygulama alanina gore varlik turleri.
- `tag_assignments`
  - Hangi tag hangi entity uzerinde.
- `position_samples`
  - Ham/filtrelenmis konum gecmisi.
- `latest_positions`
  - En son konum cache tablosu.
- `zones`
  - Polygon veya dikdortgen bolgeler.
- `zone_rules`
  - Bolgeye girince/cikinca/kalinca calisacak kurallar.
- `alerts`
  - Aktif ve gecmis alarmlar.
- `users`
  - Kullanici ve rol altyapisi.
- `audit_logs`
  - Kritik degisiklik kayitlari.

## 5. Ortak Servisler

### UWB Ingestion Service

Sorumluluk:

- UDP dinleme
- Seri port okuma
- HTTP/MQTT ile konum alma
- Farkli cihaz formatlarini normalize etme

Cikis formati:

```json
{
  "tag_id": "T-001",
  "x": 2.35,
  "y": 1.8,
  "z": 0,
  "source": "udp",
  "timestamp": "2026-07-12T09:00:00Z"
}
```

### Position Service

Sorumluluk:

- Ham konumu filtreleme
- Ziplama/aykiri deger azaltma
- Son konumu guncelleme
- Konum gecmisini saklama

Mevcut `PositionFilter` buraya tasinabilir.

### Map Service

Sorumluluk:

- Kat plani yukleme
- Pixel/metre olcegi
- Anchor yerlesimi
- Zone polygon saklama

### Rule And Alarm Service

Sorumluluk:

- Entity zone icinde mi?
- Yasak bolge ihlali var mi?
- Makine-personel mesafesi riskli mi?
- Belirli sure hareketsizlik var mi?
- Alarm uretme, kapatma, gecmise alma

### Realtime Service

Sorumluluk:

- WebSocket veya SSE ile canli konum yayini
- Dashboard metriklerini yayinlama
- Alarm eventlerini yayinlama

## 6. Frontend Modulleri

Base UI icinde ortak ekranlar:

- Canli Harita
- Plan/kat yonetimi
- Anchor yerlesimi
- Zone editor
- Tag ve entity eslestirme
- Alarm merkezi
- Raporlar
- Ayarlar
- Simulator/test verisi ekrani

Domain modulu ile degisen ekranlar:

- Entity listeleri
- KPI kartlari
- Rapor metinleri
- Form alanlari
- Zone/rule sablonlari
- Navigasyon isimleri

## 7. Domain Modul Sistemi

Her yeni uygulama alani su sekilde eklenmeli:

```text
domain_modules/
  construction/
    module.json
    entity_types.json
    rules.json
    dashboard.json
    seed_data.json
  warehouse/
    module.json
    entity_types.json
    rules.json
    dashboard.json
    seed_data.json
```

Ornek `module.json`:

```json
{
  "id": "construction",
  "name": "Santiye Takip",
  "entities": ["personnel", "machine", "equipment"],
  "default_views": ["live-map", "alarms", "reports"],
  "enabled_rules": ["danger-zone-entry", "person-machine-distance"]
}
```

Bu sayede yeni sektor icin proje kopyalamak yerine sadece yeni modul eklenir.

## 8. API Taslagi

Temel endpointler:

- `GET /api/health`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/sites`
- `POST /api/sites`
- `GET /api/floors/{floor_id}/map`
- `POST /api/floors/{floor_id}/map`
- `GET /api/anchors`
- `POST /api/anchors`
- `GET /api/tags`
- `POST /api/tags`
- `GET /api/entities`
- `POST /api/entities`
- `POST /api/tag-assignments`
- `GET /api/zones`
- `POST /api/zones`
- `GET /api/alerts`
- `POST /api/alerts/{alert_id}/ack`
- `GET /api/reports/summary`
- `WS /ws/live`

Gecis icin mevcut endpointler de kisa sure korunabilir:

- `/api/state`
- `/api/system/start`
- `/api/system/stop`
- `/api/update`

## 9. Gelistirme Fazlari

### Faz 0 - Karar ve Kapsam

- Backend framework kesinlestir.
- Frontend framework kesinlestir.
- SQLite mi PostgreSQL mi ilk hedef olacak karar ver.
- Ilk domain olarak `construction`/`emlak_new_ui` sec.

### Faz 1 - Backend Cekirdegi

- FastAPI proje iskeleti.
- DB modelleri ve migration.
- UWB UDP/seri/test ingestion servisleri.
- Position filter servisinin ayrilmasi.
- REST endpointleri.
- WebSocket/SSE canli yayin.

### Faz 2 - Frontend Cekirdegi

- Vite tabanli UI iskeleti.
- Ortak layout ve navigasyon.
- Canli harita componenti.
- Zone editor componenti.
- Entity/tag/anchor yonetim ekranlari.
- Alarm merkezi.

### Faz 3 - Domain Modul Altyapisi

- `module.json` okuma.
- Entity tiplerini dinamik forma/tabela cevirme.
- Domain bazli KPI ve rapor tanimlari.
- `emlak_new_ui` verilerini ilk domain modulu olarak tasima.

### Faz 4 - Simulator ve Test

- Test tag hareket simulatoru.
- UDP test sender.
- Seed data.
- API testleri.
- UI smoke testleri.

### Faz 5 - Urunlestirme

- Docker compose.
- PostgreSQL opsiyonu.
- Ortam degiskenleri.
- Loglama.
- Backup/export.
- Rol bazli yetki.

## 10. Ilk MVP Kapsami

Ilk calisan base proje sunlari yapmali:

- Harita/plan yukle.
- Anchorlari kaydet.
- Zone ciz ve kaydet.
- Tag/entity eslestir.
- UDP veya test simulatorunden konum al.
- Canli haritada konumu goster.
- Tehlikeli bolgeye girince alarm uret.
- Tum veriyi SQLite'a yaz.
- Yeni domain icin entity tiplerini config ile degistir.

Bu MVP, yeni uygulama alanlari icin yeterli bir temel olur.

## 11. Mevcut Projelerden Tasima Haritasi

`KOD_v2` icinden alinacaklar:

- `parse_xy_line`
- `PositionFilter`
- `UDPReader`
- `SerialReader`
- `/api/state`, `/api/system/start`, `/api/system/stop` davranislari
- `anchors_config.json` mantigi, fakat DB'ye tasinacak

`emlak_new_ui` icinden alinacaklar:

- Plan yukleme mantigi
- Polygon zone editor
- Personel/makine/ekipman ekran fikirleri
- Alarm ve rapor ekran fikirleri
- Simulator mantigi

Degistirilecekler:

- `localStorage` ve `IndexedDB` kalici ana veri kaynagi olmayacak.
- Domain verileri frontend icinde hardcode edilmeyecek.
- UI tek buyuk JS dosyasi olmayacak.
- Backend sadece statik dosya sunucusu olmayacak.

## 12. Baslama Sirasi

Onerilen ilk uygulama sirasi:

1. `base` icinde backend/frontend klasor yapisini kur.
2. SQLite DB ve migration altyapisini ekle.
3. UWB ingestion servislerini eski Python kodundan ayir.
4. `/ws/live` ile canli konum yayini kur.
5. Frontendde canli harita ve zone editoru kur.
6. `construction` domain modulunu ilk ornek olarak ekle.
7. `emlak_new_ui` demo verisini seed data'ya tasiyip localStorage bagimliligini kaldir.

## 13. Basari Kriterleri

Base proje basarili sayilirsa:

- Yeni bir uygulama alani icin ana kod kopyalanmaz.
- Yeni entity tipi config/model ile eklenebilir.
- UWB veri alma kodu UI'dan bagimsizdir.
- Harita, zone, alarm ve rapor altyapisi tekrar kullanilir.
- Demo verisi ile gercek cihaz verisi ayni API'dan akar.
- Veriler tarayici depolamasinda degil veritabaninda kalir.

## 2026-09-07 — Uygulanan oda çıkarım mimarisi ve saha kapısı

Uygulandı: süre/pencere/kapı geometri/hız/kalite temelli RegionPositionEngine; ayrı ham ve görüntüleme konumu; doğrulanmış/tahmini/aday/çıkış/belirsiz durumları; gerçek ölçüm-alınma-yayın zamanı ayrımı; merkezde sabit gösterim ve belirsizlik paneli; PostgreSQL ayrı karar olayları ve sürüm ilişkilendirmesi; LocationService/MCP/geçmişte ortak karar kullanımı; sınırlı tamponlar; eski motorla gölge karşılaştırma ve geri dönüş; fiziksel gerçek rota ile bozuk ölçümleri ayıran 13 deterministik senaryo.

Mimari akış: ingest → TrackingBuffer (ham kayıt) → RegionPositionEngine → görüntüleme yayını + RoomDecisionRepository → LocationService / geçmiş / MCP. Sentetik merkezler ham tabloya dönmez. Arayüz aday oda için merkez seçmez; aktif oda merkezi animasyonla tekrar yürütülmez. Tarihsel geçiş zamanı fiziksel kesin zaman değil karar aralığı olarak işaretlenir.

Yerel migration uygulandı. Doğrulama komutları, harita eksikleri, geri dönüş modu ve senaryo metrikleri [oda çıkarımı dokümanında](docs/room-inference.md); [temel senaryo raporu](test_api/results/room-metrics.md) ve [stres raporu](test_api/results/stress/room-metrics.md) tekrar üretilebilir.

Kalan saha doğrulaması: oda 3 / Oda 4 kapılarının açıklık, normal ve bağlantılarını ölçüp kaydetmek; alternatif kat config'inin poligon dışı merkezini düzeltmek; odaların kapsama ve beklenen sıklığını ölçmek; dar oda ve ortak duvar bantlarını kalibre etmek; paket kaybında kaçan kapı çıkışının gecikme bedeli için kabul sınırı belirlemek; gölge akışı gerçek kayıtlarla değerlendirmek. Mevcut sayısal eşikler deneysel başlangıç değerleridir, üretimde doğrulanmış eşikler değildir. Stres normal geçişinde yeni motorun gecikme bedeli eskiden yüksek çıkmıştır; kabul kapısı bu bulgu çözülmeden kapatılmamalıdır.
