# MCP Test Raporu

- Test tarihi: 2026-07-19
- Node.js: v22.18.0
- İşletim ortamı: Windows / PowerShell
- MCP SDK: `@modelcontextprotocol/sdk` 1.29.0
- Test altyapısı: yerleşik `node:test` + `tsx`
- Veritabanına yazma: **Hayır**. Gerçek DB denetimleri yalnızca `SELECT` ve route `GET` çağrılarıydı.

## Komut sonuçları

| Komut | Sonuç | Özet |
|---|---|---|
| `npm run test:mcp` | PASS | 31 test, 31 başarılı, 0 başarısız, 0 atlanan |
| `npm run test:mcp:integration` | SKIPPED | 1 test; çalışan HTTP sunucusu/`UWB_MCP_INTEGRATION=1` olmadığı için atlandı |
| `npm run typecheck:mcp` | PASS | MCP, location backend ve dört REST route strict TypeScript kontrolünden geçti |
| `npm run typecheck` | FAIL (mevcut/ilgisiz) | 7 mevcut tanı: anchors/tags union tipleri, Cloudflare tipleri, store status tipi, TagNode implicit any |
| `npm run build` | PASS | Vinext build tamamlandı; dört location route build çıktısında görüldü |
| `npm run lint` | PASS | 0 hata; mevcut `LogoMark.tsx` için 1 `<img>` uyarısı |
| `npm test` | FAIL (mevcut/ilgisiz) | Build geçti; `rendered-html.test.mjs` 2 testte eski preview beklentileri nedeniyle kaldı |
| `npm run mcp:start -- --smoke` | PASS | Sunucu ve dört tool kayıt yolu stdout protokolünü açmadan oluşturuldu |

İlk MCP geliştirme koşusu `locationErrors.ts` içinde `??`/`||` parantez önceliği nedeniyle transform aşamasında kalmıştı. Hata düzeltildi; yeni zone-timeline değişikliğinin nihai koşusu 31/31 geçti.

## Senaryo sonuçları

| # | Senaryo | Sonuç |
|---:|---|---|
| 1 | Tam ürün adı (`Palet 28`) | PASS |
| 2 | Ürün kodu (`PALLET-028`) | PASS |
| 3 | Tag kodu (`TAG-028`) | PASS |
| 4 | Çoklu eşleşme; `ambiguous`, otomatik seçim yok | PASS |
| 5 | Ürün bulunamadı; `no_data` | PASS |
| 6 | Aktif tag ataması yok; `TAG_ASSIGNMENT_NOT_FOUND` | PASS |
| 7 | Konum yok; `LOCATION_NOT_FOUND` | PASS |
| 8 | Eski konum; `stale/offline` ve `dataStatus=stale` | PASS |
| 9 | Zamanda tolerans dışı kayıt; `no_data` | PASS |
| 10 | Geçersiz/timezone'suz tarih; `VALIDATION_ERROR` | PASS |
| 11 | `from >= to`; `INVALID_DATE_RANGE` | PASS |
| 12 | Çok uzun tarih aralığı; `DATE_RANGE_TOO_LARGE` | PASS |
| 13 | Zone dışı koordinat; kontrollü fallback | PASS |
| 14 | Tag yeniden atanmış; sorgu aralığındaki iki atama | PASS |
| 15 | Eski/silinmiş tag geçmişte var, current'da aktif değil | PASS |
| 16 | API timeout | PASS |
| 17 | API 500 | PASS |
| 18 | Bozuk JSON | PASS |
| 19 | Boş query | PASS |
| 20 | Negatif entityId | PASS |
| 21 | Limit aşımı | PASS |
| 22 | Standart zarf + geçerli `generatedAt` + İstanbul timezone | PASS |
| 23 | İç/upstream hata mesajı sızıntısı yok | PASS |
| 24 | Stdio stdout logu yok | PASS |
| 25 | SDK üzerinde dört salt-okunur tool kaydı | PASS |
| 26 | Zone timeline ardışık aynı oda kayıtlarını birleştirir | PASS |
| 27 | Zone değişiminde doğru giriş/çıkış ve süre üretilir | PASS |
| 28 | Beş dakikadan uzun boşluk aynı zone'u iki aralığa böler | PASS |
| 29 | Timeline yalnızca dört izinli kayıt alanını içerir | PASS |
| 30 | Polygon ve rectangle zone modelleri birlikte çalışır | PASS |
| 31 | PostgreSQL timestamp `Europe/Istanbul` ISO 8601'e normalize edilir | PASS |

