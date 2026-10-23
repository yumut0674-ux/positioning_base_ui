# UWB Salt-Okunur MCP Sunucusu

Bu sunucu, UWB konum verisini LLM istemcilerine dört kontrollü ve salt-okunur MCP tool'u üzerinden açar. MCP katmanı PostgreSQL'e bağlanmaz ve SQL çalıştırmaz; yalnızca uygulamanın iç REST API'sini `locationApiClient` üzerinden çağırır.

## Mimari

`MCP istemcisi → stdio MCP sunucusu → HTTP locationApiClient → /api/location/* → location service/repository → PostgreSQL`

SQL yalnızca `src/server/location/*Repository.ts` dosyalarındadır. Girdi doğrulama ortak Zod şemalarıyla yapılır. REST ve MCP aynı TypeScript veri sözleşmelerini kullanır. Stdio protokolünü korumak için sunucu stdout'a log yazmaz; başlangıç hataları ve smoke sonucu stderr'e gider.

## Kurulum ve çalıştırma

Gereksinim Node.js `>=22.13.0` ve proje bağımlılıklarının kurulmuş olmasıdır.

```powershell
npm install
npm run mcp:start
```

Smoke testi:

```powershell
npm run mcp:start -- --smoke
```

Örnek MCP istemci yapılandırması, çalışma dizini bu proje olacak biçimde `node --import tsx mcp/server.ts` komutunu stdio sunucusu olarak başlatmalıdır.

## Ortam değişkenleri

| Değişken | Varsayılan / örnek | Açıklama |
|---|---:|---|
| `UWB_LOCATION_API_BASE_URL` | `http://127.0.0.1:3000` | İç REST API kökü |
| `UWB_LOCATION_API_TOKEN` | ayarlanmaz | Opsiyonel Bearer servis token'ı |
| `UWB_LOCATION_API_TIMEOUT_MS` | `5000` | HTTP zaman aşımı (100–60000 ms) |
| `UWB_LIVE_THRESHOLD_SECONDS` | `30` | Canlı konum üst sınırı |
| `UWB_OFFLINE_THRESHOLD_SECONDS` | `300` | Offline konum alt sınırı |
| `UWB_HISTORY_MAX_DAYS` | `7` | Maksimum history aralığı (üst güvenlik sınırı 31) |
| `UWB_HISTORY_MAX_POINTS` | `2000` | Maksimum döndürülen nokta (üst sınır 2000) |
| `UWB_HISTORY_PROCESSING_MAX_POINTS` | `100000` | Timeline oluşturulurken işlenecek ham kayıt güvenlik sınırı (1000–250000) |

Gerçek `.env.local` değerleri veya token'lar dokümana/loga yazılmaz.

## Tool özeti

- `search_entities`: ad, entity code veya tag code arar; çoklu sonuçta `ambiguous` döner.
- `get_current_location`: aktif tag ataması, son konum, zone ve `live/stale/offline` durumunu getirir.
- `get_location_at_time`: ilgili zamandaki tag atamasıyla tolerans içindeki en yakın kaydı getirir.
- `get_location_history`: harita için örneklenmiş `route_points` veya kullanıcı/LLM için oda-bölge aralıklarından oluşan küçük `zone_timeline` üretir. Timeline, route örneklemesinden önce oluşturulur.

Örnek çağrı girdileri:

```json
{"name":"search_entities","arguments":{"query":"TAG-028","limit":10}}
```

```json
{"name":"get_location_history","arguments":{"entityId":28,"from":"2026-07-18T00:00:00+03:00","to":"2026-07-19T00:00:00+03:00","format":"zone_timeline","limit":2000}}
```

## Güvenlik

Sunucuda genel SQL tool'u, yazma tool'u veya ham hata aktarımı yoktur. URL'ler `URL`/`URLSearchParams` ile oluşturulur; timeout için `AbortController` kullanılır. Upstream mesajları allowlist hata kodlarına ve yerel güvenli mesajlara çevrilir. Stack trace, bağlantı bilgisi ve token MCP cevabına eklenmez. Tool'lar `readOnlyHint: true` olarak kayıtlıdır.

## Bilinen sınırlamalar

Gerçek veritabanında `tracked_entities` ve `tag_assignments` henüz yoktur. Uygulama geçici olarak aktif `tags` kayıtlarını varlık kabul eder ve cevapları `partial` uyarısıyla işaretler. Bu mod tarihsel yeniden atamaları garanti edemez. `drizzle/0001_tracked_entities_and_tag_assignments.sql` incelenip yedekli bakım penceresinde manuel uygulanmalıdır.

Zone resolver dikdörtgen ve polygon sınırlarını destekler; ancak mevcut floor plan yalnızca geniş alanları tanımlar ve Oda 34/Oda 65 gibi oda numaraları için kalibre edilmiş polygon verisi içermez. Bu nedenle oda adı tahmin edilmez ve eşleşmeyen kayıtlar `Tanımlı alan dışında` döner. `app/history/page.tsx` hâlâ demo veri kullanır.

## Python terminal AI demosu

`location_agent_cli.py`, mevcut stdio MCP sunucusunu alt süreç olarak başlatır
ve dört salt-okunur tool'u Google Gemini modeline açar. Sonuçlar yalnızca
terminalde gösterilir. Konuşma hafızası işlem kapatılınca silinir.

Windows kurulumu:

```powershell
py -m venv mcp\.venv
mcp\.venv\Scripts\python.exe -m pip install -r mcp\requirements-agent.txt
```

Gemini API anahtarını yalnızca ortam değişkeni veya git tarafından yok sayılan
`.env.local` dosyası üzerinden sağlayın:

