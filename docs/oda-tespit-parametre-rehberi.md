# Oda tespit parametre rehberi

Bu belge, **Oda/Bölge** ekranındaki oda tespit ayarlarının ne yaptığını ve motorun bunları nasıl kullandığını açıklar. Amaç, bir değeri değiştirmenin yalnızca sayısal sonucunu değil, yanlış oda ataması, tespit gecikmesi ve sinyal kesintisi üzerindeki etkisini de anlaşılır kılmaktır.

> **Önemli:** `confidence` / kanıt skoru kalibre edilmiş bir olasılık değildir. Örneğin `0,80`, tag'in odada olma ihtimalinin %80 olduğu anlamına gelmez. Bu değer, motorun elindeki kanıtların göreli karar puanıdır.

## 1. Ayar önceliği: global, oda ve kapı

Bir değer birden fazla seviyede tanımlanabilir. Motor aşağıdaki sırayla ilk tanımlı değeri kullanır:

```text
Kapı özel ayarı
       ↓
Oda özel ayarı
       ↓
Global motor ayarı
       ↓
Sistem varsayılanı
```

- **Global ayar**, bütün odalar için ortak başlangıç davranışıdır.
- **Oda override'ı**, yalnızca seçili odanın global değerden farklı çalışmasını sağlar.
- **Kapı override'ı**, aynı odadaki bir kapının diğer kapılardan farklı davranmasını sağlar.
- **Etkili değer**, bu öncelik sırasından sonra motorun gerçekten kullandığı değerdir.

Bir oda veya kapı override'ı kaldırılırsa, değer otomatik olarak bir üst seviyeden gelir. `maxTags` ve `historySize` yalnızca global seviyede bulunur; oda veya kapı için değiştirilemez.

## 2. Temel oda ve geometri özellikleri

| Özellik | Ne işe yarar? | Dikkat edilmesi gereken |
|---|---|---|
| Oda/bölge adı | Kullanıcıya listede, haritada ve teşhiste gösterilen addır. | Motorun teknik kimliği değildir. |
| Kimlik (`id`) | Config, kapı bağlantıları ve karar kayıtlarında kullanılan kalıcı teknik kimliktir. | Sonradan değiştirmek `connectsTo` bağlantılarını ve geçmiş eşleşmelerini koparabilir. |
| Renk | Haritadaki görünümü belirler. | Tespit kararını etkilemez. |
| Alan türü | `room`, sabit oda çıkarımına katılır; `corridor`, hareketli takip alanıdır. | Koridorlar oda giriş/çıkış listesine derlenmez. |
| Çokgen | Odanın gerçek dünya sınırını tanımlar. | Motor aday odayı dünya koordinatındaki nokta-içinde-poligon hesabıyla seçer. |
| Oda merkezi | Oda doğrulandıktan sonra tag'in haritada gösterildiği sabit noktadır. | Bir UWB ölçümü değildir; ham ölçüm ayrıca `rawPosition` içinde korunur. |
| Pixel koordinatı | Kat planı görselindeki konumdur. | Düzenleme/çizim içindir; fiziksel karar doğrudan pixel ile verilmez. |
| Gerçek dünya koordinatı | Kalibrasyonla elde edilen metre cinsinden konumdur. | Hız, duvar, kapı ve çokgen hesapları bununla yapılır. |

Temel aday hesabı şöyledir:

```text
adayOda = pointInPolygon(ölçüm, odaÇokgeni)
```

Bir ölçüm birden çok oda çokgeninin içine düşerse motor tek bir aday seçmez. Bu yüzden komşu oda çokgenleri üst üste bindirilmemelidir.

### Duvar bandı ve ortak duvar bandı

- **Duvar bandı (`wallBandMeters`)**: Ölçüm oda duvarına bu mesafeden yakınsa zayıf kanıt kabul edilir.
- **Ortak duvar bandı (`sharedWallBandMeters`)**: Ölçüm komşu bir odanın duvarına da yakınsa kullanılan, daha korumacı banttır.

