'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function runPsFile(scriptName, scriptArgs = [], timeoutMs = 60_000) {
  const scriptPath = path.join(__dirname, scriptName);
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      ...scriptArgs,
    ],
    { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' },
  );
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function parseLastJson(stdout) {
  const line = String(stdout || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return { raw: line };
  }
}

function listWindowsPrinters() {
  const result = runPsFile('list-printers.ps1', [], 45_000);
  const data = parseLastJson(result.stdout);
  if (data && Array.isArray(data.printers)) {
    return data.printers.map((p) => ({
      name: String(p.name || ''),
      port: String(p.port || ''),
      driver: String(p.driver || ''),
    })).filter((p) => p.name);
  }
  return [];
}

function isZebraName(name) {
  return /zdesigner|zt230|zebra/i.test(String(name || ''));
}

function isUsbPortName(port) {
  return /^USB\d+/i.test(String(port || ''));
}

/**
 * Puntúa coincidencia con el nombre preferido.
 * Evita que «… ZPL PAPEL» gane frente a «… ZPL» solo por .includes().
 */
function scorePrinterName(name, preferred) {
  const n = String(name || '').toLowerCase().trim();
  const p = String(preferred || '').toLowerCase().trim();
  if (!n || !p) return 0;
  if (n === p) return 1000;
  // Preferir la cola cuya longitud encaja mejor (base vs PAPEL).
  if (n.includes(p) || p.includes(n)) {
    return 500 - Math.abs(n.length - p.length);
  }
  return 0;
}

/**
 * Detecta puerto USB de una impresora Zebra/ZDesigner.
 * Devuelve también todas las Zebras USB (`zebras`) cuando hay más de una.
 */
function detectUsbPort(preferredPrinterName = '') {
  const printers = listWindowsPrinters();
  const preferred = String(preferredPrinterName || '').trim();
  const zebras = printers.filter((p) => isZebraName(p.name) && isUsbPortName(p.port));

  let hit = null;
  if (preferred) {
    const scored = (zebras.length ? zebras : printers.filter((p) => isZebraName(p.name)))
      .map((p) => ({ p, score: scorePrinterName(p.name, preferred) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.p.name.length - b.p.name.length);
    hit = scored[0]?.p || null;
  }

  if (!hit) {
    hit = zebras[0] || printers.find((p) => isZebraName(p.name)) || null;
  }

  if (!hit) return { port: '', printer: null, printers, zebras };
  return { port: hit.port || '', printer: hit.name, printers, zebras };
}

function sendRawZpl({ filePath, portName, printerName, requireUsb, sendMode }) {
  const mode = sendMode || 'raw-queue';
  const args = ['-FilePath', filePath, '-SendMode', mode];
  if (portName) args.push('-PortName', portName);
  if (printerName) args.push('-PrinterName', printerName);

  const result = runPsFile('send-raw.ps1', args, 120_000);
  const parsed = parseLastJson(result.stdout);

  if (!result.ok || (parsed && parsed.ok === false)) {
    const err =
      (parsed && parsed.error) ||
      result.stderr ||
      (parsed && parsed.raw) ||
      `send-raw.ps1 status ${result.status}`;
    const hint = parsed && parsed.hint ? ` — ${parsed.hint}` : '';
    const error = new Error(`${err}${hint}`);
    error.details = parsed;
    throw error;
  }

  if (requireUsb && parsed && parsed.method === 'winspool-raw') {
    throw new Error(
      'Se usó la cola ZDesigner (tamaño «producto conforme»). Usa Etiquetas RAW ADHESIVO/PAPEL.',
    );
  }

  return parsed;
}

/**
 * Envía ZPL crudo a una cola Windows (ZDesigner …) con datatype RAW.
 * No pasa por el render del driver: solo WritePrinter bytes ZPL.
 * Más fiable que Browser Print cuando el USB está compartido con ZDesigner.
 */
function sendWinspoolRaw(printerName, zpl) {
  const name = String(printerName || '').trim();
  if (!name) throw new Error('Falta printerName para winspool RAW');
  const data = Buffer.isBuffer(zpl) ? zpl : Buffer.from(String(zpl), 'ascii');
  const tmp = path.join(
    os.tmpdir(),
    `etiquetas-raw-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.zpl`,
  );
  fs.writeFileSync(tmp, data);
  try {
    // Lotes de producto terminado (varios GFA) pueden superar 1–2 MB.
    const timeoutMs = Math.max(90_000, Math.min(300_000, 30_000 + data.length / 20));
    const result = runPsFile(
      'send-winspool.ps1',
      ['-PrinterName', name, '-FilePath', tmp],
      timeoutMs,
    );
    const parsed = parseLastJson(result.stdout);
    if (!result.ok || !parsed || parsed.ok === false) {
      const err =
        (parsed && parsed.error) ||
        result.stderr ||
        `send-winspool.ps1 status ${result.status}`;
      throw new Error(err);
    }
    return {
      ok: true,
      method: 'winspool-raw',
      printer: parsed.printer || name,
      bytes: parsed.bytes || data.length,
      connection: 'winspool',
    };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  runPsFile,
  parseLastJson,
  listWindowsPrinters,
  detectUsbPort,
  sendRawZpl,
  sendWinspoolRaw,
};
