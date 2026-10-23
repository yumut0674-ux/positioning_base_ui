# Oda motoru için hızdan bağımsız mesafe filtresi önerisi

Tarih: 12 Ekim 2026

Uygulama durumu (13 Ekim 2026): Mesafe filtresi ve kontrollü yeniden konumlanma motor, panel ve karar izine eklendi. Mevcut haritalarda **10 metre / 2 ölçüm**, en az 1.500 ms doğrulama süresiyle etkin. Aşağıdaki kapsam geliştirme tasarımını belgeler.

Güncel tasarım: Mesafe filtresi ve kontrollü yeniden konumlanma birlikte geliştirilmelidir. Adım adım işlem, sözde kod ve örnekler [algoritma belgesindedir](./oda-motoru-mesafe-filtresi-algoritmasi.md).

Oda motoruna **“Ardışık konumlar arası azami mesafe (m)”** ayarı eklenmeli. Yeni ölçüm ile aynı tag'ın aynı haritada son kabul edilen ham ölçümü arasındaki mesafe bu sınırı aşarsa, yeni ölçüm oda kararlarına kanıt olarak alınmamalı. Hız kontrolü ayrıca çalışmalı; mesafe kontrolü geçen süreden bağımsız olmalı.

## Mevcut sistemdeki karşılığı

`src/server/regionEngine/RegionPositionEngine.ts` içindeki `ingest()` bugün şu fiziksel tutarlılık koşulunu kullanıyor:

```text
mesafe ≤ maximumSpeedMetersPerSecond × Δt / 1000 + movementToleranceMeters
```

`Δt`, son kabul edilen ham ölçümden itibaren geçen milisaniyedir. Uzun aralıkta izin verilen mesafe büyür. Ayrıca aralık `relocationAfterMs` eşiğine ulaştığında mevcut hız kontrolü aşılabilir. Örneğin hız sınırı 4 m/sn ve tolerans 0,25 m iken, 3 saniyede 8 metrelik sıçrama bu kontrolden geçer.

Motor ayrıca ölçüm güncelliğini, donanım kalitesini ve geometrik kanıt ağırlığını değerlendiriyor. Yeni filtre, mevcut hız/güncellik/kalite kontrollerine eklenmeli. Harita sunumundaki `AdaptivePositionFilter` ayrı bir katmandır; oda kararlarının korunması için değişiklik sunucudaki oda motorunda yapılmalı.

## Önerilen kural ve ayar

| Konu | Öneri |
|---|---|
| Yapılandırma alanı | `engine.maximumStepDistanceMeters` |
| Panel etiketi | Ardışık konumlar arası azami mesafe (m) |
| Ayarın yeri | Oda motoru → Genel → Ölçüm filtresi; her haritanın kendi yapılandırması |
| Eski yapılandırmalarda varsayılan | `0`: filtre kapalı |
| Aktif değer | Sonlu, pozitif metre değeri; panel ve sunucuda 0–100 m doğrulaması |
| Karşılaştırma | Dünya koordinatlarında Öklid mesafesi: `Math.hypot(dx, dy)` |
| Sınır davranışı | `mesafe > eşik` reddedilir; eşitlik bu filtreden geçer |
| Hız toleransı | `movementToleranceMeters` mesafe eşiğine eklenmez |

İlk sürümde ayar harita genelinde uygulanmalı. Oda bazında farklı eşik, şüpheli noktanın düştüğü odaya göre kontrolü değiştirebilir; bu nedenle ilk kapsamda oda ve kapı override'ı önerilmiyor. Mevcut tipler ve panel genel ayarları oda override'larına da taşıdığı için yeni alan bu listelerden açıkça çıkarılmalı; sunucu oda seviyesindeki kullanımını reddetmeli.

Örnek yapılandırma parçası:

```json
{
  "engine": {
    "maximumSpeedMetersPerSecond": 4,
    "movementToleranceMeters": 0.25,
    "maximumStepDistanceMeters": 3
  }
}
```

Buradaki **3 m yalnızca davranışı anlatan örnektir**. Saha için eşik; gerçek ölçüm sıklığı, gürültü ve normal hareket mesafeleriyle seçilmeli. Başlangıç karşılaştırmasında kapalı, 2 m, 3 m ve 5 m adayları denenebilir.

Normal takip sırasında:

```text
mesafeUygun = filtreKapalı VEYA ilkGeçerliÖlçüm VEYA mesafe ≤ mesafeEşiği
hızUygun    = mevcut hız kontrolünün sonucu
kanıtaAl    = mesafeUygun VE hızUygun VE güncel VE donanımKalitesiUygun
```

