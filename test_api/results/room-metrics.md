# Deterministik oda çıkarımı değerlendirmesi

Parametreler: {"seed":42,"tagCount":1,"speed":1,"noise":0.05,"loss":0,"outageMs":40000,"intervalMs":1000,"startTime":1788220800000}. Harita: üretilen reference-map.json; saha doğrulaması değildir.

Çift değerler yeni / eski motor sırasındadır. Gecikmeler yeni motorun her gerçek oda ziyaretini ilk doğru atadığı ana kadardır. Fiziksel giriş anı 250 ms gerçek rota örneklemesinden alınır. Yanlış giriş, yanlış bir oda atamasına değişimdir; çıkış gecikmesi ayrıca yanlış oda süresine dahildir.

| Senaryo | Yanlış giriş yeni/eski | Kaçırılan ziyaret yeni/eski | Gecikme (sn) | Yanlış oda (sn) yeni/eski | Belirsiz (sn) yeni/eski | Doğru zaman yeni | Odadayken koridor sayılan sn yeni |
|---|---:|---:|---:|---:|---:|---:|---:|
| corridor | 0 / 0 | 0 / 0 | — | 0 / 0 | 0 / 0 | 100.0% | 0 |
| parallel-gap | 0 / 0 | 0 / 0 | — | 0 / 0 | 1 / 0 | 97.6% | 0 |
| door-turnback | 0 / 0 | 0 / 0 | — | 0 / 0 | 1 / 0 | 92.9% | 0 |
| entry-gap | 0 / 0 | 0 / 0 | 42.75 | 0 / 0 | 44 / 1 | 28.2% | 0 |
| inside-long-gap | 0 / 0 | 0 / 0 | 2.75 | 0 / 0 | 14 / 1 | 80.1% | 0 |
| room-motion | 0 / 0 | 0 / 0 | 2.75 | 0 / 0 | 3 / 1 | 95.7% | 0 |
| shared-wall-noise | 0 / 0 | 0 / 0 | 2.75 | 0 / 0 | 3 / 1 | 91.5% | 0 |
| neighbor-jumps | 0 / 1 | 0 / 0 | 2.75 | 0 / 3 | 3 / 3 | 95.7% | 0 |
| door-transfer | 0 / 0 | 0 / 0 | 2.75, 2.75 | 3 / 2 | 6 / 2 | 88.6% | 0 |
| relocation | 0 / 0 | 0 / 0 | 2.75, 26.75 | 25 / 37 | 17 / 2 | 47.0% | 0 |
| first-inside | 0 / 0 | 0 / 0 | 2.00 | 0 / 0 | 2 / 1 | 88.1% | 0 |
| packet-order | 0 / 0 | 0 / 0 | 2.75 | 0 / 0 | 3 / 0.25 | 95.7% | 0 |
| variable-stream-gap | 0 / 0 | 0 / 0 | — | 0 / 0 | 9.5 / 0 | 77.5% | 0 |

Belirsiz süre başarı sayılmaz. Doğru zaman oranı tüm tag-saniyeleri kullanır; böylece sürekli belirsiz kalan motor yüksek başarı alamaz. Tahmini doğru oda doğru zaman sayılır, ölçülen/tahmini durum ayrımı room-traces.json içinde korunur. Kaçırılan ziyaret, gerçek bir oda ziyareti boyunca hiç doğru atama olmamasıdır; geç atama gecikme metriğine ve koridor/belirsiz sürelerine yansır.