Bandın dışında kalan geçerli ölçüm güvenilir ağırlığı, bandın içindeki ölçüm ise duvar ağırlığını alır:

```text
güvenilirAğırlık = reliableEvidenceWeight × min(1, quality)
duvarAğırlığı    = wallEvidenceWeight × min(1, quality)
```

Bandı artırmak komşu oda sıçramalarına karşı korumayı artırır ama girişin doğrulanmasını yavaşlatabilir. Bandı azaltmak tespiti hızlandırabilir fakat sınır yakınındaki hatalara daha açık hale getirir.

### Kapsama tipi

| Kapsama | Anlamı | Varsayılan eskime çarpanı |
|---|---|---:|
| `regular` | Odada düzenli paket beklenir. | 3× |
| `intermittent` | Paketler aralıklı gelebilir. | 5× |
| `silent` | Oda içinde uzun süre paket gelmeyebilir. | 8× |

Sessiz kapsamanın iki ayrı etkisi vardır:

1. Ölçüm kesintisine düzenli ve aralıklı kapsamalardan daha uzun tolerans gösterir.
2. Oda bazında `silentEntryMaxDistanceMeters > 0` tanımlanmışsa, son geçerli koridor ölçümü uygun bir kapıya yeterince yakınken sinyal kesildiğinde en yakın uygun kapının odasına tahmini giriş üretebilir.

Bu ikinci karar gerçek veya ölçülmüş bir kapı geçişi değildir. Sonuç `INFERRED_IN_REGION`, `measurementKind: "estimated"` ve `positionSource: "REGION_CENTER"` olarak yayımlanır. Yanlış pozitif riski azami mesafeyi küçük ve saha geometrisine uygun tutarak yönetilmelidir. Boş, tanımsız veya `0` değer özelliği kapatır; mevcut yapılandırmalar böylece davranış değiştirmez. Önerilen başlangıç değeri 1,5 metredir ve kabul edilen aralık 0–20 metredir.

Mesafe hareket yönünden bağımsız olarak dünya koordinatlarında hesaplanır:

```text
mesafe = hypot(tag.x - kapı.x, tag.y - kapı.y)
```

Yalnız etkin, girişe izin veren, `evidenceMode: "ignored"` olmayan ve `allowEstimatedEntryAfterSignalLoss: true` kapılar değerlendirilir. Eşit mesafede yapılandırmadaki ilk oda/kapı seçilir. `approachDepthMeters` bu özellikte kullanılmaz; yönlü gerçek kapı geçişi geometrisine ait olmaya devam eder.

## 3. Giriş ve çıkış kararı

Bir tag'in oda içine atanması için yalnızca çokgen içinde görünmesi yeterli değildir. Girişte üç koşul birlikte değerlendirilir:

```text
güvenilir iç ölçüm sayısı ≥ gerekli giriş ölçüm sayısı
VE
kanıt süresi ≥ gerekli giriş kanıt süresi
VE
kapı politikası izin veriyor
```

Çıkışta benzer biçimde kapı geçişi veya izin verilen kapısız çıkış sonrası dış kanıtın sürmesi aranır:

```text
dış ölçüm sayısı ≥ gerekli çıkış ölçüm sayısı
VE
dış kanıt süresi ≥ gerekli çıkış kanıt süresi
VE
kapı politikası izin veriyor
```

Motor, güvenlik için giriş ve çıkışta etkili ölçüm eşiğini en az `2` tutar. Ayarda `1` seçilse bile tek paket oda ataması üretmez.

### Karar ve kanıt parametreleri

