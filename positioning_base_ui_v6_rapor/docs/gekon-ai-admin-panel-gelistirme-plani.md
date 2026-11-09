# Gekon AI admin paneli geliştirme planı

Bu belge geliştirme önerisidir; uygulama kodu ve çalışan sistem ayarları değiştirilmemiştir.

## 1. Amaç ve ilk sürüm kapsamı

Admin menüsüne **Gekon AI** paneli eklenir. Yönetici tek ekranda sorulmuş soruları ve cevaplarını inceler, günlük istek sayılarını görür, Gekon AI'yi **Aktif / Kullanım dışı** olarak yönetir.

Kullanım dışı durumda ve teknik hata durumunda kullanıcıya aynı metin gösterilir:

> Gekon AI şu anda aktif değil. Lütfen daha sonra tekrar deneyin.

Bu metin ilk sürümde ortak bir sabittir. Hata sebebine göre kullanıcıya farklı servis, kota veya bağlantı mesajları gösterilmez. Teknik ayrıntılar admin kayıtlarında bulunur.

## 2. Mevcut yapıyla entegrasyon

İncelenen kodun durumu:

- `src/app/components/AppSidebar.tsx` admin menüsünü ve `WorkspaceView` tipini tanımlar. Yeni görünüm kimliği `gekon-ai` olur.
- `src/app/IpsApplication.tsx` panelleri açar ve admin görünümlerini sınırlar. Yeni panel bu yapıya eklenir.
- `src/features/assistant/components/HistoryChatWidget.tsx` hem canlı harita hem rota geçmişi için kullanılan sohbet bileşenini içerir. Sorular ve cevaplar React belleğindedir.
- `app/api/assistant/route.ts` ortak giriş noktasıdır. Bazı konum sorularını yerel konum servisleriyle cevaplar; diğer soruları Python/FastAPI servisine gönderir. Kapatma kontrolü **iki yoldan da önce** yapılmalıdır.
- `mcp/location_agent_runtime.py` sohbet oturumlarını geçici bellekte tutar. Mevcut `logger` teknik olayları konsola yazar. Kalıcı soru-cevap tablosu bulunmuyor.
- Admin ve demo alan adları aynı API ve PostgreSQL verilerini kullanır. Açma/kapatma ayarı her ikisine de uygulanır.
- Admin görünümü host adına göre seçiliyor. Bu seçim doğrulanmış yönetici kimliği sağlamaz. Yeni kayıt ve ayar API'lerinde sunucu tarafında admin yetkisi doğrulanmalıdır.

**Eski sorular:** Mevcut yapıda kalıcı tutulmayan geçmiş sorular geriye dönük oluşturulamaz. Panel kayıt mekanizması devreye girdikten sonraki soruları gösterir ve “Kayıt başlangıcı” tarihini belirtir. Başka bir ortamda gerçekten saklanmış kayıt bulunursa içe aktarma ayrıca değerlendirilir.

## 3. Tek sayfalık panel düzeni

Menüde **YÖNET → Gekon AI** yer alır; kullanıcı/demo menüsünde gösterilmez.

| Alan | İçerik |
|---|---|
| Durum ve kontrol | Aktif / Kullanım dışı seçimi, son değişiklik zamanı, kullanıcıya gösterilecek sabit mesaj |
| Günlük özet | Bugünkü toplam istek, başarılı yanıt, teknik hata, kullanım dışıyken gelen istek |
| Günlük grafik | Son 7 günün istek sayıları; 30 gün seçeneği; hiç istek olmayan günlerde 0 |
| Soru kayıtları | Tarih/saat, soru özeti, durum, yanıt kaynağı, yanıt süresi |
| Kayıt detayı | Sorunun tamamı, verilen cevap veya sabit mesaj, oturum kimliği, admin için hata kodu |

Kayıt listesinde tarih aralığı, durum ve soru metni araması bulunur. En yeni kayıt önce gösterilir; sunucuda sayfalama yapılır. Satıra basıldığında detay yan paneli açılır, ayrı bir sayfaya gidilmez. İlk sayfa 25 kayıttır; sorgu üst sınırı 100 kayıt olur.

Durum seçiminin yanında **Kaydet** bulunur. Kaydetme sırasında kontrol kilitlenir; sunucu kaydı tamamlanmadan başarılı görünmez. Başka bir admin aynı ayarı değiştirmişse sürüm kontrolü çakışmayı bildirir ve güncel değer yüklenir.

**Yönetim tercihi ve servis sağlığı ayrıdır:** Yönetici “Aktif” seçmiş olsa bile servis erişilemiyorsa panel ayrıca “Servise ulaşılamıyor” gösterebilir. Geçici teknik hata yönetici tercihini kendiliğinden değiştirmez. Paneldeki sağlık kontrolü ücretli model isteği göndermez ve tam yanıt üretiminin garantisi olarak sunulmaz.

