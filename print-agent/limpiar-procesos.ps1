#Requires -Version 5.1
<#
.SYNOPSIS
  Mata procesos Node/PM2 huérfanos del print-agent y deja uno solo vivo.

  En la PC USB (.89): ejecutar como el usuario normal (no Admin si el agente
  corre como usuario), o Admin si las tareas se crearon como Admin.
#>
$ErrorActionPreference = 'Continue'
$Root = $PSScriptRoot
$Port = 9120
$Pm2Home = Join-Path $Root '.pm2'
$AgentName = 'etiquetas-print-agent'

function Write-Title([string]$t) {
  Write-Host ''
  Write-Host $t -ForegroundColor Cyan
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
  foreach ($extra in @(
      (Join-Path $Root 'runtime\node'),
      (Join-Path $env:APPDATA 'npm'),
      (Join-Path ${env:ProgramFiles} 'nodejs')
    )) {
    if ($extra -and (Test-Path $extra)) { $env:Path = "$extra;$env:Path" }
  }
}

Write-Host '=============================================='
Write-Host '  Limpiar Node / PM2 del print-agent'
Write-Host "  Carpeta: $Root"
Write-Host "  Usuario: $env:USERNAME"
Write-Host '=============================================='

Write-Title '1) Pausar tareas programadas (evita que vuelvan a nacer)'
foreach ($tn in @(
    'EtiquetasPrintAgentWatch',
    'EtiquetasPrintAgentUpdate',
    'EtiquetasPrintAgentLogon'
  )) {
  cmd /c "schtasks /Change /TN `"$tn`" /DISABLE >nul 2>&1" | Out-Null
  Write-Host "  $tn deshabilitada (si existia)"
}

Write-Title '2) Sin PM2 (no se llama a pm2: en esta PC tira EPERM)'
Refresh-Path

Write-Title '3) Matar node.exe del print-agent / PM2 / puerto 9120'
$killed = 0

# Por puerto 9120
$prevEa = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
netstat -ano 2>$null | ForEach-Object {
  if ($_ -match (":$Port\s+") -and $_ -match 'LISTENING\s+(\d+)\s*$') {
    $pidListen = [int]$Matches[1]
    Write-Host "  puerto $Port → PID $pidListen"
    Stop-Process -Id $pidListen -Force -ErrorAction SilentlyContinue
    $killed += 1
  }
}
$ErrorActionPreference = $prevEa

# Por línea de comando
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  $cmd = [string]$_.CommandLine
  if (-not $cmd) { return }
  $match =
    ($cmd -match [regex]::Escape($Root)) -or
    ($cmd -match 'print-agent') -or
    ($cmd -match 'Etiquetas\\print-agent') -or
    ($cmd -match 'etiquetas\\print-agent') -or
    ($cmd -match 'pm2') -or
    ($cmd -match 'God') -or
    ($cmd -match 'Daemon')
  if ($match) {
    Write-Host ("  kill pid={0}  {1}" -f $_.ProcessId, ($cmd.Substring(0, [Math]::Min(90, $cmd.Length))))
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    $killed += 1
  }
}

Write-Host "  Procesos tocados: $killed"
Start-Sleep -Seconds 2

Write-Title '4) Limpiar estado PM2 local (.pm2 completo)'
if (Test-Path $Pm2Home) {
  Remove-Item -LiteralPath $Pm2Home -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "  Borrado $Pm2Home"
}
# Si PM2 sigue roto, fuerza modo directo en el próximo arranque
try {
  Set-Content -Path (Join-Path $Root '.prefer-node-direct') `
    -Value ("{0:yyyy-MM-dd HH:mm:ss} limpiar-procesos" -f (Get-Date)) -Encoding UTF8
  Write-Host '  Activado .prefer-node-direct (evita spam PM2)'
} catch {}


Write-Title '5) Node.exe restantes (solo informativo)'
$left = @(Get-Process -Name node -ErrorAction SilentlyContinue)
Write-Host ("  Quedan {0} procesos node.exe en el sistema" -f $left.Count)
if ($left.Count -gt 0) {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    ForEach-Object {
      $c = [string]$_.CommandLine
      Write-Host ("    pid={0}  {1}" -f $_.ProcessId, ($(if ($c) { $c.Substring(0, [Math]::Min(100, $c.Length)) } else { '(sin cmdline)' })))
    }
  Write-Host '  Si no son del agente (Cursor, otro), dejales.' -ForegroundColor DarkGray
}

Write-Title '6) Reactivar tareas + asegurar autoarranque + un solo agente'
$ensure = Join-Path $Root 'ensure-startup-tasks.ps1'
if (Test-Path $ensure) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ensure
} else {
  foreach ($tn in @(
      'EtiquetasPrintAgentLogon',
      'EtiquetasPrintAgentWatch',
      'EtiquetasPrintAgentUpdate'
    )) {
    cmd /c "schtasks /Change /TN `"$tn`" /ENABLE >nul 2>&1" | Out-Null
  }
}

$restart = Join-Path $Root 'reiniciar-agente.ps1'
if (Test-Path $restart) {
  Write-Host 'Lanzando REINICIAR-AGENTE...'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $restart
  exit $LASTEXITCODE
}

Write-Host 'No hay reiniciar-agente.ps1. Arranca manualmente REINICIAR-AGENTE.bat' -ForegroundColor Yellow
Start-Sleep -Seconds 4
exit 1
