# Filtreler, bölgeler ve oda modu kullanım kılavuzu

**Proje:** GEKON IPS / UWB konum takibi  
**İnceleme tarihi:** 16 Eylül 2026  
**Kapsam:** Çalışma alanındaki mevcut kaynak kodu ve kayıtlı yapılandırma. Canlı sunucunun açık/kapalı durumu veya fiziksel saha başarımı bu doküman için ölçülmemiştir.

## 1. Sistem genel olarak nasıl çalışır?

UWB cihazından gelen tag koordinatı, cihazın ölçülen konumudur. Sistem bu konumu haritada gösterirken alan sınırlarını kontrol eder, gerektiğinde hareketi yumuşatır ve oda tespit motoru açıksa tag'in hangi odada bulunduğunu değerlendirir.

Burada dört farklı kavram vardır:

| İşlem | Cevapladığı soru | Sonuç |
|---|---|---|
| Bölge tanımı | Haritadaki oda ve koridorlar nerede? | Çokgen sınırlar, oda merkezi ve kapılar tanımlanır. |
| Oda tespit motoru | Tag gerçekten bu odada mı? | Ölçüm geçmişine göre oda kararı veya belirsizlik üretilir. |
| Harita gösterim filtresi | Bu konum haritada gösterilebilir mi? | Tanımlı alan dışındaki işaret önce bekletilir, sonra gizlenir. |
| Yumuşatma ve animasyon | İşaret iki konum arasında nasıl hareket etsin? | Küçük titreşimler azaltılır ve hareket ara karelerle gösterilir. |

Basitleştirilmiş akış:

```text
Ham UWB ölçümü
  ├─ Ham ölçüm geçmişi ve tag keşfi
  └─ Oda motoru kapalı → ham konum
     Oda motoru açık  → oda kararı + gösterim konumu
                            ↓
                  Tanımlı alan kontrolü
                            ↓
            Uygun yumuşatma / hareket animasyonu
                            ↓
                       Harita işareti
```

**Haritada görünen nokta her zaman son ham ölçüm değildir.** Oda merkezi, son geçerli konumda bekletilen nokta veya animasyonun ara noktası olabilir.

## 2. Bölge nedir, oda ile koridorun farkı nedir?

Bölge, harita üzerinde çizilen kapalı bir çokgendir. En az üç köşesi bulunur. Bölgelerin birleşimi, tag işaretlerinin gösterilebileceği alanı oluşturur. Sadece oda çizmek yeterli değildir; koridorda hareketi görmek için koridorların da çizilmesi gerekir.

| Alan | Anlamı |
|---|---|
| `id` | Bölgenin benzersiz kimliği; kapı bağlantılarında da kullanılır. |
| `name`, `color` | Arayüzdeki ad ve renk. Renk karar algoritmasını etkilemez. |
| `kind` | `room`: oda; `corridor`: hareketli takip yapılan koridor. |
| `polygon` | Bölge sınırlarını oluşturan köşeler. |
| `roomCenter` | Oda kararı verildiğinde işaretin gösterileceği temsil noktası. |
| `entrances` | Kapı noktaları ve varsa yönlü geçiş geometrisi. |
| `coverage` | Odadaki ölçüm sürekliliği profili. |

**Oda:** Motor odayı doğruladığında tag işareti tanımlı merkeze yerleşir. Merkez geometrik ağırlık merkezi olmak zorunda değildir; kullanıcı tarafından belirlenen, oda çokgeni içinde bulunan bir noktadır. Merkez gerçek bir UWB ölçümü değildir.

**Koridor:** Tag ham konumuna göre hareket eder; koridorun merkezine sabitlenmez. Koridor, gösterim alanına dahildir ancak oda atama motorunun oda listesine alınmaz.

Eski kayıtlarda `kind` yoksa `corridor-…` kimliği veya tam olarak “Koridor” adı koridor olarak yorumlanabilir. Yeni tanımlarda **Alan türü** seçimini açıkça yapmak daha anlaşılırdır.