“İlk ölçüm” yalnızca karşılaştırılacak önceki noktanın olmadığını belirtir; diğer filtreleri atlatmaz. Mesafe kontrolü, `history.push()`, kapı geçişi ve tüm oda kanıtı güncellemelerinden önce yapılmalı.

## Referans nokta ve ret davranışı

“Ardışık” burada **filtrelenmiş akıştaki ardışık noktalar** olarak tanımlanmalı: normal takipte karşılaştırma referansı son kabul edilen ham noktadır. Kontrollü yeniden başlangıç doğrulandığında, aday dizisinin son noktası yeni takip döneminin karşılaştırma referansı olur; oda kanıtına eklenmez. Oda merkezi, animasyon konumu, yumuşatılmış nokta veya doğrulanmamış reddedilen ham paket referans yapılmamalı.

Örnek: eşik 3 m; `A=(0,0)`, `B=(8,0)`, `C=(0.5,0)`. A kabul edilir, B reddedilir, C tekrar A ile karşılaştırılır ve diğer filtrelerden de geçerse kabul edilir. B referans yapılırsa doğru konuma dönüş de yanlışlıkla reddedilebilir; B yakınındaki ikinci hatalı nokta ise kolayca kabul edilebilir.

Reddedilen nokta için mevcut ret yolu genişletilmeli:

- `lastRawPosition`, `lastRawDataTimestamp`, kabul edilen geçmiş ve ölçüm sıklığı hesabı ilerletilmemeli.
- Giriş/çıkış sayacı, kanıt skoru, kapı geçişi, doğrudan oda değişimi ve sessiz oda kapı yakınlığı bu noktadan beslenmemeli.
- `lastSupportAt`, son güvenilir konum ve tahmini oda için kullanılan son gözlem yenilenmemeli. Retler eski konumun geçerlilik süresini uzatmamalı.
- Ham paket gözlemi (`lastSeenRawPosition` / `lastSeenRawDataTimestamp`) ve karar izindeki girdi kaydedilebilmeli. Ret, ham veriyi silmek anlamına gelmemeli.
- Yeni nokta oda ataması yaratmamalı; mevcut ret yolundaki güven düşürme ve zamanla belirsizleşme davranışı korunmalı. Eski oda süresiz geçerli tutulmamalı.

Ret kaydı `MEASUREMENT_REJECTED` olayını ve `MEASUREMENT_REJECTED_BY_DISTANCE` neden kodunu kullanmalı. İzde ölçülen mesafe, eşik ve karşılaştırılan referansın koordinat/zamanı bulunmalı. Hız ve mesafe birlikte aşılırsa iki neden de kaydedilmeli.

Önemli uygulama ayrıntısı: Bugün `reasonCode()` ve `eventType()` retleri açıklama metinlerinden çıkarıyor. Yeni mesafe açıklaması her iki yere de eklenmezse ret yanlış olay türüyle kaydedilebilir. Bu geliştirmede yeni nedenin olay sınıflandırması da test edilmeli.

## Uzun kesinti ve yeniden konumlanma kararı

**Mesafe filtresi ile kontrollü yeniden başlangıç aynı teslimde geliştirilmelidir.** Tek uzak nokta reddedilir; `longGap` mesafe kontrolünü atlatmaz. Ancak yeni noktalar sürekli eski konumdan uzak ve kendi aralarında tutarlıysa referans kontrollü biçimde yenilenir.

1. Mesafe nedeniyle reddedilen güncel ve kaliteli nokta, ayrı bir yeniden konumlanma adayı başlatır. Aday başlatmak için sinyal kesintisi veya `LOCATION_LOST` beklenmez.
2. Sonraki adayların ilk aday çevresinde kalması, kendi aralarındaki hız ve mesafe tutarlılığı, azami örnek aralığı, toplam pencere, sayı ve süre doğrulanır. Örnek başlangıç adayları 3 nokta ve en az 1,5 saniyedir; saha testinde kalibre edilir.
3. Eski referansa uygun normal bir ölçüm gelirse kabul edilir ve aday iptal edilir. Yeni aday dizisi tutarsızlaşırsa son noktayla yeniden başlar.
4. Doğrulanan dizinin son noktası yalnızca yeni karşılaştırma referansını kurar. Bu nokta dahil adaylar oda kanıtı olarak geriye dönük eklenmez; oda kararı sonraki geçerli ölçümlerle normal giriş doğrulamasından geçer.
5. Eski konumdan yeni konuma kapı geçişi veya rota çizgisi üretilmez. Önceki kanıt ve adaylar temizlenir; güncel oda ataması kaldırılır, son bilinen oda tarihsel bilgi olarak korunabilir. Yeniden başlangıç ayrıca izlenir.

