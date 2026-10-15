# Takip algoritması ve arayüz denetimi

15 Ekim 2026 · Europe/Istanbul

## Sonuç

İstenen temel ayrım uygulanıyor: açık `stationary` paketleri oda motorunun ölçüm işleme yoluna alınmıyor; ham veri, son görülme ve arayüz gösterimi devam ediyor. Ancak bütün akışın hatasız olduğu doğrulanmadı. Üç davranış uyumsuzluğu ayrı deneylerle yeniden üretildi. Bu denetimde uygulama kaynakları veya harita ayarları değiştirilmedi.

Tarayıcı açılmadı. Denetim kaynak kod, gerçek motor sınıfları, arayüz veri bağlama/animasyon sınıfları, mevcut harita geometrisi ve otomatik testlerle yapıldı. Donanım veya canlı tarayıcı üzerinde saha doğrulaması yapılmadı.

## Mevcut akış

1. Ingest API şema, tarih ve hareket etiketi doğrulamasını yapıyor; kaynak bölgesini haritaya çözüyor. Etiket eksikse `unknown` oluyor.
2. Etkin PDOP filtresinden geçmeyen ölçümler ham yayın ve son görülme güncellemesinden önce eleniyor.
3. TrackingBuffer kabul edilen ölçümü presence servisine iletiyor; ham SSE yayını ve kayıt kuyruğu devam ediyor.
4. Controller büyük alan motoruna veriyi iletiyor; ardından açık `stationary` ölçümünü oda motoruna vermeden dönüyor. Oda motorunun kendi girişinde de aynı kontrol var.
5. `moving`, `unknown` ve etiketsiz iç ölçümler oda motorunun mevcut hız, mesafe, kalite, güncellik ve kanıt kurallarından geçiyor.
6. Arayüz ham ve işlenmiş kaynakları birleştiriyor. Güncel oda ataması varsa merkez korunuyor; atama yoksa ham konum koridor/alan gösterim filtresine veriliyor. Son veri zamanı, PDOP ve ham konum gösterimde yenileniyor; motorun saklanan kanıt zamanı değişmiyor.

## Yeniden üretilen bulgular

### 1. Motorun reddettiği hareketli ölçüm haritaya ulaşabiliyor

- Kaynak: `src/features/tracking/services/mapTrackingTags.ts:16`.
- Gerçek RegionPositionEngine, koridorda `x=1, y=-2, quality=1` ölçümünü kabul etti. Bir saniye sonraki `moving`, `x=3, y=-2, quality=0` ölçümünü `MEASUREMENT_REJECTED` olarak reddetti.
- Motorun kabul edilmiş çıktısı `x=1` olarak kaldı; mapTrackingTags ham kaynağı seçti ve MapDisplayFilter bu noktayı görünür `x=3` olarak üretti.
- Böylece özellikle oda ataması bulunmayan hareketli taglerde motorun ölçüm reddi ile harita gösterimi ayrışabiliyor. Önceden yalnız motor çıktısını kullanan gösterim davranışının aynen korunduğu söylenemez.
- Öneri: Motor tarafından işlenen hareketli/bilinmeyen ölçümlerde konumu kabul edilmiş motor çıktısından almak; ham yedek konumu yalnız açıkça motor dışında bırakılan veya henüz motor çıktısı bulunmayan durumlarda kullanmak. Canlı zaman ve ham veri ayrıntısı ayrıca güncellenebilir.

### 2. Sabit tagin koridor kararı zamanlayıcı tarafından tahmini odaya çevrilebiliyor

- Kaynak: `src/server/regionEngine/RegionPositionEngine.ts:394`; `stationary` giriş kontrolü: aynı dosyada satır 183.
- Güncel Servis haritasında ilk oda kapısının koridor tarafında 30 cm uzaklıkta bir nokta seçildi. Noktanın gerçekten tanımlı koridorda olduğu kontrol edildi.
- İlk `moving` ölçümünden sonra durum `TRACKING_OUTSIDE`, oda `null` oldu. Aynı noktadan altı adet yeni zamanlı `stationary` paket gönderildi ve her saniye gerçek motor `tick()` metodu çağrıldı.
- Sonuç: `INFERRED_IN_REGION`, `room-01`. Motorun son kabul edilmiş ölçüm zamanı ilk moving ölçümünde kaldı.
- Sebep: Sabit paketleri elemek motorun kabul edilmiş ölçüm saatinde boşluk oluşturuyor. Zamanlayıcı bu boşluğu sinyal kesintisi olarak yorumlayıp eski kapı yakınlığı kanıtından oda tahmini üretebiliyor.
- Bu, “sabit paket oda motoruna girmez” kuralını ihlal etmiyor; ancak “sabitken koridordaki gösterim/oda kararı korunur” beklentisini koşulsuz sağlamıyor.
- Öneri: Ham verinin canlılığı ile oda kanıtının zamanı ayrılmalı. Güncel sabit paketler yeni konumsal kanıt sayılmadan, yapay kesintiden yeni giriş/çıkış tahmini üretimini engelleyen ayrı bir canlılık politikasında değerlendirilmeli. Gerçek veri kesintisi için mevcut zaman aşımı korunmalı.

