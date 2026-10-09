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

Koordinatlar metre cinsindedir; X sağa, Y yukarı artar. Motorun dünya
orijini, kaynak haritadaki `(0, 0)` noktasıyla aynı olmalıdır.

9 Ekim 2026 tarihli `servisv2.floorplan (2).json` ve
`servisv2-3840x2160-1px-1.417cm-origin-x-26.58-y1955.96px.png` kullanılmıştır:

- Görsel: 3840 × 2160 piksel.
- Ölçek: 1 piksel = 1,4171776872164112 cm; 1 metre = 70,56278186006284 piksel.
- Dünya orijininin görseldeki yeri: `(-26.584397118828022, 1955.9599941366955)` piksel.
- Dönüş: 0°.

Güncel görsel adresi `/maps/necmettin-servis/floor-plan-1e98c4840f0c.png`
olarak sürümlenmiştir; tarayıcıdaki eski `floor-plan.png` önbelleğini kullanmaz.
Ana harita ve oda/bölge editörü bu yeni adresi kullanır.

Harita ve oda/bölge editörü aynı kalibrasyonu kullanır. CAD duvarlarına göre
üst sırada Oda 1–10, alt sırada Oda 11–18 ve ortak koridor tanımlıdır. Banyo
çıkıntıları kendi odalarına dahildir; tesisat boşlukları ve isimsiz servis
odaları koridora dahil değildir. Ortadaki servis odalarının arasından ve
altından geçen koridor devamı da tanımlıdır.

Yoğun Bakım ile aynı ayarlar uygulanır:

- Odalar arka dış duvarlarının ötesine 3 metre uzatılır; komşu odalar arasında 10 cm boşluk vardır.
- Oda merkezleri fiziksel odaların içinde kalır; her odada 1,5 m genişliğinde, içeri yönlü koridor kapısı bulunur.
- Genel motor, oda/kapı çıkarım, gösterim ve animasyon ayarları Yoğun Bakım yapılandırmasından alınır.
- `Servis` büyük alanının sol üst ve sol alt giriş/çıkış kapıları iki yönlüdür; bekleme süresi 30 saniyedir.

Tanımları yeniden oluşturmak için `node --import tsx scripts/configure-service-rooms.ts`
komutunu kullanın. Mevcut çizimler varsa araç üzerine yazmaz; bilinçli yeniden
oluşturma için `--replace-existing` gerekir. Üretim modunda yeni görsellerin
sunulması için `npm run build` çalıştırılıp uygulama yeniden başlatılmalıdır.
