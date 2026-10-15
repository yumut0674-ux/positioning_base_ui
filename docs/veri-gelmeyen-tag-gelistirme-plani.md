# Veri gelmeyen tagların gösterimi — geliştirme planı

Tarih: 15 Ekim 2026

Bu belge geliştirmeye temel olan planı açıklar. Özellik ve aşağıdaki Ayarlar paneli uygulandı. Kullanıcı son kabul testlerini kendisi yapacaktır.

Uygulanan ayar konumu: **Sol panel → Ayarlar → Takip ve konum → Veri gelmeyen taglar**. Genel Ayarlar ekranı kategori kaydı ve ayrı düzenleyiciler üzerinden genişletilebilir. Sistem ayarları sürümlü `config/system-settings.json` dosyasında tutulur; gizleme süresi 1–86400 tam saniye arasında kaydedilebilir. Başlangıç değeri 60 saniyedir. Masaüstünde panel kendi içinde, mobilde sayfa akışı içinde kaydırılır.

Gecikmiş paketlerin eski konumu canlı göstermemesi için sunucu hem son alınma hem son ölçüm yaşını kontrol eder. Bu belgenin aşağıdaki tasarım tablosundaki ilk ayar konumu/dosya önerisinin yerini yukarıdaki genel Ayarlar yapısı almıştır.

## 1. Hedef davranış ve varsayımlar

Ayarlanabilir bir süre boyunca yeni ham konum verisi alınmayan ve motorun güncel bir oda ataması bulunmayan tag, canlı haritadan kaldırılmalı. Tag kaydı, geçmişi ve etiket listesindeki satırı korunmalı. Listede son ölçümün katı ve oda/alanı, **Güvenilir değil** uyarısıyla gösterilmeli.

Planın iki yorumu açıkça şöyledir:

- “Arayüzden silme”, haritadaki tag işaretini ve canlı izini gizlemek anlamındadır. Etiket listesinden veya veritabanından silme yapılmaz.
- “Oda kararı üretilmemiş”, **şu anda geçerli bir oda ataması bulunmaması** anlamındadır. Geçmişte oda kararı verilmiş olması tek başına haritada kalma hakkı sağlamaz.

Örnek liste satırı:

> TAG-031 · Ekipman A  
> Son görüldüğü yer: 1. Kat · Oda 103 — **Güvenilir değil**  
> Son veri: 2 dk önce · Haritada gizli

## 2. Mevcut sistemdeki ilgili noktalar

| Mevcut bölüm | İncelemede görülen davranış |
|---|---|
| `src/features/tracking/types/tracking.types.ts` | `TAG_LIVE_TIMEOUT_MS = 10_000`; canlı/pasif ayrımı mevcut. |
| `src/app/store/useIpsStore.ts` | `refreshTagActivity` tagları pasife geçiriyor; süre dolunca haritadan kaldırmıyor. Ham gözlemler `observedTags`, gösterim/kararlar `tags` içinde tutuluyor. |
| `src/features/tracking/hooks/useRealtimeTracking.ts` | Ham ve motor tarafından işlenmiş SSE akışları ayrı dinleniyor; etkinlik saniyede bir yenileniyor. |
| `src/features/tracking/services/roomDisplayPolicy.ts` | `assignedDisplayRoomId`, mevcut oda atamasını aday ve son bilinen odadan ayırıyor. |
| `src/features/tracking/services/MapDisplayFilter.ts` | Bölge dışına çıkmaya bağlı gizleme var; bu, veri kesilmesine bağlı gizlemeden farklı bir kural. |
| `src/features/tracking/services/bindMapDisplayTracking.ts` | Motor açıkken `tags`, kapalıyken `observedTags` harita kaynağı oluyor. Yeni kural her iki yola da uygulanmalı. |
| `src/features/tracking/components/TagInformationPanel.tsx` | Harita yanındaki Takip Etiketleri listesi ve seçili tag detayı. |
| `app/tags/page.tsx` | Takip Etiketi Yönetimi tablosu; son görüldüğü yer sütunu eklenecek ikinci ekran. |
| `src/server/regionEngine/RegionPositionEngine.ts` | Ölçüm olmadan da zamanlayıcıyla karar yayımlayabiliyor; `LOCATION_LOST`, oda ataması ve `lastKnownRegionId` ayrımı mevcut. |
| `src/server/trackingBuffer.ts` | Kabul edilen ham konumlara sunucu `receivedAt` zamanı ekleniyor; ham geçmiş saklanıyor. |

## 3. Parametre ve karar kuralı

