#Requires -Version 5.1
<#
.SYNOPSIS
  Verifica si el autoarranque del print-agent esta configurado.
#>
$ErrorActionPreference = 'Continue'
$Root = $PSScriptRoot
$Port = 9120

Write-Host '=============================================='
Write-Host '  Verificar autoarranque print-agent'
Write-Host "  $Root"
Write-Host '=============================================='

Write-Host ''
Write-Host '== Tareas programadas ==' -ForegroundColor Cyan
$tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
  $_.TaskName -match 'EtiquetasPrintAgent'
})
if ($tasks.Count -eq 0) {
  Write-Host 'NO hay tareas EtiquetasPrintAgent*' -ForegroundColor Red
  Write-Host 'Corre install.bat como Administrador.' -ForegroundColor Yellow
} else {
  $tasks | ForEach-Object {
    $info = Get-ScheduledTaskInfo -TaskName $_.TaskName -ErrorAction SilentlyContinue
    $who = $_.Principal.UserId
    if (-not $who) { $who = $_.Principal.GroupId }
    Write-Host ("{0}: {1}  (corre como: {2})" -f $_.TaskName, $_.State, $who) -ForegroundColor Green
    if ($info) {
      Write-Host ("  Ultima: {0}  Prox: {1}" -f $info.LastRunTime, $info.NextRunTime) -ForegroundColor DarkGray
    }
  }
}

Write-Host ''
Write-Host '== Health ahora ==' -ForegroundColor Cyan
try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
  Write-Host ("OK engine={0} bp={1}" -f $h.engine, $h.browserPrint.reachable) -ForegroundColor Green
} catch {
  Write-Host ("NO responde :{0} — {1}" -f $Port, $_.Exception.Message) -ForegroundColor Yellow
}

Write-Host ''
Write-Host '== Log de boot (si existe) ==' -ForegroundColor Cyan
$bootLog = Join-Path $Root 'logs\boot-agent.log'
if (Test-Path $bootLog) {
  Get-Content $bootLog -Tail 8
} else {
  Write-Host '(aun no hay logs\boot-agent.log — aparece tras el primer arranque automatico)'
}

Write-Host ''
Write-Host '== Modo de arranque ==' -ForegroundColor Cyan
$prefer = Join-Path $Root '.prefer-node-direct'
if (Test-Path $prefer) {
  Write-Host 'Modo: NODE DIRECTO (.prefer-node-direct)' -ForegroundColor Yellow
  Write-Host 'Al reiniciar: la tarea Logon/Watch llama boot-agent → un solo node.exe' -ForegroundColor DarkGray
  Write-Host '(PM2 no hace falta en esta PC; el autoarranque sigue funcionando.)' -ForegroundColor DarkGray
} else {
  Write-Host 'Modo: PM2 (si el demonio responde)' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Prueba definitiva: reinicia la PC, inicia sesion, espera 1 min,'
Write-Host "abre http://127.0.0.1:$Port/health"
Write-Host ''
Write-Host 'Auto-update: debe existir EtiquetasPrintAgentUpdate (cada 15 min).'
Write-Host 'Log: logs\auto-update.log'
Write-Host 'Si faltan tareas: ensure-startup-tasks.ps1 o install.bat (Admin).'
Write-Host '=============================================='
