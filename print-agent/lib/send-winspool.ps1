param(
  [Parameter(Mandatory = $true)]
  [string]$PrinterName,
  [Parameter(Mandatory = $true)]
  [string]$FilePath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not (Test-Path -LiteralPath $FilePath)) {
  @{ ok = $false; error = ("No existe el archivo: " + $FilePath) } | ConvertTo-Json -Compress
  exit 1
}

$printer = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if (-not $printer) {
  @{ ok = $false; error = ("No existe la impresora Windows: " + $PrinterName) } | ConvertTo-Json -Compress
  exit 1
}

$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $FilePath).Path)

$src = @'
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelperWinspool {
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

  public static int SendBytes(string printerName, byte[] data, string docName) {
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
          // Escribir por chunks: jobs multi-etiqueta (producto terminado) son grandes.
          const int chunkSize = 256 * 1024;
          int totalWritten = 0;
          for (int offset = 0; offset < data.Length; offset += chunkSize) {
            int len = Math.Min(chunkSize, data.Length - offset);
            IntPtr p = Marshal.AllocCoTaskMem(len);
            try {
              Marshal.Copy(data, offset, p, len);
              int written;
              if (!WritePrinter(hPrinter, p, len, out written)) {
                throw new Exception("WritePrinter falló (Win32=" + Marshal.GetLastWin32Error() + ") offset=" + offset);
              }
              if (written != len) {
                throw new Exception("WritePrinter escribió " + written + " de " + len + " bytes offset=" + offset);
              }
              totalWritten += written;
            }
            finally {
              Marshal.FreeCoTaskMem(p);
            }
          }
          return totalWritten;
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
  }
}
'@

try {
  Add-Type -TypeDefinition $src -Language CSharp -ErrorAction Stop | Out-Null
} catch {
  if ($_.Exception.Message -notmatch 'already exists') { throw }
}

try {
  $written = [RawPrinterHelperWinspool]::SendBytes($PrinterName.Trim(), $bytes, 'etiquetas-zpl')
  @{
    ok = $true
    method = 'winspool-raw'
    printer = $PrinterName.Trim()
    port = $printer.PortName
    bytes = $written
  } | ConvertTo-Json -Compress
  exit 0
} catch {
  @{
    ok = $false
    error = $_.Exception.Message
    printer = $PrinterName
  } | ConvertTo-Json -Compress
  exit 1
}