Sistem genelinde tek bir ayarla başlanmalı:

| Alan | Öneri |
|---|---|
| Teknik ad | `noDataHideAfterMs` |
| Başlangıç değeri | `60000` ms / 60 saniye |
| Arayüz adı | Oda kararı olmayan tagı gizleme süresi |
| Ayar yeri | Takip Etiketi Yönetimi → Takip ayarları |
| Doğrulama | Pozitif tam sayı; arayüzde saniye, sunucuda milisaniye |
| Kapsam | Tüm katlar ve tarayıcılar için aynı değer; oda motoru kapalıyken de geçerli |
| Kalıcılık | Ayrı `config/tracking-presence.json` dosyası ve sunucu ayar servisi |

Bu ayar mevcut 10 saniyelik canlı/pasif eşiğinden, oda motorunun `lostAfterMs` değerinden ve animasyonun `stalePositionTimeoutMs` değerinden bağımsız olmalı. Ayarın kaydedilmesi oda motorunu sıfırlamamalı; mevcut taglar yeni süreyle tekrar değerlendirilmeli.

```text
sessizlikSüresi = sunucuŞimdi - sonYeniHamVeriAlınmaZamanı
gizle = sessizlikSüresi > noDataHideAfterMs
        VE güncelGeçerliOdaAtamasıYok
```

Tam 60.000 ms anında eşik aşılmamış sayılır; ilk sonraki kontrolde gizlenir. Saniyelik kontrol kullanılırsa hedef, eşik aşıldıktan sonra en geç bir kontrol aralığında gizlemedir.

### Geçerli oda ataması

- Motor açık olmalı, karar tagın son bilinen haritasına ve etkin motor/yapılandırmaya ait olmalı.
- `assignedDisplayRoomId` politikasındaki `IN_REGION`, `INFERRED_IN_REGION`, `EXIT_CANDIDATE` ve desteklenen `ROOM_TRANSITIONED` durumları temel alınmalı.
- Atama gerçek bir oda bölgesine ait olmalı; koridor bu istisnayı sağlamamalı.
- `ENTRY_CANDIDATE`, `TRACKING_OUTSIDE`, `LOCATION_LOST`, yalnız `candidateRegionId` veya yalnız `lastKnownRegionId` bulunması istisna sağlamaz.
- `uncertainAfter` süresi dolmuş karar güncel kabul edilmemeli. `validUntil` aşılması ise tek başına atamayı kaldırmaz; motor bu noktada tahmini oda durumuna geçebilir.
- Motor devre dışı kaldığında, harita değiştiğinde veya karar yeniden doğrulama gerektirdiğinde önceki atama yeniden değerlendirilir.

Motorun hâlâ geçerli kabul ettiği tahmini oda ataması varsa tag bu yeni kuralla gizlenmez; mevcut **Tahmin edilen** açıklaması korunur. Atama geçerliliğini kaybettiğinde sessizlik eşiği zaten aşılmışsa ek 60 saniye beklenmez.

## 4. Son veri ve son konum modeli

Sunucuda tag başına şu bilgiler ayrı tutulmalı:

- `lastRawReceivedAt`: son yeni, kabul edilmiş ham konumun sunucuya geliş zamanı; gizleme süresinin kaynağı.
- `lastRawMeasuredAt`: cihazın ölçüm zamanı; paket sırası ve veri yaşı kontrolü için.
- `lastObservedLocation`: son ham ölçümün `mapId`, kat/harita adı, `x/y`, oda/koridor kimliği ve adı, ölçüm ve alınma zamanı.
- `currentRoomAssignment`: güncel motor kararının harita/oda kimliği, durumu, geçerlilik zamanı ve sürüm bilgisi.
- Türetilen gösterim alanları: `hiddenForNoData`, `hiddenSince`, `locationReliability` ve neden kodu `NO_DATA_WITHOUT_ROOM_ASSIGNMENT`.

“Veri” bu kapsamda mevcut ingest/PDOP kabul politikasından geçen yeni ham konum paketidir. Motorun sonraki mesafe veya oda kanıtı filtresinde reddettiği bir paket, ham veri gelişini yine gösterebilir; geçerli oda kanıtı oluşturmaz. Ingest tarafından tamamen düşürülen paketler mevcut kabul politikasına uygun olarak bu sayacı yenilemez.

