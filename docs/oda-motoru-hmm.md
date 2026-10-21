# Olasılıksal oda motoru (room-hmm-2)

14 Ekim 2026 (16 Ekim güncellemesi: eski motor dönemine ait Jetson oturum kayıtları, tag hareket bilgisi ve Jetson kırpması). Saha geri bildirimi, Jetson kayıtları ve bu repodaki motor incelenerek hazırlandı.

## 20 Ekim: hareketsiz taglar, Umut'un 15 Ekim değişiklikleri, yoğun bakım koridoru

- Umut'un 7 commit'i birleştirildi (motion_label, tag görünürlüğü/no-data, rota geçmişi, raporlar). Umut'un
  denetleyicisi hareketsiz konumları oda motoruna hiç vermiyordu; olasılıksal motor bunları alır ve kendisi dondurur
  (eski kural motoru için Umut'un davranışı aynen duruyor).
- `stationaryFreeze` (iki haritada açık): tag hareketsizken (Jetson motion_label ya da 10 sn ölçüm aralığı) inanç ve
  karar dondurulur; veri boşlukları ve karşı odaya sıçrayan noktalar kararı değiştirmez. Koridordaki işaret son
  hareketli konumda kalır, `stationaryDisplayRefreshMs` (10 dk) bir, o süredeki ölçümlerin en yoğun 0,5 m hücresine
  (3×3 komşuluk ağırlık merkezi) 1 m'den fazla uzaksa taşınır. Hareket (IMU moving) gelince hemen normale döner.
  İlk görülen tag 60 sn dolmadan dondurulmaz. Test tagının sonuçları (servis 9, yoğun bakım 3 kayıt) değişmedi.
- Jetson v9.1 `transport.py`: ilk adrese `motion_label` eklendi (`jetson-v9.1-guncelleme/`).
- Yoğun bakım: koridorun y < 9 m bölümü x 3,9 → 4,5 m (defibrilatör). Çıkış kapısının adı karar etiketinde
  ("Yoğun Bakım alanından çıktı (… kapısı)").

## 18 Ekim (6): yoğun bakımda duran tagların "hareket ediyor gibi" görünmesi

Video (15:07–15:10) ve V2 kayıtları: hareketsiz taglar 10 sn'de bir ölçüm gönderiyor; ölçümlerin %12–19'u
önceki noktadan 1 m'den fazla uzakta (3 anchorlu çözümler), sapma p90 0,8–2,3 m. Arayüz her yeni noktaya
yürüyerek gittiği için işaret odada geziniyormuş gibi görünüyor.
Düzeltme (yalnız yoğun bakım, `stationaryDisplayHoldMeters: 3`): duruş (IMU ya da 10 sn ölçüm aralığı) süresince
koridordaki işaret ölçümlerin ortancasında sabit; ortanca 0,5 m'den az kayarsa işaret yerinde kalır; 3 m'den
uzak art arda iki ölçüm yeni yer sayılır. Duran tagın 1,5 m'den uzak tek ölçümü oda kararını çok az etkiler.
Gerçek ölçüm decisionTrace.input'ta korunur. V2 kayıtlarında işaretin kat ettiği yol: 9A8F 13,4→1,5 m,
9C76 44→4,6 m, AD5D 46→35 / 35→11 m. Test tagının oda sonuçları değişmedi; Servis birebir aynı.

## 18 Ekim (5): yoğun bakım V2 testleri (rastgele + kapı/orta/dip 30'ar sn)

Bulgular: (1) Jetson yoğun bakım bölgesi x ≥ -1,0 m ile sınırlı, oda içi çözümler cepheye kırpılıyor;
"odanın ortası" bile çoğu zaman koridorda 0–1 m'de görünüyor. Üç testte duvardan 0,8 m'ye kadar olan şeritteki
noktaların ~8–17 katı odadayken geliyor. (2) Oda 9'un kapısı haritada güney duvardaydı; kat planında batı
(koridor) duvarında sürgülü kapı (y 17,1–19,8). (3) minAnchors 4 ve ham konum (raw) yoğun bakımda iyileştirmiyor.
Düzeltme (yalnız yoğun bakım): `glassWallStripMeters 0.8`, `glassWallCorridorFloor 0.15` (cephe şeridi oda kanıtı),
`roomExitConfirmMs 3000 / roomExitNearMeters 1.6`, Oda 9 kapısı taşındı. Canlı benzeri doğru oda:
18.10-1 %63→%75, rastgele V2 %52→%68, kapı/orta/dip testi %47→%81 (kapı aşaması %58→%90).
Bedeli: odalar arası 5–8 sn'lik kısa koridor geçişlerinde önceki oda ~3 sn daha uzun görünüyor
(koridordaOda %5–23 → %14–39). Yanlış oda %0. Servis birebir aynı.

## 18 Ekim (4): yoğun bakım testi (camlı odalar), yalnız yoğun bakım ayarı

Test "Oda testi 18.10 - 2_yogun" (12 ziyaret, Oda 3 / Oda 7). Yanlış oda hiç yok; sorun kaçan ve geç
görünen ziyaretler. Odadayken Jetson noktalarının %25'i koridorda, duvarın 0–1,5 m önünde (cam);
koridordayken bu şeritte yalnız %11. Kararlı modun 6 sn girişi kısa/yarı-koridor ziyaretleri kaçırıyordu,
duvar dibi noktalar da ziyaret ortasında odadan çıkarıyordu.
Yeni ayar `roomExitConfirmMs` (varsayılan 0 = Servis değişmez) + `roomExitNearMeters`: son nokta odaya
≤1 m iken çıkış 10 sn sürmeden yayımlanmaz. `config/maps/necmettin-yogun-bakim/room-engine.json`:
`stableEntryConfirmMs 2000, roomExitConfirmMs 10000, roomExitNearMeters 1.0`.
Canlı benzeri (anchor/motion/ham konum yok): yakalanan 8→10/12, doğru oda %56→%63, giriş 5,6→3,7 sn,
yanlış oda %0, koridorda oda %3,4→%5,4. Servis 9 kayıtta birebir aynı (SKOR 15.8 önce/sonra).
Kaçan 2 ziyaret: Oda 3'te tag 37 sn boyunca koridorda 0,5 m'de göründü (oda içi nokta yok denecek kadar az);
Oda 7'de Jetson 22 sn veri vermedi, sonra Oda 3'e düşen noktalar geldi.

## 18 Ekim (3): yoğun bakımda kapı önünde duran tagların girip çıkması; servis_Cafer_V1 testi

Sebep: hareketsiz tag ~10 sn'de bir ölçüm gönderir. Hareket bayrağı (motion) gelmediği için motor
2 Hz bekliyordu; her 10 sn'lik boşluğu "odaya girdi, sessiz" diye yorumlayıp kapı önündeki tagı odaya
alıyor, sonraki koridor ölçümüyle çıkarıyordu (videoda Oda 5 ve Oda 9).
Düzeltme `inferStationaryFromCadence: 1`: aynı yerde (≤3 m) 6–16 sn arayla gelen ölçüm "tag duruyor"
sayılır (IMU bayrağıyla aynı etki, 120 sn ya da hızlı ölçüm/yer değişimi gelene kadar). Sentetik kapı
önü kayıtlarında titreme bitti; saha kayıtlarında (hareketli tag) sonuçlar değişmedi.

servis_Cafer_V1 (18.10, 23 kısa ziyaret): positions.jsonl yoktu; ham anchor kayıtlarından v9 çözücüsüyle
yeniden hesaplandı (Pi saatleri tag sıra numarasıyla hizalandı). Canlı benzeri (anchor/motion yok):
20/23 yakalandı, doğru %62, yanlış atlama 0. 202/215 ve 201/216 karşılıklı hataları: 202'de M1 duyulmuyor,
çözümlerin %87'si A11-A12-A15 ile 3 anchorlu ve ayna çözüm 215 tarafına düşüyor; yalnız x,y gelen
motor bunu ayıramaz. Jetson `minAnchors: 4` (yalnız ayar) tüm kayıtlarda: doğru %41.7→%54.3,
yakalanan 107→122/152, yanlış atlama 0→3; C1'de 202 ziyaretleri doğru.

## 18 Ekim (2): Jetson 2. adres bırakıldı, kararlı mod her tagda açık

Jetson'a ikinci adres/ek alan eklenmeyecek. Kararlı mod artık anchor bilgisine bağlı değil
(`stableEntryRequiresAnchorInfo: 0`): her ölçümle oda girişi 6 sn doğrulanır.
Kayıtlarda (anchor bilgisi olmadan, Jetson `minAnchors: 4` benzetimi): yanlış pik 12 Eki 19→1, V7 13→3;
yanlış oda-oda atlama 5→3; yakalanan ziyaret 110→102/129; SKOR 29.2→24.6 (giriş gecikmesinin bedeli).
`minAnchors` 3 kalırsa: pik 12 Eki 19→2, V7 13→1, yanlış atlama 3→0, ama yakalanan 108→89/129.
`stableEntryGraceMs` (aday odanın kısa kaybolmasını tolere eder) denendi, belirgin fark yok; 0.

## 18 Ekim: V6–V8 saha testleri ve kararlı mod

Üç yeni test (D956… tagı, Servis): V6 kapı içi/orta/iç 30'ar sn (7 oda), V7 önce kapı önünde 20 sn bekleme
+ kapı/orta/iç 30'ar sn (10 oda), V8 rastgele kısa girişler (17). Yoğun bakımdaki 5 tagın satırları çıkarıldı.
Jetson bu testlerde hâlâ `minAnchors: 3` ile çalışıyor ve anchor sayısı göndermiyor.

**V7'de kapı önü beklemesi.** Panel saatleriyle ziyaretler arasındaki koridor süreleri incelendi: yeni motor
10 beklemenin 5'inde, beklenen kapının **kendi odasını** 15–25 sn erken gösteriyordu (kapının sıfır hizası
Jetson'da oda poligonunun içine düşüyor). Ziyaret sırasında karşı odaya geçiş (205→213, 202→215, 201→216)
oda içindeki noktaların karşı odaya düşmesinden; 205/213'te bu noktalar 4+ anchorlu, motorun ayırması mümkün değil.

**Kararlı mod (`stableEntryConfirmMs: 6000`).** Jetson anchor sayısını gönderiyorsa (2. adres yaması), ölçümle
her oda girişi 6 sn doğrulanıyor; kapı önünde/eşiğinde beklemek odayı göstermiyor. Veri kesilerek giriş
etkilenmiyor. Anchor sayısı gelmiyorsa önceki davranış (1,5 sn yalnız odadan odaya) geçerli; çünkü o durumda
oda içindeki 3 anchorlu noktalar beklemeyi bozar ve girişler kaçar (denendi: 129 ziyaretten 89'u).

8 testin toplamı (129 ziyaret, ziyaret sayısıyla ağırlıklı):

| | Yakalanan | Doğru oda | Yanlış oda | Koridordayken oda | Yanlış oda atlaması | Kısa yanlış pik |
|---|---|---|---|---|---|---|
| Sahadaki gibi (anchor bilgisi yok) | 108 | %50 | %13 | %18 | 3 | 12 Ekim 26, V7 13 |
| Anchor bilgisi ile, kararlı mod kapalı | 108 | %61 | %11 | %19 | 1 | 12 Ekim 17, V7 6 |
| **Anchor bilgisi ile, kararlı mod (varsayılan)** | 103 | %54 | %11 | **%14** | 1 | **12 Ekim 3, V7 1** |

Kararlı modun bedeli girişte ~6 sn gecikme (kısa ziyaretlerde doğru oda süresi düşer). V7'de kapı önü
beklemelerinde oda gösterimi 6 beklemede 0–1 sn'ye indi (önce 15–25 sn).

Denenip kapalı bırakılanlar (toplam skorda iyileşme yok ya da yanlış atlama artırdı): kapıda bekleme
algılama (`dwellWindowMs`), az anchorlu noktayı varlık bilgisi/koridorda kullanma (`lowAnchorMode` 2/3),
çıkılan odaya dönüş önceliği (`recentExitBoost`), koridor sağ/sol tabanı (`corridorSideFloor`),
kapı uzaklığında enine ölçek (`doorAcrossScale`), karşı oda koruması (`facingReentryGuardMs`).

## 17 Ekim: ani atlamalar ve karşı oda hatasının kök nedeni

Beş saha testi (95 oda ziyareti; 12 Ekim, 16 Ekim kapı, rastgele, 1713, 1736) birlikte değerlendirildi.

**Kök neden — 3 anchorlu çözümler.** Servis'te 7 anchor var; koridorun ortalarında (y 7–10, 24–28, 38–42) tagı
çoğu zaman yalnız 3 anchor duyuyor. 3 anchorlu TDoA çözümünün koridorun karşı tarafında bir ayna çözümü vardır ve Jetson
bazen yanlışını seçiyor. Ziyaretler sırasında karşı odanın içine düşen noktaların **%92'si**, başka odaya düşenlerin
**%95'i** 3 anchorlu (doğru odaya düşenlerde bu oran %72, koridordakilerde %62).

**Düzeltme.** Motor artık 4'ten az anchorla çözülmüş noktayı oda kararında kullanmıyor (`minimumInlierAnchors: 4`);
bu noktalar sessizlik gibi değerlendiriliyor. Bilgi Jetson'dan `inlier_anchor_count` alanıyla geliyor (2. adres yaması
gönderiyor; alan yoksa filtre uygulanmaz). Aynı etki Jetson'da `solver.minAnchors: 4` ayarıyla da büyük ölçüde alınıyor.
Ayrıca odadan odaya geçişte (veya odadan çıktıktan sonraki 10 sn'de) yeni oda kanıtının 1,5 sn sürmesi gerekiyor
(`roomEntryConfirmMs`, nokta odanın 0,5 m içindeyse beklemez).

| Test | Eski motor doğru / yanlış | Yeni (önceki) doğru / yanlış | **Yeni (17 Ekim)** doğru / yanlış | Yanlış atlama önce → şimdi |
|---|---|---|---|---|
| 12 Ekim (43) | %39 / %10 | %58 / %8 | **%69 / %4** | 3 → 0 |
| 16 Ekim kapı (8) | %38 / %0 | %68 / %0 | **%63 / %0** | 0 → 0 |
| 16 Ekim rastgele (10) | %51 / %5 | %59 / %13 | **%74 / %10** | 0 → 0 |
| 1713 (11) | %30 / %2 | %60 / %4 | **%70 / %2** | 1 → 0 |
| 1736 (23) | %23 / %23 | %38 / %30 | **%44 / %21** | 2 → 0 |
| Yoğun bakım 8 Ekim (3) | %22 / %0 | %48 / %0 | **%72 / %0** | 0 → 0 |

Yakalanan ziyaret: 12 Ekim 37/43, kapı 7/8, rastgele 9/10, 1713 10/11, 1736 18/23 (eski motor 32, 5, 8, 6, 12).
Simülasyon ve hareketsiz tag kararlılığı değişmedi.

Kalan hatalar 1736'da: 205 ziyaretlerinde 206 (yan oda), 213'te 206 (karşı oda), son 201 ziyaretinde 216; 211'e
25 sn'lik girişte hiç veri yok. Bunlar anchor yerleşiminden: y≈7–10 ve y≈24–28 bölgelerinde koridorun iki duvarına
birer anchor eklemek karşı oda hatasını kaynağında çözer.

Denenip kapalı bırakılanlar (veri yetersiz/etkisiz): karşı oda olasılık tabanı (`facingRoomLikelihoodFloor`),
öğrenilmiş oda karışıklık tablosu (`learnConfusion.ts`, `room-confusion.json`) ve öğrenilmiş ızgara olasılığı
(`learnEmission.ts`, `room-emission.json`). Birini dışarıda bırakarak yapılan testte rastgele testte yanlış odayı
%13→%4'e indirdi ama koridorda oda gösterimini ve atlamaları artırdı. Oda başına kalibrasyon kaydı birikince yeniden
denenebilir; araçlar hazır.

## 16 Ekim saha testleri (kapı testi + rastgele oda testi)

Aynı tag (06F0…5CE8), Servis. Yoğun bakımda duran 5 tagın satırları (zone `neuyogun`) çıkarıldı.

| Test | Motor | Yakalanan | Odada doğru oda | Yanlış oda | Koridordayken oda |
|---|---|---|---|---|---|
| Kapı önü/kapı/iç 10'ar sn (8 ziyaret) | eski | 5/8 | %38 | %0 | %18 |
| | **yeni** | **7/8** | **%68** | %0 | %19 |
| Rastgele odalar (10 ziyaret) | eski | 8/10 | %51 | %5 | %26 |
| | yeni (önceki ayar) | 8/10 | %45 | %13 | %18 |
| | **yeni (son ayar)** | **9/10** | **%59** | %13 | %19 |
| 12 Ekim (43 ziyaret) | eski | 32/43 | %39 | %10 | %14 |
| | **yeni (son ayar)** | **37/43** | **%59** | %8 | %18 |

Son ayar değişikliği: iki komşu kapının arasında (ör. 207/208, kapılar 2 m arayla) susan tag artık koridorda bırakılmıyor; odaların toplam olasılığı ≥%70 ve en olası oda ≥%50 ise o oda tahmini gösteriliyor (`commitMostLikelyRoomOnSilence: 0.5`). 12 Ekim ve kapı testinde sonuç değişmedi, rastgele testte 207 ziyareti yakalandı. Simülasyonda yalnız "202 önünde yanal kopma" senaryosu etkilendi (doğru %50→%70, yanlış %10→%20).

Rastgele testteki kalan hatalar Jetson verisinden geliyor:

- 209'dayken 12 sn boyunca noktaların çoğu tam karşıdaki 210'un içine düşüyor (ayna hatası). Karşı oda için ölçüm tabanı (`facingRoomLikelihoodFloor`) denendi, etkisi olmadı; kapalı. Çözüm anchor yerleşimi.
- 204'ten 2 sn içinde 203'e geçişte 203 için tek nokta var; motor 204'te kaldı.

Ani atlama: karar değişim sayısı kapı testinde 107 → 45, rastgele testte 77 → 57; 12 Ekim'in 3 saatlik kaydında tag başına ~2.400 → ~500. PDOP binlerce olan sıçramalar (ör. 12:08:49'da y=0) zaten zayıf ölçüm sayılıyor, etkisi 1,5 katla sınırlı.

## 16 Ekim güncellemesi (room-hmm-2) — özet

| Değişiklik | Neden | Ölçülen etki |
|---|---|---|
| Tag hareket bilgisi (`motion` 0/1, `motion_label`) ingest'te kabul edilir, DB'ye yazılır ve motor kullanır | Hareketsiz tag 10 sn'de bir veri yollar; konumdan "hareketsiz" tahmini 25–30 sn gecikmeliydi | 12 Ekim kaydında (3 tag, 3,4 saat hareketsiz) hareketsizken yer değişimi **462 → 7** (eski motor 2.383). Simülasyonda kapı önünde hareketsiz tag yanlış oda %1,8 → %0,2 |
| Jetson'un bölge çokgenine kırptığı çözümün ham hali (`raw_x`, `raw_y`, `raw_inside=false`) oda içine düşüyorsa motor onu kullanır | 8 Ekim oturumlarında noktaların %12–27'si kırpılmış; yoğun bakımda oda içi çözümler koridor kenarına itiliyor, oda girişi ~20 sn gecikiyor | Yoğun bakım testi 2a7fecc4: doğru oda %37,7 → %47,7, giriş gecikmesi 10,8 → 5,2 sn, koridorda yanlış oda %26 → %17 |
| Jetson forwarder'a `pdop`, `motion`, `motion_label`, `raw_x`, `raw_y`, `raw_inside` eklenir; sonsuz/NaN değer `null` gönderilir | Python `json.dumps` PDOP için `Infinity` yazar; bu geçerli JSON değildir ve UI paketi 400 ile reddeder (12 Ekim kaydında 27.708 satırda 6 kez) | Paket kaybı yok |

**Kurulum sırası önemlidir:** eski UI tanımadığı alan içeren paketi `Beklenmeyen alanlar` hatasıyla reddeder. Önce UI'yi güncelleyin, sonra Jetson'a yeni alanları ekleyin.

### Gerçek kayıtla puanlama (12 Ekim, 5 test, 43 oda ziyareti)

Jetson `positions.jsonl` (UI'ye giden akışın aynısı) truth dosyalarıyla iki motorda oynatıldı (`tools/room-benchmark/field-sim/scoreJetsonLog.ts`):

| | Eski `room-evidence-10` | Yeni `room-hmm-2` |
|---|---|---|
| Yakalanan ziyaret | 32/43 | **37/43** |
| Oda içindeyken doğru oda (süre) | %38,8 | **%58,5** |
| Oda içindeyken yanlış oda | %10,2 | %8,1 |
| Koridordayken doğru (koridor) | %56,6 | **%75,7** |
| Koridordayken oda gösterme | %14,2 | %17,3 |

Bu testlerde taglar sürekli taşındığı için hareketsiz paket yok; hareket bilgisinin etkisi aşağıdaki uzun hareketsiz dönemlerde ölçüldü. Kalan ana hatalar: oda içindeki tagın verisinin yarıdan fazlasının koridora düşmesi (oda ↔ koridor dalgalanması), karşı odaya ayna hatası ve batı tarafı odalarda (iç nokta oranı %30) sessiz girişler. Ön cephe (frontage) olasılık modeli denendi; yanlış oda gösterimini %26–29'a çıkardığı için kapalı (`frontageWeight: 0`).

### Hareket bilgisi nasıl kullanılıyor

- Gerçek veride bayrak çok net: hareketliden hareketsize geçişte ilk "hareketsiz" paket son hareketli paketten ~0,5 sn sonra gelir, sonra 10,05 sn aralıkla devam eder (medyan); tag kıpırdayınca 0,6–10 sn içinde "hareketli" paket gelir.
- Tag "hareketsiz" derken: kapı/çıkış geçiş oranları ×0,001 (yer değiştiremez), beklenen veri hızı 0,08/sn (10 sn blink, kayıp payıyla), tek ölçümün etkisi en fazla 2 kat (aynı noktanın tekrarı), "ölçülen" (soluk değil) gösterim süresi 12 sn.
- "Hareketsiz" bilgisi 25 sn içinde yeni paketle doğrulanmazsa bayatlar (tag kalkıp kapsama dışına yürümüş olabilir) ve konuma dayalı tahmine dönülür. "Hareketli" bilgisi yalnız hareketsiz dönemi anında bitirir.
- Bilgi gelmezse (eski Jetson) motor eskisi gibi konumdan tahmin eder; ayarlar `motionFlagFreshMs`, `reportedStationaryRatePerSecond`, `reportedStationaryTransitionFactor`, `reportedStationaryMeasurementInfluence`.

## Sahadaki 4 hata ve kök nedenleri

| Saha gözlemi | Kök neden (eski `room-evidence-10`) |
|---|---|
| 1. Tag (örn. Oda 7) kapıya kadar geliyor, veri kopuyor; odaya almıyor, bir süre sonra tagı yok ediyor | Yoğun bakım odaları `silent` değil, bu yüzden "kapıda kesildi → odaya girdi" çıkarımı hiç çalışmıyor. Serviste de çıkarım tek bir son noktanın kapı **merkezine** ≤1,3 m olmasına bağlı. Kesinti 30 sn'yi geçince `LOCATION_LOST`. |
| 2. Sağdaki odaya girerken sola düşen 1–2 veriyle soldaki odaya atıyor | `tick()` içinde "sessiz odada **tek** güvenilir iç ölçüm yeterli" kuralı (`inferSilentRoomSample` ve 399–405. satırlar). Jetson oda içi noktaları kapı girintisine kıstırıyor; girinti iki komşu kapıyı kapsıyor (ör. 201/202 kapıları 2 m arayla). |
| 3. Çıkış kapısından çıkan tag alandan çıkarılmıyor, odanın kenarında kalıyor | Motorun "alan dışı" kavramı yok; çıkış kapısının dibindeki son koridor noktası Dr Odası kapısına 1,3 m'den yakın olunca tag Dr Odası'na atanıyor. Koridor dışı noktalar çıkış kanıtı sayılmıyor. |
| 4. 202'nin önünde kopan tag yan odaya alınmıyor, koridorda sabit duruyor | Son nokta kapı merkezine 1,3 m'den uzaksa (kapı 1,5 m genişliğinde, yanal sapma) çıkarım yok → `LOCATION_LOST`, haritada son koridor noktasında sabit. |

Ek bulgular (gerçek Jetson kayıtlarının eski motorla yeniden oynatılması):

- Eski motor her hız/mesafe reddinde, odada değilse durumu **LOCATION_LOST** yapıyor. Sahada 1–2 Hz veride ardışık nokta farkının %10'u 3 m/sn sınırını aşıyor; 10 Ekim kayıtlarında tagların sürenin **%45–60'ı "belirsiz"** görünüyor (12 Ekim: 114 durum değişimi / 12 dk). "Tag yok oluyor" şikâyetinin büyük kısmı bu.
- Gecikme kaynakları: Jetson `solutionWaitMs` 1000 ms + eski motorun 2 sn/5 ölçüm girişi + haritada `interpolationDelayMs` **5500 ms** tampon + `maximumVisualSpeedMetersPerSecond` **1 m/sn** (yürüyen insan 1,2–1,5 m/sn; işaret sürekli geride kalıyor). Ayrıca Jetson `PositionForwarder` tek iş parçacıklı FIFO kuyruk: endpoint 50 ms sürerse 20 tagda ortalama 4,9 sn, en kötü 9,7 sn gecikme (ölçüldü); 4 sn'den eski paketi eski motor "gecikmiş" diye reddediyor.
- Sahada tag başına çözüm hızı ~1–2/sn (10 Hz blink'in çoğu ≥3 anchora ulaşmıyor); hareketsiz tag 30 sn sonra 10 sn'de bir blink atıyor.

## PDOP önemli mi?

Sınırlı. 12 Ekim kaydında 1.825 noktada tekil sıçramaların PDOP medyanı 3,7, normal noktalarınki 1,9. PDOP > 20 (mevcut Servis sınırı) 25 sıçramanın yalnız 1'ini yakalıyor; PDOP > 5 ise 7'sini yakalıyor ama 51 iyi noktayı da atıyor. Artık RMS (`robust_rms_m`) sıçramaları ayırt etmiyor. Sonuç: PDOP'u **sert filtre olarak düşük tutmayın** (20 kalabilir); yeni motor PDOP > 6 olan ölçümü atmıyor, yalnız etkisini sınırlıyor. Sıçramalara karşı asıl koruma zamansal tutarlılık (aşağıda).

## Yeni motor nasıl çalışıyor

`src/server/regionEngine/RoomHmmEngine.ts`. Her tag için olasılık dağılımı tutulur: koridor (hareketli/hareketsiz), her oda (kapı tarafı ölçülebilir / iç sessiz), alan dışı (kapının hemen dışı / uzak), bilinmeyen.

- **Topoloji**: koridordan odaya geçiş yalnız o odanın kapı **açıklığına** (merkez değil, 1,5 m'lik segment) yakınken; alan dışına yalnız `largeAreas` çıkış kapısından. Odadan odaya doğrudan geçiş yok.
- **Negatif bilgi**: ölçüm gelmemesi de kanıt. Koridorda veri sürekli gelir (tag başına öğrenilen hız), oda içinde/alan dışında gelmez. Kapıda kesilen tag doğru odaya, çıkış kapısında kesilen alan dışına gider; kapılardan uzakta kesilen tag "belirsiz" olur.
- **Kapı tarafı noktaları**: kıstırma nedeniyle kapı önündeki nokta hem koridoru hem odayı destekler; karar zaman içindeki birikimle verilir.
- **Sıçramalar**: hız kapısı (1,4 m + 2 m/sn·Δt), üç tutarlı nokta gelmeden iz yeniden kurulmaz. Fiziksel olarak erişilemeyen nokta en fazla 1,5 kat etki eder. Oda içi bir nokta komşu odalar arasında en fazla 2,5 kat fark yaratır. Kapı yakınlığı oda içi noktalardan değil, koridor tarafındaki son 3 noktadan (yeniye ağırlıklı) hesaplanır.
- **Hareketsiz tag**: tag kendi bildirirse (`motion=1`) anında, bildirmezse 25–30 sn aynı yerde kalınca hareketsiz sayılır; seyrek blink'i "kayıp" sayılmaz, yer değiştirmez.
- **Jetson kırpması**: `raw_inside=false` olan çözümün ham konumu bir odanın içindeyse ölçüm olarak o kullanılır (kırpılmış x/y kapı önü koridor gibi görünür).
- **Histerezis**: yere geçiş %70, bırakma %20. Yalnız sessizlikle odaya geçmek için en az `max(2,5 sn, 4,5 / tag hızı)` kesinti gerekir. İki komşu oda başa başsa (≥1,3 kat fark yoksa) "belirsiz" denir, yazı tura atılmaz.
- **Uzun sessizlik**: oda tahmini 12 saate kadar korunur (eski motor 30 sn sonra siliyordu). Alan dışına çıkan tag `regionInference.outsideArea: true` ile yayımlanır ve haritada gizlenir.

Çıktı sözleşmesi aynıdır (`IN_REGION`, `INFERRED_IN_REGION`, `EXIT_CANDIDATE`, `ENTRY_CANDIDATE`, `TRACKING_OUTSIDE`, `LOCATION_LOST`). Karar kayıtlarındaki son gerekçe olasılıkları gösterir (ör. `206 %91, koridor %6`).

## Seçim ve geri dönüş

- `config/maps/<harita>/room-engine.json`: `{"algorithm": "hmm"}` → yeni motor; `"evidence"` → eski motor. Dosya yoksa eski motor. Servis ve yoğun bakımda `hmm` açık.
- Sahada anında geri dönüş: sunucuyu `ROOM_ENGINE_ALGORITHM=evidence` ile başlatın.
- Ayar geçersiz kılma: `{"algorithm": "hmm", "hmm": {"doorProximitySigmaMeters": 0.8}}` (alanlar `DEFAULT_ROOM_HMM_SETTINGS` içinde açıklanmıştır). Değişiklik motor yeniden etkinleştirilince/sunucu yeniden başlatılınca uygulanır.
- Bu ayar, bölge paneli `regions.json`'u yeniden yazdığı için bilinçli olarak ayrı dosyadadır.
- Servis ve yoğun bakım haritalarında görüntü gecikmesi azaltıldı: `interpolationDelayMs` 5500 → 2000, `maximumVisualSpeedMetersPerSecond` 1 → 2.

## Doğrulama

Saha benzeri simülasyon (`tools/room-benchmark/field-sim/simulate.ts`) Jetson davranışını taklit eder: koridor+kapı girintisi çokgenine kıstırma, odada derinlikle düşen alım, %15 komşu kapıya yanal kayma, %1,5 sıçrama, 10 sn hareketsiz blink, 1 sn çözüm gecikmesi, gerçek Servis/yoğun bakım haritaları ve 3 gerçek test rotası (truth dosyalarından). Her senaryo 10 tohumla, mevcut benchmark puanlamasıyla.

Normal hız (~3,5 çözüm/sn):

| Senaryo | Eski doğru oda / yanlış oda | Yeni doğru oda / yanlış oda |
|---|---|---|
| Kapıda kopma (206) | %69 / %13, giriş 8,3 sn | %100 / %0, giriş 0,6 sn |
| Komşu odaya 2 sıçrama (202→201) | %68 / %8 | %100 / %0 |
| Çıkış kapısından çıkış | alan dışı %0 (Dr Odası'na atıyor) | alan dışı %100 |
| 202 önünde 1,2 m yanal kopma | %16 / %8 | %50 / %10 (geri kalan "belirsiz") |
| Koridorda 3 dk hareketsiz | koridor doğru %26 | %96 |
| Yoğun bakım Oda 7 kapıda kopma | %0 (10/10 kaçırıldı) | %100 |
| Gerçek rota 5c71fd2a (17 ziyaret ×10) | %76, 8 kaçan | %98, 0 kaçan |
| Gerçek rota 9a7debf0 (14 ziyaret ×10) | %70, 12 kaçan | %97, 0 kaçan |

Sahaya yakın düşük hız (~1,5 çözüm/sn): gerçek rotalarda doğru oda %66–69 → %90–94; kapıda kopma %56 → %100; komşu sıçrama %22 → %90; yoğun bakım Oda 7 %0 → %76. Zayıf kalan: kapı önünden hızla geçişte kısa yanlış oda (%14 süre) ve odadan çıkışta 2–3 sn gecikme.

Gerçek Jetson kayıtlarıyla (truth yok, 6 tag): eski motorda 19–117 durum değişimi ve sürenin %8–56'sı "belirsiz". Yeni motorda 3–23 değişim (Dr Odası duvar dibinde duran bir tagda ölçülen/tahmini oda dalgalanması nedeniyle 79); "belirsiz" yalnız kayıt sonunda veya kapılardan uzakta uzun kesintide, alan dışı kararları Jetson `area_exit` olaylarıyla uyumlu.

Komutlar:

```powershell
node --import tsx --test tests/roomHmmEngine.test.ts            # 4 saha senaryosu + seçim (eski motor 7/10'unda başarısız)
node --import tsx tools/room-benchmark/field-sim/simulate.ts --seeds 10            # eski/yeni karşılaştırma
node --import tsx tools/room-benchmark/field-sim/simulate.ts --seeds 10 --recv 0.15 # ~1,5 çözüm/sn
node --import tsx tools/room-benchmark/field-sim/replayJetsonLog.ts <positions.jsonl> [--zone servis|neuyogun]
node --import tsx tools/room-benchmark/cli.ts replay <test-id> --config config/maps/necmettin-servis/regions.json --engine hmm
```

Gerçek kayıt + truth puanlaması ve hareketsizken yer değişimi sayımı:

```powershell
node --import tsx tools/room-benchmark/field-sim/scoreJetsonLog.ts <positions.jsonl> tools/room-benchmark/datasets/<test-id>/truth.json [--map necmettin-yogun-bakim] [--no-motion] [--no-solver-raw] [--trace yeni]
node --import tsx tools/room-benchmark/field-sim/replayJetsonLog.ts <positions.jsonl> --quiet [--no-motion] [--still-detail]
node --import tsx tools/room-benchmark/field-sim/simulate.ts --seeds 10 --no-motion   # hareket bilgisi göndermeyen eski Jetson
```

Simülasyona iki senaryo eklendi: S9 sızdıran odada 4 dk hareketsiz (doğru oda %88,6 → %90,8 hareket bilgisiyle), S10 Oda 7 kapısının önünde 3 dk hareketsiz (koridorda oda gösterme %1,8 → %0,2; eski motor %66).

## Jetson tarafı öneriler

0. **Yeni alanlar** (`transport.py` `PositionForwarder.enqueue` payload'ı): `pdop`, `motion`, `motion_label`, `raw_x`, `raw_y`, `raw_inside`; sayılar sonlu değilse `null`, `json.dumps(..., allow_nan=False)`. Ekteki `jetson-forwarder-alanlar.patch`. Önce UI güncellenmeli.
1. **Forwarder kuyruğu** (`transport.py` `PositionForwarder`): her tag için yalnız en yeni gönderilmemiş konumu tutun (ekteki yama). 20 tag/50 ms endpoint yükünde gecikme 4,9 sn → 0,28 sn. Mevcut Jetson sürümünde PDOP alanı eklendiği için yalnız kuyruk mantığını taşıyın.
2. `solutionWaitMs` 1000 → 400–500 ms deneyin; `skipped_insufficient` artarsa geri alın.
3. Jetson bölge çokgeni koridor + 1 m kapı girintisinden oluşuyor (yoğun bakımda girinti yok gibi: oda içi çözümler koridor kenarına itiliyor, `raw_x` −2…−3 m iken `x` +1…+2 m); oda içi tag bu girintiye çekiliyor ve girinti iki komşu kapıyı kapsıyor. Uzun vadede girintileri kapı başına ayırmak ya da odaları çokgene eklemek oda ayrımını belirgin iyileştirir (bugün yapılması gerekmiyor, yeni motor bu kıstırmayı hesaba katıyor).
4. Aynı tagın iki bölgeden (servis/neuyogun) gelen çözümleri harita değiştirdiğinde UI motoru tag durumunu sıfırlar; çok kısa bölge atlamaları görürseniz Jetson'da bölge seçimine histerezis ekleyin.