### Piksel ve gerçek dünya koordinatları

Her köşe, merkez ve kapı hem `pixel` hem `world` koordinatı taşır. Piksel harita görselindeki yeri, `world` metre cinsinden fiziksel koordinatı ifade eder. Oda ve alan kontrolleri `world` üzerinden yapılır.

Panelde bir koordinat değiştirildiğinde karşılığı sistemin affine kalibrasyonuyla hesaplanır. Kalibrasyon en az üç uygun referans noktası kullanır. Bu panelde harita kaynağı değiştirilemez; JSON içe aktarılırken de sistem haritası korunur. Başka haritaya ait koordinatlar, yalnızca JSON yüklemekle doğru konuma dönüşmez.

## 3. Yeni oda veya bölge nasıl tanımlanır?

1. Sol menüden **Oda/Bölge** ekranına girin.
2. Oda/bölge listesindeki **+** düğmesine basın.
3. **Çokgen çiz** aracıyla sınırın köşelerini sırayla işaretleyin. En az üç köşeden sonra **Tamamla** seçeneğini kullanın. Kendi üstünden geçen sınırlar çizmeyin.
4. Adını, rengini ve **Alan türü** seçimini düzenleyin. Koridor için **Koridor · hareketli takip** seçin.
5. Oda için **Oda merkezi** aracını seçip çokgenin içinde bir nokta belirleyin. Merkez eksikse veya dışarıdaysa oda çıkarımı yapılamaz; dışarıdaki merkez için motor uyarı üretir.
6. Gerekliyse **Giriş ekle** aracıyla kapı noktalarını yerleştirin. Yönlü giriş/çıkış için sonraki bölümdeki geometrik alanları da doldurun.
7. **Oda çıkarımı** bölümünden kapsama, ölçüm aralığı ve duvar bantlarını belirleyin.
8. **Seç ve taşı** ile noktaları düzeltin veya nokta listesinden seçip **Pixel X/Y** ve **Gerçek X/Y (m)** alanlarıyla ince ayar yapın.
9. **Kaydet** düğmesine basın ve “Oda/bölge ayarları kaydedildi” mesajını kontrol edin.
10. Oda kararlarını kullanmak için üstteki **ODA TESPİT MOTORU** anahtarını etkinleştirin.

**Config yükle** dosyayı düzenleme ekranına alır; uygulamak için ayrıca **Kaydet** gerekir. **Dışa aktar** mevcut düzenlemeyi JSON olarak indirir. Bir JSON indirmiş olmak, sunucuya kaydetmiş olmak anlamına gelmez.

Kaydetme sırasında tarayıcıya yerel kopya da yazılır. “Tarayıcıya kaydedildi; config dosyasına yazılamadı” mesajı başarılı sunucu kaydı olarak değerlendirilmemelidir. Sunucu kaydının ana dosyası `config/regions.json` dosyasıdır.

Motor açıkken yapılandırma yeniden yüklendiğinde eski aday kanıtları temizlenir ve yeni ölçüm beklenir. Bu nedenle düzenleme sonrasında geçici belirsizlik görülebilir.

## 4. Kapılar nasıl tanımlanır?

Haritada **Giriş ekle** ile bir nokta koymak kapının konumunu kaydeder. Yönlü kapı geçişini kullanmak için **Kapı geometrisi ve bağlantılar** bölümündeki JSON listesi de düzenlenmelidir.

| Alan | Açıklama |
|---|---|
| `world` / `pixel` | Kapının gerçek ve harita koordinatları. |
| `widthMeters` | Kapı açıklığı, metre. |
| `inwardNormal` | Bu odanın içine bakan yön vektörü. |
| `connectsTo` | Koridora açılıyorsa `corridor`; başka odaya açılıyorsa o odanın `id` değeri. |
| `approachDepthMeters` | Kapı önündeki yaklaşım alanının derinliği; varsayılan 2 m. |
| `crossingDepthMeters` | Yönlü geçiş kontrolündeki derinlik; varsayılan 0,15 m. |

