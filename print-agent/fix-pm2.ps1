#Requires -Version 5.1
<#
  Reparacion remota: baja el paquete NUEVO (sin PM2) y arranca un solo node.
  En la .89 pegar en PowerShell:

    irm http://192.168.2.28:3000/api/print-agent/fix-pm2.ps1 | iex

  O:
    powershell -File \\...\fix-pm2.ps1
#>
$ErrorActionPreference = 'Stop'
$Server = 'http://192.168.2.28:3000'
$Root = 'C:\Etiquetas\print-agent'
$Port = 9120

Write-Host '=== Reparar print-agent (sin PM2) ===' -ForegroundColor Cyan
Write-Host "Servidor: $Server"
Write-Host "Destino:  $Root"

New-Item -ItemType Directory -Force -Path $Root | Out-Null

# Pausar watchdog
foreach ($tn in @('EtiquetasPrintAgentWatch', 'EtiquetasPrintAgentUpdate', 'EtiquetasPrintAgentLogon')) {
  cmd /c "schtasks /Change /TN `"$tn`" /DISABLE >nul 2>&1" | Out-Null
}

# Matar node del agente / puerto (SIN llamar a pm2)
Write-Host 'Deteniendo procesos viejos...'
$prev = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
netstat -ano 2>$null | ForEach-Object {
  if ($_ -match (":$Port\s+") -and $_ -match 'LISTENING\s+(\d+)\s*$') {
    Stop-Process -Id ([int]$Matches[1]) -Force -ErrorAction SilentlyContinue
  }
}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  $cmd = [string]$_.CommandLine
  if ($cmd -and (
      $cmd -match [regex]::Escape($Root) -or
      $cmd -match 'print-agent' -or
      $cmd -match 'pm2'
    )) {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}
$ErrorActionPreference = $prev
Start-Sleep -Seconds 1

# Conservar config
$bak = Join-Path $env:TEMP ("print-agent-bak-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $bak | Out-Null
foreach ($name in @('.env', 'usb-role-map.json')) {
  $p = Join-Path $Root $name
  if (Test-Path $p) { Copy-Item $p $bak -Force }
}

$zip = Join-Path $env:TEMP 'print-agent-fix.zip'
$extract = Join-Path $env:TEMP ("print-agent-fix-" + [guid]::NewGuid().ToString('N'))
Write-Host 'Descargando package.zip...'
Invoke-WebRequest -Uri "$Server/api/print-agent/package.zip" -OutFile $zip -UseBasicParsing -TimeoutSec 180
if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $extract -Force

# Contenido puede venir en subcarpeta
$src = $extract
if (-not (Test-Path (Join-Path $src 'index.js'))) {
  $sub = Get-ChildItem $extract -Directory | Select-Object -First 1
  if ($sub) { $src = $sub.FullName }
}
if (-not (Test-Path (Join-Path $src 'index.js'))) {
  throw 'El ZIP no contiene index.js'
}

Write-Host 'Copiando archivos nuevos (sin tocar .env)...'
Get-ChildItem $src -Force | ForEach-Object {
  if ($_.Name -in @('.env', 'usb-role-map.json', '.pm2', 'node_modules', 'logs', 'runtime')) { return }
  $dest = Join-Path $Root $_.Name
  if ($_.PSIsContainer) {
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue }
    Copy-Item $_.FullName $dest -Recurse -Force
  } else {
    Copy-Item $_.FullName $dest -Force
  }
}

foreach ($name in @('.env', 'usb-role-map.json')) {
  $fromBak = Join-Path $bak $name
  if (Test-Path $fromBak) { Copy-Item $fromBak (Join-Path $Root $name) -Force }
}

# Quitar estado PM2 roto + marcar modo directo
$pm2 = Join-Path $Root '.pm2'
if (Test-Path $pm2) { Remove-Item $pm2 -Recurse -Force -ErrorAction SilentlyContinue }
Set-Content -Path (Join-Path $Root '.prefer-node-direct') -Value ("{0:yyyy-MM-dd HH:mm:ss} fix-pm2" -f (Get-Date)) -Encoding UTF8
if (Test-Path (Join-Path $Root 'agent-version.json')) {
  # fuerza que el proximo auto-update vea la version del zip si hace falta
}

# npm install si falta node_modules
if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
  Write-Host 'npm install...'
  Push-Location $Root
  try { & npm.cmd install --omit=dev --no-fund --no-audit } catch { & npm install --omit=dev }
  Pop-Location
}

Write-Host 'Arranque limpio (reiniciar-agente sin PM2)...'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'reiniciar-agente.ps1')
$code = $LASTEXITCODE

foreach ($tn in @('EtiquetasPrintAgentLogon', 'EtiquetasPrintAgentWatch', 'EtiquetasPrintAgentUpdate')) {
  cmd /c "schtasks /Change /TN `"$tn`" /ENABLE >nul 2>&1" | Out-Null
}

Write-Host ''
if ($code -eq 0) {
  Write-Host 'LISTO. Health: http://127.0.0.1:9120/health' -ForegroundColor Green
  Write-Host 'Ya no debe aparecer EPERM ni montones de node.' -ForegroundColor Green
} else {
  Write-Host "Salida $code — revisa el mensaje de reiniciar-agente." -ForegroundColor Yellow
}
exit $code
