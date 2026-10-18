@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Jetson olmadan test: positions.jsonl dosyasini bu dosyanin uzerine surukleyip birakin.
rem Once 2-BASLAT.bat calisiyor olmali.
if "%~1"=="" (echo positions.jsonl dosyasini bu .bat dosyasinin uzerine surukleyip birakin. & pause & exit /b 1)
node tools\jetson-replay.mjs "%~1" --speed 1
pause