Örneğin iç tarafı dünya koordinatında pozitif Y yönünde olan bir kapının normali `{ "x": 0, "y": 1 }` olabilir. Bu yalnızca yön açıklamasıdır; kendi odanızın yönüne göre belirlenmelidir. Sistem normal vektörünü birim uzunluğa dönüştürür.

JSON düzenlemesinden sonra önce **Kapı tanımlarını uygula**, sonra **Kaydet** kullanılır. Kapı normalinin odaya yönelmesi ve tam tanımlı kapının oda sınırına yakın olması doğrulanır. İki oda arasındaki geçiş için her odada kendi içine bakan kapı tanımı yapılmalıdır.

Açıklık, yön veya bağlantı eksikse yönlü giriş/çıkış kanıtı kullanılamaz. Kapıya yaklaşmak, kapıya paralel yürümek veya kapı yanında veri kesilmesi tek başına odaya giriş değildir. Kapı açıklığı dışından duvarı aşan sıçrama da geçerli kapı geçişi sayılmaz.

## 5. Oda modu açıkken ve kapalıyken ne olur?

| Durum | Haritadaki davranış |
|---|---|
| Motor kapalı | Ham konum gösterim filtresine gider; uygun yerlerde yumuşatılır. Oda merkezine sabitleme yapılmaz. |
| Motor açık, oda doğrulanmamış | Genellikle ham konum gösterilir; aday oda ayrı değerlendirilir. |
| Motor açık, oda atanmış | Tag tanımlı oda merkezinde gösterilir. Oda içindeki ham titreşimler işareti oda içinde gezdirmez. |
| Çıkış adayı | Çıkış doğrulanana kadar mevcut oda merkezi korunur. |
| Uzun süre ölçüm yok | Güncel konum belirsizleşir; son bilinen oda merkezi gösterilmeye devam edebilir. |

Motor kapalı olsa da harita gösterim filtresi çalışır. “Motor kapalı” bütün noktaların sınırsız gösterileceği anlamına gelmez.

Motor anahtarı sunucudaki ortak motoru yönetir; yalnızca bu tarayıcının görsel tercihi değildir. Mevcut uygulama açılışta motoru kapalı oluşturur; anahtarın açık durumu bölge JSON dosyasına kaydedilmez. Yeniden başlatma sonrasında durumu kontrol edin.

## 6. Oda kararı nasıl verilir?

Motor her tag için yakın ölçüm geçmişi tutar. Varsayılan geçmiş en fazla 64 ölçüm ve 12 saniyelik kanıt penceresiyle sınırlıdır. Bir noktanın oda çokgenine düşmesi tek başına yeterli değildir.

Kararda şunlar değerlendirilir:

- Ölçüm zamanı ve sırası: Tekrarlanan veya eski sıradaki paketler yeni kanıt oluşturmaz.
- Süreklilik: Güçlü iç ölçümler yeterli zamana yayılmalıdır.
- Duvar uzaklığı: Duvara yakın noktalar daha düşük ağırlık alır.
- Hareket hızı: Kısa sürede fiziksel olarak aşırı uzak noktaya sıçrama kanıt sayılmaz.
- Kalite: Gönderilmişse donanımın `quality` değeri dikkate alınır.
- Kapı geçişi: Geçişin açıklık içinde ve doğru yönde olup olmadığı kontrol edilir.
- Önceki oda: Kısa süreli komşu oda sıçramasında mevcut atama hemen değiştirilmez.

Varsayılan giriş için **en az iki güçlü ölçüm ve bu ölçümler arasında en az 1.500 ms** gerekir. Bir saniyede bir ölçüm gelen örnekte 0., 1. ve 2. saniyedeki üç ölçümle koşul sağlanabilir. Bu yüzden “iki paket geldi, oda kesinleşti” kuralı doğru değildir. Gecikme, duvar yakınlığı veya kayıp paketler süreyi uzatabilir.

