# Admin paneli: Oda Test Kaydı geliştirme planı

Tarih: 10 Ekim 2026

Referans: `C:\Users\1548u\Downloads\oda_test_kayit (2).html`

Amaç: Saha operatörünün bir tag'ın gerçekte hangi odada bulunduğunu elle işaretleyebildiği, giriş/çıkış zamanlarını kaydedebildiği ve test sonucunu dışa aktarabildiği yeni bir admin ekranı oluşturmak. Bu kayıtlar, mevcut oda tespit motorunun sonuçlarını değerlendirmek için referans veri olarak kullanılacak.

Uygulama durumu (10 Ekim 2026): Admin menüsü, kayıt servisi, kalıcı geçmiş, yerel kurtarma, JSON/benchmark çıktıları, özel plan editörü, sıralı rota ve desteklenen tarayıcılarda canlı dosya yazımı uygulandı. Bilgi düzeltmeleri ayrı PATCH yerine revizyonlu `tags` komutuyla aynı olay API'sinden yapılır. Kullanım ve çalıştırma bilgileri `docs/oda-test-kaydi-kullanim.md` içindedir. Aşağıdaki kapsam ve tasarım, geliştirmede kullanılan planı belgeler.

## 1. İncelemeden çıkan mevcut durum

- Referans HTML; kat/alan seçimi, oda kartları, tag kimliği, başlat/durdur/sürdür, yeni test, son geçişi geri alma, durum kartı, olay terminali, ziyaret tablosu ve kayıt geçmişi içeriyor.
- Kat planında oda, koridor, kat girişi ve kat çıkışı tanımlanabiliyor. Plan JSON olarak yüklenip indirilebiliyor. Test başladıktan sonra plan değiştirilemiyor.
- Ziyaret çıktısında `room`, `entered_at`, `exited_at`, `duration_seconds` alanları var. Tag ve test bilgileriyle birlikte çıktı veya yalnızca ziyaret dizisi seçilebiliyor. Tam oturum ayrıca planı ve olayları içeriyor.
- Kayıtlar HTML örneğinde tarayıcının localStorage alanında tutuluyor. Destekleyen tarayıcılarda seçilen JSON dosyası canlı güncellenebiliyor.
- HTML içinde ayrı bir iframe ile açılan eski “Sıralı rota” modu da bulunuyor. İki modun aynı anda kayıt yapması engelleniyor.
- Mevcut proje React/TypeScript ve Vinext kullanıyor. Admin paneli `AppSidebar.tsx` içindeki `WorkspaceView` ve `IpsApplication.tsx` içindeki görünüm seçimiyle çalışıyor.
- Harita kataloğu, haritaya bağlı oda/bölge yapılandırmaları, tag listesi ve PostgreSQL erişimi mevcut. `tools/room-benchmark` gerçek ziyaret aralıklarıyla oda motorunu değerlendiren ayrı bir araç içeriyor.

## 2. Önerilen ürün kapsamı

Menü adı **Oda Test Kaydı**, çalışma alanı kimliği `room-tests` olsun. “İNCELE” bölümünde Analizler'in yanında yer alsın. Ekranın düzeni referans HTML'e yakın tutulurken admin panelinin mevcut başlığı, menüsü, ikonları ve bileşen dili kullanılsın.

İlk kullanılabilir sürüm, mevcut sistem haritalarıyla gerçek saha testi yapılmasını tamamlamalı. HTML'deki özel plan editörü, sıralı rota modu ve canlı dosya yazımı ikinci teslimde eklenerek referansın tamamı karşılanmalı.

| Özellik | İlk teslim | İkinci teslim |
|---|---|---|
| Admin menüsüne entegrasyon | Evet | — |
| Test adı, tag seçimi, bina/kat/birim seçimi | Evet | Birlikte taşınan tag grupları |
| Mevcut odaları/koridorları kartlarla seçme ve arama | Evet | Özel plan alanları |
| Başlat, duraklat, sürdür, bitir, yeni test | Evet | — |
| Oda girişi/çıkışı, son geçişi geri alma | Evet | — |
| Aktif alan, süre, ziyaret sayısı, terminal ve tablo | Evet | — |
| Sunucuda geçmiş, yerel kurtarma ve JSON çıktısı | Evet | — |
| Mevcut benchmark biçimine dönüştürme | Evet | Panelden benchmark çalıştırma ayrı kapsam |
| Özel kat planı düzenleme ve JSON içe aktarma | — | Evet |
| Sıralı rota modu | — | Evet |
| Tarayıcıda seçilen dosyayı canlı güncelleme | — | Evet |

