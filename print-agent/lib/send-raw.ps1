param(
  [string]$PrinterName = '',
  [string]$PortName = '',
  [Parameter(Mandatory = $true)]
  [string]$FilePath,
  # raw-queue = cola Generic ADHESIVO/PAPEL (rapido, Designer puede quedar abierto)
  # usb-first = intenta \\.\USBx y si falla usa Generic
  [string]$SendMode = 'raw-queue'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not (Test-Path -LiteralPath $FilePath)) {
  @{ ok = $false; error = ("No existe el archivo: " + $FilePath) } | ConvertTo-Json -Compress
  exit 1
}

$fullPath = (Resolve-Path -LiteralPath $FilePath).Path
$bytes = [System.IO.File]::ReadAllBytes($fullPath)

function Test-PassthroughDriver {
  param([string]$DriverName)
  return [bool]($DriverName -match 'Generic\s*/\s*Text Only|Generic / Text Only|Text Only')
}

function Get-PrinterDetails {
  param([string]$Name)
  if (-not $Name) { return $null }
  return Get-Printer -Name $Name -ErrorAction SilentlyContinue
}

function Get-PrinterRole {
  param([string]$Name)
  $n = ([string]$Name).ToUpperInvariant()
  if ($n -match 'PAPEL') { return 'PAPEL' }
  if ($n -match 'ADHESIVO|TELA') { return 'ADHESIVO' }
  if ($n -match 'ZDESIGNER|ZT230|ZEBRA') { return 'ADHESIVO' }
  return ''
}

function Find-RawQueue {
  param([string]$PreferredPrinter)

  # 1) Ya es Etiquetas RAW ...
  if ($PreferredPrinter -match '^Etiquetas RAW') {
    $exact = Get-PrinterDetails -Name $PreferredPrinter
    if ($exact) { return $exact }
  }

  # 2) Por rol ADHESIVO / PAPEL
  $role = Get-PrinterRole $PreferredPrinter
  if ($role) {
    $byRole = Get-PrinterDetails -Name ("Etiquetas RAW $role")
    if ($byRole) { return $byRole }
  }

  # 3) Generic en el mismo puerto que la cola preferida
  $pref = Get-PrinterDetails -Name $PreferredPrinter
  if ($pref) {
    $same = @(Get-Printer | Where-Object {
      $_.PortName -eq $pref.PortName -and (
        (Test-PassthroughDriver $_.DriverName) -or $_.Name -match '^Etiquetas RAW'
      )
    } | Select-Object -First 1)
    if ($same) { return $same }
  }

  return $null
}

function Send-ViaWinspool {
  param([string]$Name, [byte[]]$Data)

  $src = @'
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper4 {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

  public static bool SendBytes(string printerName, byte[] bytes, string docName) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
      throw new Exception("OpenPrinter falló para " + printerName + " (Win32=" + Marshal.GetLastWin32Error() + ")");
    }
    try {
      DOCINFOA di = new DOCINFOA();
      di.pDocName = docName;
      di.pDataType = "RAW";
      if (!StartDocPrinter(hPrinter, 1, di)) {
        throw new Exception("StartDocPrinter falló (Win32=" + Marshal.GetLastWin32Error() + ")");
      }
      try {
        if (!StartPagePrinter(hPrinter)) {
          throw new Exception("StartPagePrinter falló (Win32=" + Marshal.GetLastWin32Error() + ")");
        }
        try {
          IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);
          try {
            Marshal.Copy(bytes, 0, p, bytes.Length);
            int written;
            if (!WritePrinter(hPrinter, p, bytes.Length, out written)) {
              throw new Exception("WritePrinter falló (Win32=" + Marshal.GetLastWin32Error() + ")");
            }
            if (written != bytes.Length) {
              throw new Exception("WritePrinter escribió " + written + " de " + bytes.Length + " bytes");
            }
          }
          finally {
            Marshal.FreeCoTaskMem(p);
          }
        }
        finally {
          EndPagePrinter(hPrinter);
        }
      }
      finally {
        EndDocPrinter(hPrinter);
      }
    }
    finally {
      ClosePrinter(hPrinter);
    }
    return true;
  }
}
'@

  try {
    Add-Type -TypeDefinition $src -Language CSharp -ErrorAction Stop | Out-Null
  } catch {
    if ($_.Exception.Message -notmatch 'already exists') { throw }
  }

  [RawPrinterHelper4]::SendBytes($Name.Trim(), $Data, 'etiquetas-zpl') | Out-Null
  return @{ ok = $true; method = 'winspool-generic'; printer = $Name.Trim(); bytes = $Data.Length }
}

function Send-ToUsbPort {
  param([string]$Port, [byte[]]$Data)
  $path = if ($Port -match '^\\\\') { $Port } else { '\\.\' + $Port.Trim() }
  $fs = $null
  try {
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
    $fs.Write($Data, 0, $Data.Length)
    $fs.Flush()
    return @{ ok = $true; method = 'usb-port'; port = $path; bytes = $Data.Length }
  }
  finally {
    if ($fs) { $fs.Dispose() }
  }
}

# --- Resolver cola RAW destino (por nombre/rol) ---
$raw = Find-RawQueue -PreferredPrinter $PrinterName
if (-not $raw -and $PortName) {
  $raw = @(Get-Printer | Where-Object {
    $_.PortName -eq $PortName.Trim() -and $_.Name -match '^Etiquetas RAW'
  } | Select-Object -First 1)
}

if (-not $raw) {
  @{
    ok = $false
    error = 'No hay cola Etiquetas RAW ADHESIVO/PAPEL para esta impresora.'
    printerName = $PrinterName
    hint = 'Ejecuta ensure-raw-queues.ps1 como Admin. En la app usa ZDesigner … ZPL (ADHESIVO) o … PAPEL, o Etiquetas RAW ADHESIVO/PAPEL.'
  } | ConvertTo-Json -Compress
  exit 1
}

$targetName = $raw.Name
$targetPort = $raw.PortName
$warnings = New-Object System.Collections.ArrayList
[void]$warnings.Add(('target:' + $targetName + '@' + $targetPort))

# Modo por defecto: SOLO cola RAW (rapido). No pausar colas ni reintentar USB.
if ($SendMode -ne 'usb-first') {
  try {
    $r = Send-ViaWinspool -Name $targetName -Data $bytes
    $r.port = $targetPort
    $r.role = (Get-PrinterRole $targetName)
    $r.warnings = $warnings
    $r | ConvertTo-Json -Compress -Depth 5
    exit 0
  } catch {
    @{
      ok = $false
      error = $_.Exception.Message
      printer = $targetName
      port = $targetPort
      hint = 'Revisa que la cola RAW exista y el puerto USB sea el de la impresora fisica correcta (ADHESIVO vs PAPEL).'
    } | ConvertTo-Json -Compress
    exit 1
  }
}

# Modo usb-first (opt-in): intenta USB 1 vez, si falla RAW
try {
  $r = Send-ToUsbPort -Port $targetPort -Data $bytes
  $r.warnings = $warnings
  $r | ConvertTo-Json -Compress -Depth 5
  exit 0
} catch {
  [void]$warnings.Add(('usb-open:' + $_.Exception.Message))
}

$r = Send-ViaWinspool -Name $targetName -Data $bytes
$r.port = $targetPort
$r.warning = 'USB directo no disponible; cola RAW'
$r.warnings = $warnings
$r | ConvertTo-Json -Compress -Depth 5
exit 0
