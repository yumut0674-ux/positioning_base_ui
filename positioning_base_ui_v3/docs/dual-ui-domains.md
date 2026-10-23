# İki alan adıyla kullanıcı ve admin arayüzü

Uygulama tek Vinext sürecinde çalışır. `neu-demo.gekon.com.tr` kullanıcı
arayüzünü; `neu-admin.gekon.com.tr` tüm panelleri içeren admin arayüzünü
gösterir. Her ikisi de aynı REST API, canlı takip belleği ve PostgreSQL
verilerini kullanır. Yerel geliştirmede `localhost` ve `127.0.0.1` admin
arayüzünü gösterir.

| Panel | Demo | Admin |
|---|:---:|:---:|
| Canlı Harita ve seçili tag bilgisi | Evet | Evet |
| Rota Geçmişi | Evet | Evet |
| Destek ve İletişim | Evet | Evet |
| İzlenen Varlıklar (tag yönetimi) | Hayır | Evet |
| Referans İstasyonları (anchor yönetimi) | Hayır | Evet |
| Oda/Bölge | Hayır | Evet |
| Analizler | Hayır | Evet |

Cloudflare Tunnel kullanırken iki hostname için DNS kaydı oluşturun ve
`deploy/cloudflared/dual-ui.example.yml` örneğindeki kuralları yerel tunnel
yapılandırmanıza ekleyin. İki kural da aynı `127.0.0.1:3000` servisine gider.
Uygulama normal HTTP `Host` başlığına göre arayüzü seçer. Bilinmeyen
hostname'ler demo arayüzünü gösterir.

Bu aşamada giriş, Cloudflare Access veya API yetkilendirmesi yoktur. Admin
adresini bilen kişiler admin panellerini açabilir. Ayrıca demo menüsünde
görünmeyen yönetim API'leri doğrudan isteklerle erişilebilir durumdadır.
Alan adı ayrımı yalnızca arayüz düzenidir; erişim kontrolü olarak kullanılmaz.
