# Raporlama geliştirmesi — 31.10.2026

> 02.11.2026 güncellemesi: Yönetici raporu düğmesi artık kesintisiz aynı konumu birleştiren, oda/koridor/oda sınırlarını koruyan ve minimum süre uygulamayan sade kalış raporunu açar. Güncel davranış için [Yönetici oda ve koridor raporu](yonetici-oda-koridor-2026-11-02.md) belgesine bakın. Aşağıdaki teknik karar dökümü açıklaması ayrı ham JSON/CSV indirmeleri ve eski teknik uç için geçerlidir.

Bu geliştirme yönetici karar raporunu son kullanıcı rota PDF'sinden ayırır. Motor, ham veri kabulü, oda kararı üretimi, canlı harita ve karar saklama mantığı değiştirilmemiştir.

## Kullanım

- **Analizler → Oda Motoru Karar Kayıtları → Yönetici karar raporu:** tarih, tag, harita ve isteğe bağlı oda/aday oda kapsamını seçin. PDF, Excel, CSV veya özgün ayrıntıları koruyan JSON indirin.
- Yönetici çıktısında her kayıtlı karar ayrı satırdır. Süre filtresi, önemli olay elemesi ve ardışık karar birleştirmesi uygulanmaz. Aday, belirsiz, reddedilen ve kayıtlı zamanlayıcı geçişleri dahil edilir. Bildirimler motor kararı olarak sayılmaz.
- Ekrandaki JSON/CSV düğmeleri de seçilen aralığın tüm motor kararlarını sunucudan okur. Tarayıcıya yüklenmiş sayfanın kayıt sayısıyla sınırlı değildir. Tag, harita ve oda kapsamı korunur; karar/ölçüm türü ve önemli olay ekran filtreleri bu indirmelere uygulanmaz.
- Görünen tek zaman sütunu **Karar zamanı (TR)**, motorun yayımlanma zamanıdır. Saniye gösterilir. Excel bu alanı sıralama ve formüller için gerçek tarih hücresi olarak saklar. Kaynaktaki hassasiyet ve diğer zamanlar özgün JSON'da korunur.
- **Ayarlar → Raporlar:** oda ve koridor için iki bağımsız en kısa süre ayarı bulunur. Sınıra eşit kayıt gösterilir; 0 ilgili türün süre elemesini kapatır. Hemşire bankosu gibi atanmış bölgeler oda eşiğini kullanır. Alan çıkışı olayları süre eşiklerinden bağımsızdır.
- 02.11.2026 son kullanıcı düzeltmesi: Normal rota PDF'sinde süre filtresinden sonra aynı gün/kat/konumda ardışık görünen kayıtlar önceki sürümdeki gibi birleştirilir. Kalış süresi yalnızca rapora alınan aralıkların toplamıdır; gizlenen süreler eklenmez. Oda ve koridor için ayrı minimum süre ayarları korunur. Yönetici raporu ise kesintisiz konum aralıklarını ve aradaki oda/koridor/boşluk sınırlarını korumaya devam eder.

## Uyumluluk ve kapsam

Eski `reports.routeHistoryMinDurationMs` okunurken iki yeni alan için aynı değer kullanılır:

- `reports.routeHistoryRoomMinDurationMs`
- `reports.routeHistoryCorridorMinDurationMs`

Örneğin eski 60 saniye → oda 60 saniye, koridor 60 saniye. Ayar dosyası okuma sırasında yeniden yazılmaz. Sonraki kaydetme yeni alanları kullanır; takip ve bildirim ayarları korunur. Kurulu sistemin ayar dosyası bu geliştirme sırasında değiştirilmemiştir.

Yönetici API'si: `POST /api/reports/motor-decisions`. En fazla 7 gün ve 50.000 karar; PDF için 5.000 karar. Sınır aşımında veya bozuk kaynak kaydında eksik dosya başarılı indirme olarak sunulmaz. PDF biçimlendirme/font işleme ayrı Node worker thread'inde yapılır; motorun ana olay döngüsünde çalışmaz.

Raporlama saklanmış kararları ve o anda bekleyen kararların bir kopyasını okur. Zamanlayıcıda üretilip saklanmayan aynı durum tekrarlarının kayıt politikası değişmez. Tarih aralığı yayımlanma zamanına göre belirlenir. Bekleyen/saklanmış aynı karar yalnızca kimliği aynıysa tekilleştirilir; farklı kararlar aynı saniyede görünseler de korunur.

Önceki konuşmadaki aday süresini sonraki oda kalışına katma ve kısa koridoru oda kalışına ekleme kuralları bu kapsamda devreye alınmamıştır. Son kullanıcı raporunun mevcut uygun karar seçimi ve zaman kaynağı korunur.

## Doğrulama

- `npm run test:reports`: 30 test. Ayrı eşikler, eşik sınırları/0, eski ayar geçişi, satır kaybı olmaması, zamanlayıcı kararları, tüm biçimler, kimlikler, hata/sınır davranışı ve rapor üretimi sırasında HMM izolasyonu.
- `npm run typecheck`, değişen dosyalarda ESLint ve `npm run build`.
- Motor/takip: 245 başarılı, canlı DB gerektiren 3 test atlandı.
- Harita: 126 başarılı, 1 test atlandı.
- Bildirimler ve ilgili ayarlar: 23 başarılı.
- Presence ve v4 karşılaştırmaları: 59 başarılı. Bir arşiv karşılaştırması, `config/maps/necmettin-servis/regions.json` dosyasının eski v4 kopyasıyla farklı olması nedeniyle başarısız. Başlangıç SHA-256 özeti mevcut harita ile aynıdır; bu harita farkı geliştirmeden önce de mevcuttur. Arşiv kaynaklarının bağımlılıklarını bulabilmesi için doğrulama sırasında geçici bir modül çözümleme yardımcısı kullanılmış; arşiv uygulaması değiştirilmemiştir.
- 88 motor, takip, konum, harita ve yapılandırma dosyası başlangıç SHA-256 özetleriyle karşılaştırılmış; değişiklik bulunmamıştır.
- Gerçek HBM Mindray Servis kaynak Excel'iyle 4.306 karar, 176 giriş adayı ve 153 reddedilen kayıt dışa aktarılmıştır. Tüm karar kimlikleri ve özgün JSON kayıtları birebir doğrulanmıştır. Excel bağımsız openpyxl okuyucusunda, CSV standart okuyucuda, PDF metni ve sayfa sınırları bağımsız PDF araçlarında kontrol edilmiştir. Kaynak Excel zamanlayıcı kararlarını içermediğinden bu dosya testi canlı DB'deki tüm kararların sayımı değildir.
- Gerçek arayüz bileşenleri ayrı yerel test sayfasında çalıştırılmıştır. Oda 60 sn / koridor 180 sn bağımsız kaydetme ve ekranda 100 kayıt yüklüyken seçilen alt aralığın 2.702 kararının CSV indirilmesi doğrulanmıştır. Bu kontrol canlı veritabanına veya çalışan motor servisine bağlanmamıştır.

Görev başlangıcı dosya özetleri, test günlükleri ve örnek doğrulama çıktıları çalışma alanındaki `outputs/rapor-gelistirme-2026-10-31/` klasöründedir. Gerçek uygulama/servis bu geliştirme için yeniden başlatılmamıştır.
