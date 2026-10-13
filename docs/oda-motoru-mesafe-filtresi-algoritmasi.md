# Mesafe filtresi ve kontrollü yeniden konumlanma algoritması

Tarih: 12 Ekim 2026

Uygulama durumu (13 Ekim 2026): `StepDistanceFilter` ve `RegionPositionEngine` entegrasyonu uygulandı. Mevcut haritalar ve yeni harita şablonunda **10 m / 2 ölçüm** etkin; asgari doğrulama süresi 1.500 ms, aday yarıçapı 1 m, azami boşluk 2.000 ms, pencere 6.000 ms. Genel ayarlar ve karar ayrıntısı paneli eklendi. Eski yapılandırmalarda alan yoksa veya 0 ise filtre kapalıdır. Aşağıdaki örnekler tasarımın farklı eşiklerle davranışını gösterir.

Amaç: Hızdan bağımsız bir mesafe sınırıyla tekil sıçramaları oda kanıtından çıkarmak; yeni konum çevresinde tutarlı ölçümler devam ediyorsa eski referansa takılmadan takibi yeniden başlatmak.

## 1. Temel karar

Her tag ve harita için iki ayrı bilgi tutulur:

- **Takip referansı:** Normalde son kabul edilen ham noktadır. Kontrollü yeniden başlangıçta, doğrulanan aday dizisinin son noktası yalnızca yeni karşılaştırma referansı olur.
- **Yeniden konumlanma adayı:** Takip referansından uzak, fakat kendi içinde tutarlı yeni ölçümlerin özeti. Bu ölçümler oda kanıtına eklenmez.

Yeni ölçüm normal takipten geçebiliyorsa öncelik normal takibindir ve bekleyen aday temizlenir. Normal referanstan uzaksa aday doğrulaması hemen başlayabilir; sinyal kesintisi veya `LOCATION_LOST` beklemek gerekmez.

## 2. Parametreler

Aşağıdaki sayılar davranışı göstermek içindir; saha verisiyle kalibre edilmelidir.

| Sembol | Önerilen alan | Örnek | Anlamı |
|---|---|---|---|
| D | `maximumStepDistanceMeters` | 3 m | Normal takipte izin verilen azami mesafe; 0 filtreyi kapatır |
| R | `relocationClusterRadiusMeters` | 1 m | Yeni adayların, aday dizisinin ilk noktasına azami uzaklığı |
| N | `relocationConfirmationCount` | 3 | Yeni referans için gereken en az farklı zamanlı ölçüm sayısı |
| T | `relocationConfirmationDurationMs` | 1.500 ms | Adayın ilk ve son ölçümü arasındaki asgari süre |
| G | `relocationMaximumGapMs` | 2.000 ms | Aday ölçümler arasında izin verilen azami boşluk |
| W | `relocationCandidateWindowMs` | 6.000 ms | Tek aday dizisinin azami toplam süresi |

Hız sınırı `V` ve hız toleransı `ε`, mevcut motor ayarlarından gelir. Normal takip mevcut hız politikasını korur. Aday dizisindeki ardışık noktalar ayrıca `mesafe ≤ V × Δt / 1000 + ε` koşulunu sağlamalıdır; bu kısa aday dizisinde uzun boşluk nedeniyle hız kontrolünü atlama uygulanmaz.

Doğrulama: D etkinse `0 < R ≤ D`, `N ≥ 2` tam sayı, `T > 0`, `G > 0`, `W ≥ T` olmalı; bütün değerler sonlu olmalıdır. D=0 iken bu algoritma devreden çıkar ve mevcut motor yolu kullanılır.

R kontrolü, her seferinde küçük bir adımla uzaklaşan aday zincirinin sınırsız sürüklenmesini engeller. Bu tasarım yeni konum çevresinde kümelenme arar; sürekli hareket edip R dışına çıkan tag'da yeniden başlangıç gecikebilir. Hareket halindeki yeniden konumlanmayı desteklemek ayrı bir hareket modeli gerektirir.

## 3. Tag/harita başına durum

```text
reference: Point | null          // Filtrenin karşılaştırma referansı
lastObservedAt: timestamp | null // Kabulden bağımsız sıralama işareti
candidate: {
    first: Point,
    last: Point,
    count: integer              // N'de sınırlandırılabilir
} | null
```

Point en az `x`, `y`, `measuredAt` alanlarını içerir. Koordinatlar metre cinsinden dünya koordinatlarıdır. Ekranda gösterilen oda merkezi veya yumuşatılmış konum kullanılmaz.

Bu durum, oda motorunun kabul edilmiş kanıt geçmişinden ayrıdır. Özellikle `reference` yenilenmesi `lastSupportAt`, oda güveni veya oda kanıtının güncellendiği anlamına gelmez.

## 4. Sonuç türleri