| Parametre | Varsayılan | Açıklama | Artırılırsa | Azaltılırsa |
|---|---:|---|---|---|
| `entryEvidenceDurationMs` | 1,5 sn | Aday odadaki geçerli kanıtın kapsaması gereken asgari süredir. | Yanlış girişlere direnç artar, giriş gecikir. | Giriş hızlanır, kısa sıçramalara hassasiyet artar. |
| `exitEvidenceDurationMs` | 1,5 sn | Dışarıdaki kanıtın sürmesi gereken asgari süredir. | Oda daha uzun korunur. | Çıkış daha hızlı doğrulanır. |
| `entryConfirmationCount` | 2 | Giriş için gereken güvenilir iç ölçüm sayısıdır. | Daha fazla örnek gerekir. | Giriş hızlanır; etkili alt sınır yine 2'dir. |
| `exitConfirmationCount` | 2 | Çıkış için gereken dış ölçüm sayısıdır. | Oda daha zor bırakılır. | Çıkış hızlanır; etkili alt sınır yine 2'dir. |
| `evidenceWindowMs` | 12 sn | Kanıt geçmişinin en fazla yaşını sınırlar. | Daha uzun geçmiş birlikte değerlendirilir. | Kanıt daha hızlı unutulur. |
| `maxEvidenceGapMs` | 4 sn | Kanıt zincirinin korunabileceği temel ölçüm boşluğudur. | Seyrek paketlere daha çok tolerans verir. | Boşlukta aday daha çabuk sıfırlanır. |
| `expectedIntervalMs` | 1 sn | Beklenen paket ritmidir. | Seyrek veri alan odalara tolerans artar. | Kesintiler daha erken fark edilir. |
| `silentEntryMaxDistanceMeters` | Kapalı; önerilen başlangıç 1,5 m | Yalnız sessiz odada, son koridor ölçümünden kapıya tahmini giriş için azami mesafedir. | Daha uzak noktalar aday olur; yanlış pozitif riski artar. | Aday alan daralır; `0` özelliği kapatır. |
| `relocationAfterMs` | 15 sn | Bu kadar uzun boşluktan sonra yeni ölçüm yeniden konumlanma adayı sayılır. | Uzun sıçramalar daha geç yeniden konumlanır. | Kesinti sonrası yeni oda daha erken değerlendirilir. |
| `relocationEvidenceDurationMultiplier` | 2× | Yeniden konumlanma sırasında giriş süresini çarpar. | Kesinti sonrası oda değişimi daha temkinli olur. | Yeni oda daha erken kabul edilir. |
| `outsideReleaseDurationMultiplier` | 2× | Kesinti sonrası tutarlı dış ölçümlerin eski odayı bırakma süresini çarpar. | Eski oda daha uzun korunur. | Eski oda daha erken bırakılır. |
| `exitMarginMeters` | 0,5 m | Ölçümün çıkış sayılması için aktif oda duvarından dışarıdaki asgari uzaklıktır. | Daha uzağa çıkmak gerekir. | Sınır dışı ölçümler daha erken çıkış sayılır. |

Kanıt zincirinin izinli boşluğu yalnızca `maxEvidenceGapMs` değildir:

```text
izinliBoşluk = max(maxEvidenceGapMs, beklenenÖlçümAralığı × 3)
```

Bu boşluk aşılırsa aday, kapı geçişi ve yakın geçmiş sıfırlanır; eski kanıtla yeni bir giriş tamamlanmaz.

### Eski uyumluluk alanı

`evidenceDurationMs`, eski config dosyalarındaki birleşik süre alanıdır. Ayrı `entryEvidenceDurationMs` ve `exitEvidenceDurationMs` tanımlanmamışsa ikisine de uygulanır. Yeni düzenlemelerde giriş ve çıkış sürelerini ayrı yönetmek daha açıktır.

## 4. Ölçüm kalitesi ve fiziksel filtreler

| Parametre | Varsayılan | Açıklama |
|---|---:|---|
| `maximumSpeedMetersPerSecond` | 4 m/s | Ardışık ölçümler arasındaki fiziksel hız üst sınırı. |
| `movementToleranceMeters` | 0,25 m | Hız hesabındaki sabit UWB konum hata toleransı. |
| `minimumHardwareQuality` | 0,25 | Kanıt sayılacak asgari cihaz kalite değeri. |
| `reliableEvidenceWeight` | 0,5 | Duvar bandı dışındaki geçerli ölçümün temel ağırlığı. |
| `wallEvidenceWeight` | 0,1 | Duvar bandındaki zayıf ölçümün temel ağırlığı. |