Motorun zamanlayıcı yayınları, `publishedAt`, SSE heartbeat mesajları ve animasyon kareleri bu süreyi yenilememeli. Tekrarlanan, sıra dışı veya eski verinin yeniden oynatıldığı paketler de konumu güncel hâle getirmemeli. Paket yeniliği ölçüm sırasıyla; gecikmiş paketlerin güncelliği ölçüm yaşıyla kontrol edilmeli. Bu kontrol mevcut motor filtrelerini gevşetmemeli.

Son konum, çizilmiş oda merkezi veya koridora yansıtılmış gösterim noktasından çıkarılmamalı. Son ham ölçümün kendi haritasındaki bölge geometrisinden hesaplanmalı:

1. Tek bir oda/alan belirlenebiliyorsa o kat ve oda/alan yazılır. Bu geometrik eşleşme, motor tarafından doğrulanmış oda ataması sayılmaz.
2. Son ölçüm koridordaysa oda adı yerine koridor yazılır; daha eski bir oda kararıyla üzeri örtülmez.
3. Oda bulunamıyor veya birden fazla oda eşleşiyorsa `1. Kat · Oda belirlenemedi` gösterilir.
4. Kat çözülemiyorsa `Kat belirlenemedi`; hiç konum verisi yoksa `Henüz veri alınmadı` gösterilir.

Kat/oda adları gözlem anındaki bilgiyle saklanmalı. Sonradan harita geometrisinin değiştirilmesi geçmiş konumu sessizce yeniden adlandırmamalı.

## 5. Sunucu, kalıcılık ve akış

Karar sunucuda üretilmeli; tarayıcı listesi ile harita aynı durumu tüketmeli.

1. Yeni bir `TagPresenceService` ham veri kabulünü ve motor kararlarını birleştirir. Oda motoru kapalıyken de çalışır. Oda kararı güncellenirse, ham paket gelmesini beklemeden görünürlüğü tekrar hesaplar.
2. Tek bir saniyelik zamanlayıcı süreleri denetler; tag başına zamanlayıcı kurulmaz. Aynı çevrimde motorun zaman aşımı kararı önce işlenir, görünürlük ardından hesaplanır.
3. `tag_presence_state` özet kaydı, son ham gözlemi ve ona ait konum etiketini kalıcı tutar. Her saniye tüm satırları yazmak yerine yeni gözlem ve durum değişimleri toplu kaydedilir. Ham ölçüm ve oda geçmişi kayıtları korunur.
4. Yeni bir snapshot ve durum SSE uç noktası, ilk açılışta mevcut durumu ve sonrasında değişimleri verir. Olaylar tag başına artan sürüm taşır; snapshot ile canlı olaylar arasında eski verinin yeni durumu ezmesi önlenir.
5. Sayfa yenileme, SSE yeniden bağlanma ve sunucu yeniden başlatma sonrasında aynı son gözlem yüklenir. Diskteki eski motor kararı doğrudan güncel atama sayılmaz; motorun yeniden doğrulaması gerekir.
6. Motorun periyodik yayınlarıyla gizlenmiş tagın tekrar görünmesi engellenir. Sonraki yeni ham veri veya geçerli yeni oda ataması görünürlüğü tekrar hesaplatır.
7. Tarayıcı bağlantısı koparsa kullanıcıya bağlantı durumu gösterilir. Tarayıcının veri alamaması, sunucuda tag verisinin kesildiğinin kanıtı sayılmaz; yeniden bağlantıda snapshot alınır.

Yeni uç noktalar mevcut dağıtımın aynı erişim kurallarını izlemeli. Özetler kayıtlı taglarda kalıcı tutulmalı; kayıtsız yayıncılar mevcut bellek sınırlarıyla ele alınmalı ve kalıcı arşiv oluşturulmamalı.

## 6. Arayüz değişiklikleri

- `TrackedTag`/durum tipleri ve Zustand store, son gözlem ile sunucunun görünürlük kararını taşımalı. Tag nesnesi store'dan silinmemeli.
- `bindMapDisplayTracking` ve `MapDisplayFilter`, motor açık/kapalı iki veri kaynağında da yeni durumu uygulamalı. Görünürlük, mevcut bölge filtresiyle birlikte değerlendirilir: bu kuraldan izin almak tek başına haritada gösterilmeyi garanti etmez.
- `MapTagDisplay.reason` için yeni neden eklenmeli. Tag işareti, canlı izi ve animasyon kaydı gizlenmeli; yeni veri geldiğinde eski iz üzerinden atlayan bir animasyon oluşmamalı.
- `TagInformationPanel` masaüstü ve mobil listelerinde aynı son konum metni, **Güvenilir değil** rozeti, son veri zamanı ve haritada gizli bilgisi gösterilmeli.
- `app/tags/page.tsx` tablosuna **Son görüldüğü yer** alanı eklenmeli; aynı ortak sunum fonksiyonu kullanılmalı.
- Gizli tag seçiliyken detay paneli açık kalmalı. “Haritada göster/odakla” kontrolü tagı yeniden görünür yapmamalı; konumun güncel olmadığı açıklanmalı.
- Son konumun yanında “bu odada kalma süresi” sayacı yürütülmemeli; **son veriden beri geçen süre** gösterilmeli.
- Yeni veriyle gizleme nedeni kalkar; etiketin güvenilirlik açıklaması gelen ölçüm ve motor kararından yeniden hesaplanır. İlk paket otomatik olarak güvenilir oda kararı sayılmaz.

