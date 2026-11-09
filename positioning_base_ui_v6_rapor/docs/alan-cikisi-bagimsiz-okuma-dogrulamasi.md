# Alan çıkışının bağımsız okunması — 26.10.2026

Çıkış gösterimi için eklenen `lastDecision` kaydı ve ölçüm zamanı filtresi kaldırıldı. `TagPresenceService.ts`, `tagPresenceRuntime.ts`, `tagPresenceRepository.ts` ve `tagPresence.types.ts`, incelenen v4 kaynaklarıyla byte düzeyinde aynıdır. Karar kabulü yeniden v4'teki harita ve yayın sırası kontrollerini kullanır. Eski ölçüme dayanan yeni motor yayınları engellenmez. Başlangıçta arşiv kararları presence servisine yeniden uygulanmaz.

## Çıkış bilgisinin yolu

- `AreaExitReader`, mevcut `tag_room_decisions` tablosunu yalnız SELECT ile okur. Arşivin henüz veritabanına yazılmamış yayınlarını da salt okunur snapshot üzerinden değerlendirir. Yeni tablo açmaz; motoru veya presence servisini çağırmaz.
- `/api/tracking/area-exits`, istenen kayıtlı tagların son yayınından alan, kapı ve çıkış zamanını döndürür. Daha yeni içeri dönüş kararı önceki çıkışın güncel durum olarak gösterilmesini kaldırır.
- İstemci, çıkış geçmişini ayrı `areaExitByTag` alanında tutar. Bu alanın güncellenmesi tag koordinatlarını, oda atamalarını, ham veri saatlerini, harita durumunu ve presence kayıtlarını değiştirmez.
- Arayüz öncelikle normal takip akışında zaten bulunan çıkış kararını gösterir. Veri kesilip tag pasife düşse veya haritada gizlense de bu bilgi korunur; bunun için arşiv sorgusu yapılmaz.
- Canlı çıkış kararı ve geçerli oda ataması bulunmayan tag pasife geçerse, o pasif gözlem için arşivden bir kez okuma yapılır. Sayfa zaten pasif taglarla açıldığında da aynı kural uygulanır. Periyodik çıkış sorgusu veya arka planda tekrar deneme zamanlayıcısı yoktur. Yeni ham veriyle başlayan ayrı bir pasif dönem yeniden tek okuma yapabilir. İstekler en fazla 200 tag içerir; geç gelen cevaplar yeni ham veri veya canlı kararı geçersiz kılamaz.
- AI aynı okuma servisini kullanır. Varlığın mevcut tag atamasından eski çıkışlar güncel varlığın çıkışı olarak sunulmaz.
- Önceki rapor kapsamı korunur. Çıkış okuma servisi rapor veya oda motoru hesaplaması yapmaz.

## v4 ile karşılaştırma

Referans: çalışma alanındaki `inceleme/v4-v5/kaynaklar/positioning_base_ui_v4`. `tests/v4PresenceParity.test.ts`, bu klasördeki gerçek v4 motorunu ve presence sınıfını ayrı örnekler olarak yükler. Her iki sürüm aynı saatle ve aynı ham ölçümlerle çalışır.

| Senaryo | Ham ölçüm | Eşleşen tam motor yayını |
| --- | ---: | ---: |
| Oda 7 kapısına yaklaşma, 60 saniye tekrarlanan koordinat | 91 | 93 |
| Oda 4, 120 saniye tekrarlanan koordinat | 200 | 201 |
| Oda 4, 120 saniye düşük anchor verisi | 200 | 201 |
| Alan kapısından çıkış ve 90 saniye veri kesintisi | 48 | 138 |
| Toplam | 539 | 633 |

Her yayının tam payload'u karşılaştırılır: oda, durum, güven, koordinatlar, gerekçeler ve zamanlar dahil. Her adımda presence snapshot'ları da, yalnız rastgele sunucu epoch kimliği dışarıda bırakılarak karşılaştırılır. Fark bulunmadı. Oda 7'nin `INFERRED_IN_REGION / room-07` kararı v5 presence kaydına da uygulanır.

İki motor kaynak dosyası ile servis/yoğun bakım harita ve motor ayar dosyalarının da v4 ile byte düzeyinde aynı olduğu test edildi.

## Diğer doğrulamalar

71 otomatik test geçti; başarısız veya atlanan test yok. Mevcut canlı çıkış kararıyla hiç arşiv isteği oluşmadığı, eksik karar için pasife geçişte tek istek seçildiği ve aynı tag pasif kaldıkça isteğin tekrarlanmadığı test edildi. Çıkış okuma başarısı/hatasında takip nesnelerinin değişmediği, eski okuma cevabının yeni girişin üstüne yazılmadığı, kalıcı ham kayıtların korunduğu, Pacemaker 2'nin gerçek 18:50 kayıtlarıyla masaüstü/mobil bileşen metninin doğru olduğu ve rapor/AI davranışları kontrol edildi. İlgili TypeScript kontrolü sıfır hata ile tamamlandı.

Canlı tagların (mevcut çıkış kararı dahil) ve çıkış kaydı olmayan pasif tagların masaüstü/mobil bileşen HTML çıktısı gerçek v4 bileşenleriyle birebir karşılaştırıldı. Çıkışsız pasif satırlarda v4'ün "Son görüldüğü yer" başlığı korunur. Yeni çıkış gösterimi yalnız pasif taglarda uygulanır; canlı tagların standart gösterim yolu korunur.

Karşılaştırma testi `test:presence` komutuna eklendi. V4 referansı başka bir klasördeyse `V4_REFERENCE_ROOT` ortam değişkeniyle belirtilebilir. Referans bulunmazsa yalnız karşılaştırma testleri atlanır; bu doğrulamada referans mevcut olduğu için hiçbiri atlanmadı.

Testlerde mevcut yerel bağımlılıklar kullanıldı. Canlı uygulama, tarayıcı, Jetson ve PostgreSQL sunucusu başlatılmadı. SQL okuması enjekte edilen sorgu cevaplarıyla test edildi; canlı PostgreSQL entegrasyonu bu doğrulamaya dahil değildir.
