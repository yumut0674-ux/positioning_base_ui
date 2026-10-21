# Jetson v9.1: tag hareket bilgisini arayüze gönderme

Ne değişiyor: `transport.py` arayüze giden her konuma `motion_label` ekler
(`moving` / `stationary` / `unknown`; tagın kendi IMU bilgisi, AM_TAG_META `motion`).
Başka hiçbir alan ve hesap değişmez. Arayüzün eski ve yeni sürümleri bu alanı kabul eder.

## Kurulum (Jetson terminali)

```bash
cd <v9.1 klasörü>                      # transport.py'nin olduğu klasör
cp transport.py transport.py.yedek_$(date +%Y%m%d_%H%M)
cp <bu klasör>/transport.py transport.py
cp <bu klasör>/tests/test_transport.py tests/test_transport.py
python3 -m unittest tests.test_transport     # "OK" görmelisiniz
```
Sonra XY motorunu (server.py) her zamanki gibi yeniden başlatın.

Kontrol: arayüz bilgisayarında servis kaydı (`journalctl -u oda-arayuzu -f`) 400 hatası göstermemeli;
haritada duran taglar artık oynamamalı.

Geri dönüş: `cp transport.py.yedek_* transport.py` ve yeniden başlatma.

## İsteğe bağlı config.json ayarları

- Yoğun bakım koridoru (defibrilatör görünmüyordu): `zones` → `neuyogun` → `points` içinde
  `{"x": 3.87, "y": 9.05}` ve `{"x": 3.87, "y": 0.0}` noktalarını `4.5` yapın. Arayüz haritasında da koridor
  bu bölümde 4,5 m'ye genişletildi.
- Alan dışı çözümler: `solver.outsideMarginM` şu an 8.0 (konum alanın 8 m dışına kadar hesaplanır). Köşede/alan
  dışında görünen taglar için 2.0 önerilir. Arayüzün çıkış kapısı algılaması bununla çalışır.