İlk kez bir odanın içinde görülen tag, kapı geçmişi olmadan da tutarlı iç ölçümlerle doğrulanabilir. Kapı yokken de oda tespiti bu yolla çalışır. Silent odalarda hız/gecikme/kalite filtrelerinden geçmiş, koridor poligonu içinde ve oda duvarından `exitMarginMeters` kadar uzaktaki sürekli ölçümler çıkışı kapı geçişi olmadan doğrular. Kapı geçişi yalnız ek skor kanıtıdır. Regular/intermittent odaların required/preferred politikaları değişmez.

Üst üste gelen oda çokgenleri de sorun yaratır: Nokta birden fazla odaya düşerse tek bir oda adayı seçilmez. Bu nedenle komşu oda sınırlarını gereksiz yere örtüştürmeyin.

### Motor durumları

| Durum | Kullanıcı açısından anlamı |
|---|---|
| `TRACKING_OUTSIDE` | Atanmış oda yok; oda dışındaki ölçülen konum takip ediliyor. Bu, mutlaka tüm gösterim alanının dışında demek değildir; koridor olabilir. |
| `ENTRY_CANDIDATE` | Bir oda adayı var, giriş henüz doğrulanmadı. Aday merkeze sabitleme yapılmaz. |
| `IN_REGION` | Güvenilir ölçümlerle desteklenen oda ataması var. |
| `INFERRED_IN_REGION` | Oda tahmin olarak korunuyor; güncel güçlü destek yok veya ölçümler çelişkili. |
| `EXIT_CANDIDATE` | Kapıdan çıkış kanıtı var; devam eden dış ölçümler bekleniyor. |
| `LOCATION_LOST` | Güncel oda bilinmiyor. Son bilinen konum ayrı tutuluyor. |

Arayüzde “Ölçülen”, “Tahmin edilen”, “Belirsiz · oda adayı” ve “Belirsiz · son bilinen konum” gibi açıklamalar kullanılır. **“Ölçülen” bir oda kararında bile çizilen nokta oda merkezi olabilir.** Bu etiket, kararın ölçümle desteklendiğini ifade eder.

`confidence`, kalibre edilmiş olasılık değildir. Örneğin 0,85 değerinden “%85 kesin bu odada” sonucu çıkarılmamalıdır.

### Veri kesilirse

Doğrulanmış oda önce tahmin olarak korunur, uzun kesintide belirsiz olur. Daha önce yönlü kapı geçişi ve güçlü iç ölçüm varsa kısa kesinti sırasında tahmini oda üretilebilir.

Sessiz kapsamanın ayrıca isteğe bağlı bir kapı yakınlığı davranışı vardır. Oda bazındaki **Sessiz oda kapı yakınlık mesafesi (m)** (`silentEntryMaxDistanceMeters`) 0'dan büyükse motor, tag'in son geçerli koridor ölçümüyle bütün uygun sessiz oda kapıları arasındaki Öklid mesafesini karşılaştırır. Sinyal kesildiğinde en yakın uygun kapının odasını `INFERRED_IN_REGION` ve `estimated` olarak yayımlar. Hareket yönü aranmaz; tek koridor ölçümü yeterlidir. Bu gerçek bir kapı geçişi ölçümü değildir. Yanlış pozitif riskini azaltmak için mesafeyi mümkün olduğunca dar tutun; boş veya `0` özellik kapalı demektir. Önerilen başlangıç değeri 1,5 metredir.

Bu yakınlık kuralı yalnız etkin, girişe izin veren, yok sayılmayan ve kesinti sonrası tahmini giriş izni açık kapılarda çalışır. Yeni gerçek ölçüm daha yakın başka kapı gösterirse aday değişir; bütün kapılardan uzaksa temizlenir. Güvenilir iç ölçüm ve normal yönlü kapı geçişi daha güçlü kanıt olarak önceliklidir. Uzun kesintide yine `LOCATION_LOST` uygulanır. Düzenli ve aralıklı odalar bu kuraldan etkilenmez.

