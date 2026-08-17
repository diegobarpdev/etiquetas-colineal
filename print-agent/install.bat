@echo off
REM Instalador portable — Agente Browser Print + ZPL (puerto 9120)
REM Doble clic en CUALQUIER PC USB. No requiere ruta fija.
REM Requiere: Zebra Browser Print instalado + Admin.

cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permisos de Administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo === Etiquetas Colineal — Agente Browser Print (puerto 9120) ===
echo Carpeta: %CD%
echo Usuario: %USERNAME%
echo.
echo NO copies el archivo .env de otra PC (UID USB distintos).
echo El instalador crea/repara .env aqui.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set ERR=%ERRORLEVEL%
echo.
if %ERR% neq 0 (
  echo ERROR: la instalacion fallo con codigo %ERR%.
) else (
  echo Listo. Guia: INSTALACION-NUEVA-PC.md
  echo Reiniciar: REINICIAR-AGENTE.bat
  echo Diagnostico: diagnostico.ps1
)
pause
exit /b %ERR%
