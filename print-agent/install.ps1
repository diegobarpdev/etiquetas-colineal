#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Instala el agente Zebra (Browser Print + Node/PM2) en ESTA PC.
  Portable: usa la carpeta donde esta este script (sin rutas ni usuarios fijos).
  Puerto del agente: 9120 (NO 9100/9101 - los usa Zebra Browser Print).
#>
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = $PSScriptRoot
$Port = 9120
$NodeMajorMin = 18
$NodeVersion = 'v22.16.0'
$NodeMsiUrl = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-x64.msi"
$NodeZipUrl = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
$NodeRuntimeDir = Join-Path $Root 'runtime\node'
$AgentName = 'etiquetas-print-agent'

function Write-Step {
  param([string]$Message)
  Write-Host ''
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Refresh-Path {
  $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
  $npmBin = Join-Path $env:APPDATA 'npm'
  if (Test-Path $npmBin) { $env:Path = "$npmBin;$env:Path" }
  # Node portable del agente (prioridad)
  if (Test-Path (Join-Path $NodeRuntimeDir 'node.exe')) {
    $env:Path = "$NodeRuntimeDir;$env:Path"
  }
}

function Get-InteractiveUserInfo {
  <#
    Quién tiene el escritorio (Browser Print / sesión real), NO quien elevó el instalador.
    Prioridad:
      1) Get-Process explorer -IncludeUserName (Admin)
      2) WMI/CIM GetOwner de explorer.exe
      3) query user / qwinsta
      4) Win32_ComputerSystem
      5) USERNAME (ultimo recurso = cuenta del instalador)
  #>
  $info = [ordered]@{
    UserName   = $null
    DomainUser = $null
    Source     = 'unknown'
  }

  function Set-FromAccount([string]$account, [string]$source) {
    if (-not $account) { return $false }
    $account = $account.Trim()
    if ($account -match '^(DWM-|UMFD-|SYSTEM|LOCAL SERVICE|NETWORK SERVICE)') { return $false }
    if ($account -match '\\') {
      $info.DomainUser = $account
      $info.UserName = ($account -split '\\')[-1]
    } else {
      $info.UserName = $account
      $info.DomainUser = $account
    }
    $info.Source = $source
    return $true
  }

  # 1) Mas fiable en Admin: IncludeUserName
  try {
    $procs = @(Get-Process -Name explorer -IncludeUserName -ErrorAction SilentlyContinue)
    foreach ($p in $procs) {
      if (Set-FromAccount $p.UserName 'explorer IncludeUserName') {
        return [pscustomobject]$info
      }
    }
  } catch {}

  # 2) WMI GetOwner (a veces CIM falla)
  try {
    $wmi = @(Get-WmiObject Win32_Process -Filter "Name='explorer.exe'" -ErrorAction SilentlyContinue)
    foreach ($proc in $wmi) {
      $owner = $proc.GetOwner()
      if ($owner -and $owner.ReturnValue -eq 0 -and $owner.User) {
        $acct = if ($owner.Domain) { "$($owner.Domain)\$($owner.User)" } else { $owner.User }
        if (Set-FromAccount $acct 'WMI explorer GetOwner') {
          return [pscustomobject]$info
        }
      }
    }
  } catch {}

  try {
    $explorers = @(Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" -ErrorAction SilentlyContinue)
    foreach ($proc in $explorers) {
      $owner = Invoke-CimMethod -InputObject $proc -MethodName GetOwner -ErrorAction SilentlyContinue
      if ($owner -and $owner.User) {
        $acct = if ($owner.Domain) { "$($owner.Domain)\$($owner.User)" } else { $owner.User }
        if (Set-FromAccount $acct 'CIM explorer GetOwner') {
          return [pscustomobject]$info
        }
      }
    }
  } catch {}

  # 3) query user / qwinsta — sesion Active o Console
  try {
    $q = @(query user 2>$null)
    $pick = $null
    foreach ($line in $q) {
      if ($line -match '^\s*>') { $pick = $line; break }
    }
    if (-not $pick) {
      foreach ($line in $q) {
        if ($line -match '\sActive\s' -or $line -match '\sActivo\s') { $pick = $line; break }
      }
    }
    if ($pick -and $pick -match '^\s*>?\s*(\S+)') {
      $u = $Matches[1].TrimStart('>')
      if (Set-FromAccount $u 'query user') {
        return [pscustomobject]$info
      }
    }
  } catch {}

  try {
    $qw = @(qwinsta 2>$null)
    foreach ($line in $qw) {
      # "console  jorgeochoa  2  Active"
      if ($line -match '^\s*(console|rdp-tcp#\d+)\s+(\S+)\s+\d+\s+(Active|Activo)') {
        if (Set-FromAccount $Matches[2] 'qwinsta') {
          return [pscustomobject]$info
        }
      }
    }
  } catch {}

  # 4) ComputerSystem
  try {
    $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
    if ($cs.UserName -and (Set-FromAccount $cs.UserName 'Win32_ComputerSystem')) {
      return [pscustomobject]$info
    }
  } catch {}

  # 5) Ultimo recurso
  [void](Set-FromAccount $env:USERNAME 'USERNAME (instalador — no se detecto escritorio)')
  return [pscustomobject]$info
}

