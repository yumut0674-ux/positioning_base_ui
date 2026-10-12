# Servis haritası

Arayüzde **Neü Tıp Fakültesi → Servis** katı aktif ve canlı takibe açıktır.
Harita kimliği `necmettin-servis` olarak kayıtlıdır.

Motorda bölge kimliğini **`servis`**, görünen adını **`Servis`** yapın.
Konum paketinde `zone_id: "servis"` gönderin; `zone_name` tek başına
haritaya yönlendirme yapmaz. `necmettin-servis` kimliği de desteklenir.

```json
{
  "type": "position",
  "tag_id": "SERVIS-1",
  "zone_id": "servis",
  "zone_name": "Servis",
  "x": 10,
  "y": 5,
  "timestamp": "2026-10-09T11:30:00Z"
}
```

Koordinatlar metre cinsindedir. Kaynak/CAD haritasındaki **X=1,85; Y=14,25**
noktası motorun **(0,0)** orijinidir. Motor eksenleri arayüz görseline göre
90° sağa döndürülmüştür: **+X aşağıya, +Y sağa** ilerler. Görsel ve bölge
çizimleri yerlerinde kalır; koordinatlar ve oda kapılarının içeri yönleri
aynı motor dönüşümünü kullanır.

CAD koordinatından motor koordinatına dönüşüm:
`motor.x = 14.25 - cad.y`, `motor.y = cad.x - 1.85`.

9 Ekim 2026 tarihli `servisv2.floorplan (2).json` ve
`servisv2-3840x2160-1px-1.417cm-origin-x-26.58-y1955.96px.png` kullanılmıştır:

- Görsel: 3840 × 2160 piksel.
- Ölçek: 1 piksel = 1,4171776872164112 cm; 1 metre = 70,56278186006284 piksel.
- Kaynak/CAD orijininin görseldeki yeri: `(-26.584397118828022, 1955.9599941366955)` piksel.
- Yeni motor orijininin görseldeki yeri: `(103.95674932228825, 950.4403526308)` piksel.
- Motor eksen dönüşü: saat yönünde 90°.

Güncel görsel adresi `/maps/necmettin-servis/floor-plan-571d3680cd25.png`
olarak sürümlenmiştir; tarayıcıdaki eski `floor-plan.png` önbelleğini kullanmaz.
Ana harita ve oda/bölge editörü bu yeni adresi kullanır.

Harita ve oda/bölge editörü aynı kalibrasyonu kullanır. CAD duvarlarına göre
üst sırada soldan sağa Dr Odası ve 201–209, alt sırada soldan sağa 217–214
ve 213–210 ile ortak koridor tanımlıdır. Görsel ve bölge adları 12 Ekim 2026
tarihli adlandırmayla güncellenmiştir. Oda ön sınırları banyo çıkıntılarının
koridora bakan uçlarıyla aynı hizaya tamamlanmıştır; aradaki koridor
girintilerinin oda hizasında kalan kısımları ilgili odalara dahildir.
Oda kapıları da aynı doğrultuda koridora doğru 1 metre taşınmıştır;
2 metre yakınlık hesabı bu yeni kapı noktalarından yapılır.
Karşılıklı kapıların yakınlık alanları kesiştiğinde sinyal kesintisi
tahmini mevcut motor kuralına göre en yakın uygun kapıyı seçer.
Banyo çıkıntıları kendi odalarına dahildir; tesisat boşlukları ve isimsiz servis
odaları koridora dahil değildir. Ortadaki servis odalarının arasından ve
altından geçen koridor devamı da tanımlıdır.

Oda giriş eşikleri Servis'e özeldir: en az **3 saniye** güvenilir iç kanıt
ve **5 güvenilir ölçüm** gerekir. Saniyede bir ölçümde ilk iç ölçümden
yaklaşık 4 saniye sonra koşullar sağlanır. Bu ayarlar diğer haritaları etkilemez.

Diğer ayarlar Yoğun Bakım ile aynıdır:

- Odalar arka dış duvarlarının ötesine 3 metre uzatılır; komşu odalar arasında 10 cm boşluk vardır.
- Oda merkezleri fiziksel odaların içinde kalır; her odada 1,5 m genişliğinde, içeri yönlü koridor kapısı bulunur.
- Oda giriş eşikleri dışında genel motor, oda/kapı çıkarım, gösterim ve animasyon ayarları Yoğun Bakım yapılandırmasından alınır.
- `Servis` büyük alanında düzenlenmiş tek giriş/çıkış kapısı iki yönlüdür; bekleme süresi 30 saniyedir.

Mevcut çizimleri yerinde tutarak motor kalibrasyonunu yeniden uygulamak için
`node --import tsx scripts/calibrate-service-map.ts` komutunu kullanın.

Tanımları yeniden oluşturmak için `node --import tsx scripts/configure-service-rooms.ts`
komutunu kullanın. Mevcut çizimler varsa araç üzerine yazmaz; bilinçli yeniden
oluşturma için `--replace-existing` gerekir. Oda ön sınırlarını ve kapıları
güncellerken mevcut oda merkezlerini, ayarları ve büyük alan kapılarını
korumak için `node --import tsx scripts/configure-service-rooms.ts --update-fronts`
komutunu kullanın; tekrar çalıştırmak kapıları yeniden kaydırmaz.
Üretim modunda yeni görsellerin
sunulması için `npm run build` çalıştırılıp uygulama yeniden başlatılmalıdır.
