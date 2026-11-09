# Alan çıkış bildirimleri

1. Hızlı geçiş listesinin kullandığı `buildTagQuickList` ve `roomDecisionLabel` sonucunu pasif olarak gözlemle. `outsideArea` / `leftAreaAt` varsa motorun yayımladığı değerleri kullan; yeni konum, oda veya çıkış kararı üretme.
2. Oda motorundan bağımsız sunucu zamanlayıcısıyla kesintisiz alan dışında kalma süresini izle. İçeri dönüşte beklemeyi sıfırla; aynı çıkışta tek bildirim üret. Tarayıcı açık olmasa da izle ve kaydet.
3. Ayarlar → Bildirimler bölümüne bekleme ve görünme sürelerini ekle (varsayılan 5 ve 10 saniye). Tag yönetiminde her tag için varsayılan açık bildirim seçimi sun.
4. Bildirimleri ayrı PostgreSQL tablosuna kaydet. Bekleyen kayıt ve gözlem durumunu yerel dosyada koruyarak veritabanı kesintisinde yeniden dene. Motorun karar tablolarını ve algoritmalarını değiştirme.
5. Haritanın sol altında tag adı/kodu, bilinen çıkış alanı ve çıkış saatini göster. Süre dolunca veya çarpıya basılınca kapat. Kapatma geçmiş kaydını silmesin.
6. Analizlerin mevcut karar türü filtresine “Bildirim” ekle; tag, zaman, harita ve alan filtrelerini, ayrıntı ve dışa aktarmayı destekle.
7. Zaman sınırı, hızlı geri dönüş, tekrar giriş/çıkış, tag seçimi, eski ayarlar, kayıt hatası/yeniden başlatma ve filtre/sayfalama senaryolarını test et. Tür kontrolü ve üretim derlemesini çalıştır.

Çıkış saati motorun `leftAreaAt` değeridir; bu değer yoksa mevcut alan dışı sonucunun ilk gözlendiği saattir ve ayrıntıda bu kaynak açıkça belirtilir. Önceki alan bilinmiyorsa alan adı uydurulmaz. Eksik harita yapılandırması, belirsiz kat veya yalnızca bağlantı kesilmesi alan çıkışı sayılmaz.

## Uygulama ve kullanım

Plan uygulandı. Oda motorunun algoritma, durum veya konum üretim kodu değiştirilmedi. Mevcut tag-presence yayını yalnızca kuyruğa alınır; aynı hızlı geçiş birleştirme ve etiketleme yardımcıları bildirim zamanlayıcısında okunur.

- **Ayarlar → Bildirimler:** Alarm üretmeden önce bekleme süresi (varsayılan 5 sn, 0–86400 sn) ve ekranda kalma süresi (varsayılan 10 sn, 1–86400 sn).
- **İzlenen Varlıklar:** Tablodaki “Alan çıkış bildirimi” kutusu veya tag düzenleme formundaki seçenek. Mevcut ve yeni kayıtlı taglarda varsayılan açıktır. Kaydı olmayan yayıncılar önce kaydedilir.
- **Canlı Harita:** Sol altta tag, bilinen alan ve Türkiye saatine göre çıkış zamanı. Çarpı geçmişi silmez. Ekranda kalma süresi tarayıcının bildirimi ilk aldığı andan itibaren sayılır; yenileme istekleri bu süreyi uzatmaz.
- **Analizler → Karar türü → Bildirim → Uygula:** Tag, tarih aralığı, harita ve oda/alan kimliğiyle filtrelenir. Ayrıntıda çıkış zamanı, bildirim zamanı, kaynak sonuç ve süreler görülür. JSON/CSV dışa aktarma desteklenir.

Ayarlar ve tag tercihleri arka planda 2 saniyede bir yenilenir. Bildirim zamanlayıcısı 250 ms, haritanın bildirim sorgusu 500 ms aralıkla çalışır. Bekleyen alarmlar güncel bekleme süresini, oluşturulan bildirimler oluşturuldukları andaki görünme süresini kullanır.

Bildirimler `area_exit_notifications` tablosunda tutulur. `0011_area_exit_notifications.sql` yeniden çalıştırılabilir; bildirim deposu ilk kullanımında şemayı hazırlar ve mevcut migration komutu da dosyayı içerir. `.data/area-exit-notifications.json` bekleyen kayıtları ve tekrar alarmı engelleyen durumu atomik olarak korur. Veritabanı hatasında kayıt yeniden denenir; haritada depolama uyarısı gösterilir. Bu dosya kaynak kontrolüne dahil edilmez.

## Doğrulama

- `npm run test:notifications`: 22 test geçti; süre sınırı, hızlı geri dönüş, tekrar giriş/çıkış, kapalı tag, belirsiz konum, eski ayarlar, veri kesintisi, yeniden başlatma, veritabanı hatası/iyileşmesi ve analiz sayfalaması kapsandı.
- Mevcut `npm run test:tracking`: 245 test geçti, 3 veritabanı testi atlandı.
- İlgili tag/presence/arayüz regresyonları geçti. TypeScript kontrolü, değişen dosyalarda ESLint ve üretim derlemesi başarılı.
- Tarayıcıda varsayılan 5/10 saniye ayarları, yeni tagın seçili kutusu ve “Bildirim” filtresi doğrulandı. Ayrı örnek verili önizlemede çarpıyla kapatma, yenilemeden sonra kapalı kalma ve otomatik kapanma doğrulandı.
- Bu yerel v4 kopyasında çalışan veritabanı ve canlı tag akışı bulunmadığı için gerçek PostgreSQL kaydı ve saha çıkışıyla uçtan uca doğrulama yapılmadı. SQL deposunun testlerinde sorgu bağımlılığı taklit edildi; üretim verisi oluşturulmadı.

İsteğe bağlı yerel görsel test: proje kökünde `node node_modules/vite/bin/vite.js --config output/notification-preview/vite.config.mts` komutuyla `http://127.0.0.1:3105/` açılır. Bu önizleme yalnızca örnek veri kullanır; uygulamanın kayıtlarına erişmez.
