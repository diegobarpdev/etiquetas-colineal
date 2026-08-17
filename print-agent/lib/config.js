'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function envStr(key, fallback = '') {
  const v = process.env[key];
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  return s || fallback;
}

function envBool(key, fallback = false) {
  const v = envStr(key, '');
  if (!v) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function envNum(key, fallback) {
  const n = Number(envStr(key, ''));
  return Number.isFinite(n) ? n : fallback;
}

const ROOT = path.join(__dirname, '..');

const config = {
  root: ROOT,
  /** 9120 — no usar 9100/9101 (los reserva Zebra Browser Print). */
  port: envNum('PORT', 9120),
  host: envStr('HOST', '0.0.0.0'),
  /** Nombre orientativo / match Browser Print (ADHESIVO = sin PAPEL). */
  printerName: envStr('PRINTER_NAME', 'ZDesigner ZT230-200dpi ZPL'),
  printDpi: envNum('PRINT_DPI', 203),
  /** URL del servicio Browser Print en esta PC. */
  browserPrintUrl: envStr('BROWSER_PRINT_URL', 'http://127.0.0.1:9100'),
  /**
   * UID USB de Browser Print (ej. 52n215200466), NO el nombre ZDesigner.
   * connection=driver pasa por el driver y fuerza tamaño conforme.
   */
  bpUsbAdhesivo: envStr('BP_USB_ADHESIVO', ''),
  bpUsbPapel: envStr('BP_USB_PAPEL', ''),
  /**
   * Motor de envío:
   * - winspool (default): WritePrinter RAW a cola ZDesigner (fiable con USB compartido)
   * - browser-print: Zebra Browser Print USB
   * - auto: intenta winspool y si falla usa browser-print
   */
  sendEngine: (() => {
    const v = envStr('SEND_ENGINE', 'browser-print').toLowerCase();
    if (v === 'winspool' || v === 'raw') return 'winspool';
    if (v === 'auto') return 'auto';
    return 'browser-print';
  })(),
  /** Pausa entre etiquetas si PRINT_SEND_PER_LABEL=1 y modo cortadora (ms). */
  cutterGapMs: envNum('CUTTER_GAP_MS', 900),
  /** Pausa entre páginas en modo per-label tear (ms). Default 0. */
  pageGapMs: envNum('PRINT_PAGE_GAP_MS', 0),
  /**
   * Si true, envía cada etiqueta como job aparte (lento; solo diagnóstico).
   * Por defecto false: un solo stream ZPL con todas las páginas.
   */
  sendPerLabel: envBool('PRINT_SEND_PER_LABEL', false),
  /**
   * Browser Print / USB: trozos moderados; la cola del servidor manda el siguiente al terminar.
   */
  bpChunkPages: Math.max(1, Math.min(30, envNum('BP_CHUNK_PAGES', 10))),
  bpChunkMaxBytes: Math.max(50_000, envNum('BP_CHUNK_MAX_BYTES', 350_000)),
  /** Pausa corta entre chunks BP (ms). */
  bpChunkGapMs: Math.max(0, envNum('BP_CHUNK_GAP_MS', 250)),
  /**
   * Tras cada chunk, espera extra ≈ pages * este valor (ms).
   * Bajo = más rápido; la cola servidor→agente ya espacia los PDF.
   */
  bpDrainMsPerPage: Math.max(0, envNum('BP_DRAIN_MS_PER_PAGE', 80)),
  /** Velocidad ZPL ^PR (ips). */
  printSpeedIps: Math.max(2, Math.min(14, envNum('PRINT_SPEED_IPS', 6))),
  /**
   * Oscuridad ZPL ^MD (-30..30). 0 = no enviar (usa panel de la impresora).
   * PRINT_DARKNESS_PAPEL aplica a conforme-papel / rol PAPEL (tela).
   */
  printDarkness: (() => {
    const n = envNum('PRINT_DARKNESS', NaN);
    return Number.isFinite(n) ? Math.max(-30, Math.min(30, Math.round(n))) : null;
  })(),
  printDarknessPapel: Math.max(
    -30,
    Math.min(30, Math.round(envNum('PRINT_DARKNESS_PAPEL', 25))),
  ),
  dryRun: envBool('PRINT_DRY_RUN', false),
};

/** Referencia UI/hardware; el tamaño ZPL sale del PDF (plantilla). */
function stockSizeMm(stockSize) {
  const map = {
    // PDF horizontal; png-to-zpl rota a 100×150 para el cabezal.
    'producto-terminado': { widthMm: 150, heightMm: 100 },
    'producto-conforme': { widthMm: 100, heightMm: 70 },
    carpinteria: { widthMm: 100, heightMm: 70 },
    'conforme-papel': { widthMm: 60, heightMm: 90 },
    'conforme-papel-colchones': { widthMm: 60, heightMm: 100 },
  };
  return map[stockSize] || null;
}

function paperNameForStock(stockSize) {
  const map = {
    'producto-terminado': 'producto terminado',
    'producto-conforme': 'producto conforme',
    carpinteria: 'producto conforme',
    'conforme-papel': 'conforme papel',
    'conforme-papel-colchones': 'conforme papel',
  };
  return map[stockSize] || null;
}

module.exports = { config, stockSizeMm, paperNameForStock, envStr };
