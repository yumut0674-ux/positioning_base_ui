# Saha verisi aktarım durumu — 2026-09-24

Dokuz testin tamamı `tag_location_history` tablosundan yalnız `SELECT` ile alındı. Her testte 30 saniye ısınma ve 60 saniye gözlem penceresi vardır. Toplam **3.970** satır; `raw.jsonl` SHA-256 değerleri test manifestlerinde kayıtlıdır. Bunlar veritabanında kalıcı olan tag kayıtlarıdır; canlı motorun gördüğü tüm olayları kapsadığı iddia edilmez.

| Test kısa ID | Satır | Aday tag | >5 sn teslim boşluğu | Puanlama |
|---|---:|---|---:|---|
| 731bd18d | 237 | D95660981D60BDA1 | 5 | Tek tag doğrulandı; truth rev. 2 |
| f447ebd6 | 313 | D95660981D60BDA1 | 4 | Tek tag doğrulandı; truth rev. 2 |
| beaf7415 | 208 | D95660981D60BDA1 | 0 | Tek tag doğrulandı; truth rev. 2 |
| 50b72c22 | 265 | D95660981D60BDA1 | 1 | Tek tag doğrulandı; truth rev. 2 |
| daf3b7d0 | 510 | D95660981D60BDA1, 9A8FA14BB93426F1, 06F0623201E95CE8 | 9 | Üç tag birlikte doğrulandı; truth rev. 2 |
| 88c29e66 | 548 | aynı üç tag | 11 | Üç tag birlikte doğrulandı; truth rev. 2 |
| 1681d486 | 620 | aynı üç tag | 10 | Üç tag birlikte doğrulandı; truth rev. 2 |
| a8b42398 | 509 | aynı üç tag | 9 | Üç tag birlikte; truth rev. 2 |
| 356f3a73 | 760 | aynı üç tag | 11 | Üç tag birlikte; truth rev. 2 |

Tüm satırlarda `received_at` mevcut ve ölçümden sonra; zamanlama **tam** işaretli. `quality` alanı tüm 3.970 satırda boş. Koordinat ve ölçüm zamanı eksikliği yok. 60 adet 5 saniyeyi aşan tag teslim aralığı manifestlerde başlangıç/bitiş zamanı ve süreleriyle listelenir. Tüm satırların `map_id` değeri `spor-koridor`.

İlk yedi testin doğrulanmış sonuçları `reports/field-1-confirmed-20260925/` ... `reports/field-7-confirmed-20260925/` altındadır; oda giriş tablosu `reports/first-seven-entry-success-20260925.md` dosyasındadır. Sekizinci ve dokuzuncu testin raporları `reports/field-8-clarified-20260925/` ve `reports/field-9-clarified-20260925/` altındadır. Tag eşleşmesi kök neden incelemesi `reports/tag-assignment-audit-20260925.md` dosyasındadır. Geçmiş harita snapshotı bulunmadığı için raporlar güncel harita ile replay etiketi taşır.

## 2026-09-26 eklenen iki test

Kullanıcı her iki testte yalnız `lok` tag'ının taşındığını doğruladı. `tags` tablosunda `lok` adı `D95660981D60BDA1` koduna karşılık geliyor; her iki test aralığında tek aday da bu kod. `truth.json` dosyaları bu eşleşme gerekçesiyle revizyon 2'dir. Oda aralıkları arasındaki süre koridordur.

| Test kısa ID | Satır (ısınma ve gözlem dahil) | Tag | >5 sn teslim boşluğu | Giriş sonucu | Rapor |
|---|---:|---|---:|---:|---|
| 0b8d3c99 | 404 | lok (`D95660981D60BDA1`) | 2 | 5/5 | `reports/field-20260926-0b8d3c99-current/` |
| fab02d4f | 265 | lok (`D95660981D60BDA1`) | 5 | 4/5 | `reports/field-20260926-fab02d4f-current/` |

