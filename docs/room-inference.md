# UWB oda çıkarımı — uygulama ve saha doğrulaması

## Uygulanan davranış

`RegionPositionEngine` tag başına zamanla sınırlı ham geçmiş kullanır. Kapı yönü ve açıklığı, iç ölçümün duvar uzaklığı, süreklilik, zaman penceresi, hız ve isteğe bağlı donanım kalitesi birlikte değerlendirilir. Paket sayısı tek başına giriş üretmez. Yinelenen ve sırasız paketler motor kanıtına alınmaz; gecikmiş/düşük kaliteli/imkânsız ölçümler ham geçmişte kalabilir ancak oda doğrulamaz.

Koridor hareketlidir. Oda ataması `IN_REGION`, `INFERRED_IN_REGION` veya `EXIT_CANDIDATE` durumunda korunuyorsa görüntüleme koordinatı tam tanımlı merkezdir. Aday odanın merkezi görüntüleme hedefi değildir. Uzun kesintide `LOCATION_LOST`, güncel `regionId: null`, ayrı `lastKnownRegionId` ve soluk “Belirsiz” işareti kullanılır. Son bilinen merkez gösterilebilir. Merkez bir UWB ölçümü değildir.

Durumlar: `TRACKING_OUTSIDE`, `ENTRY_CANDIDATE`, `IN_REGION`, `INFERRED_IN_REGION`, `EXIT_CANDIDATE`, `LOCATION_LOST`. Her yayın kısa Türkçe nedenler içerir. `confidence` kalibre edilmemiş kanıt puanıdır; panelde olasılık yüzdesi gösterilmez.

Kapıya paralel hareket/kesinti veya yalnızca yaklaşma giriş sayılmaz. Yönlü kapı geçişi ile güvenilir iç ölçümden sonra kesinti tahmini oda üretebilir. Kesinti güveni artırmaz. Doğrulanmış oda kesintide tahmine, daha sonra belirsizliğe geçer. Genel akış durması kendi başına giriş kanıtı değildir.

Komşu oda sıçraması kapı çıkışı olmadan kısa süre içinde atamayı değiştirmez. Silent odalarda güvenilir ve kesintisiz koridor ölçümleri, sayı/süre/çıkış payı koşullarıyla kapı geçişi olmadan oda kilidini kaldırır; kapı yalnız ek kanıttır. Regular/intermittent odaların required/preferred kapı politikaları korunur. Uzun aradan sonra güçlü iç ölçümler daha uzun kanıt süresiyle yeniden konumlandırır. Sürekli çelişkili ölçümlerde de destek süresi aşılınca belirsizliğe ve yeniden konumlanmaya izin verilir. İlk kez odada görülen tag için kapı geçmişi zorunlu değildir.

## Veri sözleşmesi ve kalıcılık

- Ingest zorunlu alanları değişmedi: `type`, `tag_id`, `x`, `y`, `timestamp`. İsteğe bağlı `quality` sonlu 0–1 değeridir.
- `timestamp` / `lastRawDataTimestamp`: son gerçek ölçüm zamanı. `receivedAt`: sunucuya alınma zamanı. `publishedAt`: karar yayınının zamanı. Sentetik yayında ölçüm zamanı korunur.
- Üst düzey `x/y` görüntüleme koordinatıdır; `rawPosition` gerçek ham koordinatı ve zamanını korur. `positionSource` ayrımı devam eder.
- `regionInference`: durum, güncel oda, aday oda, son bilinen oda, nedenler, puan, `measurementKind`, ölçüm geçerliliği ve belirsizlik eşiği.
- `decisionId`, `engineVersion`, `configVersion` kararları ilişkilendirir. Config sürümü içerik SHA-256 özetidir. Motor sürümü `room-evidence-2`.
- `tag_location_history` yalnızca ham ingest verisini saklar; `received_at` ve `quality` kolonları eklendi. `tag_room_decisions` ayrı JSONB karar olaylarını saklar. Sentetik merkezler ham tabloya yazılmaz. Tekrarlanan merkez kalp atışları yeni karar olayı sayılmaz; durum değişimleri saklanır. `event_id` tekrar yazmayı önler.
- `LocationService` güncel konum, zamandaki konum ve geçmiş için saklanmış kararları kullanır. `rawPosition` ayrıca döner. Tahmini/belirsiz aralıklar ayrı etiketlenir; kararın geçerlilik süresi geçmişte de uygulanır. Tag atama zamanları karar kayıtlarına da uygulanır.
- Geçmiş `enteredAt/exitedAt` alanları geriye uyumludur. `timeMeaning: decision_effective_at` bu zamanların karar aralığı olduğunu belirtir; gözlenmeyen fiziksel geçişin kesin anı değildir. Sorgu sınırları ham ölçüm olarak kaydedilmez.
- Rota yanıtına eklenen `zoneTimeline` arayüzde yeniden oda çözümlemek yerine kullanılır. Güvenilir geçiş rotası olmadığında geçmiş haritası oda karar noktalarını çizgiyle birleştirmez, mesafe iddiası üretmez. Canlı animasyon da merkez geçişinde doğrudan görsel değişim uygular.
- Eski, karar kaydı bulunmayan geçmiş geriye uyumluluk için mevcut ham geometri çözümünü kullanır. Bu kayıtlar yeni motorla doğrulanmış ziyaretler değildir; yeni çıkarımla geriye dönük uydurma karar yazılmaz. MCP araçlarının mevcut parametreleri/zarfı korunur; yeni alanlar ek alanlardır. Harita değişince eski kayıtlar yeni geometriyle yeniden yorumlanmaz.

