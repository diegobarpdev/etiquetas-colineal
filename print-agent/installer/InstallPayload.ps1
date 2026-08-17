#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Instala el agente de impresión desde el servidor (paquete HTTP).
  Lo invoca Instalar-Agente-Etiquetas.exe (no hace falta copiar carpetas).

.PARAMETER ServerUrl
  Base del servidor de etiquetas (sin barra final).

.PARAMETER InstallRoot
  Carpeta destino del agente.
#>
param(
  [string]$ServerUrl = 'http://192.168.2.28:3000',
  [string]$InstallRoot = 'C:\Etiquetas\print-agent'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ServerUrl = $ServerUrl.TrimEnd('/')
$InstallRoot = $InstallRoot.TrimEnd('\', '/')

Write-Host ''
Write-Host '=== Etiquetas Colineal — Instalador del agente ===' -ForegroundColor Cyan
Write-Host "Servidor:  $ServerUrl"
Write-Host "Destino:   $InstallRoot"
Write-Host "Usuario:   $env:USERNAME"
Write-Host ''

Write-Host 'Requisito: Zebra Browser Print debe estar instalado en esta PC' -ForegroundColor Yellow
Write-Host '(el instalador NO incluye Browser Print).'
Write-Host ''

# Comprobar que el servidor responde
try {
  $ver = Invoke-RestMethod -Uri "$ServerUrl/api/print-agent/version" -TimeoutSec 30
  Write-Host "Paquete remoto: version=$($ver.version) ($([math]::Round($ver.sizeBytes/1KB)) KB)" -ForegroundColor Green
} catch {
  throw "No se pudo contactar $ServerUrl/api/print-agent/version. ¿La app está en marcha en el servidor? $_"
}

$tmp = Join-Path $env:TEMP ('etiquetas-install-' + [guid]::NewGuid().ToString('N'))
$zip = Join-Path $tmp 'package.zip'
$extract = Join-Path $tmp 'extract'
New-Item -ItemType Directory -Force -Path $extract | Out-Null

try {
  Write-Host 'Descargando package.zip...'
  Invoke-WebRequest -Uri "$ServerUrl/api/print-agent/package.zip" -OutFile $zip -UseBasicParsing -TimeoutSec 300
  if (-not (Test-Path $zip) -or (Get-Item $zip).Length -lt 1000) {
    throw 'Descarga inválida (archivo vacío o muy pequeño).'
  }

  Write-Host 'Extrayendo...'
  Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
  if (-not (Test-Path (Join-Path $extract 'index.js'))) {
    throw 'El ZIP no contiene index.js. Publica de nuevo: npm run publish:print-agent'
  }

  # Preservar configuración local si ya existía
  $preserve = @('.env', 'usb-role-map.json')
  $backup = Join-Path $tmp 'preserve'
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  foreach ($name in $preserve) {
    $src = Join-Path $InstallRoot $name
    if (Test-Path $src) {
      Copy-Item -LiteralPath $src -Destination (Join-Path $backup $name) -Force
      Write-Host "Conservando $name existente"
    }
  }

  if (-not (Test-Path $InstallRoot)) {
    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  }

  Write-Host "Copiando archivos a $InstallRoot ..."
  Get-ChildItem -LiteralPath $extract -Force | ForEach-Object {
    $dest = Join-Path $InstallRoot $_.Name
    if ($_.PSIsContainer) {
      Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
    } else {
      Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
    }
  }

  foreach ($name in $preserve) {
    $bak = Join-Path $backup $name
    if (Test-Path $bak) {
      Copy-Item -LiteralPath $bak -Destination (Join-Path $InstallRoot $name) -Force
    }
  }

  # Marcar servidor de updates para auto-update
  $envPath = Join-Path $InstallRoot '.env'
  if (-not (Test-Path $envPath)) {
    @(
      'PORT=9120'
      "UPDATE_SERVER_URL=$ServerUrl"
      'AUTO_UPDATE=1'
    ) | Set-Content -LiteralPath $envPath -Encoding UTF8
  } else {
    $raw = Get-Content -LiteralPath $envPath -Raw
    if ($raw -notmatch '(?m)^\s*UPDATE_SERVER_URL\s*=') {
      Add-Content -LiteralPath $envPath -Value "`nUPDATE_SERVER_URL=$ServerUrl"
    }
    if ($raw -notmatch '(?m)^\s*AUTO_UPDATE\s*=') {
      Add-Content -LiteralPath $envPath -Value 'AUTO_UPDATE=1'
    }
  }

  $installPs1 = Join-Path $InstallRoot 'install.ps1'
  if (-not (Test-Path $installPs1)) {
    throw "Falta install.ps1 en $InstallRoot"
  }

  Write-Host ''
  Write-Host 'Ejecutando install.ps1 (Node, PM2, firewall, tareas)...' -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installPs1
  $code = $LASTEXITCODE
  if ($null -eq $code) { $code = 0 }

  if ($code -ne 0) {
    throw "install.ps1 terminó con código $code"
  }

  Write-Host ''
  Write-Host 'Instalación completada.' -ForegroundColor Green
  Write-Host "Agente en: $InstallRoot"
  Write-Host 'Puerto: 9120  |  Browser Print debe estar en 9100'
  Write-Host 'Reinicio: REINICIAR-AGENTE.bat en esa carpeta'
  Write-Host ''
  exit 0
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
