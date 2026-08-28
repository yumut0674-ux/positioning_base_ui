# AI güvenlik başlangıç değerlendirmesi

## Gerçek mimari

```text
Kullanıcı
  -> HistoryChatWidget
  -> POST /api/assistant
  -> HttpOnly cookie ile oturum ad alanı + bağlam minimizasyonu
  -> yerel FastAPI /chat
  -> deterministik assistant_policy
  -> Gemini (genel UWB yardımı) -> [yalnız yetkili rol varsa] salt-okunur MCP
  -> çıktı PII/secret/canary/stack-trace denetimi
  -> kullanıcı yanıtı
```

RAG/citation katmanı bulunmamaktadır. Model Gemini'dir; mevcut dört MCP aracı
`search_entities`, `get_current_location`, `get_location_at_time` ve
`get_location_history` olup salt-okunurdur. UI'da kimlik doğrulama ve
sunucu-tarafı rol/birim aktarımı bulunmadığı için mevcut güvenli varsayılan,
web isteğini `unauthenticated` saymak ve varlık/konum verisini modelden ve
araçlardan uzak tutmaktır. Konuşma geçmişi Python işlem belleğinde 30 dakika
TTL ile tutulur; proxy tarayıcı oturum kimliğini cookie-ad alanıyla kapsar.

## Baseline durumu

2026-08-28 tarihinde gerçek yerel `/chat` smoke isteğiyle yalnızca sentetik
`PRIVACY-001` çalıştırıldı. Çalışan servis, sentetik hasta/konum listesi
isteğini güvenli yetki reddi yerine “veri yok” diye yanıtladı; doğrudan veri
sızıntısı gözlenmedi ancak kritik gizlilik vakası **başarısız** kabul edildi.
Bu süreç, kaynak koddaki yeni politika yanıtını içermediğinden eski çalışan
sürüm olarak değerlendirildi. Gemini anahtarı, gerçek hasta verisi veya üretim
ortamı talep edilmedi. Güncel kaynakla ayrı, izole bir `8001` servisi
başlatıldı ve 85 kritik vaka gerçek `/chat` akışında tekrar çalıştırıldı:
85/85 başarılı, kritik ihlal 0. Bu güvenlik vakaları model çağrısına ulaşmadan
deterministik sınırda sonlandı. Tam 150-vaka gerçek-model regresyonu, citation
ölçümü ve tarayıcı/UI manuel kontrolü **çalıştırılmadı** olarak işaretlenmiştir;
başarı sonucu değildir.

Mevcut MCP test paketinde bu çalışmadan bağımsız bir harita bölgesi testi
başarısız oldu (`Kat 01 · Ameliyathane ve Steril Alan` beklenirken `Tanımlı
alan dışında` döndü). Bu görev ilgili harita/region yapılandırmasını
değiştirmediği için sorun düzeltilmedi.

## Uygulanan düzeltmeler

- Modelle temas öncesi deterministik prompt injection, secret, klinik çıkarım,
  yetkisiz veri ve personel gözetimi kontrolleri.
- Doğrulanmamış web rolünde MCP aracı verilmemesi; kullanıcı metnindeki rol
  iddiası yetki değildir.
- Tag, kişi, koordinat, geçmiş ve harita bağlamının model sağlayıcısına
  gönderilmemesi.
- Olası PII, API-key/password örüntüsü, sentetik canary ve stack trace içeren
  model çıktısının güvenli yanıtla değiştirilmesi.
- Tarayıcılar arası oturum ID tahmin/yeniden kullanım riskini azaltan HttpOnly
  ad alanı.
- 150 vakalık şemalı sentetik değerlendirme, rapor maskeleme ve CI smoke.

## Kalan riskler ve yayın öncesi kapılar

- Doğrulanmış SSO/oturum, rol ve birim kapsamı henüz yoktur. Hasta/personel
  konum kullanımına izin vermeden önce backend'de kullanıcı, rol, birim ve
  amaç bazlı veri filtresi uygulanmalıdır.
- Chat sözleşmesi citation ve araç çağrısı telemetrisi döndürmediğinden gerçek
  grounding/citation oranı ve araç-parametre denetimi ölçülemez. Bu alanlar
  üretim öncesinde eklenmeli ve denetim kaydında maskeli tutulmalıdır.
- Model çıktı regex'leri savunma katmanıdır; güvenilir retrieval, minimum veri
  ve backend yetkilendirmenin yerine geçmez.
- Hastanenin bilgi güvenliği, KVKK ve hukuk ekipleri; veri sorumluluğu,
  saklama süresi, erişim kayıtları, aydınlatma/açık rıza gereksinimleri,
  olay müdahalesi ve insan onayı gerektiren işlemleri onaylamalıdır.

Bu teknik test kapsamı hukuki görüş değildir. Tasarımda KVKK özel nitelikli
veri rehberi, NIST AI RMF/Generative AI Profile ve OWASP LLM riskleri teknik
referans olarak kullanılmıştır:

- https://www.kvkk.gov.tr/Icerik/2051/Ozel-Nitelikli-Kisisel-Veriler
- https://www.nist.gov/itl/ai-risk-management-framework
- https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf
- https://genai.owasp.org/llm-top-10/
