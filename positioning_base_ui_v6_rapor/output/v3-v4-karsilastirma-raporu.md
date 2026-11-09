# V3–V4 motor ve çalışma akışı karşılaştırması

Tarih: 23 Ekim 2026. İncelenen klasörler: `positioning_base_ui_v3` ve `positioning_base_ui_v4`.

## Sonuç

Oda motorunun algoritması, motor denetleyicisi, ham veri alımı, PDOP/mesafe filtreleri ve mevcut motor yapılandırmaları iki sürümde birebir aynıdır. V4'te bildirim özelliğinin gerektirdiği backend, veritabanı ve başlangıç akışı eklemeleri vardır. Son harita seçimi düzeltmesi UI durumuyla sınırlıdır.

Motorun karar üretimine yönelik bir değişiklik bulunmadı. Bildirim katmanı aynı Node.js işleminde ek CPU, disk ve veritabanı işi yapar; performans etkisinin büyüklüğü bu incelemede ölçülmedi.

Bu inceleme sırasında uygulama kodu veya ayarları değiştirilmedi. Yalnızca bu rapor ve karşılaştırma envanteri oluşturuldu.

## Karşılaştırma kapsamı

Kaynak/yapılandırma envanterinde 573 ortak dosya bulundu: 552 dosya birebir aynı, 21 dosyanın içeriği farklı. V4'te 12 yeni dosya var; V3'ten silinen kaynak/yapılandırma dosyası yok.

`node_modules`, `dist`, `.next`, `.vinext`, `output`, `.npm-cache`, `.data`, Python önbellekleri, günlükler ve TypeScript derleme önbelleği kaynak karşılaştırmasına dahil edilmedi. İki klasörde de gerçek `.env.local` bulunmuyor; mevcut `.env.example` dosyaları aynı. Canlı cihaz, gerçek veritabanı veya kurulu bağımlılık ikilikleri karşılaştırılmadı.

## Birebir aynı kalan kritik parçalar

| Parça | Doğrulama |
| --- | --- |
| `src/server/regionEngine/` | 13/13 dosya aynı: HMM motoru, kural motoru, controller, alan geçiş motoru, çıktı sunucusu, konfigürasyon yükleyicisi ve motor tipleri dahil. |
| `src/server/tracking/` | 5/5 dosya aynı: presence servisi, runtime, depo, HTTP akışı ve son konum çözümleme. |
| `src/features/tracking/hooks/` | 5/5 dosya aynı: mevcut gerçek zamanlı takip bağlantıları dahil. |
| `config/` | 19/19 dosya aynı: bölgeler, kapılar, harita kalibrasyonları, motor seçimi, takip filtreleri ve kayıtlı sistem ayarları. |
| `src/server/trackingBuffer.ts` | Bayt ve SHA-256 karşılaştırması aynı. |
| `src/server/trackingFilterSettings.ts`, `trackingFilterHttp.ts`, `postgresClient.ts` | Birebir aynı. |
| `roomDecisionLabel.ts`, `tagQuickList.ts`, `TrackingGateway.ts`, `MapDisplayFilter.ts` | Birebir aynı. |
| `jetson-v9.1-guncelleme/` | 4/4 dosya aynı. |
| `build/`, `deploy/`, `mcp/` | Sırasıyla 2/2, 2/2 ve 17/17 dosya aynı. |
| `package-lock.json`, Vite/Next ayarları, kurulum/başlatma/kayıt oynatma BAT dosyaları | Birebir aynı. `package.json` farkı yalnızca yeni bildirim testi komutu. |

Ham tracking API'leri ve asıl oda kararı deposu da ortak dosya envanterinde değişmemiştir.

## Sistemin çalışmasına eklenen veya değişen işler

1. **Başlangıç:** `instrumentation.ts:7` bildirim runtime'ını yükler; `:8` başlatmayı bekler; ardından mevcut motoru etkinleştirir. Bildirim başlangıcında dosya okuması yapılır. Yakalanan başlangıç hatası loglanır ve motorun etkinleştirilmesine devam edilir.
2. **Arka plan izleme:** `notificationRuntime.ts:61` mevcut presence olaylarını kuyruğa alır. `:63` başlayan zamanlayıcı 250 ms'de bir kuyruğu işler ve mevcut durumları okur. İkinci zamanlayıcı 2 saniyede bir ayarları, bölge dosyalarını ve tag tercihlerini yeniler. Yeni bir konum/motor kararı üretme veya motoru yeniden yapılandırma çağrısı bulunmadı.
3. **Veritabanı:** `0011_area_exit_notifications.sql` ayrı `area_exit_notifications` tablosu ve indekslerini; mevcut `tags` tablosuna varsayılanı açık olan `area_exit_notification_enabled` kolonunu ekler. Tag API'sinin listeleme/kaydetme SQL'i bu kolonu destekleyecek şekilde değişmiştir. Motorun karar tablosuna bildirim yazılmaz.
4. **Disk kaydı:** Bildirim kuyruğu ve tekrar alarmı önleyen durum `.data/area-exit-notifications.json` dosyasına değiştikçe atomik olarak kaydedilir. Veritabanı kaydı hata verirse yeniden deneme yapılır.
5. **İstemci sorguları:** `useAreaExitNotifications.ts:37` bağlı her arayüz için 500 ms aralıkla bildirim sorgular. Yavaş/çakışan istekler engellenir; bu nedenle normal koşulda istemci başına yaklaşık saniyede iki ek istek oluşur. Bildirim API'si PostgreSQL sorgusu da yapar.
6. **Analiz API'si:** Oda kararları ve bildirimler `analysisLogs.ts` üzerinden birleştirilir. Varsayılan “Tümü” sonucu ve toplam kayıt sayısı artık bildirimleri de içerir. Bildirim ayrıntısı ve `NOTIFICATION` filtresi eklenmiştir. CSV'ye `regionName` ve `shortReason` sütunları eklenmiştir; CSV'yi sütun sırasına göre işleyen harici tüketiciler için çıktı şeması değişmiştir.
7. **Sistem ayarları:** Ayar şemasına `notifications.exitDelayMs` ve `displayDurationMs` eklenmiştir. Mevcut takip/rapor varsayılanları değişmemiştir. Kayıtlı 19 konfigürasyon dosyasının kendisi şu anda V3 ile aynıdır; yeni alanlar şema üzerinden varsayılanlarla tamamlanır ve ayar kaydında dosyaya yazılır.
8. **Harita UI'si:** `useIpsStore.ts` içindeki `followSelectedTagMap` elle harita seçimi yapıldığında otomatik harita takibini durdurur. Tag verisi güncellenmeye devam eder. Açık bir tag seçimi/haritada gösterme eylemi takibi yeniden açar. `IpsApplication.tsx` dış haritadaki taga açıkça odaklanmayı destekler. Bu işlemler backend/motor ayarlarına yazmaz.

