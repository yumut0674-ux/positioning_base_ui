# Oda arayüzü — kolay kurulum (Windows)

Bu klasör **tam projedir**. Yeni oda motoru (room-hmm-2, 17 Ekim sürümü) içindedir; yama uygulamaya gerek yok.

**Gerekenler:** Windows bilgisayar · Node.js 22 veya üstü (komut satırında `node -v`) · internet (yalnız ilk kurulumda).

---

## Hızlı kurulum — 5 adım

| # | Ne yapılacak | Nerede |
|---|---|---|
| 1 | Zip'i `C:\gekon` klasörüne açın → `C:\gekon\positioning_base_ui` oluşur | Arayüz bilgisayarı |
| 2 | **`1-KUR.bat`** dosyasına çift tıklayın (bir kez, 2–5 dk). Sonda "Kurulum tamam" yazmalı | Arayüz bilgisayarı |
| 3 | **`2-BASLAT.bat`** dosyasına çift tıklayın, tarayıcıda **http://localhost:3000** açın. Pencere açık kalmalı | Arayüz bilgisayarı |
| 4 | Jetson `config.json` → `"solver": { "minAnchors": 4 }` yapın, Jetson motorunu yeniden başlatın | Jetson |
| 5 | Jetson'un gönderim adresini bu bilgisayara yönlendirin (aşağıda 3. bölüm) | Jetson |

> Klasörü **OneDrive / Masaüstü** altına açmayın; eşitleme kurulumu yavaşlatır veya bozar.
>
> Daha önce kurduysanız: eski klasörün adını değiştirin (ör. `positioning_base_ui_eski`), yeni zip'i açın ve `1-KUR.bat`'ı yeniden çalıştırın.

---

## 1. Kurulumu kontrol

- `2-BASLAT.bat` penceresinde `PostgreSQL` / `ECONNREFUSED 127.0.0.1:5432` hataları görünebilir. **Normaldir**: veritabanı olmadan da canlı harita ve oda motoru çalışır, yalnız geçmiş kaydı tutulmaz.
- Windows "Güvenlik duvarı erişim izni" sorarsa **Özel ağlar** işaretli olarak **İzin ver** deyin.
- Tarayıcıda **http://localhost:3000/api/region-engine/status** → içinde `"engineVersion":"room-hmm-2"` görünmeli.

## 2. Jetson olmadan deneme

`2-BASLAT.bat` açıkken `ornek-kayit\yogun-bakim-8ekim.jsonl` dosyasını **`3-KAYIT-OYNAT.bat` dosyasının üzerine sürükleyip bırakın**. Tarayıcıda **Yoğun Bakım** haritasında tag ~4,5 dakika kayıttaki gibi hareket eder.

Kendi Jetson kayıtlarınızı (`logs/<oturum>/positions.jsonl`) da aynı şekilde oynatabilirsiniz.

## 3. Jetson'u bu bilgisayara bağlama

