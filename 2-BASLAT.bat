@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Oda arayuzu baslatiliyor ===
echo Tarayicida acin:  http://localhost:3000
echo.
echo Jetson'a yazilacak adres (forwardingUrl), asagidaki IPv4 adreslerinden biri ile:
echo     http://BU_BILGISAYARIN_IP:3000/api/tracking/ingest
ipconfig | findstr /i "IPv4"
echo.
echo Kapatmak icin bu pencerede Ctrl+C.
echo.
call npm run dev
pause
