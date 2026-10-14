# Jetson → yerel main parametre ve yapı karşılaştırması

Tarih: 14 Ekim 2026. Karşılaştırma, uzak `jetson` dalı güncellendikten sonra yapıldı.

- Yerel main: `bfeb973895237ed65576dd05e66b2a06b805247c`
- origin/jetson: `515f51df46fc1645eadcab846fda635ff2d8d9c8`
- Jetson, main’in doğrudan devamı; main’e göre iki ek commit içeriyor.
- Üç yapılandırma dosyası farklı. Motorun TypeScript kodunda, API’de, tiplerde, veritabanı şemasında ve testlerde dal farkı yok.
- Kullanıcının aktarım isteği üzerine üç yapılandırma dosyası Jetson’dan yerel main çalışma alanına birebir kopyalandı. Dal birleştirmesi ve commit yapılmadı; main HEAD aynı kaldı.

## Commitler

| Commit | Tarih (Türkiye saati) | İçerik |
| --- | --- | --- |
| `53f7eb6` | 14.10.2026 12:44 | Yoğun bakım odalarının, alan geçiş bölgelerinin ve PDOP filtresinin ayarları |
| `515f51d` | 14.10.2026 14:38 | Servis odalarının sessiz giriş mesafeleri; 203 odasında duvar bandının açıkça yazılması |

## Davranışı değiştiren parametreler

“Varsayılan” olarak gösterilen main değerleri JSON’da yazılı değil; mevcut motorun resolve/compile işlemiyle hesaplandı.

| Dosya / yapı | Parametre | Main: etkili değer | Jetson: etkili değer | Koda göre etkisi |
| --- | --- | --- | --- | --- |
| Servis: `regions[room-01…room-18].inference` | `silentEntryMaxDistanceMeters` | 1 m | 1,3 m | Silent kapsamada ölçüm kesilince son güvenilir koridor konumunun en yakın uygun kapıya uzaklık sınırı 30 cm artar; tahmini giriş için daha uzaktaki konum aday olabilir. |
| Yoğun bakım: `regions[room-01…room-07].inference` | `wallBandMeters` | 0,35 m (varsayılan) | 0,25 m | Duvar çevresindeki zayıf kanıt bandı daralır; duvara yakın daha fazla ölçüm güvenilir kanıt ağırlığı alabilir. |
| Yoğun bakım: `regions[room-01…room-07].inference` | `sharedWallBandMeters` | 0,65 m (varsayılan) | 0,35 m | Komşu oda duvarı çevresindeki zayıf kanıt bandı daralır. |
| Yoğun bakım: yedi odanın `entrances[0]` kapısı | `approachDepthMeters` | 2 m (varsayılan) | 1 m | Kapı geçişinde iki ölçümün kapı normal eksenindeki azami uzaklığı daralır; kapı yaklaşım aday alanı da küçülür. |
| Yoğun bakım: `tracking-filter.json` | `enabled` | true | false | PDOP üst sınırı filtresi kapatılır; sonlu PDOP değerleri için 70 eşiği uygulanmaz. |

PDOP `maximumPdop` her iki dalda da 70. Servis odalarının kapı yaklaşma derinliği bu iki dal arasında değişmemiş.

### Serviste etkilenen odalar

| Oda kimliği | Oda adı | `silentEntryMaxDistanceMeters` |
| --- | --- | --- |
| room-01 | Dr Odası | 1 → 1,3 m |
| room-02 | 201 | 1 → 1,3 m |
| room-03 | 202 | 1 → 1,3 m |
| room-04 | 203 | 1 → 1,3 m |
| room-05 | 204 | 1 → 1,3 m |
| room-06 | 205 | 1 → 1,3 m |
| room-07 | 206 | 1 → 1,3 m |
| room-08 | 207 | 1 → 1,3 m |
| room-09 | 208 | 1 → 1,3 m |
| room-10 | 209 | 1 → 1,3 m |
| room-11 | 217 | 1 → 1,3 m |
| room-12 | 216 | 1 → 1,3 m |
| room-13 | 215 | 1 → 1,3 m |
| room-14 | 214 | 1 → 1,3 m |
| room-15 | 213 | 1 → 1,3 m |
| room-16 | 212 | 1 → 1,3 m |
| room-17 | 211 | 1 → 1,3 m |
| room-18 | 210 | 1 → 1,3 m |

Yoğun bakımda Oda 1–7 (`room-01`–`room-07`) aynı duvar bandı ve kapı yaklaşma değişikliklerini alıyor.

## Dosyaya eklenmiş, etkili değeri değişmeyen parametreler

