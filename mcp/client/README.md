# Location API Client

`locationApiClient.ts`, MCP tool'larının iç REST API'ye eriştiği tek katmandır.

## Endpointler

- `GET /api/location/entities/search?q={query}&limit={limit}`
- `GET /api/location/entities/{entityId}/current`
- `GET /api/location/entities/{entityId}/at?at={ISO_DATE}&toleranceSeconds={number}`
- `GET /api/location/entities/{entityId}/history?from={ISO_DATE}&to={ISO_DATE}&format={zone_timeline|route_points}&limit={number}`

Base URL `UWB_LOCATION_API_BASE_URL` değerinden, opsiyonel Bearer token `UWB_LOCATION_API_TOKEN` değerinden alınır. Token loglanmaz. Varsayılan base URL `http://127.0.0.1:3000`, varsayılan timeout 5000 ms'dir.

İstemci `AbortController` ile süre sınırı uygular. JSON olmayan veya sözleşmeye uymayan 2xx cevapları ve tüm 5xx cevapları `UPSTREAM_UNAVAILABLE` yapar. Abort `UPSTREAM_TIMEOUT` olur. 4xx cevaplarda yalnızca allowlist içindeki hata kodu korunur; upstream mesaj/details taşınmaz.

Testte ağ erişimi gerekmez. `HttpLocationApiClient` kurucusuna `fetchImplementation` verilerek kontrollü `Response` veya abort davranışı enjekte edilebilir:

```ts
const client = new HttpLocationApiClient({
  baseUrl: "http://test.local",
  fetchImplementation: async () => new Response(JSON.stringify(fixture)),
});
```