Kapsama profili kesintiye ne kadar tolerans gösterileceğini etkiler:

| Profil | Panel seçimi | Temel tahmine geçiş süresi |
|---|---|---|
| `regular` | Düzenli ölçüm | Ölçüm aralığının 3 katı |
| `intermittent` | Aralıklı ölçüm | Ölçüm aralığının 5 katı |
| `silent` | İçeride çoğunlukla ölçüm yok | Ölçüm aralığının 8 katı |

Hesapta öğrenilen ölçüm aralığı ile oda için tanımlanan aralığın büyüğü kullanılır. Belirsizlik eşiği varsayılan olarak **30 saniye ile bu sürenin dört katından büyük olanıdır**. Bir saniyelik sabit aralıkta örnek eşikler düzenli için yaklaşık 3/30 saniye, aralıklı için 5/30 saniye, sessiz için 8/32 saniyedir: ilk sayı tahmine, ikinci sayı belirsizliğe geçiştir. Gerçek geçiş periyodik motor kontrolünde gerçekleşir.

Uzun aradan sonra başka yerde görülen tag için yeniden konumlanma uygulanabilir. Varsayılan uzun ara eşiği 15 saniyedir; yeniden konumlanmada kanıt süresi normalin iki katına çıkar. Bu yaklaşım yanlış oda değişimini azaltırken doğru geçişin görünmesini geciktirebilir.

## 7. Harita gösterim filtresi nasıl çalışır?

Gösterim alanı bütün tanımlı oda ve koridor çokgenlerinin birleşimidir. Çokgenlerin kenarları ve köşeleri de içeride sayılır. Harita görselinin tamamı otomatik olarak geçerli alan kabul edilmez.

1. Konum geçerli alandaysa işaret gösterilir.
2. Konum ilk kez alan dışına çıktığında süre başlar.
3. İşaret son geçerli noktada tutulur.
4. Bekleme süresi dolarsa işaret haritada gizlenir.
5. Yeniden geçerli konum gelirse güncel geçerli noktada görünür; eski animasyon kuyruğu oynatılmaz.

Varsayılan bekleme **2.000 ms, yani 2 saniyedir**. **Alan dışı gösterim bekleme süresi (ms)** alanından değiştirilip **Kaydet** ile uygulanır. Sıfır anında gizleme demektir; kabul edilen aralık 0–3.600.000 ms'dir.

**Örnek:** Tag koridordayken 12:00:00'da tanımsız bir alana sıçrar. Son geçerli koridor noktasında bekler. İçeri dönüş olmazsa yaklaşık 12:00:02'de gizlenir. Arada başka dış konum paketleri gelmesi bu süreyi baştan başlatmaz. Gizlemek için yeni paket gelmesi gerekmez.

İlk ölçümü dışarıda olan tag'in son geçerli noktası yoktur; haritada gösterilmez. Hiç bölge tanımlanmamışsa da işaretler gizlenir ve bölge tanımlama bilgisi gösterilir. Gizlenen tag listede kalabilir ve “Alan dışında · haritada gizli” açıklaması taşır.

Motor açıkken kontrol edilen nokta motorun gösterim koordinatıdır. Dolayısıyla ham ölçüm dışarı sıçrasa bile motor odayı koruyup içerideki merkezi veriyorsa işaret görünür kalabilir. Motor kapalıyken kontrol gerçek ham konum üzerinden yapılır.

Bu filtre ham ölçüm geçmişini, oda kararını veya tag'in canlı/pasif hesabını değiştirmez. Alan dışında gizlenmek ile cihazın veri göndermeyi bırakması farklı durumlardır. Tarayıcı askıya alınırsa süreye bağlı gizleme JavaScript yeniden çalıştığında gerçekleşebilir.

## 8. Yumuşatma ve animasyon nasıl çalışır?

### Küçük titreşimleri azaltma

Ham gösterimde üstel hareketli ortalama kullanılır. Katsayı 0,42'dir:

