# Crea/actualiza colas Generic/Text Only identificadas por USO (ADHESIVO / PAPEL),
# no por el numero USB (Windows lo cambia al reconectar).
# Ejecutar como Administrador.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host 'Colas RAW por rol (ADHESIVO / PAPEL)...'

function Get-GenericTextDriver {
  return Get-PrinterDriver -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq 'Generic / Text Only' } |
    Select-Object -First 1
}

function Install-GenericTextDriver {
  if (Get-GenericTextDriver) { return $true }
  Write-Host 'Instalando driver Generic / Text Only...'
  $inf = Get-Item -Path (Join-Path $env:SystemRoot 'inf\ntprint.inf') -ErrorAction SilentlyContinue
  if (-not $inf) {
    $inf = Get-Item -Path (Join-Path $env:SystemRoot 'System32\DriverStore\FileRepository\ntprint.inf_*\ntprint.inf') -ErrorAction SilentlyContinue |
      Select-Object -First 1
  }
  if ($inf) {
    try {
      Add-PrinterDriver -Name 'Generic / Text Only' -InfPath $inf.FullName -ErrorAction Stop
      if (Get-GenericTextDriver) { return $true }
    } catch {}
    try {
      $args = "/ia /m `"Generic / Text Only`" /h `"x64`" /v `"Type 3 - User Mode`" /f `"$($inf.FullName)`""
      Start-Process -FilePath "$env:SystemRoot\System32\rundll32.exe" `
        -ArgumentList "printui.dll,PrintUIEntry $args" -Wait -WindowStyle Hidden | Out-Null
      Start-Sleep -Seconds 2
      if (Get-GenericTextDriver) { return $true }
    } catch {}
  }
  try {
    Add-PrinterDriver -Name 'Generic / Text Only' -ErrorAction Stop
    if (Get-GenericTextDriver) { return $true }
  } catch {}
  return $false
}

function Get-PrinterRole {
  param([string]$Name)
  $n = $Name.ToUpperInvariant()
  if ($n -match 'PAPEL') { return 'PAPEL' }
  if ($n -match 'ADHESIVO|TELA') { return 'ADHESIVO' }
  # Sin PAPEL en el nombre = adhesivo / producto terminado
  if ($n -match 'ZDESIGNER|ZT230|ZEBRA') { return 'ADHESIVO' }
  return 'OTRA'
}

if (-not (Install-GenericTextDriver)) {
  throw 'Falta driver Generic / Text Only. Instálalo e reintenta.'
}

$zebras = @(Get-Printer -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -match 'ZDesigner|ZT230|Zebra' -and
  $_.Name -notmatch '^Etiquetas RAW' -and
  $_.PortName -match '^USB\d+'
})

Write-Host ''
Write-Host 'Zebras Windows encontradas:'
foreach ($z in $zebras) {
  $role = Get-PrinterRole $z.Name
  Write-Host ("  [{0}] {1}  ->  {2}" -f $role, $z.Name, $z.PortName)
}

if ($zebras.Count -eq 0) {
  Write-Host 'No hay Zebra en puertos USB.' -ForegroundColor Yellow
  exit 0
}

# Aviso si dos roles distintos comparten el mismo puerto (cable/remapeo mal)
$byPort = $zebras | Group-Object PortName
foreach ($g in $byPort) {
  $roles = @($g.Group | ForEach-Object { Get-PrinterRole $_.Name } | Select-Object -Unique)
  if ($roles.Count -gt 1) {
    Write-Host ("AVISO: puerto {0} tiene colas de roles distintos ({1}). Revisa cables USB." -f $g.Name, ($roles -join ', ')) -ForegroundColor Red
  }
}

# Quitar colas RAW viejas nombradas solo por USB001/USB003 (generaban confusion)
$oldRaw = @(Get-Printer -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -match '^Etiquetas RAW USB\d+'
})
foreach ($o in $oldRaw) {
  try {
    Remove-Printer -Name $o.Name -ErrorAction Stop
    Write-Host "Eliminada cola vieja: $($o.Name)" -ForegroundColor Yellow
  } catch {
    Write-Host "No se pudo borrar $($o.Name): $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

$created = @()
$rolesSeen = @{}

foreach ($z in $zebras) {
  $role = Get-PrinterRole $z.Name
  if ($role -eq 'OTRA') { continue }

  # Un rol = una cola RAW (si hay dos ADHESIVO, gana la primera / avisa)
  if ($rolesSeen.ContainsKey($role)) {
    Write-Host ("AVISO: otra cola tambien mapea a {0}: {1} ({2}). Se mantiene la primera." -f $role, $z.Name, $z.PortName) -ForegroundColor Yellow
    continue
  }
  $rolesSeen[$role] = $true

  $rawName = "Etiquetas RAW $role"
  $existing = Get-Printer -Name $rawName -ErrorAction SilentlyContinue

  if ($existing) {
    if ($existing.PortName -ne $z.PortName) {
      Write-Host "Actualizando puerto de $rawName : $($existing.PortName) -> $($z.PortName)"
      Set-Printer -Name $rawName -PortName $z.PortName
    }
    if ($existing.DriverName -ne 'Generic / Text Only') {
      Write-Host "AVISO: $rawName no usa Generic/Text Only (driver=$($existing.DriverName))" -ForegroundColor Yellow
    } else {
      Write-Host "OK $rawName -> $($z.PortName) (desde '$($z.Name)')" -ForegroundColor Green
    }
  } else {
    Add-Printer -Name $rawName -DriverName 'Generic / Text Only' -PortName $z.PortName
    Write-Host "Creada $rawName -> $($z.PortName) (desde '$($z.Name)')" -ForegroundColor Green
  }
  $created += "$rawName=$($z.PortName)"
}

# Mapa en disco para el agente / panel
$map = @{
  updatedAt = (Get-Date).ToString('o')
  printers = @($zebras | ForEach-Object {
    @{
      windowsName = $_.Name
      port = $_.PortName
      role = (Get-PrinterRole $_.Name)
      rawQueue = "Etiquetas RAW $(Get-PrinterRole $_.Name)"
    }
  })
}
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$mapPath = Join-Path $root 'printer-map.json'
$map | ConvertTo-Json -Depth 5 | Set-Content -Path $mapPath -Encoding UTF8
Write-Host "Mapa: $mapPath"

Write-Host ''
Write-Host "Listo: $($created -join ' | ')" -ForegroundColor Green
Write-Host 'En Windows, ADHESIVO = ZDesigner ... ZPL (sin PAPEL). PAPEL = nombre con PAPEL.'
Write-Host 'Si ambas salen en la misma maquina fisica: desconecta/reconecta USB y asigna de nuevo el puerto en Propiedades de impresora.'
