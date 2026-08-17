#Requires -Version 5.1
<#
.SYNOPSIS
  Compila Instalar-Agente-Etiquetas.exe (C# + payload PS1 incrustado).

.DESCRIPTION
  Usa csc.exe del .NET Framework (incluido en Windows).
  Salida por defecto: data/print-agent-dist/Instalar-Agente-Etiquetas.exe
#>
param(
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'

$InstallerDir = $PSScriptRoot
# print-agent/installer → repo root
$RepoRoot = Split-Path (Split-Path $InstallerDir -Parent) -Parent
if (-not (Test-Path (Join-Path $RepoRoot 'package.json'))) {
  $RepoRoot = (Resolve-Path (Join-Path $InstallerDir '..\..')).Path
}

if (-not $OutDir) {
  $OutDir = Join-Path $RepoRoot 'data\print-agent-dist'
}

$PayloadPath = Join-Path $InstallerDir 'InstallPayload.ps1'
$TemplatePath = Join-Path $InstallerDir 'Program.cs.template'
$ManifestPath = Join-Path $InstallerDir 'app.manifest'
$WorkDir = Join-Path $env:TEMP ('etiquetas-exe-build-' + [guid]::NewGuid().ToString('N'))
$CsPath = Join-Path $WorkDir 'Program.cs'
$OutExe = Join-Path $OutDir 'Instalar-Agente-Etiquetas.exe'

$CscCandidates = @(
  Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
)
$Csc = $CscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $Csc) {
  throw 'No se encuentra csc.exe (.NET Framework 4.x).'
}

foreach ($p in @($PayloadPath, $TemplatePath, $ManifestPath)) {
  if (-not (Test-Path $p)) { throw "Falta: $p" }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

try {
  $payloadBytes = [System.IO.File]::ReadAllBytes($PayloadPath)
  $b64 = [Convert]::ToBase64String($payloadBytes)

  $template = [System.IO.File]::ReadAllText($TemplatePath)
  if ($template -notmatch '@@PAYLOAD_BASE64@@') {
    throw 'Program.cs.template no tiene el marcador @@PAYLOAD_BASE64@@'
  }
  $cs = $template.Replace('@@PAYLOAD_BASE64@@', $b64)
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($CsPath, $cs, $utf8NoBom)

  Write-Host "Compilando con: $Csc"
  Write-Host "Salida:         $OutExe"

  $args = @(
    '/nologo'
    '/target:exe'
    '/platform:anycpu'
    '/optimize+'
    "/win32manifest:`"$ManifestPath`""
    "/out:`"$OutExe`""
    "`"$CsPath`""
  )

  $p = Start-Process -FilePath $Csc -ArgumentList $args -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) {
    throw "csc.exe falló con código $($p.ExitCode)"
  }
  if (-not (Test-Path $OutExe)) {
    throw "No se generó $OutExe"
  }

  $size = (Get-Item -LiteralPath $OutExe).Length
  Write-Host ''
  Write-Host 'EXE OK' -ForegroundColor Green
  Write-Host "  $OutExe ($size bytes)"
  Write-Host ''
  Write-Host 'Uso en PC USB (Admin):'
  Write-Host '  Doble clic en Instalar-Agente-Etiquetas.exe'
  Write-Host '  o descargar: http://192.168.2.28:3000/api/print-agent/installer.exe'
} finally {
  Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
}