```text
Yeni gösterim = Önceki gösterim + 0,42 × (Yeni ölçüm − Önceki gösterim)
```

Örneğin önceki X değeri 10 m, yeni X ölçümü 11 m ise yumuşatılmış X 10,42 m olur. Aynı işlem Y için de yapılır. İşaretin titreşimi azalır; karşılığında ölçümü takip etmesi bir miktar gecikir.

Harita filtresi bu işlemi yalnızca başlangıcı, bitişi ve aradaki doğru parçası geçerli alan içinde kalıyorsa uygular. Alan dışından dönüşte eski konumla yumuşatma yapılmaz. Katsayı mevcut panelde kullanıcı ayarı olarak sunulmaz.

### Konumlar arasını animasyonla gösterme

Animasyon, alınmış konumları zaman sırasıyla tamponda tutar ve ara noktaları çizer. Kayıtlı varsayılanlar:

| Ayar | Değer | Etki |
|---|---|---|
| `enabled` | `true` | Konum animasyonu açık. |
| `interpolationDelayMs` | 3.000 ms | Hareketi yaklaşık 3 saniye geriden oynatarak paket dalgalanmalarını azaltır. |
| `maximumBufferSize` | 10 | Tutulan örnek sayısını sınırlar. |
| `maximumSegmentDurationMs` | 2.500 ms | Uzun aralıklı paketleri normal hareket parçası olarak birleştirmeyi sınırlar. |
| `maximumExtrapolationMs` | 250 ms | Kısa süreli ileri hareket tahminini sınırlar. |
| `stalePositionTimeoutMs` | 4.000 ms | Animasyonun eski ölçüm durumunu belirler. |
| `teleportDistanceMeters` | 6 m | Büyük sıçrama eşiği. |
| `teleportAnimationDurationMs` | 300 ms | Uygun büyük sıçrama geçişinin animasyon süresi. |

Bu değerler JSON içindeki `positionAnimation` bölümündedir; mevcut Oda/Bölge Panelinde ayrı animasyon ayar alanları yoktur. JSON düzenlenip içe aktarılarak ve kaydedilerek değiştirilebilir.

Bir koridor L biçimindeyse iki nokta da içeride olsa bile aralarındaki düz çizgi duvarı kesebilir. Sistem böyle bir çizgiyi oynatmak yerine yeni geçerli noktaya doğrudan geçer. Duvar çevresinden yürüyüş rotası hesaplamaz.

Oda merkezi içeren geçişler de doğrudan uygulanır; merkezler arasında fiziksel yol çizilmez. JSON'da `regionTransitionDurationMs` bulunmasına rağmen mevcut merkez geçişi kodu bu süreyi kullanarak kaydırma yapmaz.

**Süreleri karıştırmayın:** 2 saniye alan dışı bekleme, 3 saniye animasyon gecikmesi, 4 saniye animasyon eskime eşiği ve 30 saniyelik temel oda belirsizlik eşiği farklı işlemlere aittir. Tag canlılık hesabında ayrıca son gerçek ölçüme dayalı 10 saniyelik eşik bulunur. Sentetik oda yayını yeni fiziksel ölçüm sayılmaz.

## 9. Oda tespitinin önemli ayarları

