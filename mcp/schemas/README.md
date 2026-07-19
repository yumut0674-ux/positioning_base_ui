# Doğrulama ve Response Şemaları

Tool ve REST girdileri `src/server/location/location.validation.ts` içinde merkezileştirilmiş Zod şemalarıyla doğrulanır; `mcp/schemas/toolSchemas.ts` aynı şemaları MCP katmanına yeniden export eder.

## Kurallar

- `entityId`: pozitif tam sayı.
- `query`: trim sonrası 1–100 karakter.
- arama `limit`: varsayılan 10, maksimum 20.
- history `limit`: varsayılan/maksimum 2000.
- `toleranceSeconds`: varsayılan 300, aralık 1–86400.
- `format`: yalnızca `zone_timeline` veya `route_points`.
- `from < to`; varsayılan maksimum aralık 7 gün (`UWB_HISTORY_MAX_DAYS`).

Tarihler geçerli ISO 8601 olmalı ve `Z` ya da `+03:00` gibi açık timezone içermelidir. Sunucu lokal timezone'una güvenilmez. Response meta timezone değeri daima `Europe/Istanbul`, `generatedAt` çağrı anında üretilen ISO 8601 `+03:00` değeridir.

PostgreSQL'den gelen bütün konum zamanları da response'a eklenmeden önce `Europe/Istanbul` ISO 8601 biçimine normalize edilir. `zone_timeline` ve `route_points` farklı data sözleşmeleridir:

- `route_points`: `entityId`, `entityName`, `from`, `to`, `format`, `points`, `gaps`, örnekleme sayıları.
- `zone_timeline`: yalnızca `entityId`, `entityName`, `timeline`.

Her timeline kaydı yalnızca `zoneName`, `enteredAt`, `exitedAt`, `durationSeconds` alanlarını içerir.

Başarı zarfı:

```json
{"data":{},"meta":{"timezone":"Europe/Istanbul","generatedAt":"2026-07-19T14:30:00+03:00","dataStatus":"complete","warnings":[]}}
```

Hata zarfı:

```json
{"error":{"code":"ENTITY_NOT_FOUND","message":"İstenen varlık bulunamadı.","retryable":false,"details":{}},"meta":{"timezone":"Europe/Istanbul","generatedAt":"2026-07-19T14:30:00+03:00","dataStatus":"no_data","warnings":[]}}
```

`dataStatus` kontrollü değerleri: `complete`, `partial`, `no_data`, `stale`, `ambiguous`.