## 4. İstek akışı ve kullanım dışı davranışı

1. Gelen gövde ve mesaj doğrulanır. Boş, çok uzun veya bozuk istekler 400 ile reddedilir; günlük soru sayısına eklenmez.
2. Her geçerli soru için benzersiz istek kimliği üretilir, başlangıç zamanı alınır ve kalıcı kayıt açılır.
3. Ortak ayardan `enabled` okunur. Ayar veya kayıt servisine ulaşılamıyorsa sabit mesaj döner; AI çalıştırılmaz.
4. Kullanım dışıysa kayıt `disabled` olarak tamamlanır. Yerel konum sorgusu, FastAPI, Gemini ve MCP çağrıları başlatılmaz.
5. Aktifse mevcut yerel konum veya Gemini yolu çalışır. Soru, cevap, kaynak ve süre kayda yazılır.
6. Bağlantı hatası, zaman aşımı, kota hatası, geçersiz upstream cevap veya beklenmeyen sunucu hatasında kayıt `error` olarak tamamlanır ve aynı sabit mesaj döner.
7. Başarılı cevap gönderilmeden önce kapatma durumu yeniden kontrol edilir. İstek devam ederken kapatılmışsa üretilmiş cevap kullanıcıya gönderilmez; sabit mesaj gösterilir ve kayıt `disabled` olur. Daha önce başlatılmış provider isteğinin tüketimini geri alma garantisi yoktur.

Normal bir “Kayıt bulunamadı”, açıklama isteme veya politika gereği reddetme cevabı teknik arıza sayılmaz; mevcut normal cevap olarak kaydedilir.

Kullanım dışı/teknik hata yanıtı HTTP 503 ile, ortak `ASSISTANT_UNAVAILABLE` kodu ve sabit mesajla döner. Sohbet bileşeni bu cevabı anlaşılır bir asistan mesajı olarak gösterir. Başarılı cevaplar mevcut `data.sessionId` ve `data.answer` sözleşmesini korur. Kesinti yanıtı provider/model alanlarını zorunlu tutmaz.

Tarayıcı API'ye hiç erişemezse, JSON okunamazsa veya istemci zaman aşımı olursa aynı ortak mesaj istemcide de gösterilir. İstemci zaman aşımı sunucunun çalışma sınırından uzun, fakat sonlu tutulur. Sonsuz yükleme veya otomatik tekrar gönderme yapılmaz.

Kapatma ayarı yalnızca sohbeti etkiler; harita, takip ve rota geçmişi normal çalışmaya devam eder. Kullanıcı sohbeti açıp mesaj gönderebilir ve kullanım dışı cevabını alabilir. Kapatma eski kayıtları silmez. Tekrar aktif edildiğinde sonraki istekler normal çalışır.

“Sohbeti temizle” kullanıcının görünen konuşmasını ve geçici AI oturumunu temizler; admin soru kayıtlarını silmez. Kullanım dışıyken bu işlem yerel temizliği tamamlayabilir ve yeni AI isteği başlatmaz.

## 5. Kalıcı veri modeli

Mevcut PostgreSQL bağlantısı kullanılır. Son migration sırasına göre `drizzle/0009_assistant_management.sql` önerilir; uygulama aşamasında sıra yeniden kontrol edilir.

### `assistant_settings`

Tek sistem ayarı satırı: `enabled`, `version`, `updated_at`, `updated_by` ve kayıt başlangıcı zamanı. Ayar tarayıcı depolamasında tutulmaz. İlk kurulumda `enabled=true` mevcut davranışı korur. Ayar okunamaması “aktif” varsayımına düşmez; sabit kesinti cevabı üretir.

Her yeni istekte ortak sunucu ayarı okunur; ilk sürümde process belleğinde kalıcı ayar önbelleği kullanılmaz. Kaydetme tamamlandıktan sonra başlayan istekler, tüm kullanıcılar ve uygulama süreçleri için yeni değeri uygular.

### `assistant_requests`

| Alan grubu | Alanlar |
|---|---|
| Kimlik | `id`, sunucu tarafından adlandırılmış/özetlenmiş `session_key`, varsa doğrulanmış `user_id` |
| Zaman | `created_at`, `completed_at`, `duration_ms` |
| İçerik | `question`, `answer` |
| Sonuç | `status`: `pending / success / error / disabled / interrupted` |
| Kaynak | `provider`: `local / gemini / null`, `model`, `mode`: `live / history` |
| Teknik bilgi | `error_code`, güvenli hata özeti, `upstream_status`, `provider_attempted` |