Bir hareket fiziksel olarak mümkün kabul edilirken şu kontrol uygulanır:

```text
mesafe ≤ maksimumHız × geçenSüre + hareketToleransı
```

Bu sınırı aşan, çok gecikmiş veya kalitesi `minimumHardwareQuality` altında kalan ölçüm kanıt sayılmaz. Aktif oda varsa sistem odayı hemen değiştirmek yerine tahmin/belirsizlik durumuna geçebilir.

## 5. Sinyal kesintisi, tahmin ve kayıp durumları

Ölçüm kesilince motor önce oda bilgisini tahmin olarak korur, daha uzun kesintide güncel konumu belirsiz yapar.

```text
tahmineGeçişSüresi = max(öğrenilenÖlçümRitmi, beklenenÖlçümAralığı)
                      × kapsamaÇarpanı

kayıpSüresi = max(lostAfterMs,
                  tahmineGeçişSüresi × lostAfterStaleMultiplier)
```

| Parametre | Varsayılan | Açıklama |
|---|---:|---|
| `lostAfterMs` | 30 sn | Güncel oda bilgisinin kayıp sayılması için temel süre. |
| `regularCoverageStaleMultiplier` | 3× | Düzenli kapsamada tahmine geçiş çarpanı. |
| `intermittentCoverageStaleMultiplier` | 5× | Aralıklı kapsamada tahmine geçiş çarpanı. |
| `silentCoverageStaleMultiplier` | 8× | Sessiz kapsamada tahmine geçiş çarpanı. |
| `lostAfterStaleMultiplier` | 4× | Tahmine geçiş süresinden kayıp alt sınırı üretir. |
| `historySize` | 64 | Tag başına bellekte tutulacak en fazla kanıt örneği. |
| `maxTags` | 5.000 | Bellekte aynı anda tutulacak en fazla tag durumu. |

`historySize` küçültülürse bellekte daha az geçmiş tutulur. Ancak giriş/çıkış için gereken ölçüm sayısından küçük olamaz. `maxTags` sınırı dolduğunda en eski tag durumu yeni tag için çıkarılır.

## 6. Kanıt skoru

Giriş adayı için motor şu bileşenleri hesaplar:

```text
süreKatkısı = min(süreKatkıTavanı,
                  süreKatkıTavanı × kanıtSüresi / süreKatkıTamamlanmaSüresi)

ölçümKatkısı = min(ölçümKatkıTavanı,
                   ölçümSayısı × ölçümBaşınaKatkı)

kapıKatkısı = kapıBonusu × kapıKanıtAğırlığı

toplamSkor = min(maksimumSkor,
                 başlangıçSkoru + süreKatkısı + ölçümKatkısı + kapıKatkısı)
```

| Parametre | Varsayılan | Açıklama |
|---|---:|---|
| `baseScore` | 0,15 | Aday oda skorunun sabit başlangıç değeri. |
| `maximumScore` | 0,90 | Toplam kanıt skorunun üst sınırı. |
| `durationContributionMaximum` | 0,35 | Süre katkısının ulaşabileceği en yüksek değer. |
| `durationContributionFullAtMs` | 2,1 sn | Süre katkısının tavana ulaşacağı kanıt süresi. |
| `measurementContributionPerSample` | 0,04 | Her güvenilir ölçümün eklediği skor. |
| `measurementContributionMaximum` | 0,15 | Ölçüm katkısının üst sınırı. |
| `doorEntryBonus` | 0,25 | Kapı özel bonusu yoksa giriş geçişinin skor katkısı. |
| `doorExitBonus` | 0 | Kapı özel bonusu yoksa çıkış geçişinin skor katkısı. |
| `confirmedInsideScore` | 0,85 | Aktif odada güvenilir iç ölçüm geldiğinde kullanılan skor. |
| `inferredInsideMaximumScore` | 0,65 | Tahmini oda durumundaki skor üst sınırı. |
| `invalidMeasurementMaximumScore` | 0,50 | Geçersiz ölçüm veya uzun kesintide skorun sınırlandığı değer. |

