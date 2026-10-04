@echo off
title RETRO ANTICHEAT - WEB PLATFORM (OCEAN EDITION)
color 0b

echo ===================================================================
echo     RETRO ROLEPLAY - ANTI-CHEAT WEB PLATFORM (OCEAN EDITION)
echo ===================================================================
echo.
echo [*] Web Sunucusu 0.0.0.0:3000 uzerinde baslatiliyor...
echo [*] Tarayici otomatik aciliyor: http://localhost:3000
echo.

start "" "http://localhost:3000"
node server.js

pause