Önerilen temel karar: Gerçek sistem testlerinde oda adından kimlik üretmek yerine mevcut `mapId` ve `region.id` kullanılsın. Özel planlar test şablonu olarak saklansın; canlı harita ve oda geometrisini değiştirmesin.

## 3. Kullanıcı akışı ve kayıt kuralları

1. Operatör yeni test oluşturur; test adını, haritayı ve taşıdığı tag'ı seçer. Tag listesinde ad ve gerçek tag kodu birlikte gösterilir. Kimliği bilinmeyen tag için doğrulanmamış test açılabilir.
2. Kaydı başlatır. O anda kullanılan harita/bölge yapılandırmasının kopyası oturuma eklenir; kayıt geçmişi bu kopyayı kullanır.
3. İlk oda veya koridor kartına basar. Alanın giriş zamanı kaydedilir.
4. Başka bir alana bastığında önceki ziyaret kapanır ve yeni ziyaret aynı zaman damgasıyla açılır. Tek geçiş tek işlem olarak kaydedilir.
5. Aktif odaya yeniden basmak veya “Odadan çıktım” düğmesini kullanmak çıkışı kaydeder. Açıkça tanımlanmış tek koridor bağlantısı varsa koridora geçilir; diğer durumlarda konum “Bilinmiyor” olur. Sistem oda çıkışından rastgele koridor seçmez.
6. Kat/harita seçimini değiştirmek yalnız görüntülenen kartları değiştirir. Gerçek geçiş, yeni alan seçildiğinde kaydedilir. Ziyaretlerin kimliği `mapId + areaId` üzerinden belirlenir.
7. “Duraklat” açık ziyareti kapatır. “Sürdür” yeni kayıt parçası açar ve operatörden bulunduğu alanı yeniden seçmesini ister. Bekleme süresi kayıt süresine eklenmez.
8. “Testi bitir” açık ziyareti kapatır ve testi tamamlar. Sonradan düzeltme gerekiyorsa revizyon ve açıklama kaydedilir.
9. JSON indir/kopyala veya geçmişten görüntüle işlemleri yapılabilir. “Yeni test” önceki testi silmez.

HTML'deki “Durduruldu” durumu hem ara verme hem sonlandırma için kullanılıyor. Yeni ekranda bu ayrım açık olmalı: `draft → running → paused → running → completed`.

Son geçişi geri alma, önceki çıkış ve yeni giriş olayını birlikte geri çevirmeli. Sunucudaki olaylar fiziksel olarak silinmek yerine düzeltme olayıyla geçersiz kılınmalı. Böylece testin nasıl düzeltildiği izlenebilir.

## 4. Ekran ve uygulama yapısı

Üst bölümde test/tag bilgileri ve kayıt kontrolleri; sol bölümde harita/kat seçimi, arama ve alan kartları; sağ bölümde aktif alan, sayaçlar ve olay terminali; alt bölümde ziyaret tablosu olsun. Ayarlar, geçmiş ve dışa aktarma yan panel veya modal ile açılsın. Mobilde aktif durum ve kayıt düğmeleri kolay erişilebilir kalmalı.

| Dosya/alan | Planlanan görev |
|---|---|
| `src/app/components/AppSidebar.tsx` | `room-tests` görünümü ve menü öğesi |
| `src/app/IpsApplication.tsx` | Admin görünümüne ekleme, gerektiğinde yükleme, kayıt durumunun menü geçişlerinde korunması |
| `src/features/roomTests/components/` | Panel, kayıt araçları, alan kartları, durum kartı, terminal, ziyaret tablosu ve diyaloglar |
| `src/features/roomTests/types/` | Oturum, olay, ziyaret ve çıktı tipleri |
| `src/features/roomTests/services/` | Kayıt durum makinesi, plan dönüştürme, yerel kuyruk, API istemcisi ve JSON çıktısı |
| `src/server/roomTests/` | Doğrulama, oturum servisi, PostgreSQL repository ve benchmark dönüştürücüsü |
| `app/api/room-tests/` | Oturum/geçmiş/olay/dışa aktarma uçları |
| `drizzle/0008_room_test_sessions.sql` | Geliştirme sırasında sıranın hâlâ uygun olduğu kontrol edilerek yeni tablolar |
| `tests/roomTests*.test.ts` | Kayıt davranışı, veri doğrulama, kalıcılık ve dışa aktarma testleri |