Kuyruklar ham/karar için ayrı ayrı 20.000 kayıtla sınırlıdır; taşan en eski kayıt sayısı durum çıktısında görünür. Karar yazımı 1.000 kayıtlık batch kullanır, başarısız batch sınırlı kuyrukta yeniden denenir. Uzun veritabanı kesintisinde bu bellek kuyruğu tam kalıcılık garantisi sağlamaz; dropped/error izlenmelidir. Motor varsayılan 5.000 tag ve tag başına 64 yakın ölçüm tutar. UI keşif listeleri de 5.000 kayıtla sınırlıdır. Gölge karşılaştırma son 1.000 ham paketle sınırlıdır.

## Harita ve kapı tanımı

`kind: room | corridor` alanını açıkça tanımlayın. Geriye uyumluluk için `corridor-*` kimliği veya “Koridor” adı merkezine sabitlenmez. Oda merkezi poligon dışında/eksikse oda çıkarıma alınmaz ve uyarı döner. Dar odalarda duvar bandı yok sayılmaz; güvenilir iç kanıt yoksa motor belirsiz kalabilir. Geometri uydurulmaz.

Bir kapının örnek ek alanları (saha koordinatı değildir):

```json
{
  "id": "door-a", "label": "A kapısı",
  "pixel": {"x": 30, "y": 0}, "world": {"x": 3, "y": 0},
  "widthMeters": 1.4,
  "inwardNormal": {"x": 0, "y": 1},
  "connectsTo": "corridor",
  "approachDepthMeters": 2,
  "crossingDepthMeters": 0.15
}
```

`inwardNormal` bu odanın içine bakar ve derleyicide normalize edilir. `connectsTo` koridor için `corridor`, diğer oda için gerçek oda kimliğidir. İki oda bağlantısında iki tarafta yönleri doğru kapı tanımlayın. Açıklık, normal ve bağlantı eksikse yalnızca eski kapı noktası korunur; yönlü geçiş çıkarımı yapılmaz. Normal, bağlantı, sonlu koordinatlar, açıklık, duvar yakınlığı ve pozitif eşikler doğrulanır. Yaklaşım/geçiş bölgeleri açıklığın iki yanındaki yönlü şeritlerdir; açıklık dışındaki duvar geçiş sayılmaz.

Oda alanları: `coverage: silent | intermittent | regular`, `expectedIntervalMs`, `wallBandMeters`, `sharedWallBandMeters` ve yalnız sessiz kapsamada kullanılan `silentEntryMaxDistanceMeters`. Duvar bandı poligon kenarlarına uzaklıktan hesaplanır; ortak duvara yakın ölçüm daha düşük ağırlıktadır. Bölge panelinde alan türü/kapsama/eşikler ve kapı JSON düzenleyicisi bulunur; kaydetme sunucu doğrulamasından geçer.

Sessiz kapsama hem ölçüm kesintisine daha uzun tolerans verir hem de `silentEntryMaxDistanceMeters > 0` olduğunda son gerçek koridor ölçümünün en yakın uygun kapıya uzaklığından tahmini oda girişi üretebilir. Bu karar hareket yönü veya `approachDepthMeters` kullanmaz; `hypot(tag.x - door.x, tag.y - door.y)` ile dünya koordinatlarında hesaplanır. Gerçek kapı geçişi ölçümü değildir, `INFERRED_IN_REGION`/`estimated` olarak yayımlanır ve yanlış pozitif riski azami mesafeyle yönetilir. Tanımsız veya `0` değer davranışı kapatır; önerilen başlangıç 1,5 metredir. Güvenilir iç ölçüm ve normal yönlü geçiş güçlü kanıt olarak önceliklidir, uzun kesintide `LOCATION_LOST` korunur.

