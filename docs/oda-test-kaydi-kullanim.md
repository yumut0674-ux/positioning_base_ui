# Oda Test Kaydı

Admin arayüzünde sol menünün **İNCELE → Oda Test Kaydı** öğesiyle açılır. Panel, genel sistemin menüsünü, renklerini ve bileşen düzenini kullanır.

## Saha kaydı

1. Test adını ve gerçek tag kodunu girin. Birlikte taşınan kodları virgülle ayırın. Fiziksel taşımayı doğruladıysanız doğrulama kutusunu işaretleyin.
2. Kat/birim seçin; sistem haritalarını veya **Özel plan** ile hazırladığınız şablonu kullanın. Özel plan JSON'u referans HTML'in `building / floors / areas / connects_to` biçimini kabul eder. İçe aktarılan plan uygulamadan önce düzenlenebilir.
3. **Kaydı başlat** ile oturumu açın. Bulunduğunuz alanın kartını seçin. Sonraki kart seçimi önceki çıkış ve yeni girişi aynı anda kaydeder.
4. Aktif karta yeniden basmak veya **Odadan çıktım**, tanımlanmış tek koridor bağlantısı varsa o koridora geçer; yoksa konumu bilinmeyen olarak bırakır. **Son geçişi geri al**, son alan değişimini düzeltir; olay geçmişi korunur.
5. **Duraklat** ziyareti kapatır. **Kaydı sürdür** sonrası alanı yeniden seçin. Bekleme süreleri oda ziyareti veya koridor sayılmaz.
6. **Testi bitir** ile tamamlayın. **Geçmiş** kayıtları yeniden açar; **Yeni test** önceki kaydı silmez. Tag bilgisi duraklatılmış veya tamamlanmış testte açıklamayla düzeltilebilir.

**Sıralı rota:** Test başlamadan Test ayarları'nda modu seçip alanları sıraya ekleyin. Kayıt sırasında **Bu alana girdim** sıradaki adımı kaydeder. Plan ve rota başlayan oturumda kilitlenir.

## Saklama ve çıktılar

Her işlem önce IndexedDB'ye yazılır, ardından PostgreSQL'e sıralı olarak gönderilir. Alt satırdaki **Sunucuya kaydedildi / yerelde bekliyor** durumunu takip edin. Ağ geri geldiğinde kuyruk tekrar gönderilir. Bir tarayıcıda yalnız bir sekme yazıcı olabilir. Sunucudaki sürüm çakışmasında yerel tam oturumu indirip sunucudan yükleyin.

Menüler arasında geçiş kayıt oturumunu korur. Sayfa yeniden açılınca gözlem kesintisi son yerel kontrol zamanında kapatılır ve kayıt duraklatılır. Sunucudan açılan, yerel gözlem bilgisi olmayan aktif test son olayında kapatılır. Gözlenmeyen süre ziyaret olarak uzatılmaz.

**JSON çıktısı** ziyaret dizisi, test/tag bilgileri, tam oturum veya benchmark parçaları üretir. Tarihler UTC ISO biçimindedir; ekran İstanbul saatini gösterir. Henüz kapanmayan ziyarette çıkış ve süre `null` olur. Yerel olayın `receivedAt` değeri sunucu onayına kadar `null` kalır. Tam oturum, saat farkı ölçümünü ve plan/yapılandırma kopyasını içerir; olay zamanı cihaz saatiyle korunur.

Canlı dosya yazımını destekleyen tarayıcılarda dışa aktarma penceresinden **Canlı dosya seç** kullanılabilir. Tam oturum her işlemde dosyaya yazılır. Her test için ayrı dosya seçilir. Diğer tarayıcılarda JSON indirme kullanılabilir.

## Benchmark

Sistem haritasıyla tamamlanmış testler, harita ve kesintisiz gözlem aralığına göre parçalara ayrılır. Pause, bilinmeyen konum ve gözlem kesintileri puanlama aralığına alınmaz. Özel planlar için benchmark kapalıdır. Tag doğrulanmadıysa `groups` boş kalır.

Her parçada **Truth indir** ve **Harita yapılandırmasını indir** bulunur. Mevcut CLI, `test-UUID-part-N` kimliklerini kabul eder. İndirilen truth dosyasını `tools/room-benchmark/datasets/<truth.testId>/truth.json` olarak yerleştirin. Mevcut `candidates`, `import` ve `replay` akışında bu kimliği ve indirilen yapılandırmayı `--config` ile kullanın. Ham paketler ayrıca mevcut benchmark akışıyla alınır; panel motoru veya replay'i başlatmaz.

## Çalıştırma ve doğrulama

PostgreSQL bağlantısı mevcut projenin ayarlarını kullanır. `drizzle/0008_room_test_sessions.sql`, API ilk kullanıldığında `IF NOT EXISTS` ile uygulanır; uygulama DB kullanıcısının tablo oluşturma izni olmalıdır. Üretim dağıtımında bu migration dosyası da bulunmalıdır.

**3001 oda motoru için ayrılmıştır.** İzole geliştirme/önizleme örneği:

```powershell
$env:PORT='3010'
$env:RAW_POSITION_PORT='3010'
$env:REGION_POSITION_PORT='3011'
npm run dev -- --port 3010 --hostname 127.0.0.1
```

Üretim derlemesiyle çalışan sunucuda yeni panelin görünmesi için yeni build ile uygulamanın yeniden başlatılması gerekir.

Kontroller: `npm run test:room-tests`, `npm run typecheck`, ilgili dosyalar için ESLint, `npm test`, `node --import tsx --test tools/room-benchmark/benchmark.test.ts`. Admin/demo ayrımı mevcut host modelini kullanır; ayrı bir kullanıcı/rol sistemi eklenmez.