İki aktarım da yalnız `SELECT` kullandı. Toplam 669 yeni satırın `received_at`, ölçüm zamanı ve koordinatları mevcut; zamanlama tam. `quality` alanı 669 satırın tamamında boş. Ham `raw.jsonl` ve manifest dosyaları SHA-256 ile kayıtlıdır ve eski dokuz veri kümesine dokunulmadı. Her iki rapor motor `room-evidence-8`, Git commit `7c3bcd403cd0f53d881f8bc96bc0de3b904c8fa4`, güncel `spor-koridor` configVersion `38e7f597d4f2ce19` ile üretildi. Raporların sonunda ziyaret bazlı ham konum dağılımı ve sistem hatırlatması bulunur.

## 2026-09-26 14:44:34.150 testi — üç tag doğrulandı ve puanlandı

`test-ab1564af-4f54-41e0-8b48-463e3f607ac5` için dört oda ziyareti UTC/ISO olarak kaydedildi. `tag_location_history` tablosundan yalnız `SELECT` ile 30 saniye ısınma ve 60 saniye gözlem dahil **888** ham satır aktarıldı. Adaylar `D95660981D60BDA1` (315), `9A8FA14BB93426F1` (290) ve `06F0623201E95CE8` (283). İlk `truth.json` revizyonunda tag grubu boştu ve puanlama yapılmadı. Kullanıcının üç tag'ın birlikte taşındığını doğrulaması üzerine `truth.json` revizyon 2'de bu tag'lar tek rota grubuna bağlandı. `received_at`, ölçüm zamanı ve koordinatlar tam; zamanlama tam. `quality` 888 satırın tamamında boş; 5 saniyeyi aşan 21 teslim aralığı manifestte yer alıyor. Ham dosya SHA-256: `ace88e786a33678bf344aaea3c1098ba196ad20b90aed597fa8ec1c9b107f037`.

Puanlı replay `reports/ab1564af-three-tags-20260926/` altında. Güncel motor `room-evidence-8`, güncel `spor-koridor` configVersion `364082d73273abb0` ile 12 tag-oda ziyaretinin 11'i yakalandı; zaman ağırlıklı genel doğru durum %63,676, yalnız oda içindeki doğru oda %64,239. `06F0623201E95CE8` tag'ının Oda 6 ziyareti kaçırıldı. Oda 6 ziyareti sırasında üç tag için beklenen odadaki ham paket sayısı sırasıyla 2, 1 ve 0; bu kısımdaki sonuç konum/veri kapsamı açısından ayrıca incelenmelidir.

## 2026-09-26 15:51:28.100 testi — veri kümesi eklendi

`test-734a7d51-5553-43d5-be81-dbca4c37ab71` için dört oda ziyareti `truth.json` revizyon 1'e UTC/ISO olarak kaydedildi. Kullanıcının üç tag'ın birlikte taşındığı doğrulamasıyla önceki üçlü testteki `D95660981D60BDA1`, `9A8FA14BB93426F1` ve `06F0623201E95CE8` aynı rota grubuna bağlandı. Bu aralıktaki veritabanı adayları da yalnız bu üç koddu: sırasıyla 304, 290 ve 292 paket. `tag_location_history` tablosundan yalnız `SELECT` ile, 30 saniye ısınma ve 60 saniye gözlem dahil toplam **886** ham satır aktarıldı. `received_at`, ölçüm zamanı ve koordinatlar tam; zamanlama tam. `quality` alanı tüm 886 satırda boş. Beş saniyeyi aşan **8** teslim boşluğu manifestte bulunur; en uzunları Oda 6 ziyareti yakınında 31–33 saniyedir. Ham dosya SHA-256: `ee71e7e89dc67babbdbaa65c45f1397b9789d881eb98979eb52dab4606949433`. Bu ekleme sırasında puanlı replay yapılmadı.