Her soru tek satırdır; başlangıçtaki `pending` satırı sonuçla güncellenir. Kullanım dışı kayıtlarında da soru ve sabit cevap saklanır. Başarısız provider girişimleri başarılı kullanım gibi gösterilmez. Oturum kimliği kişi kimliği olarak sunulmaz; doğrulanmış kullanıcı yoksa isim veya e-posta üretilmez.

Başlangıç kaydı yazılamazsa model çağrısı yapılmaz ve sabit mesaj döner. Sonuç kaydı yazılamazsa kullanıcıya yine sabit mesaj gösterilir; istek kimliğiyle güvenli teknik olay kaydı tutulur. Yeniden başlatmada/zaman aşımında uzun süre `pending` kalmış satırlar `interrupted` olarak işaretlenir. Tamamen veritabanı kesintisinde veya sunucuya ulaşmayan istekte kalıcı soru kaydı garanti edilemez; bu durum gerçek günlük toplamların eksik olabileceği bir sınırdır.

Tarih ve durum alanlarına indeks eklenir. Liste yalnız soru özeti döndürür; tam soru-cevap detay çağrısıyla alınır. API anahtarı, cookie, yetkilendirme başlığı, ham konum bağlamı veya provider'a gönderilen tam payload kaydedilmez. Mesajlar arayüzde metin olarak render edilir.

### `assistant_setting_events`

Her açma/kapatma işlemi için eski değer, yeni değer, zaman ve doğrulanmış admin kimliği saklanır. Ayar değişikliği ve olay kaydı aynı veritabanı işlemi içinde tamamlanır.

İlk sürüm geçmişi kendiliğinden silmez. Saklama süresi ve otomatik temizleme daha sonra açık bir ürün kararıyla eklenebilir.

## 6. Günlük sayıların tanımı

- **Bir istek = `/api/assistant` üzerinden alınan bir geçerli kullanıcı sorusu.**
- Yerel konum cevabı, başarılı Gemini cevabı, hata ve kullanım dışıyken sorulan soru toplam sayıya dahildir.
- Modelin iç araç çağrıları ayrı soru sayılmaz. Sohbet temizleme, durum okuma, sağlık kontrolü ve admin paneli sorguları sayılmaz.
- Sonuç ayrı gösterilir: başarılı, hata, kullanım dışı, işleniyor ve yarıda kalan. Toplam bu grupların toplamıdır.
- Gemini çağrısı yapılan istek sayısı ayrıca kaynak filtresinden incelenebilir; toplam soru sayısı provider tüketimi olarak adlandırılmaz.
- Zamanlar veritabanında UTC tutulur. Gün sınırları ve ekrandaki saatler **Europe/Istanbul** üzerinden hesaplanır; istek başladığı güne yazılır.
- Bugünün bitiş sınırı ertesi günün başlangıcıdır. Tarih aralığı başlangıcı dahil, bitişi hariç ele alınır.
- Ayrı, drift oluşturabilecek günlük sayaçlar yerine ilk sürümde kalıcı istek tablosundan SQL gruplaması yapılır. Özet ve liste aynı zaman/durum tanımlarını kullanır.
- Veri servisi hatasında panel 0 göstermez; “Veriler yüklenemedi” durumunu gösterir. Devam eden/yarıda kalan istekler başarıya eklenmez.

## 7. API ve dosya planı

| Endpoint | Amaç |
|---|---|
| `GET /api/admin/gekon-ai/settings` | Ayar, kayıt başlangıcı, ayrı servis sağlık bilgisi |
| `PATCH /api/admin/gekon-ai/settings` | `enabled` ve beklenen `version` ile güncelleme |
| `GET /api/admin/gekon-ai/summary?from=...&to=...` | Dönem toplamları ve günlük dağılım |
| `GET /api/admin/gekon-ai/requests` | Tarih/durum/kaynak/arama filtreleri ve sayfalama |
| `GET /api/admin/gekon-ai/requests/{id}` | Tek sorunun detayları |

Tüm yeni admin endpoint'leri sunucuda doğrulanmış admin yetkisi ister ve `Cache-Control: no-store` kullanır. Mevcut projede kimlik entegrasyonu olmadığı için bu doğrulamanın bağlanması ilk teslimin parçasıdır. İstemcinin bildirdiği rol veya yalnız `Host` başlığı yeterli kabul edilmez. Ayar güncellemesinde aynı kaynak/CSRF kontrolü uygulanır.

Önerilen yeni dosyalar:

- `src/features/assistantAdmin/components/GekonAiAdminPanel.tsx`: tek sayfa panel ve detay görünümü.
- `src/features/assistantAdmin/components/gekonAiAdmin.module.css`: mevcut admin tasarımına uygun stiller.
- `src/features/assistantAdmin/services/gekonAiAdminApi.ts` ve `types/`: API istemcisi ve tipler.
- `src/features/assistant/services/assistantAvailability.ts`: sunucu ve istemcinin kullandığı sabit mesaj/sözleşme.
- `src/server/assistant/assistantSettingsRepository.ts`: kalıcı ayar ve değişiklik geçmişi.
- `src/server/assistant/assistantRequestRepository.ts`: soru kaydı, liste ve günlük gruplama.
- `src/server/assistant/assistantRequestService.ts`: açma/kapatma, kayıt ve ortak hata yönetimi.
- `app/api/admin/gekon-ai/*`: yönetim endpoint'leri.

Mevcut sidebar, `IpsApplication`, `/api/assistant` ve sohbet bileşeni güncellenir. Gerekli admin kimlik doğrulama bileşeni mevcut dağıtımın giriş yapısına bağlanır. Python tarafında ikinci bir soru tablosu tutulmaz; kullanıcı sorusu kayıtlarının merkezi uygulamanın ortak giriş noktasıdır.

## 8. Geliştirme sırası ve teslimler

| Sıra | İş | Tamamlanma ölçütü |
|---|---|---|
| 1 | Ortak mesaj, durum/sayaç sözleşmesi, admin yetki doğrulaması ve migration | Veri modeli ve korunan yönetim API temeli hazır |
| 2 | Kalıcı ayar, soru kayıtları, ortak istek servisi | Yerel ve Gemini istekleri kayıtlı; kapalıyken iki yol da duruyor |
| 3 | Sohbet bileşeninde ortak kesinti cevabı | Sunucu/istemci hata senaryolarında aynı mesaj ve sonlu bekleme |
| 4 | Admin menüsü, özet, grafik, filtreli liste ve detay | Tek ekrandan inceleme ve açma/kapatma çalışıyor |
| 5 | Hedefli testler, migration/smoke doğrulaması, kullanım belgesi | Kabul senaryoları sağlanmış, ilk sürüm kullanıma hazır |

İlk sürüm kullanıcı tarafından istenen tüm temel özellikleri içerir. CSV dışa aktarma, token/maliyet raporu, otomatik kota kapatma ve otomatik kayıt temizleme sonraki geliştirmeler olarak değerlendirilir.

## 9. Kabul ve test senaryoları

1. Başarılı yerel konum sorusu ve Gemini sorusu birer kalıcı kayıt oluşturur; soru-cevap ve kaynak doğru görünür.
2. Kullanım dışıyken hem genel soru hem konum sorusu aynı sabit mesajı alır. Yerel sorgu, FastAPI ve provider çağrısı yapılmadığı mock/spies ile doğrulanır.
3. Ayar iki alan adına ve farklı tarayıcılara uygulanır; uygulama yeniden başlatıldığında korunur.
4. Devam eden istek sırasında kapatma yapılırsa üretilen cevap kullanıcıya gönderilmez. Kayıt ve provider denemesi doğru gösterilir.
5. Upstream bağlantı/kota/timeout/bozuk JSON, yerel servis ve beklenmeyen sunucu hatalarında aynı sabit metin gösterilir; teknik hata nedeni admin kaydında bulunur.
6. Tarayıcı ağ kesintisi ve boş/bozuk API cevabında aynı metin gösterilir, gönderme durumu yeniden kullanılabilir hale gelir.
7. Gece yarısından önce/sonra gönderilen sorular İstanbul günlerine doğru ayrılır; boş günler 0 görünür ve durum toplamları uyuşur.
8. Sohbet temizleme admin kayıtlarını ve günlük toplamları değiştirmez. Yeniden başlatma sonrası eski soru kayıtları görünür.
9. Yetkisiz ve demo istemcileri yönetim API'lerinden kayıt okuyamaz veya ayar değiştiremez; yalnızca menü gizleme ile yetinilmez.
10. Veritabanı/ayar okuma/yazma kesintisi sabit cevap üretir; panel sahte sıfır/başarı göstermez. Takılmış `pending` kayıtlarının toparlanması sınanır.
11. Filtreleme, sayfalama, özel karakterli sorular ve farklı ekran boyutları çalışır; soru içeriği HTML olarak yürütülmez.
12. Gekon AI kapalıyken canlı takip, harita ve rota geçmişi çalışmaya devam eder.

Doğrulama için `npm run typecheck`, `npm run lint`, mevcut `npm run test:ai:location` ve yeni yönetim/istek testleri çalıştırılır. Ayrıca ayrı test veritabanında migration ve günlük özet sorguları, tarayıcıda tek sayfa panel ve sohbet akışları doğrulanır.

Yayınlama sırası: migration ve admin erişim doğrulaması → istek/kayıt altyapısı → sohbet ve admin paneli → aktif/kapalı/hata smoke kontrolleri. Bu belge kapsamında dağıtım veya veri değişikliği yapılmaz.
