# Saha verisi aktarım durumu — 2026-09-24

## 2026-10-12 Servis — akşam iki yeni test

Kullanıcının açık kodları SELECT ad eşleşmesiyle doğrulandı: `5c71fd2a` / Mustafa (`AD5D457F2924852A`) **1.086** satır, `bd53fa7f` / cihaz (`EA0FC8F8CA447FF5`) **450** satır. Tam test ID'leri kendi dataset klasörlerinde korunuyor. Truth revizyon 1, 30 sn ısınma + 60 sn gözlem; Z saatleri UTC olarak korundu. received_at, ölçüm zamanı ve koordinat eksikliği veya negatif zaman anomalisi yok. Kalite 1.536 satırın tamamında boş. >5 sn teslim boşlukları 27 ve 5; Mustafa'nın ilk üç ziyaretini kapsayan boşluk 160,008 sn. Ham SHA-256 değerleri manifestlerde; raw dosyaları değişmez. Diğer aday taglar puanlanmadı. cihaz kaydının 9 açık koridor aralığı oda ziyareti sayılmadı; 7 gerçek oda ziyareti değerlendirildi.

Motor `room-evidence-9`, güncel Servis `aed0c3f67f66ef77`: Mustafa 11/17 yakalama, katı doğru oda %24,665 (43 sn doğrulanmış + 154,75 sn tahmini), koridorda oda 48 sn, gerçek odada yanlış oda 22,5 sn. cihaz 4/7, %42,824 (1,75 + 43,75 sn), koridorda oda 29,75 sn, gerçek odada yanlış oda 11,5 sn. ±2 sn sınır toleranslı doğru oda oranları %24,293 ve %50,160. DB canlı kaydı farklı config'ler içeriyor: Mustafa `fb44c4d5d60cc465` → `aed0c3f67f66ef77`, cihaz `1bb52386568d2067`. DB'de kayıtlı canlı ziyaret yakalamaları 11/17 ve 5/7; bunlar güncel sabit replay ile aynı deney olarak sunulmadı.

Standart JSON/Markdown/HTML, config snapshotları ve ziyaret çizelgeleri `reports/necmettin-servis-5c71fd2a-current-20261012/` ve `reports/necmettin-servis-bd53fa7f-current-20261012/` içinde. Ortak neden analizi ve kontrollü parametre deneyleri `reports/servis-late-two-20261012-analysis.md`; ham/karar ayrıntıları eş adlı JSON'da. Güncel ve deney replay'leri tekrarda deterministik; benchmark/Servis/çıkış testleri 23/23 geçti, nonincremental typecheck geçti. Canlı motor/config/UI veya DB yazma akışı değiştirilmedi; çalışma öncesi kullanıcı değişiklikleri korundu.

## 2026-10-12 Servis — Mustafa ve Tansiyon

İki test kullanıcı tarafından açık tag kodlarıyla verildi; SELECT ile adları doğrulandı, diğer adaylar puanlanmadı. `ce530aaa` / Mustafa (`AD5D457F2924852A`) 531 satır, `ca88f73a` / Tansiyon (`EC27D9C145F838EB`) 406 satır. Truth revizyon 1; UTC saatleri korunuyor. Her testte 30 sn ısınma ve 60 sn gözlem var. received_at/ölçüm/koordinat eksikliği ve negatif zaman anomalisi yok; 937 kalite değeri eksik. Büyük teslim boşlukları sırasıyla 4 ve 2. SHA-256 değerleri manifestlerde.

Motor `room-evidence-9`, güncel Servis configVersion `c61e258497587aa6` ile sabit replay: Mustafa 4/9 ziyaret, katı doğru oda %9,608 (8 sn doğrulanmış + 4,25 sn tahmini); Tansiyon 2/6, %7,190 (1,5 + 4 sn). Canlı tarihsel kararlarda test ortasında `3bf2a7e064ec0ac9` → `c61e258497587aa6` geçişi var; yeni sürümün ilk kayıtlı kararı 18:56:43.232 Europe/Istanbul. Sabit replay gerçek canlı deneyle eşdeğer sayılmadı. Ayrıntılar `reports/servis-two-20261012-analysis.md`; standart raporlar `reports/necmettin-servis-ce530aaa-current-20261012/` ve `reports/necmettin-servis-ca88f73a-current-20261012/` altında. Çalışma boyunca canlı config değiştirilmedi.

## 2026-10-13 Servis — f93aa2c0 — ham veri yok, puanlanmadı

`test-f93aa2c0-e0fc-4130-b0c5-3d1207fd120a`: kullanıcı açık tag kodu `9C76E417B4CB5ECF` ve 13 ziyareti verdi. SELECT ile aynı kodun `tagVerified:true` test oturumu ve tüm oda saatleri doğrulandı. Oturum `running`, bitiş boş; kısmi truth revizyon 1 son kapanmış ziyaret çıkışına (`2026-10-13T07:14:54.157Z`) kadar hazırlandı. Kaynak JSON ve `availability.json` eklendi; raw/manifest **oluşturulmadı**. Bu tagın tüm zamanlardaki ham konum ve kayıtlı karar sayısı 0, güncel `tags` kaydı yok. Kod biçimi ve ölçüm/teslim saatleri ayrıca kontrol edildi. Aynı aralıkta başka bir tagın 74 Servis paketi var; başka tag bu teste eşlenmedi.