## Gerçek veri ve route denetimi

Salt-okunur DB audit sonucunda `tags=3`, `tag_location_history=130502`; `tracked_entities` ve `tag_assignments` yoktu. `TAG-028` için gerçek arama route'u HTTP 200, tek sonuç döndürdü. Current route HTTP 200 döndü.

Yeni `zone_timeline` route'u entity `184` için `2026-07-19T10:00:00+03:00`–`11:05:00+03:00` aralığındaki 3.011 ham kaydı route-point örneklemesi kullanmadan tek bir zaman aralığına sıkıştırdı:

```json
{
  "data": {
    "entityId": 184,
    "entityName": "Pallet 28",
    "timeline": [
      {
        "zoneName": "Tanımlı alan dışında",
        "enteredAt": "2026-07-19T10:39:28.976+03:00",
        "exitedAt": "2026-07-19T11:04:59.708+03:00",
        "durationSeconds": 1531
      }
    ]
  }
}
```

Legacy entity modeli nedeniyle response `meta.dataStatus=partial` ve açıklayıcı warning içerdi.

Geriye uyumluluk denetiminde aynı aralık `format=route_points&limit=100` ile HTTP 200 döndü; 3.011 kaynak kayıttan 98 örneklenmiş nokta üretildi, `sampled=true` korundu ve ilk `observedAt` değeri `2026-07-19T10:39:28.976+03:00` olarak normalize edildi.

## Entegrasyon durumu ve sınırlamalar

Otomatik HTTP entegrasyon testi çalışan ayrı uygulama süreci olmadığı için **SKIPPED** durumundadır; sahte başarı yazılmadı. Buna karşılık route handler'lar gerçek DB'ye karşı doğrudan `GET` ile başarıyla doğrulandı.

`tracked_entities`/`tag_assignments` migration'ı güvenli otomatik uygulama yetkisi olmadığı için çalıştırılmadı. Legacy fallback tarihsel yeniden atamayı gerçek veride garanti etmez. History UI hâlâ demo veri kullanır.

Konum adları yalnızca kaydedilmiş bölgeler paneli konfigürasyonundaki çokgenlerden çözülür. Tanımlı bir çokgenin dışında kalan koordinatlar `Tanımlı alan dışında` kalır; oda numarası veya alan adı uydurulmaz.

Mevcut proje testi iki nedenle başarısızdır: `codex-preview=development` meta etiketi bulunmuyor ve `app/_sites-preview/SkeletonPreview.tsx` mevcut değil. Bunlar MCP değişikliklerinden bağımsızdır.

## Sonraki adımlar

1. PostgreSQL yedeği ve bakım penceresiyle migration'ı inceleyip uygulayın.
2. Ürün–tag atama verisini doldurun ve çakışma kontrollerini operasyonel veriyle doğrulayın.
3. Çalışan REST sunucusunda `UWB_MCP_INTEGRATION=1` ile otomatik entegrasyon testini çalıştırın.
4. `app/history/page.tsx` demo verisini yeni history endpointine bağlayın.
5. Kalibre edilmiş oda polygonlarını Bölgeler panelinden tanımlayıp kaydedin.
6. Mevcut proje typecheck ve rendered HTML test borçlarını ayrı değişiklikte giderin.