```powershell
$env:GEMINI_API_KEY="..."
```

CMD kullanıyorsanız:

```cmd
set "GEMINI_API_KEY=..."
```

Önce REST uygulamasını ayrı bir terminalde çalıştırın:

```powershell
npm run dev
```

Ardından AI istemcisini çalıştırın:

```powershell
mcp\.venv\Scripts\python.exe mcp\location_agent_cli.py
```

Örnek soru:

```text
Operator A14, 19 Temmuz 2026 günü 10:00 ile 11:05 arasında hangi bölgelerdeydi?
```

Varsayılan model `gemini-3.6-flash`'tir. Gerekirse `GEMINI_MODEL` ile
değiştirilebilir.
Node.js PATH üzerinde değilse `UWB_NODE_COMMAND` değişkenine `node.exe` tam yolu
verilebilir. `/clear` konuşma hafızasını, `/exit` ise programı kapatır.

## Rota Geçmişi web chat asistanı

Rota Geçmişi sayfasındaki chat paneli tarayıcıdan doğrudan Gemini'ye veya konum
araçlarına bağlanmaz. Tarayıcı `POST /api/assistant` endpointine gider. “En son
neredeydi” ve “şu an nerede” gibi tanınan tek varlık soruları burada doğrudan
yerel entity/konum servisleriyle yanıtlanır; kişi ve konum verisi Gemini'ye
gönderilmez. Diğer sorular yerel FastAPI asistanına iletilir. Endpoint her
tarayıcı için HttpOnly bir ad alanı üretir; soru-cevap kayıtları bu ad alanı ve
konuşma kimliğiyle ilişkilendirilir. Kimlik kullanılarak eski sohbet belleği okunmaz.

Mevcut uygulamada doğrulanmış kullanıcı/rol aktarımı bulunmadığı için web
istekleri varsayılan olarak `unauthenticated` kabul edilir. FastAPI akışında kişi,
tag veya konum geçmişi istekleri modele ya da MCP araçlarına gönderilmez; genel
UWB kullanım soruları cevaplanabilir. Tanınan tek varlık konum soruları aynı
uygulamanın mevcut `/api/location/*` servisleriyle sunucu tarafında yanıtlanır.
UI bağlamındaki tag kodu yalnızca veritabanında doğrulanacak arama anahtarıdır;
koordinat ve rota bilgisi modele iletilmez. Hasta veya personel verisiyle çalışan bir
kurulum, üretime alınmadan önce güvenilir sunucu tarafı kimlik doğrulama,
rol/birim kapsamı ve retrieval filtresi eklemelidir; istemci mesajındaki
“adminim” ifadesi yetki kanıtı değildir.

Web sohbetinin belleği, açık chat bileşenindeki mesaj listesidir. Her istekte
`history` alanında son 20 tamamlanmış soru-cevap (toplam en fazla 32.000 karakter,
cevap başına en fazla 8.000 karakter) taşınır. FastAPI bu geçmişle yeni bir Gemini
chat oluşturur; web yanıtları sunucudaki oturum önbelleğine veya 30 dakikalık
oturum süresine bağlı değildir. `sessionId` yalnızca yönetim kayıtlarını aynı
konuşma altında ilişkilendirir. Terminal istemcisi eski oturum akışını kullanır.

Yerel konum cevapları doğrulanan varlığın kodunu `locationSubject` olarak chat
mesajına ekler. “O şimdi nerede?”, “peki en son neredeydi?” gibi devam soruları
bu kodu yeniden arayıp güncel veriyi getirir; eski konum cevabı tekrar kullanılmaz.
Yeni bir kişi sorulduğunda bağlam değişir; belirsiz veya bulunamayan kişi önceki
kişiye geri düşmez. “Seçili etiket” / “bu etiket” soruları ekrandaki seçimi kullanır.
Kişi ve konum içeren yerel soru-cevaplar Gemini geçmişine aktarılmaz.

Paneli kapatıp açmak mevcut mesajları korur. “Konuşmayı temizle”, sayfayı yenileme
ve chat bileşeninin kaldırılması konuşma belleğini sıfırlar. Yönetim kayıtları
sohbet belleği olarak tekrar okunmaz.

Konuşma belleği regresyon testleri (Gemini çağrısı yapmaz):

```powershell
npm run test:ai:location
mcp\.venv\Scripts\python.exe tests\assistant_conversation_test.py -v
```

`assistant_policy.py` modelden önce prompt injection, gizli yapılandırma,
klinik çıkarım ve yetkisiz veri erişimi isteklerini deterministik engeller.
Model yanıtı gönderilmeden önce sentetik canary, kişisel veri, secret ve stack
trace örüntüleri için tekrar denetlenir. Bu kontroller savunmada ek katmandır;
KVKK veya hastane politikası yerine geçmez.

İki terminalle yerel çalıştırma:

Terminal 1:

```powershell
npm run dev
```

Terminal 2:

```powershell
mcp\.venv\Scripts\python.exe -m uvicorn chat_api:app --app-dir mcp --host 127.0.0.1 --port 8000
```

Gerekli ortam değişkenleri:

```powershell
$env:GEMINI_API_KEY="..."
$env:GEMINI_MODEL="gemini-3.6-flash"
$env:CHATBOT_SERVICE_URL="http://127.0.0.1:8000"
$env:UWB_LOCATION_API_BASE_URL="http://127.0.0.1:3000"
```

Asistan servisi genel CORS açmaz ve yalnızca `127.0.0.1` üzerinde
çalıştırılmalıdır. Gerçek API anahtarını README, test fixture veya log çıktısına
yazmayın.
