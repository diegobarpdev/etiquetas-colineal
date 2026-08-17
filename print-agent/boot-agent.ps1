#Requires -Version 5.1
<#
.SYNOPSIS
  Arranque silencioso (logon / watchdog). Siempre un solo node.exe.
  No llama a PM2 (evita EPERM rpc.sock).
#>
$ErrorActionPreference = 'Continue'
$Root = $PSScriptRoot
$Port = 9120
$PreferNodeFlag = Join-Path $Root '.prefer-node-direct'
$LogDir = Join-Path $Root 'logs'
$BootLog = Join-Path $LogDir 'boot-agent.log'

function Write-BootLog([string]$msg) {
  try {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $msg
    Add-Content -Path $BootLog -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
  } catch {}
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

function Test-AgentHealth {
  try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 4
    return $true
  } catch {
    return $false
  }
}

function Stop-PortAndAgentNodes {
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

  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    $cmd = [string]$_.CommandLine
    if (-not $cmd) { return }
    $hit =
      ($cmd -match [regex]::Escape($Root)) -or
      ($cmd -match 'print-agent' -and $cmd -match 'index\.js') -or
      ($cmd -match 'pm2') -or
      ($cmd -match 'Daemon')
    if ($hit) {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Start-DirectNode {
  Write-BootLog 'start direct node (no pm2)'
  Stop-PortAndAgentNodes
  Start-Sleep -Milliseconds 800
  Refresh-Path
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-BootLog 'ERROR: node no en PATH'
    return $false
  }
  $index = Join-Path $Root 'index.js'
  if (-not (Test-Path $index)) {
    Write-BootLog 'ERROR: index.js missing'
    return $false
  }
  $p = Start-Process -FilePath $node.Source -ArgumentList "`"$index`"" `
    -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  try { Set-Content -Path (Join-Path $Root 'agent.pid') -Value $p.Id -Encoding ASCII } catch {}
  try {
    Set-Content -Path $PreferNodeFlag -Value ("{0:yyyy-MM-dd HH:mm:ss} boot" -f (Get-Date)) -Encoding UTF8
  } catch {}
  return $true
}

Write-BootLog '=== boot-agent start (no-pm2) ==='
Refresh-Path
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$updateScript = Join-Path $Root 'actualizar-agente.ps1'
if (Test-Path $updateScript) {
  Write-BootLog 'Comprobando actualizacion remota...'
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden `
      -File $updateScript -Silent -SkipRestart
    Write-BootLog ("update exit={0}" -f $LASTEXITCODE)
  } catch {
    Write-BootLog ("update error: {0}" -f $_.Exception.Message)
  }
}

if (Test-AgentHealth) {
  Write-BootLog 'Ya responde /health — nada que hacer'
  exit 0
}

if (-not (Start-DirectNode)) { exit 1 }

Start-Sleep -Seconds 3
if (Test-AgentHealth) {
  Write-BootLog 'OK health'
  exit 0
}
Write-BootLog 'FAIL health'
exit 1