## 7. Geliştirme sırası ve kabul testleri

| Adım | Teslim |
|---|---|
| 1 | Ayar şeması, varsayılan değer, karar fonksiyonu ve durum tipleri |
| 2 | Ham veri/motor entegrasyonu, son konum çözümleme ve kalıcı özet |
| 3 | Snapshot + SSE, sürümleme ve yeniden bağlantı davranışı |
| 4 | Harita görünürlüğü, iz/animasyon temizliği ve seçili tag davranışı |
| 5 | Etiket listesi, detay paneli, yönetim tablosu ve ayar alanı |
| 6 | Davranış testleri, mevcut ilgili testler, tip kontrolü ve build |

Sahte saatle doğrulanacak temel senaryolar:

| Senaryo | Beklenen sonuç |
|---|---|
| Oda ataması yok, son veriden 59.999 ms veya 60.000 ms geçti | Bu kural nedeniyle gizlenmez. |
| Oda ataması yok, 60.000 ms aşıldı | En geç bir kontrol aralığında haritadan ve canlı izden gizlenir; listede son yer ve **Güvenilir değil** kalır. |
| 60 saniye aşıldı, geçerli tahmini oda ataması var | Bu kuralla gizlenmez; **Tahmin edilen** açıklaması korunur. |
| Oda ataması `LOCATION_LOST` oldu veya `uncertainAfter` doldu | Eşik aşılmışsa hemen gizleme değerlendirilir. |
| Yalnız oda adayı veya geçmiş oda kimliği var | Gizlemeyi engellemez. |
| Motor periyodik/sentetik konum yayımlıyor | Son ham veri saati değişmez; gizli tag tekrar belirmez. |
| Motor kapalı, harita değişiyor veya farklı kat açık | Aynı kural uygulanır; son yer tagın kendi katından gelir. |
| Son ham nokta koridorda, eski karar bir odada | Son görüldüğü yer koridor olur. |
| Geçerli yeni ham veri geldi | Gizleme nedeni kaldırılır; mevcut bölge/gösterim kuralları yeniden uygulanır. |
| Aynı/eski paket, geç gelen eski durum olayı | Sayaç ve görünürlük geriye alınmaz. |
| Sayfa yenilendi, yeni istemci bağlandı veya sunucu yeniden başladı | Son gözlem korunur; eski oda kararı doğrulanmadan geçerli sayılmaz. |
| Süre 60 saniyeden 30/120 saniyeye değişti | Mevcut taglar yeniden değerlendirilir; oda motoru sıfırlanmaz. |
| Ingest/PDOP veya motor filtresi paketi reddetti | Yukarıda tanımlanan ham kabul ve oda kanıtı ayrımı korunur. |
| Kayıtlı tag, kayıtsız tag veya hiç veri almamış tag | Kayıtlar silinmez; uygun son konum/boş durum metni gösterilir. |

Yeni test dosyaları `tests/tagPresence.test.ts`, `tests/tagPresenceApi.test.ts` ve `tests/tagPresencePersistence.test.ts` olarak eklenebilir. Mevcut `tagUpdateOrdering`, `tagInformationPanel`, `tagManagementPanel`, `mapDisplayFilter`, `multifloorTracking` ve `regionPositionEngine` testlerine ilgili regresyon senaryoları eklenmeli. Son doğrulamada ilgili testler, `npm run typecheck` ve `npm run build` çalıştırılmalı; masaüstü/mobil görünüm kontrol edilmeli.

Tamamlanma ölçütü: **60 saniyeden uzun süredir yeni veri alınmayan ve geçerli oda ataması olmayan tag hiçbir canlı haritada görünmez; etiket listelerinde son kat/oda bilgisi “Güvenilir değil” uyarısıyla korunur ve yeni veri geldiğinde durum kendiliğinden güncellenir.**