| Sonuç | Filtre davranışı | Oda motoruna etkisi |
|---|---|---|
| `IGNORE` | Yinelenen veya sırasız paket; durum ilerlemez | Kanıt oluşturmaz |
| `REJECT` | Ölçüm reddedilir; gerekirse aday başlatılır/ilerletilir | Kanıt oluşturmaz, geçerlilik süresini uzatmaz |
| `ACCEPT` | Referans yeni noktaya taşınır, aday temizlenir | Normal oda değerlendirmesine tek ölçüm olarak girer |
| `REFERENCE_RESET` | Doğrulanan adayın son noktası yeni referans olur | Eski kanıt dönemi kapanır; bu ölçüm oda kanıtına girmez |

## 5. Sözde kod

```text
function process(p, now, settings, state):
    if settings.D == 0:
        return EXISTING_ENGINE_PATH(p)

    if coordinatesOrTimestampInvalid(p) or tooFarInFuture(p, now):
        state.candidate = null
        return REJECT("INVALID_INPUT")

    if state.lastObservedAt != null and p.time <= state.lastObservedAt:
        return IGNORE("DUPLICATE_OR_OUT_OF_ORDER")

    state.lastObservedAt = p.time

    // Mevcut ölçüm güncelliği ve donanım kalite kontrolleri.
    if not fresh(p, now) or not hardwareQualityOK(p):
        state.candidate = null
        return REJECT(relevantQualityOrFreshnessReasons)

    if state.reference == null:
        state.reference = p
        state.candidate = null
        return ACCEPT(p)

    a = state.reference
    d = distance(a, p)
    speedOK = existingSpeedPolicy(a, p)

    if d <= settings.D and speedOK:
        state.reference = p
        state.candidate = null
        return ACCEPT(p)

    if d <= settings.D:
        // Mesafe uygun ama hız uygun değil: toparlanmayla atlatılmaz.
        state.candidate = null
        return REJECT("MEASUREMENT_REJECTED_BY_SPEED")

    // Buradan itibaren p, A'ya göre mesafe filtresinden reddedilmiştir.
    reasons = ["MEASUREMENT_REJECTED_BY_DISTANCE"]
    if not speedOK:
        reasons.add("MEASUREMENT_REJECTED_BY_SPEED")

    c = state.candidate
    if c == null:
        state.candidate = { first: p, last: p, count: 1 }
        return REJECT(reasons, candidateStatus="STARTED")

    gap = p.time - c.last.time
    span = p.time - c.first.time
    step = distance(c.last, p)
    candidateSpeedOK = step <= effectiveMaxSpeed(p) * gap / 1000
                                  + effectiveMovementTolerance(p)

    coherent = gap <= settings.G
               and span <= settings.W
               and step <= settings.D
               and distance(c.first, p) <= settings.R
               and candidateSpeedOK

    if not coherent:
        state.candidate = { first: p, last: p, count: 1 }
        return REJECT(reasons, candidateStatus="RESTARTED")

    c.last = p
    c.count = min(c.count + 1, settings.N)

    if c.count < settings.N or span < settings.T:
        return REJECT(reasons, candidateStatus="COLLECTING")

    oldReference = state.reference
    state.reference = p
    state.candidate = null
    return REFERENCE_RESET(
        oldReference, newReference=p,
        reasons=reasons + ["DISTANCE_REFERENCE_REESTABLISHED"],
        usedAsRoomEvidence=false
    )
```

`distance(a,b) = hypot(a.x-b.x, a.y-b.y)`. Eşiklerde eşitlik geçerlidir: `d = D`, `gap = G`, `span = W`, `count = N` ve `span = T` sınırları koşulları sağlar. Sıralama kontrolü sayesinde adaylar arasında `gap > 0` olur.

Ölçüm gelmeyen aralıkta zamanlayıcı `now - candidate.last.time > G` olduğunda adayı silebilir. Yeni ölçümde aynı boşluk kontrolü tekrar yapılır; doğruluk zamanlayıcının çalışmasına bağlı değildir. Zamanlayıcı tek başına aday doğrulayamaz. Oda motorunun normal eskime/kayıp zamanlayıcısı çalışmaya devam eder.

## 6. Yeniden başlangıcın oda motoruna bağlanması

`REFERENCE_RESET` geldiğinde tek işlem içinde:

1. Eski oda kanıt geçmişi, giriş/çıkış sayaçları, kapı geçişleri, doğrudan oda değişimi ve sessiz oda adayları temizlenir. Eski oda için kalan güvenilir konum/kapı çıkarımı yeni döneme taşınmaz.
2. Güncel oda ataması kaldırılır ve durum `LOCATION_LOST` olur; son bilinen oda tarihsel bilgi olarak saklanabilir. Yeni referans tek başına oda ataması veya güven artışı üretmez.
3. Eski konum ile yeni referans arasında kapı geçişi, geçiş zamanı veya rota parçası üretilmez. Yeni bir takip dönemi başlar.
4. Doğrulamayı tamamlayan nokta dahil bütün adaylar oda kanıtından dışarıda kalır. Sonraki uygun nokta yeni dönemin ilk oda kanıtıdır; normal süre/sayı/kalite/geometri kuralları uygulanır.
5. Filtrenin hız ve mesafe hesapları artık yeni referansı kullanır. Motorun eski `lastRawPosition` üzerinden ikinci kez hız kontrolü yaparak bu noktaları reddetmesi önlenir; fiziksel kabul kararı tek yerde hesaplanır.

Oda kanıtı için `lastRawDataTimestamp` ile filtrenin `reference.time` değeri karıştırılmamalıdır. Yeniden başlangıç, eski oda kanıtının geçerlilik süresini yenilemez. Konum kayıp çıktısı eski ham koordinatı güncel ve güvenilir konum gibi sunmamalıdır.

Normal `REJECT`, mevcut ret/güven düşürme yolunu kullanır; konum kanıtını ilerletmez. Adayın ilerlemesi oda motorunda görünmez bir giriş veya çıkış kanıtına dönüştürülmemelidir.

## 7. Örnek yürütmeler

Örnek ayarlar: D=3 m, R=1 m, N=3, T=1.500 ms, G=2.000 ms, W=6.000 ms; hız sınırı 4 m/sn ve tolerans 0,25 m. Bütün ölçümler güncel ve kaliteli, y=0 kabul edilmiştir.

### Yeni konum çevresinde tutarlı ölçümler

| Nokta | Zaman | x | İşlem | Oda kanıtı |
|---|---|---|---|---|
| A | 0 ms | 0 | İlk referans | Normal değerlendirmeye girer |
| B | 1.000 ms | 8 | A'dan uzak; aday 1/3 | Hayır |
| C | 2.000 ms | 8,2 | A'dan uzak, B'ye yakın; aday 2/3 | Hayır |
| D | 3.000 ms | 8,1 | 3 nokta ve 2 saniye; referans D'ye yenilenir | Hayır |
| E | 4.000 ms | 8,3 | D'den 0,2 m uzakta; normal kabul | Yeni dönemin ilk oda kanıtı |

B ve C kabul edilmiş sayılmaz. D yalnızca karşılaştırma referansıdır. E de tek başına doğrulanmış oda ataması anlamına gelmez.

### Tek sıçrama sonrası eski konuma dönüş

`A=(0,0) → B=(8,0) → C=(0.5,0)` dizisinde B aday başlatır. C normal referans A'ya yakınsa ve hız kontrolünden geçerse kabul edilir; B adayı temizlenir.

### Dağınık sıçramalar

`A=(0,0) → B=(8,0) → C=(15,0) → D=(-5,0)` dizisinde her uzak ölçüm önceki adayla tutarsızdır. Aday her seferinde bir ölçümle yeniden başlar; yeni referans doğrulanmaz.

### Aday sırasında kesinti veya kalite sorunu

B'den sonra G'den uzun boşluk varsa C yeni adayın ilk noktası olur. Güncel fakat düşük kaliteli paket aday dizisini keser. Yinelenen/sırasız paket sayılmaz ve mevcut adayı ilerletmez. N nokta çok kısa sürede gelse de T dolmadan referans yenilenmez.

## 8. İzleme ve kabul koşulları

Her mesafe reddinde eski referans, ölçülen mesafe, D, ret nedenleri ve adayın sayısı/süresi kaydedilmeli. Yeniden başlangıçta yeni referans, doğrulama süresi ve `usedAsRoomEvidence=false` bilgisi izlenmeli. Olay/alan adları öneridir; mevcut karar izi şeması ve olay sınıflandırmasına eklenmeleri gerekir.

Kabul testleri en az örnekleri, eşik eşitliklerini, sadece hız reddini, aynı zamanlı paketleri, aday zaman aşımını, uzun kesintide tek noktanın reddini, düşük kaliteyi, eski konuma dönüşü, birbirinden bağımsız tag/haritaları ve yeniden başlangıçtan sonra ilk oda kanıtının E olması kuralını kapsamalı.

Tag silme, harita değiştirme, motor kapatma ve koordinat sistemini değiştiren yapılandırma yükleme bütün filtre durumunu temizlemeli. Filtre ayarları değiştiğinde bekleyen aday iptal edilmeli; koordinat sistemi aynıysa normal referans korunabilir. Filtre kapatılıp açıldığında eski aday geri kullanılmamalı.

Bu algoritma ölçümlerin kendi içindeki tutarlılığı doğrular. Birkaç saniye aynı yanlış konumu üreten sistematik ölçüm hatası da tutarlı görünebilir; oda geometrisi ve normal oda doğrulaması bu nedenle yeni referanstan sonra da uygulanır.
