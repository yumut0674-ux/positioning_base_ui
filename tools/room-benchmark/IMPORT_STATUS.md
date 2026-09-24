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