| Ayar | Varsayılan | İşlev |
|---|---|---|
| `engine.entryConfirmationCount` | 2 | Asgari güçlü giriş ölçümü sayısı; süre koşulu da gerekir. |
| `engine.exitConfirmationCount` | 2 | Kapı çıkışı sonrası asgari doğrulama sayısı; süre koşulu da gerekir. |
| `engine.evidenceDurationMs` | 1.500 ms | Normal doğrulama için kanıt süresi. |
| `engine.evidenceWindowMs` | 12.000 ms | Yakın kanıt geçmişi penceresi. |
| `engine.maxEvidenceGapMs` | 4.000 ms | Kanıt sürekliliğinin temel aralık eşiği; ölçüm sıklığına göre büyüyebilir. |
| `engine.expectedIntervalMs` | 1.000 ms | Başlangıçta beklenen ölçüm aralığı. |
| `engine.maxSpeedMetersPerSecond` | 4 m/s | Hız tutarlılığı sınırı; mesafe kontrolünde ayrıca 0,25 m tolerans var. |
| `engine.relocationAfterMs` | 15.000 ms | Uzun aradan sonra yeniden konumlanma eşiği. |
| `engine.lostAfterMs` | 30.000 ms | Temel belirsizlik eşiği; kapsama profili uzatabilir. |
| Bölge `wallBandMeters` | 0,35 m | Duvara yakın ölçümlerin düşük ağırlık aldığı bant. |
| Bölge `sharedWallBandMeters` | 0,65 m | Başka odaya yakın duvar çevresindeki bant. |
| Bölge `silentEntryMaxDistanceMeters` | Kapalı; önerilen 1,5 m | Yalnız sessiz odada kapı yakınlığından tahmini giriş mesafesi; 0 kapatır. |

Oda bazındaki **Beklenen ölçüm aralığı**, **Duvar bandı**, **Ortak duvar bandı** ve sessiz kapsama seçiliyken **Sessiz oda kapı yakınlık mesafesi (m)** panelden değiştirilebilir. Genel `engine` eşikleri JSON yapılandırmasındadır. `quality` verilmezse motor 1 kabul eder; 0,25 altındaki kaliteyi kanıt saymaz. Güçlü kanıt için ağırlığın en az 0,5 olması gerekir; dolayısıyla 0,25 kaliteyi aşmak tek başına güçlü kanıt üretmez.

Dar odada duvar bandı çok büyükse güvenilir iç alan kalmayabilir. Eşikleri küçültmek tespiti hızlandırabilir ancak duvar yakınındaki yanlış oda kararlarını artırabilir. Varsayılan süreler ve mesafeler gerçek sahada doğrulanmış garantiler değildir.

**Sürüm notu:** Eski belgelerdeki `inference / shadow / legacy` seçimi mevcut panelde bulunmuyor. Güncel denetleyici yalnız `RegionPositionEngine` kullanıyor; kayıt API'si eski `engine.mode` alanını çıkarıyor. `exitMarginMeters`, silent oda çıkışında güvenilir koridor kanıtının oda duvarından bulunması gereken asgari uzaklıktır.

## 10. Bu projede şu anda neler tanımlı?

İncelenen `config/regions.json` dosyasında `kat1-ortopedi` haritası için şu kayıtlar bulunuyor:

| Bölge | Kimlik | Türün mevcut yorumu | Kapı sayısı |
|---|---|---|---|
| oda 3 | `zone-91d9e84c` | Oda | 0 |
| Koridor | `corridor-main` | Koridor | 0 |
| Oda 4 | `zone-44b1bd94` | Oda | 0 |

Tür alanları açıkça yazılmamış; mevcut geri uyumluluk kuralları uygulanıyor. İki oda için merkezler kayıtlı. Oda 3 merkezi yaklaşık `(5,710; 20,920)` m, Oda 4 merkezi `(5,242; 16,938)` m.

**Mevcut kapı eksikliğinin sonucu:** Odalar sürekli güvenilir iç ölçümlerle atanabilir, ancak yönlü kapı giriş/çıkış kanıtı kullanılamaz. Özellikle oda çıkışı ve komşu odaya geçişte eski atama daha uzun korunabilir. Kapı üzerinden kesinti tahmini için önce gerçek kapı geometrileri tanımlanmalıdır.

Canlı motor varsayılan olarak kökteki `config/regions.json` dosyasını yükler. `config/maps/...` altındaki başka bir dosyanın bulunması, onun canlı motor tarafından kullanıldığını göstermez. Düzenlenen harita, canlı takip haritası ve koordinat sistemi eşleşmelidir.

## 11. Sık karşılaşılan durumlar

