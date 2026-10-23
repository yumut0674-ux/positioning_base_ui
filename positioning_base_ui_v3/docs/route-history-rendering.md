# Rota geçmişi haritası

Rota geçmişi paneli `GET /api/location/entities/:entityId/history?format=route_points&render=map` çağrısını kullanır. PostgreSQL'de dakika bazında hesaplanan X/Y medyanları ve oda zaman çizelgesi aynı sorgu sonucundan alınır. Sunucu her katın planını ve rota noktalarını Sharp ile tek bir WebP görseline birleştirir; görsel ve kalibrasyon bilgisi `renderedMaps` alanında döner. `render=map` verilmezse mevcut JSON sözleşmesi korunur.

Tarayıcıda geçmiş haritası için Konva veya canvas kullanılmaz. Tek bir görsel katmanı CSS `translate3d` ve `scale` ile taşınır. Sürükleme sırasında React state'i güncellenmez; hareket bittiğinde bir kez güncellenir. Tekerlek hareketleri 120 ms sessizlikten sonra state'e aktarılır. Sürükleme ve yakınlaştırma sunucuya istek göndermez. Fare, dokunmatik sürükleme, iki parmakla yakınlaştırma ve klavye desteği vardır.

Zaman çizelgesinden seçim yapıldığında `POST /api/location/history-map/selection` yalnızca seçili aralığın medyan koordinatlarından şeffaf PNG vurgu katmanı üretir. Bu işlem veritabanını tekrar sorgulamaz. Eski seçim istekleri iptal edilir ve geçici tarayıcı görsel adresleri temizlenir.

Görseller en fazla 3840 piksel kenar ve 8.294.400 piksel alanla sınırlandırılır. Katlar sırayla render edilerek sunucu belleği sınırlanır. Katlar, tag değişimleri ve beş dakikadan uzun konum boşlukları arasında rota çizgisi kurulmaz. Oda karar geçmişi olan sonuçlarda önceki davranış korunur: kesin geçiş rotası varsayılmaz, medyan noktalar gösterilir. Tarihsel kat planı bulunamazsa diğer katlar gösterilir ve uyarı döner.

Doğrulama: `node --import tsx --test tests/historyMapImage.test.ts tests/routeHistory.test.ts tests/mcp/all.test.ts`. Görsel testleri canlı veritabanı olmadan gerçek Sharp çıktısını, şeffaflığı, boyut sınırını ve API yanıtlarını doğrular.

Sharp, `createRequire` ile doğrudan Node.js tarafından ve ilk görsel isteğinde yüklenir. Statik çalışma zamanı importu Vinext geliştirme ortamında Sharp'ın CommonJS modüllerinin dönüştürülmesine ve `buildPlatformArch` başlatma hatasına yol açar. Bu geliştirme akışı ayrıca `node --test tests/historyMapVite.test.mjs` ile sınanır; test kendi geçici Vite önbelleğini kullanır.
