# Servis haritası

26 Ekim 2026: v4.2'deki Servis haritası ve bölge yapılandırması v5'e
aktarıldı. Güncel yapılandırma Hemşire Bankosu, Personel Odası ve Derslik
dahil 21 oda, 1 koridor ve 1 büyük alan içerir. Görsel ve bölge çizimleri
`config/maps/necmettin-servis/` altındaki dosyalardan yüklenir.

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

Güncel görsel adresi `/maps/necmettin-servis/floor-plan-dadcc1714f6c.png`
olarak sürümlenmiştir; tarayıcıdaki eski `floor-plan.png` önbelleğini kullanmaz.
Ana harita ve oda/bölge editörü bu yeni adresi kullanır.

Harita ve oda/bölge editörü aynı kalibrasyonu kullanır. Üst sırada soldan
sağa Dr Odası ve 201–209, alt sırada 217–214, Hemşire Bankosu, 213–210,
Personel Odası ve Derslik tanımlıdır. Oda sınırları, koridor girintileri,
kapı konumları ve Servis alanının giriş/çıkış geçidi v4.2'deki güncel
`regions.json` ile birebir aynıdır. Derslikte iki, diğer odalarda birer
koridor kapısı vardır. Kapı genişliği, yaklaşma derinliği ve içeri yönü
her kapının kendi kaydından okunur.

Oda giriş eşikleri Servis'e özeldir: en az **2 saniye** güvenilir iç kanıt
ve **5 güvenilir ölçüm** gerekir. Saniyede bir ölçümde ilk iç ölçümden
yaklaşık 4 saniye sonra koşullar sağlanır. Bu ayarlar diğer haritaları etkilemez.

Odalar sessiz kapsama kullanır; kapıdan sessiz giriş yakınlık sınırı
1,3 metredir. `Servis` büyük alanında düzenlenmiş tek giriş/çıkış kapısı
iki yönlüdür; bekleme süresi 30 saniyedir. v4.2'de kaydedilen gösterim
ayarları da bölge yapılandırmasıyla birlikte taşınmıştır: animasyon tampon
gecikmesi 5500 ms, azami görsel hız 1 m/sn'dir.

Mevcut çizimleri yerinde tutarak motor kalibrasyonunu yeniden uygulamak için
`node --import tsx scripts/calibrate-service-map.ts` komutunu kullanın.

`scripts/configure-service-rooms.ts` önceki CAD düzeninden oda üretir;
güncel 21 odalı düzen için `regions.json` esas alınmalıdır. Mevcut çizimler
varsa araç üzerine yazmaz; `--replace-existing` ve `--update-fronts`
seçenekleri güncel elle düzenlenmiş çizimlerin yerini değiştirebilir.
Üretim modunda yeni görsellerin
sunulması için `npm run build` çalıştırılıp uygulama yeniden başlatılmalıdır.