Bu skor giriş için görünür bir tanı göstergesidir; karar doğrudan `toplamSkor ≥ eşik` biçiminde verilmez. Asıl giriş kararı süre, ölçüm sayısı ve kapı politikasının birlikte sağlanmasına dayanır.

## 7. Kapı geometrisi ve kapı politikası

Kapı, yalnızca haritadaki nokta değildir. Yönlü geçişin değerlendirilmesi için kapının gerçek dünya konumu, genişliği, odaya bakan normali ve bağlantısı gerekir.

| Geometri alanı | Açıklama |
|---|---|
| `widthMeters` | Kapı açıklığının metre cinsinden genişliği. |
| `inwardNormal` | Kapıdan bu odanın içine bakan birim yön vektörü. |
| `connectsTo` | Bağlandığı koridorun veya diğer odanın teknik kimliği. |
| `approachDepthMeters` | Kapı önündeki yaklaşım alanının derinliği. |
| `crossingDepthMeters` | Geçişin doğrulanmasında kullanılan içeri/dışarı derinlik eşiği. |

Kapıya yaklaşmak, kapıya paralel ilerlemek veya kapı yanında veri kesilmesi tek başına geçiş değildir. Geçiş, açıklık içinde ve doğru yönde hareketle desteklenmelidir.

### Kapı özel ayarları

| Parametre | Varsayılan | Açıklama |
|---|---:|---|
| `enabled` | `true` | Kapının motor tarafından kullanılmasını açar/kapatır. |
| `direction` | `bidirectional` | Kapının giriş, çıkış veya iki yönlü kullanılacağını belirtir. |
| `evidenceMode` | `preferred` | Kapı kanıtının giriş/çıkış kararındaki zorunluluk derecesidir. |
| `entryEvidenceWeight` | 1 | Giriş kapı kanıtı ağırlığıdır. |
| `exitEvidenceWeight` | 1 | Çıkış kapı kanıtı ağırlığıdır. |
| `entryConfidenceBonus` | 0,25 | Bu kapıdan girişte skora eklenen bonus. |
| `exitConfidenceBonus` | 0 | Bu kapıdan çıkışta skora eklenen bonus. |
| `crossingValidityMs` | 12 sn | Geçiş kanıtının kullanılabileceği süre. |
| `minimumDirectionalMovementMeters` | 0 m | Geçiş sayılmak için gereken en küçük yönlü ilerleme. |
| `missingDoorEvidenceDurationMultiplier` | 1× | Tercih edilen kapı görülmezse giriş/çıkış süresine uygulanan çarpan. |
| `missingDoorEvidenceCountMultiplier` | 1× | Tercih edilen kapı görülmezse gerekli ölçüm sayısına uygulanan çarpan. |
| `allowEstimatedEntryAfterSignalLoss` | `true` | Geçiş ve iç kanıt sonrası kısa kesintide tahmini girişe izin verir. |
| `allowEstimatedExitAfterSignalLoss` | `true` | Geçiş sonrası kısa kesintide tahmini çıkışa izin verir. |

### Kapı yönleri

- **`bidirectional`**: Kapı hem giriş hem çıkış kanıtında kullanılabilir.
- **`entry-only`**: Kapı yalnız giriş kanıtında kullanılabilir.
- **`exit-only`**: Kapı yalnız çıkış kanıtında kullanılabilir.

### Kapı kanıt rolleri

| Rol | Davranış |
|---|---|
| `required` | Uygun kapı geçişi görülmeden ilgili giriş/çıkış doğrulanmaz. Bu proje doğrulamasında iki yönlü kapı olmalıdır. |
| `preferred` | Kapı geçişi görülürse normal eşikler kullanılır. Görülmezse aşağıdaki süre ve ölçüm çarpanları uygulanır. |
| `optional` | Kapı geçişi ek kanıt ve skor katkısı sağlar, fakat karar için şart değildir. |
| `ignored` | Kapı haritada kalır fakat motor tarafından kullanılmaz. |