function Get-InteractiveUserName {
  return (Get-InteractiveUserInfo).UserName
}

function Set-Pm2HomeForCurrentUser {
  # Home LOCAL del agente (evita EPERM rpc.sock). No fija el usuario de Windows.
  $env:PM2_HOME = Join-Path $Root '.pm2'
  New-Item -ItemType Directory -Force -Path $env:PM2_HOME | Out-Null
  $desk = Get-InteractiveUserInfo
  Write-Host "PM2_HOME=$($env:PM2_HOME) (carpeta local del agente)"
  Write-Host "Escritorio (sesion real): $($desk.UserName)  [$($desk.Source)]"
  Write-Host "Cuenta de este instalador (Admin): $($env:USERNAME)"
  if ($desk.UserName -and $env:USERNAME -and ($desk.UserName -ne $env:USERNAME)) {
    Write-Host "NOTA: instalas como $($env:USERNAME) pero el escritorio es $($desk.UserName). Las tareas usaran el escritorio / grupo Users." -ForegroundColor Yellow
  }
}

function Find-NodeExe {
  Refresh-Path
  $portable = Join-Path $NodeRuntimeDir 'node.exe'
  if (Test-Path $portable) { return $portable }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  foreach ($candidate in @(
      (Join-Path ${env:ProgramFiles} 'nodejs\node.exe'),
      (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
      (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

function Test-NodeOk {
  $exe = Find-NodeExe
  if (-not $exe) { return $false }
  try {
    $ver = & $exe -v 2>$null
    if ($ver -match '^v(\d+)\.') {
      return [int]$Matches[1] -ge $NodeMajorMin
    }
  } catch {}
  return $false
}

function Install-NodePortable {
  Write-Host "Descargando Node portable ($NodeVersion)..." -ForegroundColor Yellow
  $zip = Join-Path $env:TEMP "node-$NodeVersion-win-x64.zip"
  $extractParent = Join-Path $Root 'runtime'
  $extractTemp = Join-Path $extractParent "_tmp_node"
  New-Item -ItemType Directory -Force -Path $extractParent | Out-Null
  if (Test-Path $extractTemp) { Remove-Item $extractTemp -Recurse -Force -ErrorAction SilentlyContinue }

  Invoke-WebRequest -Uri $NodeZipUrl -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $extractTemp -Force
  Remove-Item $zip -Force -ErrorAction SilentlyContinue

  $inner = Get-ChildItem -Path $extractTemp -Directory | Select-Object -First 1
  if (-not $inner) { throw 'ZIP de Node no contiene carpeta esperada' }

  if (Test-Path $NodeRuntimeDir) {
    Remove-Item $NodeRuntimeDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  Move-Item -Path $inner.FullName -Destination $NodeRuntimeDir -Force
  Remove-Item $extractTemp -Recurse -Force -ErrorAction SilentlyContinue

  Refresh-Path
  if (-not (Test-NodeOk)) {
    throw "Node portable no quedo usable en $NodeRuntimeDir"
  }
  Write-Host ("Node portable OK: {0} ({1})" -f (& (Find-NodeExe) -v), $NodeRuntimeDir) -ForegroundColor Green
}

function Install-NodeJs {
  Write-Step 'Asegurando Node.js...'
  if (Test-NodeOk) {
    Write-Host ("Node OK: {0} ({1})" -f (& (Find-NodeExe) -v), (Find-NodeExe)) -ForegroundColor Green
    return
  }

  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host 'Probando winget...'
    try {
      & winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --disable-interactivity
    } catch {}
    Refresh-Path
    if (Test-NodeOk) { return }
  }

  Write-Host 'Probando MSI de Node...'
  $msi = Join-Path $env:TEMP 'node-lts-x64.msi'
  try {
    Invoke-WebRequest -Uri $NodeMsiUrl -OutFile $msi -UseBasicParsing
    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
    $code = $p.ExitCode
  } catch {
    $code = -1
    Write-Host ("MSI no se pudo ejecutar: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
  }
  Remove-Item $msi -Force -ErrorAction SilentlyContinue
  Refresh-Path

  if (Test-NodeOk) {
    if ($code -notin 0, 3010, $null) {
      Write-Host ("msiexec salio $code pero Node ya funciona.") -ForegroundColor Yellow
    }
    Write-Host ("Node OK: {0}" -f (& (Find-NodeExe) -v)) -ForegroundColor Green
    return
  }

  Write-Host 'MSI/winget no dejaron Node usable (tipico exit 1603). Usando Node portable...' -ForegroundColor Yellow
  Install-NodePortable
}

function Find-ZebraHintName {
  $printers = @(Get-Printer -ErrorAction SilentlyContinue)
  $zebras = @($printers | Where-Object {
    $_.Name -match 'ZDesigner|ZT230|ZM400|Zebra' -and $_.Name -notmatch '^Etiquetas RAW'
  })
  $preferred = $zebras | Where-Object { $_.Name -notmatch 'PAPEL' } | Select-Object -First 1
  if (-not $preferred) { $preferred = $zebras | Select-Object -First 1 }
  if (-not $preferred) { return 'ZDesigner ZT230-200dpi ZPL' }
  return $preferred.Name
}

function Test-PortFree {
  param([int]$P)
  $inUse = Get-NetTCPConnection -LocalPort $P -State Listen -ErrorAction SilentlyContinue
  return -not $inUse
}

function Repair-EnvPort {
  param([string]$EnvPath)
  if (-not (Test-Path $EnvPath)) { return $false }
  $raw = Get-Content -Path $EnvPath -Raw -ErrorAction SilentlyContinue
  if (-not $raw) { return $false }

  $changed = $false
  if ($raw -match '(?m)^\s*PORT\s*=\s*(9100|9101)\s*$') {
    Write-Host "AVISO: .env tenia PORT=$($Matches[1]) (reservado por Browser Print). Corrigiendo a $Port" -ForegroundColor Yellow
    $raw = [regex]::Replace($raw, '(?m)^\s*PORT\s*=\s*(9100|9101)\s*$', "PORT=$Port")
    $changed = $true
  }
  if ($raw -notmatch '(?m)^\s*PORT\s*=') {
    $raw = "PORT=$Port`r`n" + $raw
    $changed = $true
  }
  if ($raw -notmatch '(?m)^\s*HOST\s*=') {
    $raw = $raw.TrimEnd() + "`r`nHOST=0.0.0.0`r`n"
    $changed = $true
  }
  if ($raw -notmatch '(?m)^\s*SEND_ENGINE\s*=') {
    $raw = $raw.TrimEnd() + "`r`nSEND_ENGINE=browser-print`r`n"
    $changed = $true
  }
  if ($raw -notmatch '(?m)^\s*BROWSER_PRINT_URL\s*=') {
    $raw = $raw.TrimEnd() + "`r`nBROWSER_PRINT_URL=http://127.0.0.1:9100`r`n"
    $changed = $true
  }
  if ($raw -notmatch '(?m)^\s*PRINT_DPI\s*=') {
    $raw = $raw.TrimEnd() + "`r`nPRINT_DPI=203`r`n"
    $changed = $true
  }
  if ($raw -notmatch '(?m)^\s*PRINT_SPEED_IPS\s*=') {
    $raw = $raw.TrimEnd() + "`r`nPRINT_SPEED_IPS=10`r`n"
    $changed = $true
  }
  if ($raw -notmatch '(?m)^\s*UPDATE_SERVER_URL\s*=') {
    $raw = $raw.TrimEnd() + "`r`nUPDATE_SERVER_URL=http://192.168.2.28:3000`r`n"
    $changed = $true
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
  # No dejar dry-run activo por accidente al copiar .env de otra PC
  if ($raw -match '(?m)^\s*PRINT_DRY_RUN\s*=\s*1\s*$') {
    Write-Host 'AVISO: .env tenia PRINT_DRY_RUN=1 - se comenta (no imprimiria de verdad).' -ForegroundColor Yellow
    $raw = [regex]::Replace($raw, '(?m)^\s*PRINT_DRY_RUN\s*=\s*1\s*$', '# PRINT_DRY_RUN=1')
    $changed = $true
  }
  if ($changed) {
    [System.IO.File]::WriteAllText($EnvPath, $raw)
  }
  return $changed
}

function Write-EnvFile {
  Write-Step 'Generando / reparando .env (Browser Print)...'
  $printerName = Find-ZebraHintName
  $envPath = Join-Path $Root '.env'

  if (Test-Path $envPath) {
    Write-Host '.env ya existe - se conserva y se reparan claves basicas.' -ForegroundColor Yellow
    if ((Get-Content $envPath -Raw) -match 'BP_USB_') {
      Write-Host '  Nota: tiene BP_USB_* de otra PC. Si fallan roles USB, borra esas lineas o regenera .env.' -ForegroundColor Yellow
    }
    $null = Repair-EnvPort -EnvPath $envPath
    Get-Content $envPath | Where-Object { $_ -match '^\s*(PORT|HOST|SEND_ENGINE|PRINT_SPEED_IPS|PRINTER_NAME|BROWSER_PRINT_URL)\s*=' } | ForEach-Object {
      Write-Host "  $_"
    }
    return
  }

  $lines = @(
    '# Generado por install.ps1 - agente en 9120 (Browser Print usa 9100/9101)'
    "PORT=$Port"
    'HOST=0.0.0.0'
    "PRINTER_NAME=$printerName"
    'PRINT_DPI=203'
    'BROWSER_PRINT_URL=http://127.0.0.1:9100'
    'SEND_ENGINE=browser-print'
    'PRINT_SPEED_IPS=10'
    'UPDATE_SERVER_URL=http://192.168.2.28:3000'
    'AUTO_UPDATE=1'
    'BP_CHUNK_PAGES=8'
    'BP_CHUNK_MAX_BYTES=300000'
    'BP_CHUNK_GAP_MS=300'
    ''
    '# Opcional: UID USB de Browser Print (panel :9120 -> devices connection=usb)'
    '# BP_USB_ADHESIVO='
    '# BP_USB_PAPEL='
  )
  [System.IO.File]::WriteAllLines($envPath, $lines)
  Write-Host "PORT=$Port"
  Write-Host "PRINTER_NAME=$printerName"
  Write-Host 'SEND_ENGINE=browser-print'
}

function Confirm-BrowserPrintReady {
  Write-Step 'Comprobando Zebra Browser Print (127.0.0.1:9100)...'
  try {
    $null = Invoke-RestMethod -Uri 'http://127.0.0.1:9100/available' -TimeoutSec 5
    Write-Host 'Browser Print responde en :9100' -ForegroundColor Green
    return $true
  } catch {
    Write-Host 'AVISO: Browser Print no responde en http://127.0.0.1:9100' -ForegroundColor Yellow
    Write-Host '  1) Descarga e instala Zebra Browser Print (sitio Zebra).'
    Write-Host '  2) Asegura que NADA use puertos 9100/9101 (excepto Browser Print).'
    Write-Host '  3) Icono Zebra en bandeja -> Settings -> descubrir USB.'
    return $false
  }
}

function Ensure-Firewall {
  Write-Step "Firewall TCP $Port"
  $old = Get-NetFirewallRule -DisplayName 'Etiquetas Print Agent 9101' -ErrorAction SilentlyContinue
  if ($old) {
    Remove-NetFirewallRule -DisplayName 'Etiquetas Print Agent 9101' -ErrorAction SilentlyContinue
    Write-Host 'Eliminada regla firewall vieja del puerto 9101'
  }
  $ruleName = "Etiquetas Print Agent $Port"
  if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
    Write-Host "Ya existe: $ruleName"
    return
  }
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
}

function Disable-LegacyWatchTasks {
  Write-Step 'Desactivando watchdogs viejos (evitan node.exe en primer plano)...'
  $watchPath = Join-Path $Root 'watch-agent.ps1'
  @(
    '# Desactivado: el agente corre solo con PM2 (windowsHide).'
    '# No crear tareas que ejecuten node.exe.'
    'exit 0'
  ) | Set-Content -Path $watchPath -Encoding UTF8

  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  try {
    # Solo las viejas (cada minuto / nombres legacy). NO borrar EtiquetasPrintAgentLogon/Watch nuevas.
    foreach ($taskName in @('EtiquetasPrintAgent', 'etiquetas-print-agent-watch')) {
      cmd /c "schtasks /Change /TN `"$taskName`" /DISABLE >nul 2>&1" | Out-Null
      cmd /c "schtasks /Delete /TN `"$taskName`" /F >nul 2>&1" | Out-Null
    }
  } finally {
    $ErrorActionPreference = $prev
  }
  Write-Host 'OK: sin tarea vieja cada minuto que abra node.exe'
}

function Ensure-StartupScheduledTasks {
  Write-Step 'Tareas programadas (logon + watchdog + auto-update)...'
  $boot = Join-Path $Root 'boot-agent.ps1'
  if (-not (Test-Path $boot)) {
    Write-Host "AVISO: no esta boot-agent.ps1 - no se crean tareas" -ForegroundColor Yellow
    return
  }

  $psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$boot`""
  $tr = "powershell.exe $psArgs"
  $logonName = 'EtiquetasPrintAgentLogon'
  $watchName = 'EtiquetasPrintAgentWatch'
  $updateName = 'EtiquetasPrintAgentUpdate'
  $updateScript = Join-Path $Root 'auto-update.ps1'

  # Borrar previas sin tumbar el install si no existen
  Unregister-ScheduledTask -TaskName $logonName -Confirm:$false -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $watchName -Confirm:$false -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $updateName -Confirm:$false -ErrorAction SilentlyContinue

  # ONLOGON: preferir dueño del escritorio (jorgeochoa), no la cuenta Admin del instalador.
  $desk = Get-InteractiveUserInfo
  $interactive = $desk.UserName
  $domainUser = if ($desk.DomainUser) { $desk.DomainUser } else { $interactive }

  # 1) Intento: cualquier usuario (grupo Users) via Register-ScheduledTask
  $createdLogon = $false
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Stop'
  try {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
    $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -StartWhenAvailable `
      -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
      -MultipleInstances IgnoreNew `
      -Hidden
    # En PS 5.1: GroupId + RunLevel (sin LogonType) evita AmbiguousParameterSet
    $usersGroup = 'BUILTIN\Users'
    try {
      $usersGroup = (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')).Translate([System.Security.Principal.NTAccount]).Value
    } catch {}
    $principal = New-ScheduledTaskPrincipal -GroupId $usersGroup -RunLevel Highest
    $triggerLogon = New-ScheduledTaskTrigger -AtLogOn
    Register-ScheduledTask -TaskName $logonName -Action $action -Trigger $triggerLogon `
      -Principal $principal -Settings $settings -Force | Out-Null
    $createdLogon = $true
    Write-Host "Tarea $logonName OK (al iniciar sesion, grupo Users - sirve para todos los usuarios)." -ForegroundColor Green
  } catch {
    Write-Host "Register-ScheduledTask (Users) no disponible: $($_.Exception.Message)" -ForegroundColor DarkYellow
    Write-Host "Fallback: ONLOGON para escritorio $domainUser ..." -ForegroundColor Yellow
  } finally {
    $ErrorActionPreference = $prev
  }

  # 2) Fallback schtasks: usuario del ESCRITORIO (no soportectin Admin)
  if (-not $createdLogon) {
    cmd /c "schtasks /Create /TN `"$logonName`" /TR `"$tr`" /SC ONLOGON /RU `"$domainUser`" /IT /RL HIGHEST /F >nul 2>&1" | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $createdLogon = $true
      Write-Host "Tarea $logonName OK (ONLOGON / escritorio $domainUser)." -ForegroundColor Green
    } else {
      # Ultimo recurso: sin /RU (queda asociada a quien instala)
      cmd /c "schtasks /Create /TN `"$logonName`" /TR `"$tr`" /SC ONLOGON /RL HIGHEST /F >nul 2>&1" | Out-Null
      if ($LASTEXITCODE -eq 0) {
        $createdLogon = $true
        Write-Host "Tarea $logonName OK (ONLOGON, cuenta del instalador $($env:USERNAME))." -ForegroundColor Yellow
        Write-Host "AVISO: ideal reinstalar estando logueado como el usuario de planta, o que la tarea quede en grupo Users." -ForegroundColor Yellow
      } else {
        Write-Host "No se pudo crear $logonName." -ForegroundColor Red
      }
    }
  }

  # Watchdog cada 5 min (schtasks es mas compatible que Register con MaxValue)
  cmd /c "schtasks /Create /TN `"$watchName`" /TR `"$tr`" /SC MINUTE /MO 5 /RL HIGHEST /F >nul 2>&1" | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Tarea $watchName OK (cada 5 min; solo actua si /health falla)." -ForegroundColor Green
  } else {
    Write-Host "No se pudo crear $watchName (el logon puede bastar)." -ForegroundColor Yellow
  }

  # Auto-update cada 15 min (silencioso)
  if (Test-Path $updateScript) {
    $updArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$updateScript`""
    $updTr = "powershell.exe $updArgs"
    cmd /c "schtasks /Create /TN `"$updateName`" /TR `"$updTr`" /SC MINUTE /MO 15 /RL LIMITED /F >nul 2>&1" | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Tarea $updateName OK (cada 15 min; baja version desde UPDATE_SERVER_URL)." -ForegroundColor Green
    } else {
      Write-Host "No se pudo crear $updateName." -ForegroundColor Yellow
    }
  }

  Write-Host "Escritorio detectado: $interactive ($($desk.Source)) | Instalador: $($env:USERNAME)" -ForegroundColor DarkGray
}

function Stop-OrphanAgentProcesses {
  Write-Step 'Limpiando procesos node.exe sueltos del agente (no PM2)...'
  $killed = 0
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    $cmd = [string]$_.CommandLine
    if (-not $cmd) { return }
    # Solo procesos que ejecutan este index.js directamente (no el daemon pm2)
    if ($cmd -match [regex]::Escape($Root) -and $cmd -match 'index\.js' -and $cmd -notmatch 'pm2') {
      Write-Host "  Matando pid=$($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      $killed++
    }
  }
  if ($killed -eq 0) {
    Write-Host '  Ninguno suelto'
  }
}

function Ensure-Pm2Startup {
  # PM2 en Windows suele fallar con EPERM rpc.sock y multiplica node.exe.
  # Autoarranque = tareas programadas + reiniciar-agente (node directo).
  Write-Step 'PM2 omitido (modo estable: node directo + tareas Windows)...'
  try {
    Set-Content -Path (Join-Path $Root '.prefer-node-direct') `
      -Value ("{0:yyyy-MM-dd HH:mm:ss} install" -f (Get-Date)) -Encoding UTF8
  } catch {}
}

function Show-AgentCrashHint {
  Write-Host ''
  Write-Host '--- Ultimas lineas de log ---' -ForegroundColor Yellow
  $errLog = Join-Path $Root 'logs\pm2-error.log'
  $outLog = Join-Path $Root 'logs\pm2-out.log'
  $agentOut = Join-Path $Root 'logs\agent-out.log'
  foreach ($f in @($errLog, $outLog, $agentOut)) {
    if (Test-Path $f) {
      Write-Host "($f)" -ForegroundColor DarkGray
      Get-Content $f -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }
  }
  Write-Host ''
  Write-Host 'Causa tipica: .env con PORT=9100 o 9101 (chocan con Browser Print).' -ForegroundColor Yellow
  Write-Host "Debe ser PORT=$Port. Luego: REINICIAR-AGENTE.bat" -ForegroundColor Yellow
}

function Start-AgentWithPm2 {
  Write-Step 'npm install + arranque node directo (sin PM2)...'
  New-Item -ItemType Directory -Force -Path (Join-Path $Root 'logs') | Out-Null
  Push-Location $Root
  try {
    & npm install --omit=dev
    if ($LASTEXITCODE -ne 0) { throw 'npm install fallo' }

    Write-Host 'Smoke test (node -e require)...'
    & node -e "require('./lib/config'); const c=require('./lib/config').config; if([9100,9101].includes(c.port)) { console.error('ERROR: PORT='+c.port+' reservado por Browser Print. Usa 9120.'); process.exit(2); } console.log('PORT efectivo='+c.port+' engine='+c.sendEngine);"
    if ($LASTEXITCODE -ne 0) { throw 'Smoke test fallo - revisa .env (PORT debe ser 9120)' }

    $restart = Join-Path $Root 'reiniciar-agente.ps1'
    if (-not (Test-Path $restart)) { throw 'Falta reiniciar-agente.ps1' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $restart
    if ($LASTEXITCODE -ne 0) {
      Show-AgentCrashHint
      throw 'reiniciar-agente fallo'
    }
  }
  finally {
    Pop-Location
  }
}



function Confirm-AgentHealth {
  Write-Step 'Health check...'
  Start-Sleep -Seconds 2
  try {
    $res = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 8
    $bp = $res.browserPrint
    Write-Host ("OK engine={0} dpi={1} printer={2} BP reachable={3} devices={4}" -f `
      $res.engine, $res.dpi, $res.printer, $bp.reachable, $bp.deviceCount) -ForegroundColor Green
  }
  catch {
    Write-Host "Health fallo: $($_.Exception.Message)" -ForegroundColor Yellow
    Show-AgentCrashHint
    Write-Host 'Tambien: pm2 logs etiquetas-print-agent'
  }
}

