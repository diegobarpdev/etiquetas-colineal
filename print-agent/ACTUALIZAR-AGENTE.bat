@echo off
REM Actualiza el print-agent desde el servidor HTTP (manual).
cd /d "%~dp0"

if /I "%~1"=="__RUN__" goto :run

start "Actualizar Agente Etiquetas" cmd /c call "%~f0" __RUN__
exit /b 0

:run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar-agente.ps1"
set ERR=%ERRORLEVEL%
echo.
if %ERR% neq 0 (
  echo Fallo la actualizacion. Codigo %ERR%
  pause
  exit /b %ERR%
)
echo.
echo Listo. Puedes cerrar esta ventana.
timeout /t 8
exit /b 0
