@echo off
REM Abre ventana visible, corre el reinicio y se cierra solo.
cd /d "%~dp0"

if /I "%~1"=="__RUN__" goto :run

start "Reiniciar Agente Etiquetas" cmd /c call "%~f0" __RUN__
exit /b 0

:run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0reiniciar-agente.ps1"
exit /b %ERRORLEVEL%
