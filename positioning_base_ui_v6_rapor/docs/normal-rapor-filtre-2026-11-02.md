# Normal rota raporunda önceki filtre davranışı - 02.11.2026

Kullanıcının isteğiyle normal rota PDF'sinin filtre sonrası birleştirmesi önceki sürümdeki davranışına döndürüldü. Oda ve koridor için ayrı minimum süre ayarları korunur. Önce her aralık kendi süre eşiğiyle değerlendirilir; sonra aynı Türkiye takvim günü, aynı kat/harita ve aynı konumda ardışık görünen sonuçlar tek satırda toplanır. Arada rapora alınmış başka konum varsa birleştirme yapılmaz.

Birleştirilen satırın giriş ve çıkış saatleri ilk ve son dahil edilen kaydın sınırlarını gösterir. Kalış süresi bu saatler arasındaki fark değil, dahil edilen aralıkların toplamıdır. Gizlenen oda, koridor, belirsiz konum veya veri boşluğu süresi toplam kalışa eklenmez. Bu nedenle giriş/çıkış aralığı ile kalış toplamı farklı olabilir; PDF alt notunda açıklanır. Tek tek eşik altında kalan parçalar birleştirilerek eşik üstüne çıkarılmaz.

30.10.2026 11:06-16:06 için paylaşılan örneğin yedi görünen satırı eski kuralla üç satıra dönüşür: koridor 13:52-14:02 (216,604 sn), oda 216 14:06-14:09 (183,358 sn), koridor 14:13-14:37 (730,485 sn). PDF'nin mevcut dakika yuvarlamasıyla kalışlar sırasıyla 4, 3 ve 12 dakika gösterilir.

Değişiklik yalnızca `routeReportPdf.ts` içindeki normal PDF satır seçimi/toplaması ve açıklamasındadır. Veritabanı sorgusu, temel karar/konum yorumlaması, motor, oda atamaları, canlı harita, ayarlar ve yönetici raporu değiştirilmedi. Yönetici raporunda oda > koridor > aynı oda ayrı aralıklar olmaya devam eder.
