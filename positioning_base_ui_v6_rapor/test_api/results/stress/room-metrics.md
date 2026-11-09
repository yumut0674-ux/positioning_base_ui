# Deterministik oda çıkarımı değerlendirmesi

Parametreler: {"seed":20260907,"tagCount":4,"speed":1.2,"noise":0.15,"loss":0.1,"outageMs":30000,"intervalMs":1000,"startTime":1788220800000}. Harita: üretilen reference-map.json; saha doğrulaması değildir.

Çift değerler yeni / eski motor sırasındadır. Gecikmeler yeni motorun her gerçek oda ziyaretini ilk doğru atadığı ana kadardır. Fiziksel giriş anı 250 ms gerçek rota örneklemesinden alınır. Yanlış giriş, yanlış bir oda atamasına değişimdir; çıkış gecikmesi ayrıca yanlış oda süresine dahildir.

| Senaryo | Yanlış giriş yeni/eski | Kaçırılan ziyaret yeni/eski | Gecikme (sn) | Yanlış oda (sn) yeni/eski | Belirsiz (sn) yeni/eski | Doğru zaman yeni | Odadayken koridor sayılan sn yeni |
|---|---:|---:|---:|---:|---:|---:|---:|
| corridor | 0 / 0 | 0 / 0 | — | 0 / 0 | 1 / 0 | 99.4% | 0 |
| parallel-gap | 0 / 0 | 0 / 0 | — | 0 / 0 | 5 / 0 | 96.8% | 0 |
| door-turnback | 0 / 0 | 0 / 0 | — | 0 / 0 | 8 / 0 | 85.2% | 0 |
| entry-gap | 0 / 0 | 0 / 0 | 33.00, 33.00, 33.00, 34.00 | 0 / 0 | 137 / 4 | 32.5% | 0 |
| inside-long-gap | 0 / 0 | 0 / 0 | 3.00, 3.00, 3.00, 4.00 | 0 / 0 | 18 / 4 | 92.4% | 0 |
| room-motion | 0 / 0 | 0 / 0 | 3.00, 3.00, 3.00, 4.00 | 0 / 0 | 14 / 4 | 94.1% | 0 |
| shared-wall-noise | 0 / 0 | 0 / 0 | 3.00, 3.00, 3.00, 4.00 | 0 / 0 | 14 / 4 | 89.6% | 0 |
| neighbor-jumps | 0 / 3 | 0 / 0 | 3.00, 3.00, 3.00, 4.00 | 0 / 9 | 14 / 15 | 94.1% | 0 |
| door-transfer | 0 / 0 | 0 / 0 | 3.00, 3.00, 3.00, 4.00, 2.25, 2.25, 2.25, 21.25 | 38 / 10 | 30 / 9 | 74.2% | 0.25 |
| relocation | 0 / 0 | 0 / 0 | 3.00, 3.00, 3.00, 4.00, 19.25, 19.25, 19.25, 19.25 | 102 / 113 | 32 / 8 | 49.4% | 0 |
| first-inside | 0 / 0 | 0 / 0 | 2.00, 2.00, 2.00, 2.00 | 0 / 0 | 8 / 4 | 87.9% | 0 |
| packet-order | 0 / 0 | 0 / 0 | 3.00, 3.00, 3.00, 4.00 | 0 / 0 | 14 / 1 | 94.1% | 0 |
| variable-stream-gap | 0 / 0 | 0 / 0 | — | 0 / 0 | 40.5 / 0 | 74.0% | 0 |

Belirsiz süre başarı sayılmaz. Doğru zaman oranı tüm tag-saniyeleri kullanır; böylece sürekli belirsiz kalan motor yüksek başarı alamaz. Tahmini doğru oda doğru zaman sayılır, ölçülen/tahmini durum ayrımı room-traces.json içinde korunur. Kaçırılan ziyaret, gerçek bir oda ziyareti boyunca hiç doğru atama olmamasıdır; geç atama gecikme metriğine ve koridor/belirsiz sürelerine yansır.
