# Harita gösterim filtresi

Gösterim alanı `config/regions.json` içindeki bütün oda ve koridorların `polygon[].world` poligonlarının birleşimidir; kenarlar ve köşeler içeridedir. Bölge bulunmayan haritalarda işaretler gizlenir ve “Gösterim için bölge tanımlayın” bilgisi gösterilir.

`mapDisplay.outsideHoldMs` varsayılan olarak `2000` ms'dir (0–3600000 arasında tam sayı). Oda/Bölge Panelindeki “Alan dışı gösterim bekleme süresi (ms)” alanından değiştirilip Kaydet ile uygulanabilir; JSON içe/dışa aktarma ve `/api/regions` de bu ayarı korur.

Alan dışındaki ilk gösterim koordinatı, bağımsız tag zamanlayıcısını başlatır. Son geçerli noktada beklenir; süre dolarsa işaret gizlenir. Yeni paket gelmesi gerekmez. Eski/tekrarlanan paketler ve sentetik motor yayınları süreyi uzatmaz. İlk konumu dışarıda olan tag hiç gösterilmez. İçeri dönüşte işaret güncel geçerli noktada görünür; eski animasyon kuyruğu kullanılmaz. Gizlenen tag listede kalır ve “Alan dışında · haritada gizli” bilgisi taşır.

Motor açıkken motorun gösterim koordinatı (oda merkezi veya RAW), kapalıyken gerçek ham konum değerlendirilir. RAW yumuşatma yalnızca geçerli ve bütünüyle alan içinde kalan yollarda uygulanır. Başka bir bölgenin içine düşen sıçrama kabul edilir; oda kararını mevcut motor verir.

`MapDisplayFilter` ve `mapTagDisplays` yalnızca sunum durumudur. Tag deposundaki ölçümler, oda kararları, konum geçmişi ve canlı/pasif hesabı değiştirilmez. Bekletilen koordinat hiçbir zaman tag deposuna ölçüm olarak yazılmaz. Motorun geometri/eşik/zamanlama algoritmasına müdahale edilmez.

Animasyonda doğru parçası bütün poligon sınır kesişimlerinde bölünerek birleşimin içinde kalıp kalmadığı kontrol edilir. L koridor köşeleri ve bölgeler arası boşluklarda yeni noktaya doğrudan geçilir; duvar çevresinde rota üretilmez. Kare başına kontrol, bekleyen hareketlerin ve ekstrapolasyonun alan dışına çıkmasını da engeller. Bölge/harita/mod değişimleri gösterimi yeniden değerlendirir; silinen tag durumları, animasyon kuyrukları ve zamanlayıcılar temizlenir.

Doğrulama: `npm run test:maps`, `npm run test:tracking`, `npm run typecheck`. Süreler tarayıcının zamanlayıcısıyla uygulanır; işletim sistemi askısı veya tarayıcının arka plan kısıtlaması varsa gizleme, JavaScript tekrar çalıştığında gerçekleşir.