Write-Host '=============================================='
Write-Host '  Etiquetas Colineal - Browser Print + ZPL'
Write-Host "  Carpeta: $Root"
$deskBanner = Get-InteractiveUserInfo
Write-Host "  Escritorio (sesion real): $($deskBanner.UserName)  [$($deskBanner.Source)]"
Write-Host "  Cuenta instalador (Admin): $($env:USERNAME)"
if ($deskBanner.UserName -and $env:USERNAME -and ($deskBanner.UserName -ne $env:USERNAME)) {
  Write-Host "  -> Instalando como Admin distinto al escritorio; es normal. Tareas = Users / escritorio." -ForegroundColor Yellow
} elseif ($deskBanner.Source -match 'instalador') {
  Write-Host "  -> No se detecto otro escritorio. Si la sesion real es jorgeochoa (u otro), cierra sesion de soportectin," -ForegroundColor Yellow
  Write-Host "     entra con ese usuario, y desde AHI ejecuta install.bat (UAC puede pedir clave Admin)." -ForegroundColor Yellow
}
Write-Host '=============================================='

if (-not (Test-PortFree -P $Port)) {
  Write-Host "AVISO: el puerto $Port ya esta en uso (se reutilizara / reiniciara)." -ForegroundColor Yellow
}

if (-not (Test-PortFree -P 9101)) {
  Write-Host 'Nota: el puerto 9101 esta en uso (normal si Browser Print esta abierto).' -ForegroundColor Yellow
  Write-Host '  Solo es problema si un agente viejo lo ocupa en lugar de Browser Print.'
}