| Gözlem | Açıklama ve kontrol |
|---|---|
| Tag listede var, haritada yok. | Konum tanımlı alan dışında olabilir; bölge yokluğu veya harita eşleşmesi de kontrol edilmelidir. |
| Tag odada hareketsiz görünüyor. | Motor odayı atamışsa oda merkezinde sabit gösterim beklenen davranıştır. |
| Tag başka odaya sıçradı ama oda adı değişmedi. | Kapı çıkışı veya yeterli yeniden konumlanma kanıtı olmayabilir; kısa sıçramalar hemen kabul edilmez. |
| Oda çizili ama atama oluşmuyor. | Merkez, oda türü, duvar bandı, ölçüm kalitesi/sıklığı, örtüşen çokgenler ve motorun açık durumu kontrol edilir. |
| Kapı noktası ekledim, çıkış yine geç algılanıyor. | Sadece nokta yeterli değildir; açıklık, iç yön ve bağlantı da tanımlanmalıdır. |
| İşaret birkaç saniye geriden geliyor. | Animasyon gecikmesi ve yumuşatma etkisi olabilir; oda doğrulama süresi de ayrı gecikme ekleyebilir. |
| İşaret koridor köşesinde bir anda yer değiştirdi. | Aradaki düz çizgi geçerli alanı terk ediyorsa duvar içinden animasyon engellenir. |
| Cihaz sustu ama oda işareti duruyor. | Son bilinen oda tahmini veya belirsiz konum gösteriliyor olabilir; etiket ve son gerçek ölçüm zamanı kontrol edilir. |
| JSON yüklendi ama davranış değişmedi. | İçe aktarma sonrası Kaydet yapılmalı ve başarılı sunucu kaydı doğrulanmalıdır. |

## 12. Ham ölçüm ve geçmiş kayıtları

Ham konum ile oda kararı ayrı tutulur. İşlenmiş veride üst düzey `x/y` gösterim koordinatı, `rawPosition` gerçek ölçümdür. `positionSource`, noktanın `RAW` veya `REGION_CENTER` olduğunu belirtir.

Gerçek ölçüm zamanı `timestamp` / `lastRawDataTimestamp`, kararın yayın zamanı `publishedAt` alanındadır. Motor yeni bir tahmin yayınlarken gerçek ölçüm zamanını yenilemez.

Ham geçmiş `tag_location_history`, oda kararları `tag_room_decisions` üzerinden saklanır. Son geçerli noktada bekletme ve animasyon ara noktaları ham UWB ölçümü olarak yazılmaz. Oda geçmişindeki karar zamanı, fiziksel kapıdan geçilen anın kesin ölçümü olarak yorumlanmamalıdır.

## 13. Kaynak kodu başvuru noktaları

Bu kılavuz mevcut kod incelenerek hazırlanmıştır; eski uygulama notlarından farklı yerlerde güncel kod esas alınmıştır.

- Bölge paneli: `src/features/regions/components/RegionManagementPanel.tsx`
- Oda ve kapı alanları: `src/features/regions/components/RegionInferenceEditor.tsx`
- Kayıt ve doğrulama: `app/api/regions/route.ts`, `src/server/regionEngine/configLoader.ts`
- Oda kararları: `src/server/regionEngine/RegionPositionEngine.ts`
- Motor açma/kapatma: `src/server/regionEngine/controller.ts`
- Alan dışı filtre: `src/features/tracking/services/MapDisplayFilter.ts`
- Harita/veri kaynağı bağlantısı: `src/features/tracking/services/bindMapDisplayTracking.ts`
- Yumuşatma: `src/features/tracking/services/positionFilters.ts`
- Animasyon: `src/features/tracking/services/PositionAnimationController.ts`
- Geçerli yapılandırma: `config/regions.json`

İlgili davranış testleri: `tests/mapDisplayFilter.test.ts`, `tests/regionPositionEngine.test.ts`, `tests/positionAnimationController.test.ts`, `tests/roomDecisionPersistence.test.ts`. Bu dokümantasyon çalışmasında uygulama kodu değiştirilmemiş ve testler yeniden çalıştırılmamıştır.
