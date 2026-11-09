# v4.2 harita ve bölge değişikliklerinin v5'e aktarımı

26 Ekim 2026.

Kaynak: `positioning_base_ui_v4.2.zip` içindeki
`positioning_base_ui_v4/positioning_base_ui_v4/` projesi.
Hedef: çalışma alanındaki `positioning_base_ui_v5/` projesi.

## Uygulanan değişiklikler

- Servis haritasının `map.json` ve `regions.json` dosyaları kaynaktan birebir aktarıldı.
- Güncel `floor-plan-dadcc1714f6c.png` görseli eklendi; `floor-plan.png` kopyası da güncellendi.
- Servis: 21 oda, 1 koridor, 1 büyük alan, 1 iki yönlü alan geçidi. Ek odalar: Hemşire Bankosu, Personel Odası, Derslik. Derslikte iki koridor kapısı var.
- Oda ve koridor poligonları, oda merkezleri, kapı geometrileri ve alan giriş/çıkış geçidi v4.2'deki kayıtlarla aynı.
- Bölge dosyasındaki animasyon ayarları da taşındı: tampon gecikmesi 5500 ms, azami görsel hız 1 m/sn.
- Mevcut kalibrasyon, diğer haritalar ve v5 uygulama/motor kaynak kodları değiştirilmedi.
- Harita kataloğu testindeki görsel özeti ve oda sayısı ile Servis geometri testleri yeni çizimlere göre güncellendi. Servis kullanım belgesi güncellendi.

Görsel SHA-256:
`dadcc1714f6c8a259ddf6955213b66b594323a1fc79a04c6c7f5ccc943fe514c`

## Doğrulama

- Harita test paketi: **126 başarılı, 0 başarısız, 1 atlandı**. Atlanan test gerçek PostgreSQL bağlantısı gerektiriyor.
- Takip test paketi: **243 başarılı, 2 ortam kaynaklı başarısız, 3 atlandı**. İki başarısız test yerel HTTP/SSE sunucusuna bağlantı kuruyor. Bu ortamda basit yerel HTTP denemesi de `connect EACCES 127.0.0.1` hatası verdi. Atlanan testler gerçek PostgreSQL bağlantısı gerektiriyor.
- Yeni Servis yapılandırması derlendi: 21 oda, 1 koridor, **0 motor uyarısı**.
- Harita API'si ve bölge editöründe görsel/kalibrasyon uyumu; 21 odanın giriş/çıkışı, kapı yakınlığı, kapı yönleri, poligon iç alanlarının ayrılığı ve güncel alan geçidinden gözlenen çıkış doğrulandı.
- Testler Node 22.18.0 ve çalışma alanındaki mevcut komşu proje bağımlılıklarıyla çalıştırıldı. Test geçici dizini çalışma alanına taşındı ve çalışan servislerle çakışmaması için testte boş bir port kullanıldı.
- Canlı Jetson/PostgreSQL bağlantısı, tarayıcı testi ve üretim derlemesi yapılmadı.

Tam çıktılar: `harita-testleri.log`, `takip-testleri.log`.
Değiştirilen mevcut v5 dosyalarının yedeği: `onceki-v5/`.
Test yedekleri TypeScript derlemesine karışmaması için `.bak` uzantısıyla saklandı.

Güncellenmiş kaynak paketi çalışma alanı kökündeki
`positioning_base_ui_v5_harita_guncel.zip` dosyasındadır. Paket güncel v5
kaynaklarını içerir; yerel ortam dosyaları, çalışma verileri, bağımlılıklar,
derleme çıktıları ve inceleme/yedek klasörü pakete dahil edilmez.