if (-not (Test-NodeOk)) { Install-NodeJs } else { Write-Step "Node: $(node -v)" }

Disable-LegacyWatchTasks
Stop-OrphanAgentProcesses
Write-EnvFile
Confirm-BrowserPrintReady | Out-Null
Ensure-Firewall
Ensure-Pm2Startup
Start-AgentWithPm2
Ensure-StartupScheduledTasks
Confirm-AgentHealth

$ips = @(
  Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -ExpandProperty IPAddress -First 3
) -join ', '

Write-Host ''
Write-Host 'Listo.' -ForegroundColor Green
Write-Host "Panel:  http://127.0.0.1:$Port/"
Write-Host "Health: http://127.0.0.1:$Port/health"
if ($ips) { Write-Host "IPs:    $ips" }
Write-Host "En el servidor agrega el agente: http://IP_DE_ESTA_PC:$Port"
Write-Host 'Reiniciar: REINICIAR-AGENTE.bat (o acceso en Escritorio)'
Write-Host 'Actualizar: automatico cada 15 min + al arrancar (AUTO_UPDATE=1). Manual: ACTUALIZAR-AGENTE.bat'
Write-Host 'Verificar autoarranque: powershell -File .\verificar-arranque.ps1'
Write-Host '  (debe listar EtiquetasPrintAgentLogon, Watch y Update)'
Write-Host ''
Write-Host 'Requisito: Zebra Browser Print en bandeja (puertos 9100/9101).' -ForegroundColor Yellow
Write-Host 'Guia: INSTALACION-NUEVA-PC.md'
