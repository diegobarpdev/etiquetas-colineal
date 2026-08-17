$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$printers = @()
Get-Printer | ForEach-Object {
  $printers += [ordered]@{
    name = $_.Name
    port = $_.PortName
    driver = $_.DriverName
  }
}

@{ ok = $true; printers = $printers } | ConvertTo-Json -Compress -Depth 4