Bu özellik için `config/regions.json` ve `config/maps/spor-koridor/regions.json` içindeki mevcut yedi sessiz odaya açıkça `silentEntryMaxDistanceMeters: 1.5` eklendi. `corridor-main` hareketli koridor olarak kalır. `config/maps/kat1-ortopedi/regions.json` içindeki düzenli kapsama odalarında yakınlık özelliği etkinleştirilmedi.

Servis haritasındaki (`config/maps/necmettin-servis/regions.json`) 18 odada sessiz kapsama ve `silentEntryMaxDistanceMeters: 2` etkindir. Kapı yaklaşma derinliği de açıkça 2 metredir. Son güvenilir koridor ölçümü kapıya en fazla 2 metre uzaktaysa sinyal kesintisinden sonra tahmini oda girişi üretilebilir; sürekli iç ölçümle giriş doğrulama eşikleri 3 saniye ve 5 ölçümdür.

## Simülasyon

Deterministik değerlendirme gerçek zaman beklemez. Fiziksel gerçek rota referans haritanın koridoruna/kapılarına uyar. Gürültü, sıçrama, kayıp ve gecikme yalnızca üretilen paketlere uygulanır. Gerçek oda ve koordinatlar yalnızca değerlendirme izinde bulunur; ingest'e verilmez.

```powershell
npm run simulate:rooms -- --scenario all --seed 42
node --import tsx test_api/simulate_tags.js --scenario neighbor-jumps --seed 17 --tags 8
npm run simulate:rooms -- --scenario all --seed 20260907 --tags 4 --speed 1.2 --noise 0.15 --loss 0.1 --outage 30000 --output test_api/results/stress
```

Seçenekler: `--scenario`, `--seed`, `--tags`, `--speed` (m/sn), `--noise` (metre, düzgün dağılımlı ± sapma), `--loss` (0–1), `--outage` (ms), `--interval` (ms), `--start-time` (ISO saat), `--output`. Fiziksel gerçek iz çözünürlüğü 250 ms'dir; paket sıklığı bundan daha hızlı örneklenmez.

13 senaryo: `corridor`, `parallel-gap`, `door-turnback`, `entry-gap`, `inside-long-gap`, `room-motion`, `shared-wall-noise`, `neighbor-jumps`, `door-transfer`, `relocation`, `first-inside`, `packet-order`, `variable-stream-gap`. Kapı geçiş kanıtından hemen sonraki kesintinin tahmini giriş üretebildiği ayrıca deterministik motor testinde sınanır. `entry-gap` kapı önündeki son ölçümden sonra kesilir; kanıt yokken tahmin üretmemesi beklenir.

Çıktılar: `reference-map.json`, `room-metrics.json`, `room-metrics.md`, `room-traces.json`. İzde `truth`, `packets`, yeni motor `events` ayrı alanlardır. Her tag bağımsız seed akışı kullanır; tag sayısını artırmak ilk tag'in akışını değiştirmez.

Canlı replay isteğe bağlıdır:

```powershell
node --import tsx test_api/simulate_tags.js --scenario door-transfer --seed 42 --endpoint http://127.0.0.1:3000/api/tracking/ingest
```

Bu komut açıkça seçilen endpoint'e gönderir ve duvar saatiyle çalışır. Yalnızca **üretilen referans haritanın yüklü olduğu ayrı test uygulamasında** kullanın; mevcut hastane haritasıyla bu koordinatlar eşleşmez. Varsayılan değerlendirme ağ isteği yapmaz. Yerel hastane config'i hiçbir komutla otomatik değiştirilmez. Eski etkileşimli `node test_api/simulate_tags.js` korunur; oda ziyaretleri artık açık kapı + geçilebilir koridor/oda bağlantısı doğrulanırsa oluşturulur. Sadece merkezden duvar kestirmesi yapılmaz.

## Sonuçlar ve sınırlar

[Seed 42 senaryo metrikleri](../test_api/results/room-metrics.md), [4 tag stres metrikleri](../test_api/results/stress/room-metrics.md).

Seed 42: 13 senaryoda yanlış yeni oda girişi 0, tamamen kaçırılan ziyaret 0. Normal/ilk oda ataması yaklaşık 2–2,75 sn; kapı önünde 40 sn veri yokken giriş 42,75 sn sonra doğrulanıyor ve 44 sn belirsiz kalınıyor. Bunun doğru zaman oranı yalnızca %28,2; “hata yok” diye başarıya dönüştürülmez. Komşu sıçrama senaryosunda yanlış oda süresi yeni motorda 0, eskide 3 sn. Normal kapı transferinde yeni motor 3 sn, eski motor 2 sn önceki odada kalıyor. Uzun kesintili yeniden konumlanmada yanlış oda süresi 25 / 37 sn, yeni motorun ikinci oda gecikmesi 26,75 sn.