Tercih edilen kapı görülmediğinde etkili eşikler şunlardır:

```text
etkiliSüre = normalSüre × missingDoorEvidenceDurationMultiplier
etkiliÖlçümSayısı = max(2,
                         ceil(normalÖlçümSayısı × missingDoorEvidenceCountMultiplier))
```

Örnek: Giriş süresi `2 sn`, giriş ölçüm sayısı `3`, süre çarpanı `2` ve ölçüm çarpanı `1,5` ise kapı görülmediğinde giriş için `4 sn` ve `5` ölçüm gerekir.

## 8. Motor durumları

| Durum | Anlamı |
|---|---|
| `TRACKING_OUTSIDE` | Atanmış oda yok; ham konum veya koridor takip ediliyor. |
| `ENTRY_CANDIDATE` | Aday oda var; süre, ölçüm veya kapı koşulları henüz tamamlanmadı. |
| `IN_REGION` | Geçerli iç ölçümle desteklenen doğrulanmış oda ataması var. |
| `INFERRED_IN_REGION` | Güncel güçlü ölçüm yok; önceki oda tahmin olarak korunuyor. |
| `EXIT_CANDIDATE` | Çıkış işareti var; devam eden dış kanıt bekleniyor. |
| `LOCATION_LOST` | Güncel oda bilinmiyor; son bilinen oda ayrıca tutulabilir. |

Oda doğrulandıysa haritadaki gösterim koordinatı oda merkezi olabilir. Bu nedenle haritada merkezde görünen tag'in son ham UWB ölçümü merkezde olmak zorunda değildir.

## 9. Ayar yapma önerileri

1. Önce geometrinin doğru olduğundan emin olun: çokgen, oda merkezi, kapı genişliği ve normal yanlışsa katsayı değiştirmek sorunu çözmez.
2. Bir anda çok sayıda ayar değiştirmeyin. Her değişiklik için gerçek veya simüle edilmiş rota ile sonuçları karşılaştırın.
3. Yanlış giriş varsa önce giriş süresini veya giriş ölçüm sayısını küçük adımlarla artırın; duvar bantlarını gereksiz büyütmeyin.
4. Giriş çok geç geliyorsa önce paket ritmini, kapı geometrisini ve ölçüm kalitesini inceleyin. Ardından süre/sayı eşiklerini kademeli düşürün.
5. Sinyal kesintisinde oda çok erken kayboluyorsa kapsama tipini ve `expectedIntervalMs` değerini doğrulayın; doğrudan `lostAfterMs` artırmak her zaman doğru çözüm değildir.
6. `required` kapı rolünü yalnızca kapı geçişi güvenilir biçimde ölçülüyorsa kullanın. Kapı eşiğinde sık paket kaybı varsa `preferred` daha uygundur.
7. Kanıt skorunu doğrudan yüzde olarak yorumlamayın; değişiklikleri yanlış giriş, kaçan giriş ve gecikme metrikleriyle değerlendirin.

## 10. Kaydetme ve sürüm etkisi

Oda/bölge ayarları kaydedildiğinde config yeniden derlenir ve motor yeni config sürümünü kullanmaya başlar. Aktif aday kanıtları temizlenebilir; yeni ölçümler geldikçe odalar yeniden doğrulanır. Bu nedenle ayar değişikliğinden hemen sonraki kısa belirsizlik, tek başına tespit hatası anlamına gelmez.

Değişiklikten sonra en az şu senaryolarla kontrol yapılması önerilir:

- Koridordan odaya normal giriş
- Odada duvara yakın hareket
- Ortak duvar yanında gürültü
- Kapıdan girip geri dönme
- Odadan koridora çıkış
- Paket kesintisi sonrası aynı odada kalma
- Uzun kesinti sonrası başka odaya yeniden konumlanma
