@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Oda arayuzu kurulumu ===
where node >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden 22 LTS kurun. & pause & exit /b 1)
node -v
if not exist .env.local (copy .env.example .env.local >nul & echo .env.local olusturuldu.)
call npm install
if errorlevel 1 (echo. & echo KURULUM HATASI. Yukaridaki mesaji bize gonderin. & pause & exit /b 1)
echo.
echo Kurulum tamam. Simdi 2-BASLAT.bat dosyasini calistirin.
pause
