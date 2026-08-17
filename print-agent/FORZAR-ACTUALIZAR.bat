@echo off
REM Fuerza bajada del paquete nuevo (sin PM2) y arranque limpio.
cd /d "%~dp0"
echo ==============================================
echo   FORZAR actualizacion print-agent (sin PM2)
echo ==============================================
if exist "agent-version.json" del /f /q "agent-version.json"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar-agente.ps1" -Force
if errorlevel 1 (
  echo Fallo la actualizacion. Revisa red hacia el servidor :3000
  pause
  exit /b 1
)
echo.
echo Arrancando sin PM2...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0reiniciar-agente.ps1"
exit /b %ERRORLEVEL%
