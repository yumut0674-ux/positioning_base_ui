# Hızlı geçiş tarih ve süre gösterimi — 03.11.2026

## Plan ve kapsam

1. Süre sunumunda 24 saat sınırını uygulamak: 24 saat altındaki dakika/saniye ve saat/dakika gösterimini korumak; 24 saatten itibaren gün, kalan saat ve dakikayı göstermek.
2. Hızlı geçiş listesi, seçili etiket kartı ve son görüldüğü yer alanındaki çıkış zamanlarını `GG.AA.YYYY SS:dd:ss` biçiminde, `Europe/Istanbul` saat diliminde sunmak. Tarihi güncel saatten veya yayımlanma zamanından değil, mevcut çıkış olayının zamanından almak.
3. Seçili etiket kartındaki “Güncel veri ve geçerli oda kararı olmadığı için haritada gizli.” açıklamasını kaldırmak. Güvenilirlik rozeti ve mevcut harita düğmesi davranışını korumak. Uzayan geçmiş durum satırının dar ekranlarda alt satıra geçmesini sağlamak.
4. Süre sınırlarını, İstanbul tarihinin UTC tarihinden farklı olduğu gece saatini, canlı/arşiv çıkışlarını ve masaüstü/mobil bileşenlerini doğrulamak; mevcut takip ve oda kararı testlerini çalıştırmak.

## Uygulama

- `119 sa 57 dk önce` artık `4 gün 23 sa 57 dk önce`; tam 24 saat `1 gün 0 sa 0 dk` olarak gösterilir.
- Çıkış örneği: `Yoğun Bakım alanından çıktı (Sağ koridor giriş / çıkış kapısı) · 03.11.2026 13:29:41`.
- Tarihli canlı çıkış metni ayrı UI sunum yardımcısında oluşturulur. `roomDecisionLabel` ve bu metni kullanan takip süre başlangıçları/bildirimler değiştirilmez.
- Motor, HMM, oda atamaları, karar üretimi/saklama, ham veri, API, haritada gizleme eşikleri ve yapılandırmalar bu geliştirme kapsamında değiştirilmez.

## Doğrulama sonuçları

| Kontrol | Sonuç |
| --- | --- |
| Yeni tarih/süre testleri, etiket paneli ve gerçek Pacemaker 2 kayıtlarının masaüstü/mobil tekrarı | 25 başarılı, 0 hata |
| Tip kontrolü (`npm run typecheck`) | Başarılı |
| Değişen TypeScript dosyalarında ESLint | Başarılı |
| Üretim derlemesi (`npm run build`) | Başarılı |
| Güncel UI ile v4 masaüstü/mobil karşılaştırması | 2 başarılı; yalnızca istenen tarih, açıklama ve satır sınıfı farklılıkları karşılaştırmada normalize edilir |
| Takip ve motor testleri | 244 başarılı, 1 mevcut yapılandırma/beklenti farkı, canlı DB gerektiren 3 test atlandı |
| Presence ve eski v4 motor karşılaştırmaları | 60 başarılı, 5 mevcut arşiv yapılandırması farkı |
| Kaynak bütünlüğü | Sunucu, yapılandırma, store ve ortak karar metni dahil 96 korunan dosyanın SHA-256 özeti görev başlangıcıyla aynı |

Takip testindeki kalan fark, `roomHmmEngine.test.ts` içinde beklenen `Sol koridor giriş / çıkış kapısı` yerine mevcut yapılandırmadaki `Servis giriş / çıkış kapısı` adıdır. Presence grubundaki beş hata, arşivdeki v4 harita yapılandırmasının güncel harita yapılandırmasıyla aynı olduğunu varsayan kaynak/senaryo karşılaştırmalarındadır. Bu dosyaların görev başlangıcından beri değişmediği SHA-256 ile doğrulanmıştır. Kullanıcının yalnızca UI talebi doğrultusunda bu motor/yapılandırma farklarına müdahale edilmemiştir.

İlk kısıtlı çalıştırmalarda Windows geçici dosya yeniden adlandırma ve yerel bağlantı hataları da görülmüştür. Tablodaki geniş test sonuçları bu kısıtlar olmadan yapılan yerel çalıştırmalara aittir. Arşiv testlerinin mevcut bağımlılıkları bulması için yalnızca doğrulamada kullanılan bir modül çözümleme yardımcısı kullanılmış, arşiv uygulaması değiştirilmemiştir.

Gerçek bileşenlerle 410 px ve 320 px genişlikte örnek verili HTML önizlemesi oluşturulmuştur. Görsel kontrol tamamlanamamıştır: gömülü tarayıcı yerel adrese ulaşamamış, computer-use daha sonra Windows'taki geçerli tarayıcı URL'sini güvenle belirleyemediği için erişimi durdurmuştur. Bu nedenle ekran görüntüsüyle yerleşim doğrulaması yapılmış sayılmaz. Örnek önizleme sunucusu kapatılmıştır; asıl uygulama/motor servisi başlatılmamış veya yeniden başlatılmamıştır.

Ayrıntılı günlükler, `source-integrity.json`, doğrulama yardımcısı ve `preview.html`, çalışma alanındaki `../outputs/hizli-gecis-ui-2026-11-03/` dizininde saklanır. Yerel doğrulama için mevcut kurulu bağımlılıklar `node_modules` dizin bağlantısıyla yeniden kullanılmıştır; bağımlılık sürümleri ve kilit dosyası değiştirilmemiştir.