### 3. Yeni ham veri, eski presence gizleme kararını hemen kaldıramıyor

- Kaynak: `src/features/tracking/services/bindMapDisplayTracking.ts:17`.
- Önce 61 saniye veri almadığı için gizlenen bir presence kaydı oluşturuldu. Daha sonra bağımsız ham akış üzerinden sıfır yaşında yeni bir stationary ölçüm store'a verildi.
- Ham ölçüm ve konumu güncellendiği halde gösterim `visible:false`, `reason:no-data` kaldı. Gösterim, önceki presence kaydının `hiddenForNoData` alanını koşulsuz kullanıyor.
- Presence güncellemesi yetiştiğinde düzelebilir; akışların sırası değiştiğinde veya presence bağlantısı geciktiğinde kullanıcı taze ham veriye rağmen gizli tag görebilir.
- Öneri: Gizleme kararı en yeni doğrulanmış ham ölçümün ölçüm/alınma saatleriyle uzlaştırılmalı. Eski/yinelenen paketler canlılık sağlamamalı; gerçekten güncel ham paket eski gizleme kararından kurtarabilmeli.

## Etiket anlamıyla ilgili önemli ayrım

`unknown` ve hareket alanı bulunmayan veriler arayüzde de “Sabit” yazıyor (`tagActivityPresentation.ts:18`), fakat oda motoruna girebiliyor. Yalnız gerçek `motion_label: stationary` oda motorundan eleniyor. Dolayısıyla ekranda “Sabit” yazması tek başına paketin motora alınmadığı anlamına gelmiyor.

Sabit paketler oda motorunun mevcut zaman aşımını uzatmıyor. Oda ataması süresiz kilitlenmiyor; son hareketli/bilinmeyen kabul edilmiş ölçüm yaşlandığında tahmin veya `LOCATION_LOST` durumuna geçilebiliyor.

## Test ve derleme sonuçları

- Ana takip, harita, presence ve oda test kaydı grupları: 36 dosya, 363 test; **355 geçti, 5 başarısız, 3 atlandı**.
- Ek parametre, arayüz, oda API'si, rota ve rapor testleri: 11 dosya, 51 test. İlk koşudaki tek geçici dosya izin sorunu izinli çalışma dizininde yeniden çalıştırılarak geçti: **48 geçti, 3 atlandı**.
- Birlikte: **414 test, 403 geçti, 5 başarısız, 6 atlandı**. Bu sayılara yukarıdaki üç ayrı teşhis deneyi dahil değildir; üç deney de bulguyu yeniden üretti.
- Ana testlerin ilk kısıtlı koşusundaki geçici dosya/yerel bağlantı hataları, izinli koşuda ortadan kalktı. Rapor edilen beş hata bunlardan ayrı.
- Beş test hatası mevcut ayar beklentileriyle ilgili: iki test Yoğun Bakım PDOP filtresini açık bekliyor; dosyada `enabled:false`. Üç Servis testi kapı yakınlığını 1 m bekliyor; mevcut değerler 1,3 m. Ayarlar değiştirilmedi.
- Tam TypeScript kontrolü başarısız: `tools/room-benchmark/reports/ui-experience-5c71fd2a-20261013/analyze.ts:133` içinde `roomId` iki defa tanımlanıyor (`TS2783`). Bu eski analiz dosyasındaki hata, yukarıdaki üç akış bulgusundan ayrı.
- Üretim derlemesi (`npm run build`) başarılı.
- Atlanan altı test gerçek PostgreSQL senaryoları. Kalıcı veritabanı yazma/geri okuma doğrulaması yapılmış sayılmamalı.

## Yeniden çalıştırma

Teşhis deneyleri:

```powershell
node --import tsx output/tracking-system-audit-probes.mjs
```

Deney çıktısı: `output/tracking-system-audit-probes.json`.

Geniş test kayıtları: `output/tracking-system-audit-confirmed-tests.log`, `output/tracking-system-audit-ui-tests.log`.

Derleme kaydı: `output/tracking-system-audit-build.log`.

Bu rapor, takip/oda algoritması ve ilgili arayüz akışlarının denetimidir. Yapay zekâ servisleri, harici entegrasyonlar, bütün yönetim işlevleri ve canlı saha doğruluğu için genel bir hatasızlık garantisi değildir.
