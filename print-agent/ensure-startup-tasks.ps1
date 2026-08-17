#Requires -Version 5.1
<#
.SYNOPSIS
  Asegura tareas de autoarranque (logon + watchdog + update).
  Modo node directo: las tareas llaman boot-agent.ps1.
#>
$ErrorActionPreference = 'Continue'
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$boot = Join-Path $Root 'boot-agent.ps1'
$updateScript = Join-Path $Root 'auto-update.ps1'
if (-not (Test-Path $updateScript)) { $updateScript = Join-Path $Root 'actualizar-agente.ps1' }

$logonName = 'EtiquetasPrintAgentLogon'
$watchName = 'EtiquetasPrintAgentWatch'
$updateName = 'EtiquetasPrintAgentUpdate'

function Write-Msg {
  param(
    [Parameter(Mandatory = $false, Position = 0)]
    [string]$Message = '',
    [Parameter(Mandatory = $false, Position = 1)]
    [ValidateSet('Black','DarkBlue','DarkGreen','DarkCyan','DarkRed','DarkMagenta','DarkYellow','Gray','DarkGray','Blue','Green','Cyan','Red','Magenta','Yellow','White')]
    [string]$Color = 'White'
  )
  if ($Color -eq 'White') {
    Write-Host $Message
  } else {
    Write-Host $Message -ForegroundColor $Color
  }
}

if (-not (Test-Path $boot)) {
  Write-Msg -Message ("No esta boot-agent.ps1 en {0}" -f $Root) -Color Red
  return
}

$psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$boot`""
$tr = "powershell.exe $psArgs"

function Test-TaskExists([string]$name) {
  $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  return [bool]$t
}

$needCreate = -not (Test-TaskExists $logonName) -or -not (Test-TaskExists $watchName)

if ($needCreate) {
  Write-Msg -Message 'Creando / recreando tareas de autoarranque...' -Color Yellow
  Unregister-ScheduledTask -TaskName $logonName -Confirm:$false -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $watchName -Confirm:$false -ErrorAction SilentlyContinue

  $created = $false
  try {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
    $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -StartWhenAvailable `
      -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
      -MultipleInstances IgnoreNew `
      -Hidden
    $usersGroup = 'BUILTIN\Users'
    try {
      $usersGroup = (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')).Translate([System.Security.Principal.NTAccount]).Value
    } catch {}
    $principal = New-ScheduledTaskPrincipal -GroupId $usersGroup -RunLevel Highest
    $triggerLogon = New-ScheduledTaskTrigger -AtLogOn
    Register-ScheduledTask -TaskName $logonName -Action $action -Trigger $triggerLogon `
      -Principal $principal -Settings $settings -Force | Out-Null
    $created = $true
    Write-Msg -Message ("OK {0} (al iniciar sesion)" -f $logonName) -Color Green
  } catch {
    cmd /c "schtasks /Create /TN `"$logonName`" /TR `"$tr`" /SC ONLOGON /RL HIGHEST /F >nul 2>&1" | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $created = $true
      Write-Msg -Message ("OK {0} (schtasks ONLOGON)" -f $logonName) -Color Green
    } else {
      Write-Msg -Message ("No se pudo crear {0}. Corre install.bat como Admin una vez." -f $logonName) -Color Red
    }
  }

  cmd /c "schtasks /Create /TN `"$watchName`" /TR `"$tr`" /SC MINUTE /MO 5 /RL HIGHEST /F >nul 2>&1" | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Msg -Message ("OK {0} (cada 5 min si cae el agente)" -f $watchName) -Color Green
  } else {
    Write-Msg -Message ("No se pudo crear {0}" -f $watchName) -Color Yellow
  }

  if (-not $created) {
    Write-Msg -Message 'AVISO: sin tarea de logon el agente NO arrancara al reiniciar la PC.' -Color Red
  }
} else {
  Write-Msg -Message ("Tareas ya existen: {0} + {1}" -f $logonName, $watchName) -Color Green
}

if (Test-Path $updateScript) {
  if (-not (Test-TaskExists $updateName)) {
    $updArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$updateScript`""
    $updTr = "powershell.exe $updArgs"
    cmd /c "schtasks /Create /TN `"$updateName`" /TR `"$updTr`" /SC MINUTE /MO 15 /RL LIMITED /F >nul 2>&1" | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Msg -Message ("OK {0} (auto-update 15 min)" -f $updateName) -Color Green
    }
  }
}

foreach ($tn in @($logonName, $watchName, $updateName)) {
  cmd /c "schtasks /Change /TN `"$tn`" /ENABLE >nul 2>&1" | Out-Null
}

Write-Host ''
Write-Host 'Autoarranque: al reiniciar la PC, inicia sesion y boot-agent arranca el agente.'
Write-Host '(node directo; health en http://127.0.0.1:9120/health).'
Write-Host 'Comprobar: powershell -File .\verificar-arranque.ps1'