Filtre referansı ile kabul edilmiş oda kanıtının konum/zamanı ayrı tutulmalıdır. Referans yenileme eski odanın geçerlilik süresini uzatmaz. Ayrıntılar ve sınır davranışları algoritma belgesinde tanımlıdır.

## Geliştirme kapsamı

| Dosya / alan | Yapılacak değişiklik |
|---|---|
| `src/features/regions/types/region.types.ts` | Global mesafe alanı; oda override tipinden çıkarılması |
| `src/features/regions/config/regionInferenceSettings.ts` | Geriye uyumlu `0` varsayılanı |
| `src/server/regionEngine/configLoader.ts` | Sonlu değer/aralık doğrulaması; yalnız global kullanım |
| `src/server/regionEngine/RegionPositionEngine.ts` | Mesafe koşulu, yeniden konumlanma aday durumu, referans yenileme, ret yolu, neden/olay sınıflandırması ve karar izi |
| `src/server/regionEngine/types.ts` | Karar izi için isteğe bağlı mesafe/eşik/referans alanları |
| `src/features/regions/components/RegionInferenceEditor.tsx` | Genel ölçüm filtresine alan; oda override listesinde gösterilmemesi |
| `src/features/regions/config/inferenceParameterHelp.ts` | Birim, eşitlik, `0` ve uzun kesinti davranışını açıklayan yardım |
| Motor ve yapılandırma testleri, kullanım belgeleri | Aşağıdaki kabul senaryoları ve yeni ayar açıklaması |

Controller zaten harita başına motor oluşturuyor ve harita değiştiren tag'ı eski motordan kaldırıyor. Mesafe referansı tag/harita bazında kalmalı; tag silme, motor kapatma ve harita geometrisi yeniden yükleme sırasında eski koordinat referansı temizlenmeli. Özellikle mevcut `reload()` kabul edilen ham konumu koruduğu için geometri değişiminde referansın yeniden kurulması ele alınmalı.

## Kabul senaryoları

| Senaryo | Beklenen sonuç |
|---|---|
| Alan yok veya `0` | Mevcut motor davranışı korunur |
| İlk güncel, kaliteli nokta | Referans kurulur; oda kararı normal kanıt kurallarına bağlıdır |
| Eşik altı / tam eşik / eşik üstü | Diğer filtrelere bağlı kabul / diğer filtrelere bağlı kabul / mesafe nedeniyle ret |
| Hız uygun, mesafe fazla | Ret; bağımsız filtrenin temel testi |
| Mesafe uygun, hız fazla | Mevcut hız reddi |
| İki sınır da aşılmış | Ret; iki neden izde görünür |
| Uzun aralıkta mesafe fazla | Mesafe reddi; `relocationAfterMs` otomatik izin vermez |
| A → uzak hatalı B → A yakını C | B reddedilir; C'nin referansı A'dır |
| Uzak konumda dağınık noktalar | Aday yeniden başlar; normal referans değişmez |
| Uzak konumda yeterli süre/sayıyla tutarlı adaylar | Yalnızca referans yenilenir; oda kanıtı sonraki geçerli ölçümle başlar |
| Ret noktasından oda/kapı/sessiz oda adaylığı | Kanıt veya yeni aday oluşmaz |
| Sürekli ret + zaman aşımı | Kabul edilen zaman yenilenmez; eski konum belirsizleşir |
| Yinelenen/sırasız, eski veya düşük kaliteli paket | Yeni referans veya toparlanma kanıtı oluşturmaz |
| İki tag veya harita geçişi | Referanslar birbirine karışmaz |
| Tag silme, motor kapatma, geometri yükleme | Eski referans yeni takip dönemine taşınmaz |
| Negatif, sonsuz, sayısal olmayan ayar / oda override'ı | Yapılandırma reddedilir |

Uygulamadan sonra aynı saha kayıtları `tools/room-benchmark` ile filtre kapalı ve aday eşiklerle yeniden çalıştırılmalı. Yanlış oda atamaları, kaçırılan ziyaretler, giriş/çıkış gecikmeleri, mesafe ret sayısı ve konum kayıp süresi birlikte karşılaştırılmalı. Daha fazla noktayı reddetmek tek başına başarı ölçütü değildir; gerçek oda ziyaretlerinin korunması da aranmalı.

Önerilen teslim sırası: mesafe filtresi + kontrollü yeniden başlangıç + panel + karar izi + kabul testleri birlikte; ardından saha karşılaştırmasıyla eşik ve aday doğrulama parametrelerinin seçimi.