## Doğrulanan iki uyumluluk/hata etkisi

### Bildirim deposunun hatası varsayılan analiz listesini de etkiliyor

`src/server/notifications/analysisLogs.ts:9` oda ve bildirim sorgularını `Promise.all` ile bekliyor. Bildirim sorgusu başarısız olursa oda sorgusu başarılı olsa bile birleşik istek reddediliyor. `app/api/room-decisions/route.ts` bunu HTTP 503'e çeviriyor. Sonuç, analiz ekranındaki “Tümü” listesinin yüklenememesi. Bu hata motorun karar üretimine doğrudan iletilmiyor.

Bağımlılıkları taklit eden salt okunur kontrol sonucu:

- Oda sorgusu başarılı + bildirim sorgusu hatalı + karar türü “Tümü”: birleşik liste başarısız.
- Aynı koşul + karar türü `ROOM_CONFIRMED`: oda listesi başarılı; bildirim deposu çağrılmıyor.

### V4'te kaydedilen ayar dosyası V3'e doğrudan taşınamıyor

V3 ayar şeması kökte `.strict()` kullanıyor ve `notifications` alanını tanımıyor. V4 ayarları kaydedildikten sonra oluşan dosya V3'e taşınırsa V3 bu dosyayı geçersiz sayıyor. `FileSystemSettings.read()` bunu sistem ayarları okuma hatasına dönüştürüyor. Bu, V3'e geri dönüşte veya aynı ayar dosyasını iki sürümle paylaşırken dikkate alınmalı; iki ayrı klasördeki mevcut dosyalar şu anda aynı ve geçerli.

Gerçek şemalar üzerinde, dosyaya yazmadan yapılan kontrol sonucu:

- V3 mevcut ayar dosyasını kabul ediyor: **evet**.
- V4 mevcut ayar dosyasını kabul ediyor: **evet**.
- V3, V4 şemasından geçirilmiş/kaydedilecek ayar nesnesini kabul ediyor: **hayır**.

Bu iki bulgu bu incelemede raporlandı; kodları değiştirilmedi.

## Değişen mevcut dosyalar

```text
app/api/room-decisions/[decisionId]/route.ts
app/api/room-decisions/route.ts
app/api/tags/route.ts
app/tags/page.tsx
instrumentation.ts
package.json
scripts/migrate-room-decisions.ts
src/app/IpsApplication.tsx
src/app/store/useIpsStore.ts
src/features/decisionLogs/components/DecisionLogDetail.tsx
src/features/decisionLogs/components/DecisionLogFilters.tsx
src/features/decisionLogs/components/DecisionLogList.tsx
src/features/decisionLogs/services/decisionLogsApi.ts
src/features/decisionLogs/types/decisionLog.types.ts
src/features/settings/components/SettingsPanel.tsx
src/features/settings/types/settings.types.ts
src/features/tracking/services/tagApi.ts
src/server/location/roomDecision.validation.ts
src/server/settings/settingsHttp.ts
tests/mapSelection.test.ts
tests/settingsApi.test.ts
```

## V4'te eklenen kaynak dosyaları

```text
app/api/notifications/route.ts
docs/alan-cikis-bildirimleri-plani.md
drizzle/0011_area_exit_notifications.sql
src/features/notifications/AreaExitToasts.tsx
src/features/notifications/notification.types.ts
src/features/notifications/notifications.module.css
src/features/notifications/useAreaExitNotifications.ts
src/server/notifications/AreaExitObserver.ts
src/server/notifications/analysisLogs.ts
src/server/notifications/notificationRepository.ts
src/server/notifications/notificationRuntime.ts
tests/areaExitNotifications.test.ts
```

Makine tarafından okunabilir dosya envanteri ve ortak dosyaların SHA-256 sonuçları aynı klasördeki `v3-v4-karsilastirma.json` dosyasındadır.
