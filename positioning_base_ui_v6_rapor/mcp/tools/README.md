# MCP Tool Sözleşmeleri

Bütün tool'lar başarıda `{ data, meta }`, hatada `{ error, meta }` döndürür. Aynı veri hem JSON metni hem `structuredContent` olarak sunulur. Hatalarda `isError: true` ayarlanır.

## `search_entities`

Girdi: `{ "query": "Palet 28", "limit": 10 }`. `query` trim edilir, 1–100 karakter olmalıdır. `limit` varsayılan 10, aralık 1–20'dir. Yanıtın `data.matches` alanında `entityId`, `entityCode`, `name`, `entityType`, `tagCode`, `status` bulunur. Sıfır sonuç `no_data`, bir sonuç `complete`, birden fazla sonuç `ambiguous` olur; cevap otomatik seçim içermez.

## `get_current_location`

Girdi: `{ "entityId": 28 }`; pozitif tam sayı zorunludur. Yanıt entity/tag, koordinat, zone, floor plan, `observedAt`, `ageSeconds` ve `trackingStatus` içerir. Varsayılan eşikler: `<=30s live`, `<=300s stale`, sonrası `offline`. `stale/offline` konumlar `dataStatus=stale` döner.

## `get_location_at_time`

Girdi: `{ "entityId": 28, "at": "2026-07-18T14:00:00+03:00", "toleranceSeconds": 300 }`. Tarih `Z` veya açık `±HH:MM` offset içermelidir. Tolerans 1–86400 saniye, varsayılan 300'dür. Tolerans içinde kayıt yoksa `position=null` ve `no_data` döner. Tarihsel tag ataması sorgu zamanına göre seçilir.

## `get_location_history`

Girdi: `{ "entityId": 28, "from": "2026-07-18T00:00:00+03:00", "to": "2026-07-19T00:00:00+03:00", "format": "zone_timeline", "limit": 2000 }`. Format `zone_timeline` veya `route_points`; limit 1–2000; varsayılan tarih aralığı üst sınırı 7 gündür.

`route_points` harita odaklıdır. Büyük veri SQL tarafında eşit aralıklı örneklenir; `sampled`, `sourcePointCount`, `returnedCount` ve `gaps` alanları korunur.

`zone_timeline` örneklenmiş rota noktalarından üretilmez. Backend güvenlik sınırı içindeki gerçek kronolojik kayıtlar önce zone'lara çözülür; ardışık aynı zone'lar birleşir, zone değişimi önceki aralığı kapatır ve 5 dakikadan uzun veri boşluğu yeni aralık başlatır. Cevap yalnızca entity ve küçük zaman çizelgesini içerir:

```json
{
  "entityId": 184,
  "entityName": "Pallet 28",
  "timeline": [
    {
      "zoneName": "Oda 34",
      "enteredAt": "2026-07-19T10:39:28+03:00",
      "exitedAt": "2026-07-19T10:52:14+03:00",
      "durationSeconds": 766
    }
  ]
}
```

Timeline kayıtlarında koordinat, tag, floor plan veya ham position bulunmaz. PostgreSQL tarihleri ISO 8601 `Europe/Istanbul` (`+03:00`) biçimine normalize edilir. Kalibre edilmiş oda sınırı yoksa oda adı uydurulmaz; `Tanımlı alan dışında` kullanılır.

## Hata kodları

`VALIDATION_ERROR`, `ENTITY_NOT_FOUND`, `ENTITY_AMBIGUOUS`, `TAG_ASSIGNMENT_NOT_FOUND`, `LOCATION_NOT_FOUND`, `INVALID_DATE_RANGE`, `DATE_RANGE_TOO_LARGE`, `UPSTREAM_TIMEOUT`, `UPSTREAM_UNAVAILABLE`, `INTERNAL_ERROR`.

`UPSTREAM_TIMEOUT` ve `UPSTREAM_UNAVAILABLE` yeniden denenebilir. İç istisna ve upstream ham mesajlar döndürülmez.

## `dataStatus`

- `complete`: sonuç eksiksizdir.
- `partial`: legacy varlık modeli veya örnekleme gibi açıklanmış sınırlama vardır.
- `no_data`: eşleşen veri yoktur.
- `stale`: güncel konum tazelik eşiğini aşmıştır.
- `ambiguous`: arama birden fazla varlık döndürmüştür.