HTML'in doğrudan iframe içinde taşınması yerine işlevleri React bileşenlerine aktarılmalı. İkinci teslimde sıralı rota da aynı kayıt servisini kullanmalı; iki ayrı oturum ve saklama mantığı oluşmamalı.

## 5. Veri modeli ve API

**Oturum:** `id`, `schemaVersion`, `name`, `status`, `tagCodes`, `tagVerification`, `timezone`, `startedAt`, `endedAt`, `recordingSegments`, `planSnapshot`, `configHash`, `revision`, `revisionReason`.

**Olay:** `eventId`, `actionId`, `sessionId`, `sequence`, `type`, `occurredAt`, `receivedAt`, `mapId`, `areaId`, `payload`. Gereken türler: başlatma, giriş, çıkış, bilinmeyen konum, duraklatma, sürdürme, tamamlama, geri alma ve tag düzeltme.

**Ziyaret:** `id`, `mapId`, `floorId`, `areaId`, `areaName`, `areaType`, `enteredAt`, `exitedAt`, `durationSeconds`. Aktif ziyarette çıkış ve süre `null` kalır. Ziyaretler olaylardan türetilir; iki ayrı doğruluk kaynağı oluşturulmaz.

Oturumlar ve sıralı olaylar PostgreSQL'de saklansın. Ayrı ziyaret tablosu başlangıçta gerekli değil; ihtiyaç görülürse okunabilir bir özet eklenebilir.

| API önerisi | Görev |
|---|---|
| `GET /api/room-tests` | Sayfalı oturum listesi ve filtreler |
| `POST /api/room-tests` | Test oluşturma |
| `GET /api/room-tests/:id` | Oturum, plan kopyası, olaylar ve ziyaretler |
| `POST /api/room-tests/:id/actions` | Kayıt komutlarını sırayla ve atomik uygulama |
| `PATCH /api/room-tests/:id` | İzin verilen bilgi düzeltmeleri ve revizyon |
| `GET /api/room-tests/:id/export?format=…` | Ziyaret dizisi, testli çıktı, tam oturum veya benchmark çıktısı |

Komutlarda istemci üretimi benzersiz `actionId` ve beklenen oturum sürümü bulunmalı. Tekrar gönderilen komut aynı sonucu dönmeli; çift kayıt oluşturmamalı. Eski sürümle farklı sekmeden gelen değişiklik sessizce üzerine yazılmamalı. Çıkış/giriş çifti tek veritabanı transaction'ında uygulanmalı.

Mevcut `GET /api/maps`, `GET /api/maps/:mapId/regions` ve `GET /api/tags` veri kaynakları kullanılmalı. Manuel test kayıtları mevcut oda motorunun karar tablolarından ayrı tutulmalı.

## 6. Kayıt güvenilirliği ve zaman