1. Jetson ve bu bilgisayar **aynı ağda** olmalı.
2. `2-BASLAT.bat` penceresinin başındaki `IPv4 Adresi ... : 192.168.x.y` değerini not edin.
3. Jetson arayüzü → Ağ ayarları → "Tag konumlarını başka sisteme gönder":
   - Düğme **açık**,
   - adres **`http://192.168.x.y:3000/api/tracking/ingest`** (`localhost` yazmayın, o Jetson'un kendisidir).
4. Jetson motorunu yeniden başlatın; haritada taglar görünmeli.

Bağlantıyı Jetson'dan denemek (Jetson terminali):

```
curl -i -X POST http://192.168.x.y:3000/api/tracking/ingest -H "content-type: application/json" -d "{\"type\":\"position\",\"tag_id\":\"TEST1\",\"x\":1.8,\"y\":12,\"zone_id\":\"servis\",\"zone_name\":\"Servis\",\"timestamp\":\"2026-10-17T12:00:00+03:00\"}"
```

`HTTP/1.1 204` dönmeli. Zaman aşımı olursa bu bilgisayarda **yönetici** PowerShell'de:

```
netsh advfirewall firewall add rule name="Oda arayuzu 3000" dir=in action=allow protocol=TCP localport=3000
```

## 4. Neden `minAnchors: 4`?

Sahadaki 5 testte (95 oda ziyareti) karşı odaya düşen noktaların **%92'si yalnız 3 anchorla** hesaplanmış. 3 anchorlu konumun koridorun karşı tarafında bir "ayna" ikizi vardır; tagın odadan odaya ani atlamasının asıl sebebi bu. Ayarla bu konumların ~%80'i hiç üretilmez. Kayıtlar üzerinde doğru oda %58 → %72'ye çıktı. Eski arayüz de iyileşir.

## 4b. Kararlı mod (kapı önünde beklerken oda görünmesin)

Motor bir odaya ancak tag ~6 saniye o odada kaldıktan sonra geçer. Kapı önünde ya da eşiğinde beklemek odayı göstermez; karşı odaya ani pikler görünmez. Bedeli: odaya girişte ~6 sn gecikme. Jetson'da `minAnchors: 4` ile birlikte en iyi sonucu verir.
Kapatmak için `config\maps\necmettin-servis\room-engine.json` → `"hmm": { "stableEntryConfirmMs": 0 }`.

## 4c. Yoğun bakım ayarı ve servis için öneri dosyası

- Yoğun bakım (camlı odalar) kendi ayarını kullanır: `config\maps\necmettin-yogun-bakim\room-engine.json`. Odadaki tagın konumu çoğu zaman cam cephenin önünde koridorda göründüğü için cephenin 0,8 m önü o odanın kanıtı sayılır; giriş 2 sn, çıkış 3 sn doğrulanır. Oda 9'un kapısı kat planındaki yerine (koridora bakan duvar) taşındı. Servis bundan etkilenmez.
- **İsteğe bağlı (sahada henüz denenmedi):** `config\maps\necmettin-servis\oneri\regions-girinti-bosluk.json`. Kapıların önündeki girintinin koridor tarafındaki 50 cm'si koridora verilmiş, yan yana kapılı odaların kapı önleri arasında 50 cm boşluk var. Kayıtlarda yanlış oda %10,1 → %6,1, yakalanan ziyaret 107 → 104/152. Denemek için `config\maps\necmettin-servis\regions.json` dosyasını yedekleyip bunun yerine koyun ve `2-BASLAT.bat`'ı yeniden açın. Not: bu dosyadaki işaret animasyonu ayarları sahadaki dosyadan alındı (gecikme 5,5 sn, hız 1 m/sn).

## 5. Saha testi ve dosyaları gönderme

Bir testten iki şey gerekir:

**a) Jetson konum kaydı (otomatik):**
`<Jetson motor klasörü>/View/arayuz/logs/<testAdı>_<tarih_saat>/positions.jsonl`
Klasör adı `remote_` ile **başlamayan** klasördür. Yalnız bu dosya yeter (anchor dosyaları gerekmez).

**b) Gerçek oda giriş/çıkış saatleri:** arayüzde sol menü → **Oda Test Kaydı** → test adı + tag kimliği → **Kaydı başlat** → odaya girince oda kartına, çıkınca **Koridor**'a → **Testi bitir** → **JSON çıktısı → Benchmark → JSON indir** ve **Tam oturum indir** (İndirilenler klasörüne gelir).
Kayıt tarayıcıda saklanır; her testten sonra indirin. Telefonla kayıt için `ODA-TEST-KAYDI.html` dosyası da kullanılabilir.

İkisini tek zip yapıp gönderin. Kısa bir not ekleyin: hangi tag kimdeydi, nerede sorun görüldü (ör. "14:32'de 206'ya girdi, 207 gösterdi").

## Sorun olursa

| Belirti | Çözüm |
|---|---|
| `1-KUR.bat`: "Node.js bulunamadı" | nodejs.org → 22 LTS kurun, bilgisayarı yeniden açın |
| `1-KUR.bat` ağ hatası (`ETIMEDOUT`, `ECONNRESET`) | İnterneti kontrol edip tekrar çalıştırın |
| `localhost:3000` açılmıyor | `2-BASLAT.bat` penceresi açık mı? 3000 portunu kullanan başka program var mı? |
| Haritada tag yok | Önce 2. bölümdeki örnek kayıtla deneyin. Örnek çalışıyor, Jetson çalışmıyorsa 3. bölüm (IP, aynı ağ, güvenlik duvarı) |
| Jetson'da `400` hatası | Hata metnini gönderin (ör. "Beklenmeyen alanlar" → arayüz eski sürüm) |
| Eski motora dönmek | `config\maps\necmettin-servis\room-engine.json` ve `config\maps\necmettin-yogun-bakim\room-engine.json` içinde `"hmm"` → `"evidence"`, sonra `2-BASLAT.bat`'ı yeniden açın |
| `minAnchors: 4` sonrası bazı yerlerde tag seyrek güncelleniyor | Normal (3 anchorlu konumlar atılıyor). Sorun olursa 3'e geri alın ve bize bildirin |

**Veritabanı (isteğe bağlı):** Geçmiş ve tag listesi için PostgreSQL gerekir. README'deki "PostgreSQL kurulumu ve şema" bölümü; parola `.env.local` dosyasındaki `POSTGRES_PASSWORD` satırına yazılır.
