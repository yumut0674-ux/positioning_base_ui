# Domain üzerinden geçici demo paylaşımı

Bu rehber, uygulamayı Windows bilgisayarınızda çalıştırmaya devam ederken Cloudflare Tunnel ve Cloudflare Access ile yalnızca izin verilen kişilere açar.

Akış şöyledir:

`İnternet → Cloudflare Access → Cloudflare Tunnel → 127.0.0.1:3000 → uygulama`

Bu kurulum bir production deployment değildir. Demo ve kısa süreli test içindir. Cloudflare hesabında yapılacak bütün adımlar manueldir; repoda gerçek domain, e-posta, tunnel UUID, token veya credential bulunmaz.

## 1. Gereksinimler

- Windows 10/11 ve yönetici yetkisine sahip bir hesap.
- Node.js `22.13.0` veya daha yeni sürüm.
- Çalışan yerel PostgreSQL; yalnızca `127.0.0.1:5432` üzerinde erişilebilir olmalı.
- Cloudflare hesabı ve DNS'i Cloudflare tarafından yönetilen bir domain.
- Demo için bir alt alan adı; örneğin `demo.example.com`.
- İzin verilecek kişilerin tam e-posta adresleri.
- Cloudflare Zero Trust organizasyonu.

Cloudflare Tunnel dışarı doğru bağlantı kurar; router üzerinde port yönlendirme veya Windows Firewall'da inbound internet kuralı gerekmez. Ayrıntılar için [Cloudflare Tunnel genel bakışı](https://developers.cloudflare.com/tunnel/) ve [Tunnel firewall gereksinimleri](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/) belgelerine bakın.

## 2. Uygulamayı güvenli yerel ayarlarla hazırlayın

PowerShell'i proje dizininde açın:

```powershell
Set-Location "C:\Users\1548u\Desktop\UWB\ui\base"
Copy-Item .env.example .env.local
```

`.env.local` içinde en az şunları doğrulayın:

```dotenv
PORT=3000
RAW_POSITION_PORT=3000
REGION_POSITION_HOST=127.0.0.1
REGION_POSITION_PORT=3001
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_PASSWORD=CHANGE_ME
```

`CHANGE_ME` değerini yalnızca `.env.local` içinde gerçek yerel veritabanı parolanızla değiştirin. `.env.local` Git tarafından dışlanır. Assistant çalışmıyorsa `CHATBOT_SERVICE_URL` boş kalmalıdır. Çalışıyorsa yalnızca `http://127.0.0.1:8000` kullanın.

Bağımlılıkları kurup build alın:

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run start:share
```

`start:share`, uygulamayı özellikle `127.0.0.1:3000` üzerinde başlatır. Bu pencere açık kalmalıdır. Yeni bir PowerShell penceresinde kontrol edin:

```powershell
Invoke-WebRequest "http://127.0.0.1:3000/" -UseBasicParsing
Invoke-RestMethod "http://127.0.0.1:3000/api/health"
```

Health yanıtının `503` olması çoğunlukla zorunlu PostgreSQL servisinin hazır olmadığını gösterir. Assistant `not_configured` olabilir ve tek başına `503` nedeni değildir.

## 3. cloudflared kurun

Güncel Windows paketini [cloudflared indirme sayfasından](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) indirin veya kurumsal paket yöneticinizle kurun. Komutun çalıştığını doğrulayın:

```powershell
cloudflared.exe --version
```

Cloudflare hesabına tarayıcı üzerinden yetki verin:

```powershell
cloudflared.exe tunnel login
```

Tarayıcıda doğru Cloudflare hesabını ve doğru domain'i seçin. Oluşan sertifika ve sonraki credential JSON dosyalarını paylaşmayın veya repoya kopyalamayın.

## 4. Named Tunnel oluşturun ve DNS'i bağlayın

Placeholder yerine size ait, açıklayıcı bir ad kullanın:

```powershell
cloudflared.exe tunnel create <TUNNEL_NAME>
cloudflared.exe tunnel list
cloudflared.exe tunnel route dns <TUNNEL_NAME> <DEMO_DOMAIN>
```

İlk komut bir tunnel UUID ve `%USERPROFILE%\.cloudflared\<TUNNEL_UUID>.json` credential dosyası üretir. İkinci komuttaki UUID'yi not alın. Üçüncü komut demo hostname'i için Cloudflare DNS kaydını oluşturur.

## 5. Tunnel config dosyasını hazırlayın

Repodaki `deploy/cloudflared/config.example.yml` dosyasını `%USERPROFILE%\.cloudflared\config.yml` konumuna kopyalayın. Sonra yalnızca kendi bilgisayarınızdaki kopyada `<TUNNEL_UUID>`, `<WINDOWS_USER>` ve `<DEMO_DOMAIN>` alanlarını değiştirin:

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: C:\Users\<WINDOWS_USER>\.cloudflared\<TUNNEL_UUID>.json

ingress:
  - hostname: <DEMO_DOMAIN>
    service: http://127.0.0.1:3000
  - service: http_status:404
```

