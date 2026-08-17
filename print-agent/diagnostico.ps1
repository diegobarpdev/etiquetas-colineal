#Requires -Version 5.1
<#
.SYNOPSIS
  Diagnostico del print-agent en la PC de la impresora.
#>
$ErrorActionPreference = 'Continue'
$Root = $PSScriptRoot
$Port = 9120

Write-Host '=============================================='
Write-Host '  Diagnostico print-agent / Browser Print'
Write-Host "  $Root"
Write-Host '=============================================='

Write-Host ''
Write-Host '== Node / PM2 ==' -ForegroundColor Cyan
try { Write-Host ("node: {0}" -f (& node -v)) } catch { Write-Host 'node: NO instalado' -ForegroundColor Red }
try { Write-Host ("pm2:  {0}" -f (& pm2 -v)) } catch { Write-Host 'pm2: NO instalado' -ForegroundColor Red }
try { & pm2 status } catch {}

Write-Host ''
Write-Host '== Puertos ==' -ForegroundColor Cyan
foreach ($p in 9100, 9101, 9120) {
  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    Write-Host ("{0}: LISTEN pid={1}" -f $p, $c.OwningProcess) -ForegroundColor Green
  } else {
    Write-Host ("{0}: libre" -f $p) -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host '== .env ==' -ForegroundColor Cyan
$envPath = Join-Path $Root '.env'
if (Test-Path $envPath) {
  Get-Content $envPath | Where-Object { $_ -and $_ -notmatch '^\s*#' } | ForEach-Object { Write-Host $_ }
} else {
  Write-Host 'NO hay .env' -ForegroundColor Red
}

Write-Host ''
Write-Host '== Browser Print :9100 ==' -ForegroundColor Cyan
try {
  $bp = Invoke-RestMethod -Uri 'http://127.0.0.1:9100/available' -TimeoutSec 5
  Write-Host 'OK responde' -ForegroundColor Green
  $bp | ConvertTo-Json -Depth 6
} catch {
  Write-Host ("FALLA: {0}" -f $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Instala/abre Zebra Browser Print (bandeja).'
}

Write-Host ''
Write-Host '== Agente :9120/health ==' -ForegroundColor Cyan
try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 8
  $h | ConvertTo-Json -Depth 6
  if ($h.browserPrint -and $h.browserPrint.reachable) {
    Write-Host 'OK agente + Browser Print' -ForegroundColor Green
  } else {
    Write-Host 'Agente OK pero Browser Print no reachable' -ForegroundColor Yellow
  }
} catch {
  Write-Host ("FALLA: {0}" -f $_.Exception.Message) -ForegroundColor Red
  Write-Host 'pm2 restart etiquetas-print-agent'
}

Write-Host ''
Write-Host '== IPs LAN (usar en PRINT_AGENT_URL del servidor) ==' -ForegroundColor Cyan
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
  ForEach-Object { Write-Host ("http://{0}:9120" -f $_.IPAddress) -ForegroundColor Green }

Write-Host ''
Write-Host 'Panel:     http://127.0.0.1:9120/'
Write-Host 'BP check:  http://127.0.0.1:9120/bp-check.html'
Write-Host '=============================================='