| Dosya / yapı | Parametre | Main | Jetson | Sonuç |
| --- | --- | --- | --- | --- |
| Servis, 203 (`room-04`).inference | `wallBandMeters` | 0,35 m varsayılan | 0,35 m açıkça yazılmış | Davranış değişmez. |
| Yoğun bakım, engine | `relocationClusterRadiusMeters` | 1 m varsayılan | 1 m açıkça yazılmış | Davranış değişmez. |
| Yoğun bakım, engine | `relocationConfirmationDurationMs` | 1500 ms varsayılan | 1500 ms açıkça yazılmış | Davranış değişmez. |
| Yoğun bakım, engine | `relocationMaximumGapMs` | 2000 ms varsayılan | 2000 ms açıkça yazılmış | Davranış değişmez. |
| Yoğun bakım, engine | `relocationCandidateWindowMs` | 6000 ms varsayılan | 6000 ms açıkça yazılmış | Davranış değişmez. |

Yoğun bakım `engine.maximumStepDistanceMeters = 10` ve `engine.relocationConfirmationCount = 2` aynı kalmış; JSON içindeki sıraları değişmiş. İki haritanın derlenmiş global motor kuralları karşılaştırıldığında etkili fark yok.

## Yapı ve geometri değişiklikleri

- Yoğun bakımda yedi oda için `inference` nesnesi eklenmiş; mevcut motor bu alanları zaten destekliyor.
- Yedi oda kapısına `approachDepthMeters` alanı eklenmiş; kapı konumları, genişlikleri ve yön normal vektörleri aynı.
- `kind`, kapı `id` ve `label` alanlarının JSON içindeki sırası değişmiş. Alan adları, kimlikler ve oda/koridor türleri aynı.
- `largeAreas[intensive-care-area].gates` içindeki iki geçiş bölgesinin dört köşesinin pixel ve world koordinatları değişmiş.
- Bu alan geçiş bölgeleri oda kapılarından ayrı yapılar. `AreaTransitionEngine` bu poligonlarla giriş/çıkış bölgesinde bulunmayı değerlendiriyor.
- Büyük yoğun bakım alanının dış poligonu ve oda poligonları aynı. Her iki geçiş bölgesinin rolü `bidirectional`, bekleme süresi 30000 ms olarak korunmuş.

### Alan geçiş bölgelerinin world koordinatları

Koordinatlar metre; main değerleri okunabilirlik için üç ondalığa yuvarlandı. Patch dosyası tam hassasiyeti korur.

| Geçiş bölgesi | Köşe | Main (x, y) | Jetson (x, y) |
| --- | --- | --- | --- |
| intensive-care-left-gate | 1 | (1.351, -0.562) | (0.733, -1.817) |
| intensive-care-left-gate | 2 | (1.351, 0.438) | (1.191, 0.299) |
| intensive-care-left-gate | 3 | (2.650, 0.438) | (2.969, 0.329) |
| intensive-care-left-gate | 4 | (2.650, -0.562) | (3.955, -1.826) |
| intensive-care-right-gate | 1 | (1.351, 21.536) | (0.760, 21.802) |
| intensive-care-right-gate | 2 | (1.351, 22.536) | (0.210, 23.634) |
| intensive-care-right-gate | 3 | (2.650, 22.536) | (3.466, 23.765) |
| intensive-care-right-gate | 4 | (2.650, 21.536) | (3.178, 21.792) |

## Doğrulama ve aktarım

- Main ve Jetson servis/yoğun bakım yapılandırmaları mevcut `compileRegionsConfig` fonksiyonuyla başarıyla derlendi; uyarı yok.
- Her iki dalda servis 18, yoğun bakım 7 oda olarak derlendi.
- PDOP ayarları mevcut `parsePdopFilterSettings` doğrulamasını geçti.
- Aktarımdan önce patch için `git apply --check` başarılıydı. Ardından üç dosya doğrudan Jetson içeriğiyle kopyalandı; dosyaların byte düzeyinde aynı olduğu doğrulandı.
- Aktarım sonrası servis ve yoğun bakım testlerinde 14 testin 10’u geçti, 4’ü başarısız oldu. Üç servis testi eski 1 m sınırını bekliyor. Yoğun bakım geçiş testinin mevcut rotası yeni poligonlarla `AREA_EXITED_OBSERVED` üretmiyor. Jetson ile eşitliği korumak için ayarlar ve testler değiştirilmedi.
- Saha ölçümleriyle motor performansı testi yapılmadı; davranış açıklamaları mevcut kodun parametreleri nasıl kullandığına dayanıyor.

Bütün dal farkları `output/jetson-main-parametre-degisiklikleri.patch` içinde. Aktarım için yalnızca şu üç dosya yeterli:

- `config/maps/necmettin-servis/regions.json`
- `config/maps/necmettin-yogun-bakim/regions.json`
- `config/maps/necmettin-yogun-bakim/tracking-filter.json`

Aktarımdan önce patch ile uygulanabilecek komutlar (dosyalar artık kopyalandığı için yeniden uygulamak gerekmez):

```powershell
git apply --check output/jetson-main-parametre-degisiklikleri.patch
git apply output/jetson-main-parametre-degisiklikleri.patch
```
