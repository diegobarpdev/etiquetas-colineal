# Bootstrap: una sola linea desde cualquier PC USB
#   irm http://192.168.2.28:3000/api/print-agent/bootstrap.ps1 | iex
#
# Si hay EPERM / muchos node, preferir:
#   irm http://192.168.2.28:3000/api/print-agent/fix-pm2.ps1 | iex

$ErrorActionPreference = 'Stop'
$Server = 'http://192.168.2.28:3000'

$candidates = @(
  'C:\Etiquetas\print-agent',
  'C:\etiquetas\print-agent',
  (Join-Path $env:USERPROFILE 'print-agent'),
  (Join-Path $PWD 'print-agent')
)
$Root = $candidates | Where-Object { Test-Path (Join-Path $_ 'index.js') } | Select-Object -First 1
if (-not $Root) {
  Write-Host 'No encuentro print-agent. Indica la carpeta:' -ForegroundColor Yellow
  $Root = Read-Host 'Ruta completa (ej C:\Etiquetas\print-agent)'
}
if (-not (Test-Path (Join-Path $Root 'index.js'))) {
  throw "No hay index.js en $Root"
}

Write-Host "Agente: $Root" -ForegroundColor Cyan
Write-Host "Servidor: $Server"
Write-Host 'Aplicando reparacion sin PM2...' -ForegroundColor Yellow

# Bajar fix-pm2 del servidor y ejecutarlo (no depende de scripts viejos locales)
$fixUrl = "$Server/api/print-agent/fix-pm2.ps1"
$fixLocal = Join-Path $env:TEMP 'fix-pm2.ps1'
Invoke-WebRequest -Uri $fixUrl -OutFile $fixLocal -UseBasicParsing -TimeoutSec 60
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $fixLocal
exit $LASTEXITCODE
