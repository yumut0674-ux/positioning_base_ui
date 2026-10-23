# Gekon AI yönetimi

Admin menüsündeki **YÖNET → Gekon AI** ekranı günlük istek sayılarını, soru-cevap geçmişini ve kullanım durumunu gösterir. Kullanıcı/demo menüsünde bu yönetim ekranı bulunmaz.

## İlk hazırlık

1. `npm run setup:ai-admin` çalıştırın. Komut mevcut parolayı korur; eksikse rastgele bir yönetim parolası üretip git dışında tutulan `.env.local` dosyasına `GEKON_AI_ADMIN_PASSWORD` olarak ekler. Parolayı konsola yazmaz.
2. Uygulama sunucusunu yeniden başlatın. Üretimde aynı değişkeni servis ortamına tanımlayın. En az 16 karakter kullanın. Bu değişken tarayıcıya gönderilmez.
3. Gekon AI panelini açıp bu parolayla giriş yapın. Oturum 8 saat geçerlidir; “Oturumu kapat” ile sonlandırabilirsiniz. Parolanın değiştirilmesi mevcut oturumları geçersiz kılar.

İlk veritabanı isteğinde `drizzle/0009_assistant_management.sql` idempotent olarak uygulanır. Kontrollü dağıtımda bu SQL dosyası önceden de uygulanabilir. PostgreSQL bağlantısı mevcut `POSTGRES_*` ayarlarını kullanır. Şema yalnız ekleme yapar; takip verilerini değiştirmez.

## Kullanım

- Üst kartlar **bugünü**, grafik seçili tarih aralığını gösterir. İstekler İstanbul saatine göre başladıkları güne yazılır.
- Toplam sayıya başarılı, hatalı ve kullanım dışıyken gönderilen geçerli sorular dahildir. İşleniyor ve yarıda kalan kayıtlar ayrıca belirtilir.
- Boş/bozuk istekler, sağlık sorguları, yönetim sorguları ve sohbet temizleme soru sayılmaz.
- Son 7 / 30 gün kısayolları vardır. Liste 31 güne kadar tarih aralığı, durum, kaynak ve soru metniyle filtrelenir; her sayfa 25 kayıt içerir.
- Bir soruyu açtığınızda tam metin, verilen cevap, kaynak, süre ve teknik notları görürsünüz. Oturum kodu doğrulanmış kişi kimliği değildir.
- **Aktif / Kullanım dışı** seçimini yapıp **Kaydet** düğmesine basın. Ayar veritabanında tutulur ve admin/demo alan adlarındaki tüm kullanıcılar için geçerlidir. Harita, takip ve rota geçmişi çalışmaya devam eder.
- Kullanım dışıyken hiçbir yerel konum veya yeni model isteği başlatılmaz. Devam eden istek kapatma sonrasında kontrol edilir; kullanıcıya üretilen cevap yerine sabit mesaj gösterilir. Başlatılmış model tüketimi geri alınamaz.
- Manuel kapatma veya teknik hata durumunda kullanıcı aynı mesajı alır: **“Gekon AI şu anda aktif değil. Lütfen daha sonra tekrar deneyin.”** Teknik neden yalnız yönetim kayıtlarında bulunur.
- Sohbeti temizlemek admin geçmişini silmez. Eski, kalıcı tutulmamış sorular geriye dönük getirilemez. Panel kayıt başlangıcını gösterir.
- Servis sağlık göstergesi ücretli model isteği göndermez. Servis erişilebilirliği tam yanıt üretimini garanti etmez; yerel konum cevapları ayrı çalışabilir.

## Erişim ve veri

Yönetim API'leri imzalı HttpOnly/SameSite yönetici oturumuyla korunur. Alan adı tek başına erişim izni sağlamaz. Ayar ve giriş işlemleri aynı kaynak kontrolünden geçer. Parola için kısa süreli giriş denemesi sınırı uygulanır.

Kayıtlar soru ve gösterilen cevabı içerir; cookie, API anahtarı, yetki başlığı, ham konum bağlamı ve tam model payload'u saklanmaz. Ekran mesajları HTML olarak çalıştırmaz. İlk sürüm kayıtları otomatik silmez.

Veritabanı veya ayar servisi erişilemezse AI çalıştırılmaz ve aynı kesinti mesajı döner. Veritabanına hiç yazılamayan veya sunucuya ulaşmayan isteğin kalıcı kaydı garanti edilemez. Panel veri hatasında sahte sıfır göstermez. İki dakikadan uzun süre tamamlanamayan kayıtlar panel sorgularında “Yarıda kaldı” olarak toparlanır.

## Kontroller

`npm run test:ai:admin` yönetim, kapatma ve hata davranışlarını sınar. `npm run test:ai:location` mevcut konum cevaplarını doğrular. `npm run typecheck` ve `npm run lint` kod kontrolleridir.

Veritabanı entegrasyon testi için `ASSISTANT_TEST_DB=1` ile `npm run test:ai:admin:db` çalıştırın. Test yalnız kendisi için rastgele adlandırılmış ayrı bir şema oluşturur ve sonunda bu test şemasını kaldırır; gerçek soru kayıtlarına yazmaz. Test kullanıcısının şema oluşturma yetkisi olmalıdır.
