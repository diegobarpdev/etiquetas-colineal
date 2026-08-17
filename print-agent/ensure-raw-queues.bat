@echo off
REM Ejecutar como Administrador en la PC de la Zebra
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-raw-queues.ps1"
echo.
pause