- Her kullanıcı işlemi önce IndexedDB'de yerel kuyruğa yazılır, ardından sunucuya gönderilir. Arayüz “Sunucuya kaydedildi” ile “Yerelde bekliyor” durumlarını ayrı gösterir. localStorage yalnız küçük arayüz tercihlerine ayrılır.
- Bağlantı kesildiğinde kayıt devam edebilir. Bağlantı döndüğünde olaylar sıralı ve tekrarsız gönderilir. Sunucu hatasında operatör yerel tam oturumu indirebilir.
- Sayfa yenilenince yerel kuyruk ve sunucu oturumu birleştirilir. Yenileme boyunca fiziksel konum gözlenmediği için kör aralık otomatik ziyaret olarak uzatılmaz; operatör yeniden alan seçer ve aralık işaretlenir.
- Menüden başka panele geçmek oturumu sıfırlamaz. Aktif kayıt göstergesi ve sayfadan çıkış bildirimi bulunur.
- Aynı oturum için tek yazıcı sekme kullanılır; diğer sekmeler görüntüleme moduna geçer. Sürüm kontrolü sunucuda da uygulanır.
- Kanonik tarihler UTC ISO 8601 ve milisaniyeyle saklanır; kullanıcıya `Europe/Istanbul` saatinde gösterilir. Sunucunun alış zamanı ayrıca saklanır; elle işaretlenen olay zamanı bununla değiştirilmez.
- Başlangıçta cihaz/sunucu saat farkı ölçülür. Süre hesabında monoton saat kullanılır; cihaz saatinin geri gitmesi ve çevrimdışı zaman belirsizliği kayda alınır. Milisaniyeli çıktı, operatörün milisaniye doğruluğunda gözlem yaptığı anlamına gelmez.

## 7. JSON ve benchmark uyumu

Üç mevcut çıktı korunmalı: dört alanlı ziyaret dizisi; test/tag bilgileriyle ziyaretler; plan, ziyaretler ve olaylarla tam oturum. Yeni tam oturum sürümlü şema kullanmalı. Eski saat biçimi gerekiyorsa açıkça `Europe/Istanbul` saatine dönüştürülmüş uyumluluk çıktısı sunulmalı.

Benchmark dönüştürücüsü mevcut `Truth` modelindeki `testId`, `timezone`, `revision`, `revisionReason`, `test`, `visits` ve `groups` alanlarını üretmeli. İsimle tag eşleştirmek yerine kaydedilen gerçek tag kodu kullanılmalı. Fiziksel taşıma doğrulanmamışsa `groups` boş kalmalı ve test “puanlanmadı” olarak işaretlenmeli.

Önemli uyum konusu: Mevcut benchmark oda ziyaretleri arasındaki boşlukları koridor kabul ediyor. Yeni kayıt ekranında duraklatma, konumun bilinmemesi ve sayfa kapalıyken geçen süre de boşluk oluşturabilir. Bunlar koridor diye puanlanmamalı. İlk teslimde yalnız kesintisiz ve konumu doğrulanmış kayıt parçaları ayrı benchmark testlerine dönüştürülmeli; uygun olmayan parçalarda neden gösterilmeli. Tek parçada bilinmeyen süre varsa önce manuel düzeltme gerekmeli. Çok haritalı testler harita bazında bölünmeli; tek replay'e farklı haritaların oda kimlikleri verilmemeli.

Tamamlanmamış aktif ziyaret, final benchmark çıktısına alınmamalı. Özel planın odaları sistem oda kimlikleriyle eşleştirilmemişse benchmark dışa aktarma kapalı olmalı; normal JSON indirme açık kalmalı.

İlk teslim benchmark uyumlu dosya üretir. Ham paketleri DB'den toplama, replay başlatma ve sonucu panelde gösterme ek bir geliştirmedir; arayüzden doğrudan CLI komutu çalıştırma yoluna gidilmemeli.

## 8. Geliştirme sırası ve tahmini efor

| Aşama | İş | Bitiş ölçütü | Tahmini efor |
|---|---|---|---|
| 1 | Tipler, durum makinesi, olay ve çıktı sözleşmesi | Geçiş/pause/undo kuralları testlerle net | 0,5–1 gün |
| 2 | Admin menüsü ve referansa uygun React ekranı | Harita ve tag verisiyle panel çalışıyor | 1–1,5 gün |
| 3 | PostgreSQL, API, yerel kuyruk ve kurtarma | Yenileme/bağlantı kesintisinde kayıt korunuyor | 1,5–2 gün |
| 4 | Geçmiş, JSON çıktıları ve benchmark dönüştürme | Gerçek oda kimlikleriyle doğrulanmış çıktı | 0,5–1 gün |
| 5 | Saha akışı, mobil kontrol ve regresyon doğrulaması | İlk teslim kabul ölçütleri karşılanıyor | 1 gün |
| 6 | Özel plan editörü, sıralı rota ve canlı dosya | Referansın kalan işlevleri ortak modele taşındı | 1,5–2,5 gün |

