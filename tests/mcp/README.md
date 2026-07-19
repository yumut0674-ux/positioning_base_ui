# MCP Testleri

Bu klasör MCP input doğrulamasını, standart zarfları, dört tool'u, HTTP istemcisini, ortak location service iş mantığını ve SDK tool kaydını deterministik fixture'larla sınar.

## Yapı

- `fixtures/testData.ts`: sabit saat (`2026-07-19T11:30:00Z`), varlık ve API zarfları.
- `searchEntities.test.ts`: ad/code/tag araması, ambiguous/no-data, SDK tool listesi.
- `getCurrentLocation.test.ts`: aktif atama, konum yokluğu, tazelik ve validation.
- `getLocationAtTime.test.ts`: tolerans, fark saniyesi ve ISO timezone doğrulaması.
- `getLocationHistory.test.ts`: format, limit, tarih aralığı ve MCP/REST zone-timeline sözleşmesi.
- `locationApiClient.test.ts`: URL, token, timeout, 500, bozuk JSON ve hata sızıntısı.
- `locationService.test.ts`: ardışık zone birleştirme, zone geçişi, veri boşluğu, entity adı, yasak alanların yokluğu, ISO İstanbul normalizasyonu, polygon/rectangle resolver, fallback ve tarihsel tag atamaları.
- `integration.test.ts`: çalışan gerçek REST servisine opsiyonel salt-okunur arama.
- `all.test.ts`: unit dosyalarını tek Node test sürecinde yükler.

## Çalıştırma

```powershell
npm run test:mcp
npm run typecheck:mcp
npm run mcp:start -- --smoke
```

Entegrasyon testi varsayılan olarak atlanır. Uygulama sunucusu ve güvenli test ortamı hazırken:

```powershell
$env:UWB_MCP_INTEGRATION = "1"
$env:UWB_LOCATION_API_BASE_URL = "http://127.0.0.1:3000"
npm run test:mcp:integration
```

Unit testlerde gerçek PostgreSQL kullanılmaz ve yazma yapılmaz. HTTP `fetchImplementation`, servis repository interface'leri ve saat fonksiyonu enjekte edilir. Gerçek ortam denetimleri yalnızca `GET`/`SELECT` ile manuel olarak yapılır.

`zone_timeline` testleri timeline repository yolunun route-point örnekleme yolunu çağırmadığını ayrıca doğrular. Gerçek oda polygonları fixture içinde açıkça verilir; üretim oda koordinatları tahmin edilmez.
