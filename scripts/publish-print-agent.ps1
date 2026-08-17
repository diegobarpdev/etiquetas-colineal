#Requires -Version 5.1
<#
.SYNOPSIS
  Empaqueta print-agent para distribución HTTP (version.json + package.zip).

.DESCRIPTION
  Salida: data/print-agent-dist/version.json y data/print-agent-dist/package.zip
  Uso:  powershell -File scripts/publish-print-agent.ps1
        npm run publish:print-agent
#>
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $RepoRoot 'package.json'))) {
  $RepoRoot = $PSScriptRoot
}
$Source = Join-Path $RepoRoot 'print-agent'
$DistDir = Join-Path $RepoRoot 'data\print-agent-dist'
$Staging = Join-Path $env:TEMP ("print-agent-publish-" + [guid]::NewGuid().ToString('N'))
$ZipPath = Join-Path $DistDir 'package.zip'
$VersionPath = Join-Path $DistDir 'version.json'

$ExcludeDirNames = @(
  'node_modules', '.pm2', 'runtime', 'logs', '.git',
  '_ssh_tmp', 'coverage'
)
$ExcludeFileNames = @(
  '.env', 'usb-role-map.json', 'last-job.zpl', 'agent-version.json'
)
$ExcludePatterns = @('*.bak', '*.bak-*', '*.log', '.DS_Store')

if (-not (Test-Path (Join-Path $Source 'index.js'))) {
  throw "No se encuentra el agente en: $Source"
}

Write-Host "Origen:  $Source"
Write-Host "Destino: $DistDir"

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
New-Item -ItemType Directory -Force -Path $Staging | Out-Null

function Test-ExcludedPath([string]$FullPath, [string]$Relative) {
  $parts = $Relative -split '[\\/]'
  foreach ($p in $parts) {
    if ($ExcludeDirNames -contains $p) { return $true }
  }
  $name = Split-Path $FullPath -Leaf
  if ($ExcludeFileNames -contains $name) { return $true }
  foreach ($pat in $ExcludePatterns) {
    if ($name -like $pat) { return $true }
  }
  return $false
}

$fileCount = 0
Get-ChildItem -Path $Source -Recurse -Force | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
  $rel = $_.FullName.Substring($Source.Length).TrimStart('\', '/')
  if (Test-ExcludedPath $_.FullName $rel) { return }
  $dest = Join-Path $Staging $rel
  $destDir = Split-Path $dest -Parent
  if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  }
  Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
  $script:fileCount++
}

if ($fileCount -lt 5) {
  throw "Muy pocos archivos empaquetados ($fileCount). Revisa exclusiones."
}

if (Test-Path $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }

# Compress-Archive necesita la carpeta o los ítems; zip con raíz = contenido del agente
Push-Location $Staging
try {
  Compress-Archive -Path * -DestinationPath $ZipPath -CompressionLevel Optimal -Force
} finally {
  Pop-Location
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ZipPath).Hash.ToLowerInvariant()
$version = $hash.Substring(0, 12)
$builtAt = (Get-Date).ToUniversalTime().ToString('o')
$zipBytes = (Get-Item -LiteralPath $ZipPath).Length

$meta = [ordered]@{
  version   = $version
  builtAt   = $builtAt
  sha256    = $hash
  fileCount = $fileCount
  sizeBytes = $zipBytes
  package   = 'package.zip'
}

$json = ($meta | ConvertTo-Json)
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($VersionPath, $json, $utf8NoBom)

Remove-Item -LiteralPath $Staging -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'Publicacion OK' -ForegroundColor Green
Write-Host "  version:   $version"
Write-Host "  archivos:  $fileCount"
Write-Host "  zip:       $ZipPath ($zipBytes bytes)"
Write-Host "  sha256:    $hash"

# Compilar instalador EXE (descarga este mismo package.zip al instalar)
$buildExe = Join-Path $Source 'installer\build-exe.ps1'
if (Test-Path $buildExe) {
  Write-Host ''
  Write-Host 'Compilando instalador EXE...' -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $buildExe -OutDir $DistDir
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'AVISO: no se pudo compilar el EXE (el ZIP sí quedó publicado).' -ForegroundColor Yellow
  }
} else {
  Write-Host "AVISO: no está $buildExe" -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Endpoints (con la app en :3000):'
Write-Host '  GET /api/print-agent/version'
Write-Host '  GET /api/print-agent/package.zip'
Write-Host '  GET /api/print-agent/installer.exe'
Write-Host '  GET /api/print-agent/bootstrap.ps1'