Yalnızca port `3000` Tunnel ingress'idir. `3001`, `5432` ve `8000` için hostname veya ingress eklemeyin. Yapılandırmayı doğrulayın ve önce ön planda deneyin:

```powershell
cloudflared.exe tunnel ingress validate
cloudflared.exe tunnel --config "$env:USERPROFILE\.cloudflared\config.yml" run <TUNNEL_NAME>
```

Bu pencere açıkken domain henüz Access ile korunmadıysa uygulamayı uzun süre açık bırakmayın. Bir sonraki adımı hemen tamamlayın.

## 6. Cloudflare Access ile tüm hostname'i koruyun

1. Cloudflare panelinde **Zero Trust → Access controls → Applications** bölümüne gidin.
2. **Add an application → Self-hosted** seçin.
3. Uygulama adı olarak örneğin `UWB geçici demo` yazın.
4. Application domain alanına yalnızca `<DEMO_DOMAIN>` girin; path alanını boş bırakın. Böylece `/`, `/api/*`, health ve SSE dahil tüm hostname korunur.
5. Bir **Allow** policy oluşturun.
6. **Include → Emails** seçip yalnızca `<ALLOWED_EMAIL>` değerlerini ekleyin.
7. Gerekirse **Settings → Authentication → Login methods** altında One-Time PIN'i etkinleştirin. E-posta allowlist'i kimlerin OTP alabileceğini belirlemelidir.
8. Policy veya application içinde `Everyone`, genel bir e-posta domain'i ya da `Bypass` kuralı eklemeyin.
9. Kaydedin ve gizli/oturum açılmamış tarayıcı penceresinde test edin.

`Login Methods = One-time PIN` kuralını tek başına bir Allow koşulu olarak kullanmak tüm geçerli e-postalara erişim verebilir. Mutlaka tam e-posta allowlist'i ile sınırlayın. Cloudflare'ın güncel davranışı için [Access policy](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/), [yaygın policy örnekleri](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/) ve [One-Time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) belgelerine bakın.

Önemli: `/api/*`, `/api/health`, `/api/tracking/ingest` veya `/api/tracking/processed` için ayrı Access application ya da bypass oluşturmayın. Daha özel bir path uygulaması, kök hostname politikasının önüne geçebilir.

## 7. Windows servisi olarak çalıştırın

Ön plandaki test başarılı olduktan sonra `Ctrl+C` ile cloudflared'i durdurun. Yönetici olarak CMD veya PowerShell açıp resmi [Windows service rehberini](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/windows/) uygulayın:

```powershell
cloudflared.exe service install
```

Windows servisi `LocalSystem` hesabıyla çalıştığında kullanıcınızın `%USERPROFILE%` dizinini görmez. Resmi rehberde belirtildiği gibi config ve `<TUNNEL_UUID>.json` dosyasını `C:\Windows\System32\config\systemprofile\.cloudflared\` altına kopyalayın ve bu servis kopyasındaki `credentials-file` yolunu aynı dizine göre güncelleyin. Credential dosyasının ACL'ini yalnızca `SYSTEM` ve yöneticiler okuyacak şekilde sınırlayın.

Servis `ImagePath` değerinin açıkça doğru config'i kullandığını resmi rehberdeki biçimle doğrulayın. Ardından:

```powershell
sc.exe start cloudflared
sc.exe query cloudflared
```

Config değişince servisi yeniden başlatın:

```powershell
sc.exe stop cloudflared
sc.exe start cloudflared
```

## 8. Cloudflare tarafı HTTPS ayarları

- Cloudflare SSL/TLS modunu domain'in diğer servislerini de dikkate alarak güvenli bir moda alın.
- HSTS'yi uygulama kodunda etkinleştirmeyin; yerel HTTP geliştirmesini bozar. Demo domain HTTPS ile doğrulandıktan sonra **SSL/TLS → Edge Certificates → HSTS** bölümünde Cloudflare tarafında değerlendirin.
- HSTS tüm alt domain'leri etkileyebileceğinden `includeSubDomains` veya preload seçeneklerini sonuçlarını bilmeden açmayın.

## 9. Başlatma, durdurma ve geri alma

Her demo oturumunda sıralama:

1. PostgreSQL'i başlatın.
2. `npm.cmd run start:share` ile uygulamayı başlatın.
3. `sc.exe query cloudflared` ile Tunnel servisini doğrulayın.
4. Access girişini izinli ve izinsiz e-posta ile test edin.

Paylaşımı durdurmak için önce uygulama penceresinde `Ctrl+C` kullanın. Tunnel'ı da kapatmak isterseniz yönetici terminalinde `sc.exe stop cloudflared` çalıştırın.

Tam geri alma için Cloudflare panelinde Access application'ı kaldırın/devre dışı bırakın, DNS hostname bağlantısını kaldırın ve Tunnel'ı durdurun. Credential JSON'u silmeden önce Tunnel'ın artık kullanılmadığını doğrulayın; credential silme geri alınamaz. Router veya firewall üzerinde açılmış bir inbound kural olmamalıdır.

## 10. Sorun giderme

```powershell
# Uygulama yalnızca loopback'te mi dinliyor?
Get-NetTCPConnection -State Listen -LocalPort 3000,3001,5432,8000 |
  Select-Object LocalAddress,LocalPort,OwningProcess

