#Requires -Version 5.1
<#
.SYNOPSIS
  Arranca el print-agent con UN solo node.exe (sin PM2).

  PM2 en Windows suele romper con EPERM \\.\pipe\rpc.sock y multiplica procesos.
  El autoarranque lo hacen las tareas EtiquetasPrintAgentLogon / Watch → boot-agent.

  Opt-in PM2 (no recomendado): en .env pon USE_PM2=1
#>
$ErrorActionPreference = 'Continue'
$Root = $PSScriptRoot
$Port = 9120
$PreferNodeFlag = Join-Path $Root '.prefer-node-direct'
$EnvPath = Join-Path $Root '.env'

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
      (Join-Path $env:LOCALAPPDATA 'npm'),
      (Join-Path ${env:ProgramFiles} 'nodejs'),
      (Join-Path ${env:ProgramFiles(x86)} 'nodejs')
    )) {
    if ($extra -and (Test-Path $extra)) { $env:Path = "$extra;$env:Path" }
  }
}

function Find-Cmd([string]$name) {
  Refresh-Path
  return (Get-Command $name -ErrorAction SilentlyContinue)
}

function Get-EnvFlag([string]$Key) {
  if (-not (Test-Path $EnvPath)) { return $false }
  $line = Get-Content $EnvPath -ErrorAction SilentlyContinue |
    Where-Object { $_ -match ("^\s*" + [regex]::Escape($Key) + "\s*=") } |
    Select-Object -First 1
  if (-not $line) { return $false }
  $val = (($line -split '=', 2)[1]).Trim().Trim('"').Trim("'").ToLowerInvariant()
  return @('1', 'true', 'yes', 'on') -contains $val
}

function Test-AgentHealth {
  try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
    return $true
  } catch {
    return $false
  }
}

function Stop-PortListeners {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  try {
    netstat -ano 2>$null | ForEach-Object {
      if ($_ -match (":$Port\s+") -and $_ -match 'LISTENING\s+(\d+)\s*$') {
        Stop-Process -Id ([int]$Matches[1]) -Force -ErrorAction SilentlyContinue
      }
    }
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Stop-AgentRelatedNodes {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    $cmd = [string]$_.CommandLine
    if (-not $cmd) { return }
    $hit =
      ($cmd -match [regex]::Escape($Root)) -or
      ($cmd -match 'print-agent' -and $cmd -match 'index\.js') -or
      ($cmd -match 'pm2') -or
      ($cmd -match '[\\/]God') -or
      ($cmd -match 'Daemon')
    if ($hit) {
      Write-Host ("  kill pid={0}" -f $_.ProcessId)
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Start-AgentHiddenNode {
  Write-Host 'Arrancando un solo node.exe (sin PM2)...' -ForegroundColor Green
  Stop-PortListeners
  Stop-AgentRelatedNodes
  Start-Sleep -Seconds 1

  $index = Join-Path $Root 'index.js'
  $node = Find-Cmd 'node'
  if (-not $node) { throw 'node no encontrado' }

  $p = Start-Process -FilePath $node.Source -ArgumentList "`"$index`"" `
    -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  try { Set-Content -Path (Join-Path $Root 'agent.pid') -Value $p.Id -Encoding ASCII } catch {}
  try {
    Set-Content -Path $PreferNodeFlag -Value ("{0:yyyy-MM-dd HH:mm:ss} reiniciar-agente" -f (Get-Date)) -Encoding UTF8
  } catch {}
  Start-Sleep -Seconds 2
}

Write-Host '=============================================='
Write-Host '  Reiniciar / arrancar print-agent'
Write-Host "  Carpeta: $Root"
Write-Host "  Usuario: $env:USERNAME"
Write-Host '=============================================='

New-Item -ItemType Directory -Force -Path (Join-Path $Root 'logs') | Out-Null
$indexJs = Join-Path $Root 'index.js'
if (-not (Test-Path $indexJs)) {
  Write-Host "ERROR: no esta index.js en $Root" -ForegroundColor Red
  Start-Sleep -Seconds 4
  exit 1
}

$node = Find-Cmd 'node'
if (-not $node) {
  Write-Host 'ERROR: Node.js no esta en PATH. Corre install.bat como Admin.' -ForegroundColor Red
  Start-Sleep -Seconds 4
  exit 1
}
Write-Host ("node: {0} ({1})" -f (& node -v), $node.Source)

# Por defecto NUNCA llamamos a pm2 (evita EPERM y spam de procesos).
$usePm2 = Get-EnvFlag 'USE_PM2'
if ($usePm2) {
  Write-Host 'USE_PM2=1 en .env — se intentara PM2 (puede fallar con EPERM).' -ForegroundColor Yellow
} else {
  Write-Host 'Modo estable: node directo (PM2 desactivado).' -ForegroundColor Cyan
}

Write-Title 'Limpiar restos y arrancar'
Start-AgentHiddenNode

Write-Title "Health http://127.0.0.1:$Port/health"
Start-Sleep -Seconds 2
$ok = Test-AgentHealth
if ($ok) {
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
    Write-Host ("OK engine={0} bp={1}" -f $h.engine, $h.browserPrint.reachable) -ForegroundColor Green
  } catch {
    Write-Host 'OK (health responde)' -ForegroundColor Green
  }
} else {
  Write-Host 'FALLO health' -ForegroundColor Red
}

Write-Host ''
if ($ok) {
  Write-Host 'Listo. Panel: http://127.0.0.1:9120/' -ForegroundColor Green
  Write-Title 'Autoarranque al reiniciar'
  $ensure = Join-Path $Root 'ensure-startup-tasks.ps1'
  if (Test-Path $ensure) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ensure
  } else {
    Write-Host 'Tareas Logon/Watch levantan el agente al iniciar sesion.' -ForegroundColor DarkGray
  }
  Write-Host ''
  Write-Host 'NO uses pm2 en esta PC. Si ves EPERM, es un script viejo: actualiza el agente.' -ForegroundColor DarkGray
  Start-Sleep -Seconds 3
  exit 0
}

Write-Host 'No quedo saludable. Mata todos los Node.js en el Administrador de tareas y vuelve a correr este script.' -ForegroundColor Yellow
Start-Sleep -Seconds 4
exit 1
