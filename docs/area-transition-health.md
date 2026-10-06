# Büyük alan çıkışları için kaynak sağlığı

30 saniyelik tahmini çıkış yalnızca ilgili haritanın **bütün** `trackingZoneIds` kaynaklarından güncel ve sağlıklı heartbeat alındığında çalışır. Tag ölçümleri heartbeat sayılmaz. Sinyal hiç gelmezse veya 15 saniye boyunca yenilenmezse durum `unknown` olur; açık çıkış bekler. `outage` bildirimi de bekleyen kararı durdurur. `/api/region-engine/status` içindeki `areaTracking.sourceHealth`, `pendingExits` ve kuyruk sayaçları bu durumu gösterir. Aynı bilgiler büyük alan olayları ekranında görünür.

Kaynak uygulamasında `TRACKING_HEALTH_TOKEN` ile aynı gizli değeri ayarlayın. Kaynak çalışırken her 5 saniyede bir, tag ölçümü olmasa da, her `zone_id` için `POST /api/tracking/ingest` gönderin:

```json
{"type":"source_health","zone_id":"zone-a","status":"healthy","timestamp":"2026-09-27T12:00:00.000Z"}
```

İstekte `Content-Type: application/json` ve `x-tracking-health-token: <secret>` başlıkları gerekir. Genel kesinti tespitinde `status: "outage"` gönderin. Sunucu yalnızca haritaya bağlı, en fazla 15 saniyelik bildirimleri kabul eder. Simülatör token ayarlandığında bu bildirimi tag konumlarından ayrı gönderir. Canlı kaynak aynı sözleşmeyi uygulayana kadar kaynak sağlığı `unknown` kalır ve tahmini çıkış üretilmez.

Olay ve son durum yazımları `.data/area-transitions` dizininde kalıcı dosyalarla bekletilir (`AREA_TRANSITION_SPOOL_DIR` ile değiştirilebilir). Bu dizin yeniden başlatmalar arasında korunmalıdır. PostgreSQL kurtulduğunda olaylar küçük transaction batch'leriyle, ilgili durumlarıyla birlikte yazılır. Olay kimliği tekildir; tekrar yazım `ON CONFLICT(id) DO NOTHING` ile güvenlidir. Durum dosyası tag/harita/alan başına bir tanedir; ara durumlar birleştirilir. Diskte bekleyen olay sayısı üst sınırı dolarsa yeni geçiş açık hata verir ve alan motoru geçişi geri alır; `rejectedWrites` ve `error` teşhis alanlarında görünür. Disk doluluğu ve kalıcı disk kaybı için işletim izlemesi gerekir.
