# UWB Salt-Okunur MCP Sunucusu

Bu sunucu, UWB konum verisini LLM istemcilerine dört kontrollü ve salt-okunur MCP tool'u üzerinden açar. MCP katmanı PostgreSQL'e bağlanmaz ve SQL çalıştırmaz; yalnızca uygulamanın iç REST API'sini `locationApiClient` üzerinden çağırır.

## Mimari

`MCP istemcisi → stdio MCP sunucusu → HTTP locationApiClient → /api/location/* → location service/repository → PostgreSQL`

SQL yalnızca `src/server/location/*Repository.ts` dosyalarındadır. Girdi doğrulama ortak Zod şemalarıyla yapılır. REST ve MCP aynı TypeScript veri sözleşmelerini kullanır. Stdio protokolünü korumak için sunucu stdout'a log yazmaz; başlangıç hataları ve smoke sonucu stderr'e gider.

## Kurulum ve çalıştırma

Gereksinim Node.js `>=22.13.0` ve proje bağımlılıklarının kurulmuş olmasıdır.

```powershell
npm install
npm run mcp:start
```

Smoke testi:

```powershell
npm run mcp:start -- --smoke
```

Örnek MCP istemci yapılandırması, çalışma dizini bu proje olacak biçimde `node --import tsx mcp/server.ts` komutunu stdio sunucusu olarak başlatmalıdır.

## Ortam değişkenleri

| Değişken | Varsayılan / örnek | Açıklama |
|---|---:|---|
| `UWB_LOCATION_API_BASE_URL` | `http://127.0.0.1:3000` | İç REST API kökü |
| `UWB_LOCATION_API_TOKEN` | ayarlanmaz | Opsiyonel Bearer servis token'ı |
| `UWB_LOCATION_API_TIMEOUT_MS` | `5000` | HTTP zaman aşımı (100–60000 ms) |
| `UWB_LIVE_THRESHOLD_SECONDS` | `30` | Canlı konum üst sınırı |
| `UWB_OFFLINE_THRESHOLD_SECONDS` | `300` | Offline konum alt sınırı |
| `UWB_HISTORY_MAX_DAYS` | `7` | Maksimum history aralığı (üst güvenlik sınırı 31) |
| `UWB_HISTORY_MAX_POINTS` | `2000` | Maksimum döndürülen nokta (üst sınır 2000) |
| `UWB_HISTORY_PROCESSING_MAX_POINTS` | `100000` | Timeline oluşturulurken işlenecek ham kayıt güvenlik sınırı (1000–250000) |

Gerçek `.env.local` değerleri veya token'lar dokümana/loga yazılmaz.

## Tool özeti

- `search_entities`: ad, entity code veya tag code arar; çoklu sonuçta `ambiguous` döner.
- `get_current_location`: aktif tag ataması, son konum, zone ve `live/stale/offline` durumunu getirir.
- `get_location_at_time`: ilgili zamandaki tag atamasıyla tolerans içindeki en yakın kaydı getirir.
- `get_location_history`: harita için örneklenmiş `route_points` veya kullanıcı/LLM için oda-bölge aralıklarından oluşan küçük `zone_timeline` üretir. Timeline, route örneklemesinden önce oluşturulur.

Örnek çağrı girdileri:

```json
{"name":"search_entities","arguments":{"query":"TAG-028","limit":10}}
```

```json
{"name":"get_location_history","arguments":{"entityId":28,"from":"2026-07-18T00:00:00+03:00","to":"2026-07-19T00:00:00+03:00","format":"zone_timeline","limit":2000}}
```

## Güvenlik

Sunucuda genel SQL tool'u, yazma tool'u veya ham hata aktarımı yoktur. URL'ler `URL`/`URLSearchParams` ile oluşturulur; timeout için `AbortController` kullanılır. Upstream mesajları allowlist hata kodlarına ve yerel güvenli mesajlara çevrilir. Stack trace, bağlantı bilgisi ve token MCP cevabına eklenmez. Tool'lar `readOnlyHint: true` olarak kayıtlıdır.

## Bilinen sınırlamalar

Gerçek veritabanında `tracked_entities` ve `tag_assignments` henüz yoktur. Uygulama geçici olarak aktif `tags` kayıtlarını varlık kabul eder ve cevapları `partial` uyarısıyla işaretler. Bu mod tarihsel yeniden atamaları garanti edemez. `drizzle/0001_tracked_entities_and_tag_assignments.sql` incelenip yedekli bakım penceresinde manuel uygulanmalıdır.

Zone resolver dikdörtgen ve polygon sınırlarını destekler; ancak mevcut floor plan yalnızca geniş alanları tanımlar ve Oda 34/Oda 65 gibi oda numaraları için kalibre edilmiş polygon verisi içermez. Bu nedenle oda adı tahmin edilmez ve eşleşmeyen kayıtlar `Tanımlı alan dışında` döner. `app/history/page.tsx` hâlâ demo veri kullanır.