# Uygulama ve health
Invoke-WebRequest "http://127.0.0.1:3000/" -UseBasicParsing
Invoke-RestMethod "http://127.0.0.1:3000/api/health"

# Tunnel config ve bağlantı
cloudflared.exe tunnel ingress validate
cloudflared.exe tunnel info <TUNNEL_NAME>
sc.exe query cloudflared

# DNS
Resolve-DnsName <DEMO_DOMAIN>
```

- `3000` ve `3001` için `LocalAddress` değeri `127.0.0.1` olmalıdır.
- Processed SSE çalışmıyorsa önce region engine'i etkinleştirin, sonra `http://127.0.0.1:3000/api/tracking/processed` isteğinin `text/event-stream` döndürdüğünü kontrol edin.
- `503` health yanıtında database `unavailable` ise PostgreSQL'i ve `.env.local` ayarlarını kontrol edin. Dışarı verilen health yanıtı iç hata ayrıntılarını içermez; ayrıntılar yalnızca uygulamanın server logundadır.
- Tunnel çalışıyor fakat domain açılmıyorsa config hostname'ini, DNS kaydını ve Windows servisinin kullandığı config yolunu kontrol edin.
- Access ekranı gelmiyorsa hostname'i kapsayan Self-hosted Application'ı ve daha özel path uygulaması/bypass olup olmadığını kontrol edin.

## 11. Güvenlik kontrol listesi

- [ ] Gerçek domain ve izinli e-postalar yalnızca Cloudflare panelinde/yerel config'de bulunuyor.
- [ ] Tunnel config yalnızca `http://127.0.0.1:3000` servisine yönleniyor.
- [ ] Uygulama `npm.cmd run start:share` ile `127.0.0.1:3000` üzerinde çalışıyor.
- [ ] Processed servis `127.0.0.1:3001`, PostgreSQL `127.0.0.1:5432` üzerinde.
- [ ] Assistant kullanılıyorsa yalnızca `127.0.0.1:8000` üzerinde.
- [ ] Router'da 80, 443, 3000, 3001, 5432 veya 8000 port forwarding yok.
- [ ] Windows Firewall'da bu portları internete açan inbound allow kuralı yok.
- [ ] Access application path'siz biçimde tüm `<DEMO_DOMAIN>` hostname'ini koruyor.
- [ ] Allow policy yalnızca tam e-posta allowlist'ini içeriyor; `Everyone` ve bypass yok.
- [ ] `/api/*`, SSE veya health için Access bypass yok.
- [ ] İzinsiz e-posta erişemiyor; izinli e-posta Access girişinden sonra erişebiliyor.
- [ ] Tunnel credential JSON, token, gerçek parola ve `.env.local` Git'e eklenmemiş.
- [ ] Cloudflare edge üzerinde HTTPS doğrulandı; HSTS kararı Cloudflare tarafında bilinçli verildi.

## Kapsam dışı

Dış ağdaki UWB cihazlarının bu hostname üzerinden veri göndermesi bu demo çalışmasının kapsamında değildir. Böyle bir ihtiyaç doğarsa tarayıcı demosundan ayrı bir hostname, machine-to-machine kimlik doğrulama ve Cloudflare Access Service Token tasarlanmalıdır. Mevcut kullanıcı Access oturumunu cihaz kimlik doğrulaması olarak kullanmayın.

Bu kurulum uygulamaya production düzeyinde kimlik doğrulama, yetkilendirme, yüksek erişilebilirlik, merkezi secret yönetimi, kapsamlı audit veya saldırı dayanıklılığı kazandırmaz. Yalnızca kontrollü demo paylaşımı içindir.
