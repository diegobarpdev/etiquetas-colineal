#Requires -Version 5.1
<#
.SYNOPSIS
  Actualizacion automatica en silencio (tarea programada cada 15 min).
  Log: logs\auto-update.log
#>
$ErrorActionPreference = 'Continue'
$Root = $PSScriptRoot
$script = Join-Path $Root 'actualizar-agente.ps1'
if (-not (Test-Path $script)) { exit 1 }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden `
  -File $script -Silent
exit $LASTEXITCODE