Kullanıcı panelde hareketi gördüğünü doğruladı. Kaynak kodda ham yayın kayıt kontrolünden önce yapılır; kayıtlı olmayan tagın ham geçmişi ve motor kararları kalıcı DB kaydına alınmaz. Bu nedenle 13 ziyaret **başarısız sayılmadı**, doğruluk/yakalama/gecikme metrikleri bilinmiyor. Önce gerçek paket arşivi gerekir. Güncel disk motoru `room-evidence-10`, Servis configVersion `7a7a74d7f8c40ac0`. Test planı snapshotı `59c473fecb97678f` saklandı; tek fark mesafe filtresi 5 → 10 m. Ayrıntılar `reports/servis-f93aa2c0-audit-20261013/analysis.md`, JSON ve statik HTML aynı klasörde. Üretim motoru/harita veya DB yazma akışı değiştirilmedi.

## 2026-10-12 Servis — servis2

`test-4192b569-b345-4a41-a028-32b342ab4710`: kullanıcı `cihaz` tagını belirtti; SELECT ad-kod eşleşmesi `EA0FC8F8CA447FF5`. 30 saniye ısınma ve 60 saniye gözlem dahil 344 ham satır aktarıldı. Truth revizyon 1; kaynak UTC saatleri korunuyor, katı ve ±2 saniye sınır toleranslı değerlendirme var. `received_at`, ölçüm zamanı ve koordinat eksikliği yok; kalite 344 satırda boş. Teslim boşlukları 30,630 ve 26,254 saniye. Ham SHA-256: `121f4a3b71b9ba7b253522953b3d95ad52ae549a5af2da4e4f6874aa39f77121`.

Motor `room-evidence-9`, Servis configVersion `39c2b07f0a712840`: 0/4 ziyaret; katı ve toleranslı doğru oda %0. DB'deki canlı kararların motor/config sürümü aynı ve hiçbirinde oda ataması yok. Ham geçmişin canlı akışın tamamını kapsadığı varsayılmıyor. Diğer aday taglar puanlanmadı. Ayrıntılar, parametre deneyleri ve ziyaret çizelgeleri `reports/necmettin-servis-servis2-4192b569-20261012/` içinde. Canlı config veya motor değiştirilmedi.

## 2026-10-09 hastane testi

`test-f6d295ed-38a9-4e8f-a8d2-f5f6ba4b1d06`: kullanıcı `hasan` tagını doğruladı; SELECT ile kod `06F0623201E95CE8` olarak eşleştirildi. Truth revizyon 2. 456 ham satır salt okunur aktarıldı; received_at/ölçüm/koordinat eksikliği, zaman anomalisi ve >5 s teslim boşluğu yok; 456 kalite değeri eksik. Ham SHA `56fa57dca0d6925c90869fa40d6ab3d1f743a66fbd0351f7d3002979c6fd0591`. Aktif motor `room-evidence-9`, yoğun bakım configVersion `db4d1a246b950588`: 4/5 ziyaret yakalandı, zaman ağırlıklı doğru oda %28,136. Raporlar `reports/necmettin-yogun-bakim-f6d295ed-20261009/` içinde. 8 Ekim testinin belirsiz tag eşleşmesi değiştirilmedi.

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

## Necmettin Hastanesi — Yoğun Bakım, 2026-10-08

`test-2a7fecc4-d625-4091-8b6c-a5a056302913` için Oda 2 → Oda 5 → Oda 2 aralıkları `truth.json` revizyon 1'e UTC/ISO olarak kaydedildi. Kullanıcı tek tag taşıdığını, ancak hangisi olduğundan emin olmadığını belirtti. Veritabanındaki tek aday `06F0623201E95CE8` (`tags` adı `hasan`), 30 saniye ısınma ve 60 saniye gözlem dahil 441 satır. Bu kod fiziksel tag olarak doğrulanmadığı için `groups` boş ve rapor **puanlanmadı**. Salt okunur `SELECT` aktarımında `received_at`, ölçüm zamanı ve koordinat eksikliği yok; büyük teslim boşluğu yok; 441 `quality` değeri boş. Ham veri SHA-256 `a1983ab5e8040c6667724b1e6aeae57076c7fd8d8f1c21975895b38fad82fa92`. Güncel yoğun bakım haritası ve aktif motorla karar izi `reports/necmettin-yogun-bakim-2a7fecc4-unscored-20261008/` altında; ayrıntılı neden analizi `reports/necmettin-yogun-bakim-2a7fecc4-analysis.md` dosyasında. Test sırasındaki veritabanı kararları da salt okunur karşılaştırıldı: motor `room-evidence-8`, configVersion `36181d9e68761282`.