Stres denemesinde de tamamen kaçırılan ziyaret ve yanlış yeni oda ataması 0; fakat paket kaybıyla kapı kanıtının kaçtığı normal transferde dört tag toplam yanlış oda süresi **38 sn**, eski motorda **10 sn**. Bu gerçek bir gecikme bedelidir; saha kabul testi olmadan üretim başarısı iddia edilmez. Yeniden konumlanma toplamı 102 / 113 sn. Raporlar belirsiz süre, doğru zaman oranı ve odadayken koridor sayılan süreyi de gösterir.

## Devreye alma ve geri dönüş

```powershell
npm run migrate:rooms
npm run test:tracking
npm run test:mcp
npm run typecheck
npm run typecheck:mcp
$env:ROOM_DATABASE_TEST='1'
npm run test:rooms:db
```

Migration `0003_room_decisions.sql` ek tablo/kolon/index kullanır; ham geçmişi silmez. Yerel `.env.local` ile uygulanıp gerçek PostgreSQL geçici tablolarında rollback yapan roundtrip testi çalıştırıldı. Farklı ortam için aynı migration'ı o ortamın normal dağıtım süreciyle uygulayın. DB testi kalıcı test tag'i veya ziyaret bırakmaz.

Bölge panelinde `engine.mode` seçimi kaydedilebilir:

- `inference`: yeni motor yayınlar ve yeni karar geçmişi yazılır.
- `shadow`: aynı ham paket iki motora gider, eski motor yayınlar; yeni kararlar üretim ziyaretine yazılmaz. Durum endpoint'indeki sınırlı `shadowComparisons` karşılaştırma için okunabilir.
- `legacy`: eski sayaç motoruna geri dönüş. Eski motorun bilinen kesinti/yanlış sıçrama kusurları da geri gelir. Yeni tarihsel kararlar silinmez.

Motoru kapatma mevcut ham akışa geri döner. Gölge/geri dönüş sırasında DB'de önceki motor kararları tarihsel kayıt olarak kalır. Canlı config yeniden yüklemesinde eski aday kanıtı atılır, yeni ölçüm beklenir.

Saha kalibrasyonu gereken varsayılanlar: 1.500 ms kanıt süresi, 12.000 ms pencere, 4.000 ms temel azami kanıt aralığı, 1.000 ms başlangıç ölçüm sıklığı, 4 m/sn hız + 0,25 m tolerans, 0,35 m duvar / 0,65 m ortak duvar bandı, 0,25 donanım kalite alt sınırı, 0,5 güçlü kanıt ağırlığı, 15.000 ms yeniden konumlanma eşiği, 30.000 ms belirsizlik tabanı. Profil kesinti çarpanları regular/intermittent/silent için 3/5/8 ölçüm aralığıdır; belirsizlik tabanı en az bu sürenin dört katıdır. Kapı genişliği/normal/bağlantı saha ölçümü; yaklaşım 2 m ve geçiş 0,15 m ise deneysel varsayılandır. Dar odalar, değişken sıklık, ortak duvar yankıları ve yüksek kayıplı gerçek kapı çıkışı öncelikli saha kabul vakalarıdır.

## Son doğrulama kaydı

2026-09-07 çalışma alanında:

| Kontrol | Sonuç |
|---|---|
| Tüm üst düzey TypeScript testleri + simülatör + MCP paketi | 130 geçti, 0 hata; DB roundtrip varsayılan pakette 1 skip |
| `ROOM_DATABASE_TEST=1` ile PostgreSQL/kalıcılık paketi | 5/5 geçti; roundtrip ayrıca gerçekten çalıştırıldı |
| Uygulama typecheck ve MCP typecheck | Geçti |
| Değişen motor/izleme/geçmiş bileşenleri ESLint | Hata/uyarı yok |
| Vinext üretim build ve rendered HTML testi | Geçti; HTML 1/1 |
| `git diff --check` | Geçti |

Yeni testler gerçek zamanlı beklemeye dayanmaz; mevcut ağ/SSE entegrasyon testleri kendi yerel sunucularını kullanır. Tarayıcıda manuel saha yürüyüşü yapılmadı. Fiziksel kapı ve kapsama kalibrasyonu teslimatın saha aşamasıdır.
