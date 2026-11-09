# Yönetici oda ve koridor raporu - 02.11.2026

Analizler > Oda Motoru Karar Kayıtları > Yönetici raporu düğmesi artık teknik karar dökümü yerine başlangıç, bitiş, kat, konum, kalış ve karar türü içeren bir oda/koridor raporu indirir. PDF, Excel, CSV ve JSON aynı konum aralıklarını kullanır. Excel ayrıca hesaplanabilir saniye sütunu ve gerçek tarih hücreleri içerir.

## Kalış kuralları

- Bir saat kesintisiz koridor tek satır ve bir saat olarak gösterilir.
- Oda 203 > koridor > oda 203 üç ayrı aralıktır. Koridor kısa olsa da gizlenmez veya oda süresine eklenmez.
- Oda 203 > oda 204 > oda 203 üç ayrı aralıktır.
- Aynı atanmış odada ölçülen/tahmini/çıkış adayı durumları arasında geçiş olması tek başına kalışı bölmez. Karar sütununda ölçülen ve tahmini türler belirtilir.
- Minimum oda veya koridor süresi uygulanmaz. Son kullanıcı raporunun süre ayarları yönetici raporunda kullanılmaz.
- Oda adayı gerçek oda girişi sayılmaz; aday adıyla ve belirsiz durumuyla gösterilir. Konum kaybı veya veri boşluğu koridor olarak doldurulmaz. Bu aralıklar kalışları birbirinden ayırır.
- Kayıtlı `validUntil` ve `uncertainAfter` sınırları dikkate alınır. Yeni ölçüm yoksa tazelik süresi dolan koridor belirsizleşir; oda tahmini varsa belirsizlik sınırına kadar tahmini olarak kalabilir. Bu işlem yalnızca rapor gösterimidir, motora karar yazmaz.
- Zaman sırası `published_at,id` üzerinden belirlenir; zamanlayıcı kararları eski ölçüm zamanına geri taşınmaz. Görünen saatler Türkiye saatiyle saniye düzeyindedir. Süre hesabında milisaniye hassasiyeti korunur.
- Rapor başlangıcından önceki son kayıt sınırdaki konumu belirlemek için okunur. Süreler seçilen aralıkla sınırlıdır; rapor bitişi fiziksel çıkış iddiası değildir. Geçerlilik bilgisi ve sonraki kararı olmayan eski bir son kayıt rapor sonuna kadar uzatılmaz.
- Oda/harita seçimi tam zaman çizelgesi oluşturulduktan sonra uygulanır. Böylece seçilmeyen konumun çıkarılması iki ayrı ziyareti birleştiremez.

## Sınırlar ve değişmeyen bölümler

Yeni uç: `POST /api/reports/admin-route-history`. Seçilen tag ve zaman aralığı için yalnızca `SELECT` çalıştırır. En fazla 7 gün ve başlangıç kaydı dahil 50.000 kaynak kayıt; PDF için 5.000 oluşmuş konum aralığı desteklenir. Sınır aşımında eksik dosya sunulmaz. Son birkaç saniyede henüz veritabanına kaydedilmemiş kararlar bu raporda bulunmaz; kayıt kuyruğu zorla boşaltılmaz.

Karar ekranındaki ayrı JSON/CSV düğmeleri teknik inceleme amacıyla mevcut ham karar indirmelerini korur. Yönetici raporu penceresindeki dört biçim ise sade konum aralıklarıdır.

Motor, oda kararı üretimi, HMM kuralları, canlı harita, kayıt politikası, veritabanı şeması, ortam ayarları ve son kullanıcı raporu değiştirilmemiştir. PDF sayfa hazırlama mevcut ayrı iş parçacığında çalışır.

## Doğrulama

- Raporlar: 43 test başarılı. Bir saat koridor, 500 ms koridor, oda/koridor/oda, farklı odalar/haritalar, adaylık, tazelik sınırları, rapor sınırları, sıfır süreli geçişler, oda seçimi ve dört biçim kontrol edildi.
- Rapor üretimi eklenen HMM örneği, kontrol HMM örneğiyle aynı sonraki kararları ve aynı durumu üretti.
- Ek karar ekranı, kayıt deposu, oda motoru ve çıkış regresyon testleri: 43 başarılı, canlı veritabanına yazan 1 entegrasyon testi çalıştırılmadı.
- TypeScript, değişen dosyalarda ESLint ve üretim derlemesi başarılı.
- Gerçek veritabanından 30.10.2026 11:00-12:00 aralığı yalnızca okunarak doğrulandı. Güncellik sınırlarını aşan dört ölçüm kesintisi koridora eklenmedi.
- Daha önce sağlanan HBM Mindray Servis kaynak verisindeki 4.306 karar 110 konum aralığına dönüştü. Kaynak değişmedi ve altı saatlik kapsam boşluk/belirsizlik satırlarıyla birlikte eksiksiz korundu. Bu Excel kaynağı zamanlayıcı kayıtlarını içermediğinden canlı DB ile aynı veri kümesi olduğu ileri sürülmez.
- Excel bağımsız openpyxl okuyucusuyla, CSV standart okuyucuyla ve PDF metni/sayfa sınırları PDF araçlarıyla doğrulandı. PDF sayfaları görsel olarak incelendi.

Doğrulama çıktıları ve görev başındaki kaynak dosya özetleri `../../outputs/yonetici-rota-2026-11-02/` çalışma klasöründedir. Çalışan uygulama bu geliştirme için yeniden başlatılmadı.