Tek geliştirici için ilk teslim yaklaşık **4,5–6,5 iş günü**, referansın tamamı yaklaşık **6–9 iş günü**. Bunlar kapsam tahminidir; mevcut altyapı çalışır durumda kabul edilmiştir. Yeni kullanıcı/rol yönetimi ve panel içinden benchmark çalıştırma bu süreye dahil değildir.

İkinci teslimde özel plan JSON'u şema, tekrar eden kimlik, bağlantı ve boyut sınırlarıyla doğrulanmalı. İçe aktarma önce önizleme göstermeli. Başlamış testin planı kilitli kalmalı. Canlı dosya yazımı desteklenmeyen tarayıcılarda normal JSON indirme sunulmalı.

## 9. Kabul ve doğrulama ölçütleri

- Yeni menü yalnız admin arayüzünde görünür. Mevcut domain ayrımı bir kullanıcı yetkilendirme sistemi değildir; özellik bu mevcut erişim modeliyle entegre edilir. Gerçek rol kontrolü istenirse API uçlarını da kapsayan ayrı iş olarak planlanır.
- Bir oturumda aynı anda en fazla bir açık ziyaret vardır. Farklı haritalarda aynı oda kimliği çakışmaz.
- Oda A → Oda B geçişinde A'nın çıkışı ve B'nin girişi aynı zaman damgasını kullanır. Son geçişi geri alma iki değişikliği birlikte geri çevirir.
- Duraklatma açık ziyareti kapatır; sürdürme bekleme süresini oda ziyareti veya koridor süresi saymaz.
- Çift tıklama, tekrar gönderim ve sırası değişen ağ istekleri aynı ziyareti çoğaltmaz. Negatif süre ve geriye giden olay sırası reddedilir.
- Menü değişimi, yenileme, ağ kesintisi ve birden fazla sekme senaryolarında veri korunur ve kayıt durumu anlaşılır kalır.
- Test sırasında plan değiştirilemez. Daha sonra canlı plan güncellense bile geçmiş testin oda adları, kimlikleri ve yapılandırma kopyası korunur.
- Tag düzeltmesi gerçek kodla, revizyonla ve açıklamayla saklanır. Doğrulanmamış tag resmi benchmark puanı üretmez.
- Aktif ziyaret JSON'unda çıkış/süre `null` olur. Eski dört alanlı çıktı korunur; tam oturum tekrar okunabilir.
- Benchmark çıktısı UTC ve doğru oda kimliklerini kullanır; pause/bilinmeyen aralıkları koridor diye değerlendirmez.
- Mobilde kayıt başlatma, oda değiştirme, çıkış ve durdurma işlemleri rahat kullanılabilir; klavyeyle erişim ve görünür odak bulunur.

Doğrulama: Durum makinesi, tekrar gönderim, transaction, zaman/JSON dönüşümü ve benchmark boşlukları için odaklı Node testleri; sunucu HTML/admin görünüm kontrolü; masaüstü ve mobil tarayıcıda gerçek akış kontrolü. Sonrasında `npm run typecheck`, `npm run lint`, `npm test` ve mevcut `tools/room-benchmark/benchmark.test.ts` çalıştırılır. Test/harita bağlantılarında değişiklik olduysa ilgili `test:maps` ve `test:tracking` kontrolleri de çalıştırılır.

## 10. Teslim çıktıları

İlk teslim: Admin ekranı, kayıt servisi, migration, kalıcı geçmiş, yerel kurtarma, üç JSON çıktısı, benchmark dönüştürücüsü, odaklı testler ve kısa kullanım belgesi.

İkinci teslim: Özel kat planı editörü ve içe/dışa aktarma, ortak servisle çalışan sıralı rota modu, desteklenen tarayıcılarda canlı dosya yazımı ve bunların kabul kontrolleri.

Koda başlamadan uygulanacak varsayımlar: Menü “İNCELE” bölümüne eklenecek; sistem haritaları varsayılan kaynak olacak; kayıtlar PostgreSQL'de tutulacak; ilk teslim tek tag ile çalışacak; HTML'deki özel plan ve sıralı rota işlevleri ikinci teslimde tamamlanacak.
