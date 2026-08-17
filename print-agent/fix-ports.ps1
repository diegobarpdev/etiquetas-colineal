# Muestra el mapa ADHESIVO/PAPEL y permite corregir el puerto USB de una cola.
# Ejecutar como Admin en la PC de las Zebras.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host '=== Mapa actual (ZDesigner + RAW) ===' -ForegroundColor Cyan
Get-Printer | Where-Object {
  $_.Name -match 'ZDesigner|ZT230|Zebra|^Etiquetas RAW'
} | Sort-Object Name | Format-Table Name, PortName, DriverName -AutoSize

Write-Host ''
Write-Host 'ADHESIVO debe ser la maquina de adhesivo. PAPEL la de papel.'
Write-Host 'Si Etiquetas RAW PAPEL apunta al USB del adhesivo, cambia el puerto:'
Write-Host ''
Write-Host '  Ejemplo (ajusta USB00X al cable de la impresora de PAPEL):'
Write-Host '  Set-Printer -Name "Etiquetas RAW PAPEL" -PortName "USB001"'
Write-Host '  Set-Printer -Name "ZDesigner ZT230-200dpi ZPL PAPEL" -PortName "USB001"'
Write-Host ''
Write-Host 'Lista de puertos USB:'
Get-PrinterPort | Where-Object { $_.Name -match '^USB' } | Format-Table Name -AutoSize

$papel = Get-Printer -Name 'Etiquetas RAW PAPEL' -ErrorAction SilentlyContinue
$adhesivo = Get-Printer -Name 'Etiquetas RAW ADHESIVO' -ErrorAction SilentlyContinue
if (-not $adhesivo) {
  $adhesivo = Get-Printer -Name 'Etiquetas RAW TELA' -ErrorAction SilentlyContinue
}
if ($papel -and $adhesivo -and $papel.PortName -eq $adhesivo.PortName) {
  Write-Host "ERROR: ADHESIVO y PAPEL comparten $($papel.PortName). Imposible distinguir maquinas." -ForegroundColor Red
}

Write-Host ''
$newPort = Read-Host 'Puerto USB correcto para PAPEL (ej USB002) o Enter para salir'
if (-not $newPort) { exit 0 }
$newPort = $newPort.Trim()

foreach ($n in @('Etiquetas RAW PAPEL', 'ZDesigner ZT230-200dpi ZPL PAPEL')) {
  $p = Get-Printer -Name $n -ErrorAction SilentlyContinue
  if ($p) {
    Set-Printer -Name $n -PortName $newPort
    Write-Host "OK $n -> $newPort" -ForegroundColor Green
  } else {
    Write-Host "No existe: $n" -ForegroundColor Yellow
  }
}

Write-Host 'Listo. Prueba imprimir PAPEL desde el panel (debe salir texto PAPEL en esa maquina).'
