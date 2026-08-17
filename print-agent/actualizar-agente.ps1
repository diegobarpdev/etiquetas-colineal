#Requires -Version 5.1
<#
.SYNOPSIS
  Actualiza el print-agent desde el servidor HTTP.

.PARAMETER Silent
  Sin colores/pausas; escribe en logs\auto-update.log. Para tarea programada.

.PARAMETER SkipRestart
  No reinicia el agente al final (raro; boot lo arrancara).

.PARAMETER Force
  Ignora .update.lock y fuerza la actualizacion.
#>
param(
  [switch]$Silent,
  [switch]$SkipRestart,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Port = 9120
$DefaultServer = 'http://192.168.2.28:3000'
$LocalVersionPath = Join-Path $Root 'agent-version.json'
$EnvPath = Join-Path $Root '.env'
$UsbMapPath = Join-Path $Root 'usb-role-map.json'
$LogDir = Join-Path $Root 'logs'
$UpdateLog = Join-Path $LogDir 'auto-update.log'
$LockPath = Join-Path $Root '.update.lock'

function Write-Msg([string]$msg, [string]$color = 'White') {
  if ($Silent) {
    try {
      New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
      $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $msg
      Add-Content -Path $UpdateLog -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
  } else {
    if ($color -eq 'White') { Write-Host $msg }
    else { Write-Host $msg -ForegroundColor $color }
  }
}

function Write-Title([string]$t) {
  if (-not $Silent) {
    Write-Host ''
    Write-Host $t -ForegroundColor Cyan
  } else {
    Write-Msg $t
  }
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
  foreach ($extra in @(
      (Join-Path $Root 'runtime\node'),
      (Join-Path $env:APPDATA 'npm'),
      (Join-Path $env:LOCALAPPDATA 'npm'),
      (Join-Path ${env:ProgramFiles} 'nodejs'),
      (Join-Path ${env:ProgramFiles(x86)} 'nodejs')
    )) {
    if ($extra -and (Test-Path $extra)) { $env:Path = "$extra;$env:Path" }
  }
}

function Get-EnvValue([string]$Key, [string]$Fallback = '') {
  if (-not (Test-Path $EnvPath)) { return $Fallback }
  $line = Get-Content $EnvPath -ErrorAction SilentlyContinue |
    Where-Object { $_ -match ("^\s*" + [regex]::Escape($Key) + "\s*=") } |
    Select-Object -First 1
  if (-not $line) { return $Fallback }
  $val = ($line -split '=', 2)[1].Trim()
  if (-not $val) { return $Fallback }
  return $val.Trim('"').Trim("'")
}

function Get-LocalVersion {
  if (-not (Test-Path $LocalVersionPath)) { return $null }
  try {
    return (Get-Content $LocalVersionPath -Raw).Replace([char]0xFEFF, '') | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Stop-AgentPort {
  Write-Msg "Deteniendo proceso en puerto $Port..."
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  try {
    $pids = @()
    netstat -ano 2>$null | ForEach-Object {
      if ($_ -match (":$Port\s+") -and $_ -match 'LISTENING\s+(\d+)\s*$') {
        $pids += [int]$Matches[1]
      }
    }
    foreach ($procId in ($pids | Select-Object -Unique)) {
      Write-Msg "  taskkill PID $procId"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }

    # Mata node.exe de ESTE print-agent (sin depender de PM2)
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $_.CommandLine -and
        $_.CommandLine -match [regex]::Escape($Root) -and
        $_.CommandLine -match 'index\.js'
      } |
      ForEach-Object {
        Write-Msg ("  stop node pid={0}" -f $_.ProcessId)
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }

    Refresh-Path
    # NO llamar a pm2: en Windows suele tirar EPERM rpc.sock y tumba el update.
    Start-Sleep -Seconds 1
  } finally {
    $ErrorActionPreference = $prevEa
  }
}

function Find-NodeExe {
  Refresh-Path
  $portable = Join-Path $Root 'runtime\node\node.exe'
  if (Test-Path $portable) { return $portable }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $pf = Join-Path ${env:ProgramFiles} 'nodejs\node.exe'
  if (Test-Path $pf) { return $pf }
  return $null
}

function Find-NpmCmd {
  Refresh-Path
  $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Ensure-AutoUpdateScheduledTask {
  $script = Join-Path $Root 'auto-update.ps1'
  if (-not (Test-Path $script)) { return }
  $taskName = 'EtiquetasPrintAgentUpdate'
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existing) { return }

  $psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
  $tr = "powershell.exe $psArgs"
  cmd /c "schtasks /Create /TN `"$taskName`" /TR `"$tr`" /SC MINUTE /MO 15 /RL LIMITED /F >nul 2>&1" | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Msg "Tarea $taskName creada (cada 15 min)"
  }
}

function Unlock-Update {
  Remove-Item $LockPath -Force -ErrorAction SilentlyContinue
}

function Exit-Update([int]$code) {
  Unlock-Update
  exit $code
}

# --- main ---
if (Test-Path $LockPath) {
  $ageMin = ((Get-Date) - (Get-Item $LockPath).LastWriteTime).TotalMinutes
  # Lock viejo (crash anterior) o -Force: borrar y seguir
  if ($Force -or $ageMin -ge 2) {
    Write-Msg ("Quitando .update.lock stale ({0:N1} min)" -f $ageMin) 'Yellow'
    Remove-Item $LockPath -Force -ErrorAction SilentlyContinue
  } else {
    Write-Msg 'Otra actualizacion en curso (.update.lock). Espera 2 min o borra el archivo .update.lock' 'Yellow'
    exit 0
  }
}

$autoFlag = (Get-EnvValue 'AUTO_UPDATE' '1').ToLowerInvariant()
if ($Silent -and ($autoFlag -in @('0', 'false', 'no', 'off'))) {
  Write-Msg 'AUTO_UPDATE desactivado en .env — skip'
  exit 0
}

try {
  '1' | Set-Content -Path $LockPath -Encoding ASCII
} catch {}

Write-Title '=== Actualizar print-agent desde servidor ==='
Write-Msg "Carpeta: $Root"

$serverUrl = (Get-EnvValue 'UPDATE_SERVER_URL' $DefaultServer).TrimEnd('/')
Write-Msg "Servidor: $serverUrl"

Write-Title '1) Consultando version remota...'
try {
  $remote = Invoke-RestMethod -Uri "$serverUrl/api/print-agent/version" -TimeoutSec 30
} catch {
  Write-Msg "No se pudo leer version remota: $($_.Exception.Message)" 'Red'
  if (-not $Silent) {
    Write-Host "¿Esta la app en $serverUrl y se publico con npm run publish:print-agent?" -ForegroundColor Yellow
  }
  Exit-Update 1
}

$remoteVersion = [string]$remote.version
$remoteSha = [string]$remote.sha256
if (-not $remoteVersion) {
  Write-Msg 'Respuesta remota sin version.' 'Red'
  Exit-Update 1
}

$local = Get-LocalVersion
$localVersion = if ($local) { [string]$local.version } else { '' }
Write-Msg "Remota: $remoteVersion  (builtAt=$($remote.builtAt))"
Write-Msg "Local:  $(if ($localVersion) { $localVersion } else { '(ninguna)' })"

# Asegurar tarea auto aunque ya este al dia
Ensure-AutoUpdateScheduledTask

if ($localVersion -and $localVersion -eq $remoteVersion) {
  Write-Msg 'Ya esta actualizado. No hay cambios.' 'Green'
  Exit-Update 0
}

Write-Title '2) Descargando package.zip...'
$tmpRoot = Join-Path $env:TEMP ("print-agent-update-" + [guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $tmpRoot 'package.zip'
$extractDir = Join-Path $tmpRoot 'extract'
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

try {
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri "$serverUrl/api/print-agent/package.zip?sha256=$remoteSha" `
    -OutFile $zipPath -TimeoutSec 180 -UseBasicParsing
} catch {
  Write-Msg "Descarga fallida: $($_.Exception.Message)" 'Red'
  Exit-Update 1
}

$actualSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
if ($remoteSha -and ($actualSha -ne $remoteSha.ToLowerInvariant())) {
  Write-Msg "SHA256 no coincide. Esperado=$remoteSha Actual=$actualSha" 'Red'
  Exit-Update 1
}
Write-Msg "ZIP OK ($((Get-Item $zipPath).Length) bytes)"

Write-Title '3) Respaldo de config local...'
$backupDir = Join-Path $tmpRoot 'backup'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
foreach ($f in @($EnvPath, $UsbMapPath)) {
  if (Test-Path $f) {
    Copy-Item -LiteralPath $f -Destination (Join-Path $backupDir (Split-Path $f -Leaf)) -Force
    Write-Msg "  Backup: $(Split-Path $f -Leaf)"
  }
}

Write-Title '4) Deteniendo agente...'
Stop-AgentPort

Write-Title '5) Extrayendo archivos...'
Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force

$skipNames = @('.env', 'usb-role-map.json', 'agent-version.json', '.pm2', 'node_modules', 'runtime', '.update.lock')
Get-ChildItem -Path $extractDir -Recurse -Force | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
  $rel = $_.FullName.Substring($extractDir.Length).TrimStart('\', '/')
  $top = ($rel -split '[\\/]')[0]
  if ($skipNames -contains $top) { return }
  $name = Split-Path $_.FullName -Leaf
  if ($skipNames -contains $name) { return }
  $dest = Join-Path $Root $rel
  $destDir = Split-Path $dest -Parent
  if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  }
  Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
}

Write-Title '6) Restaurando config local...'
foreach ($name in @('.env', 'usb-role-map.json')) {
  $src = Join-Path $backupDir $name
  if (Test-Path $src) {
    Copy-Item -LiteralPath $src -Destination (Join-Path $Root $name) -Force
    Write-Msg "  Restaurado: $name"
  }
}

if (Test-Path $EnvPath) {
  $raw = Get-Content $EnvPath -Raw
  $changed = $false
  if ($raw -notmatch '(?m)^\s*UPDATE_SERVER_URL\s*=') {
    $raw = $raw.TrimEnd() + "`r`nUPDATE_SERVER_URL=$serverUrl`r`n"
    $changed = $true
    Write-Msg "  Anadido UPDATE_SERVER_URL=$serverUrl"
  }
  if ($raw -notmatch '(?m)^\s*AUTO_UPDATE\s*=') {
    $raw = $raw.TrimEnd() + "`r`nAUTO_UPDATE=1`r`n"
    $changed = $true
  }
  if ($raw -notmatch '(?m)^\s*BP_CHUNK_PAGES\s*=') {
    $raw = $raw.TrimEnd() + "`r`nBP_CHUNK_PAGES=8`r`n"
    $changed = $true
  }
  if ($raw -notmatch '(?m)^\s*BP_CHUNK_MAX_BYTES\s*=') {
    $raw = $raw.TrimEnd() + "`r`nBP_CHUNK_MAX_BYTES=300000`r`n"
    $changed = $true
  }
  if ($raw -notmatch '(?m)^\s*BP_CHUNK_GAP_MS\s*=') {
    $raw = $raw.TrimEnd() + "`r`nBP_CHUNK_GAP_MS=300`r`n"
    $changed = $true
  }
  if ($changed) {
    [System.IO.File]::WriteAllText($EnvPath, $raw)
  }
} else {
  @(
    "PORT=$Port"
    'HOST=0.0.0.0'
    'SEND_ENGINE=browser-print'
    'BROWSER_PRINT_URL=http://127.0.0.1:9100'
    "UPDATE_SERVER_URL=$serverUrl"
    'AUTO_UPDATE=1'
    'BP_CHUNK_PAGES=8'
    'BP_CHUNK_MAX_BYTES=300000'
    'BP_CHUNK_GAP_MS=300'
  ) | Set-Content -Path $EnvPath -Encoding ASCII
  Write-Msg '  Creado .env minimo'
}

Write-Title '7) npm install...'
$npm = Find-NpmCmd
$node = Find-NodeExe
if (-not $npm) {
  Write-Msg 'npm no encontrado. Instala Node o usa runtime\node del agente.' 'Red'
  Exit-Update 1
}
Push-Location $Root
try {
  & $npm install --omit=dev
  if ($LASTEXITCODE -ne 0) { throw "npm install fallo ($LASTEXITCODE)" }
} finally {
  Pop-Location
}

Write-Title '8) Guardando agent-version.json...'
$localMeta = [ordered]@{
  version     = $remoteVersion
  sha256      = $remoteSha
  builtAt     = $remote.builtAt
  updatedAt   = (Get-Date).ToUniversalTime().ToString('o')
  updatedFrom = $serverUrl
}
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($LocalVersionPath, ($localMeta | ConvertTo-Json), $utf8)

Ensure-AutoUpdateScheduledTask

if (-not $SkipRestart) {
  Write-Title '9) Reiniciando agente...'
  $reiniciar = Join-Path $Root 'reiniciar-agente.ps1'
  if (Test-Path $reiniciar) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $reiniciar
  } elseif ($node) {
    Start-Process -FilePath $node -ArgumentList 'index.js' -WorkingDirectory $Root -WindowStyle Hidden
    Start-Sleep -Seconds 3
  } else {
    Write-Msg 'No se pudo reiniciar automaticamente.' 'Yellow'
  }

  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 12
    Write-Msg ("Health OK engine={0} bp={1}" -f $health.engine, $health.browserPrint.reachable) 'Green'
  } catch {
    Write-Msg "Health pendiente: $($_.Exception.Message)" 'Yellow'
  }
}

Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
Write-Msg "Actualizado a version $remoteVersion" 'Green'
Exit-Update 0
