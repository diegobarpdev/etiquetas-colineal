'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { config } = require('./config');
const { renderPdfToPngPages } = require('./render-pdf');
const { buildZplBatch, encodeBitmapZ64 } = require('./png-to-zpl');
const {
  resolveDevice,
  writeZpl,
  roleFromHint,
} = require('./browser-print');
const { detectUsbPort, sendWinspoolRaw } = require('./windows');

let lastJob = null;
let cachedDeviceName = '';

function clearDetectCache() {
  cachedDeviceName = '';
}

function getLastJob() {
  return lastJob;
}

function rememberJob(job) {
  lastJob = {
    at: new Date().toISOString(),
    ...job,
  };
  return lastJob;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveWindowsPrinterName(preferred, role) {
  const hint = String(preferred || '').trim();
  if (/zdesigner|zt230|zebra/i.test(hint)) return hint;
  const detected = detectUsbPort(
    role === 'PAPEL' ? 'ZDesigner ZT230-200dpi ZPL PAPEL' : hint || config.printerName,
  );
  if (role === 'PAPEL') {
    const papel =
      (detected.zebras || []).find((p) => /PAPEL/i.test(p.name)) ||
      detected.printer;
    if (papel) return typeof papel === 'string' ? papel : papel.name;
  }
  if (detected.printer) return detected.printer;
  if (role === 'PAPEL') return 'ZDesigner ZT230-200dpi ZPL PAPEL';
  return config.printerName || 'ZDesigner ZT230-200dpi ZPL';
}

/**
 * Envía una etiqueta: Browser Print (default) o winspool RAW.
 * Si BP falla, intenta winspool como respaldo (evita cortes en lotes grandes).
 */
async function sendLabelZpl({ zpl, preferred, role, device, engine }) {
  const mode = engine || config.sendEngine || 'winspool';
  const windowsName = resolveWindowsPrinterName(preferred, role);
  const errors = [];

  const tryWinspool = mode === 'winspool' || mode === 'auto';
  // browser-print también puede caer a winspool si BP cae a mitad del lote
  const tryBp = mode === 'browser-print' || mode === 'auto' || mode === 'winspool';
  const allowWinspoolFallback = mode === 'browser-print' || mode === 'auto';

  async function viaWinspool(fallbackFrom) {
    const send = sendWinspoolRaw(windowsName, zpl);
    return {
      ok: true,
      method: send.method || 'winspool-raw',
      device: send.printer || windowsName,
      uid: device?.uid || '',
      role,
      connection: 'winspool',
      printer: send.printer || windowsName,
      bytes: send.bytes,
      fallbackFrom,
      warnings: errors,
    };
  }

  if (tryWinspool && mode !== 'browser-print') {
    try {
      return await viaWinspool(undefined);
    } catch (error) {
      errors.push(`winspool: ${error instanceof Error ? error.message : String(error)}`);
      console.warn(`[zpl] winspool falló, intento Browser Print: ${errors[errors.length - 1]}`);
      if (mode === 'winspool' && !tryBp) throw error;
    }
  }

  if (tryBp) {
    try {
      const bpDevice = device || (await resolveDevice(preferred));
      const send = await writeZpl(bpDevice, zpl);
      return {
        ...send,
        printer: bpDevice.name || bpDevice.uid,
        fallbackFrom: errors.length ? 'winspool' : undefined,
        warnings: errors,
      };
    } catch (error) {
      errors.push(`browser-print: ${error instanceof Error ? error.message : String(error)}`);
      console.warn(`[zpl] Browser Print falló: ${errors[errors.length - 1]}`);
      if (allowWinspoolFallback) {
        try {
          console.warn(`[zpl] fallback winspool → «${windowsName}»`);
          return await viaWinspool('browser-print');
        } catch (winErr) {
          errors.push(`winspool: ${winErr instanceof Error ? winErr.message : String(winErr)}`);
        }
      }
      throw new Error(errors.join(' | '));
    }
  }

  throw new Error(errors.join(' | ') || 'No hay motor de envío disponible');
}

/**
 * Resuelve impresora vía Browser Print (para health/status).
 */
async function resolvePortAndPrinter(explicitPrinter) {
  const preferred = String(explicitPrinter || config.printerName || '').trim();
  const role = roleFromHint(preferred);
  try {
    const device = await resolveDevice(preferred);
    cachedDeviceName = device.name || device.uid;
    return {
      port: device.connection || 'browser-print',
      printer: device.name || device.uid,
      uid: device.uid,
      role: device.role || role,
      device,
      all: [],
      zebras: [],
    };
  } catch (error) {
    return {
      port: '',
      printer: preferred,
      uid: '',
      role,
      error: error instanceof Error ? error.message : String(error),
      all: [],
      zebras: [],
    };
  }
}

async function printPdfZpl(pdfPath, options = {}) {
  const dpi = Number(options.dpi) || config.printDpi;
  const copies = Math.max(1, Math.min(99, Number(options.copies) || 1));
  const widthMm = Number(options.widthMm);
  const heightMm = Number(options.heightMm);
  const preferred = options.printerName || config.printerName;

  const device = await resolveDevice(preferred);
  const role = device.role || roleFromHint(preferred);
  const stockSize = String(options.stockSize || '').trim();

  // Perfiles fijos por stock / rol (colchones usan producto-terminado)
  const HARDWARE_BY_STOCK = {
    'conforme-papel': {
      printMode: 'cutter',
      thermalMethod: 'direct',
      mediaType: 'continuous',
      printDarkness: config.printDarknessPapel,
    },
    'conforme-papel-colchones': {
      printMode: 'cutter',
      thermalMethod: 'direct',
      mediaType: 'continuous',
      printDarkness: config.printDarknessPapel,
    },
    'producto-terminado': {
      printMode: 'tear',
      thermalMethod: 'direct',
      mediaType: 'gap',
      printDarkness: config.printDarkness,
    },
    'producto-conforme': {
      printMode: 'tear',
      thermalMethod: 'direct',
      mediaType: 'gap',
      printDarkness: config.printDarkness,
    },
    carpinteria: {
      printMode: 'tear',
      thermalMethod: 'direct',
      mediaType: 'gap',
      printDarkness: config.printDarkness,
    },
  };

  let printMode = options.printMode;
  let thermalMethod = options.thermalMethod;
  let mediaType = options.mediaType;
  let printDarkness =
    options.printDarkness != null ? Number(options.printDarkness) : config.printDarkness;
  const forcedByRole =
    role === 'PAPEL' || /PAPEL/i.test(preferred)
      ? HARDWARE_BY_STOCK['conforme-papel']
      : HARDWARE_BY_STOCK[stockSize] || null;
  if (forcedByRole) {
    printMode = forcedByRole.printMode;
    thermalMethod = options.thermalMethod ? options.thermalMethod : forcedByRole.thermalMethod;
    mediaType = forcedByRole.mediaType;
    if (options.printDarkness == null && forcedByRole.printDarkness != null) {
      printDarkness = forcedByRole.printDarkness;
    }
  }

  const printSpeedIps = Number(options.printSpeedIps) || config.printSpeedIps || 6;

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etiquetas-zpl-'));
  try {
    const t0 = Date.now();
    const pngs = await renderPdfToPngPages(pdfPath, workDir, dpi);
    console.log(
      `[zpl] pages=${pngs.length} copies=${copies} dpi=${dpi} label=${widthMm || '?'}x${heightMm || '?'}mm role=${role || '-'} device=${device.name} uid=${device.uid} hw=${printMode || '-'}/${thermalMethod || '-'}/${mediaType || '-'}/MD${printDarkness ?? '-'} speed=${printSpeedIps}ips renderMs=${Date.now() - t0}`,
    );

    const batch = buildZplBatch(pngs, {
      dpi,
      widthMm,
      heightMm,
      copies,
      printMode,
      thermalMethod,
      mediaType,
      printSpeedIps,
      printDarkness,
    });

    for (const p of batch.pages) {
      console.log(
        `[zpl] page=${p.page}/${batch.pages.length} ${p.widthMm}x${p.heightMm}mm ^PW=${p.widthDots} ^LL=${p.heightDots}`,
      );
    }

    try {
      fs.writeFileSync(path.join(config.root, 'last-job.zpl'), batch.zpl, 'ascii');
    } catch {
      /* ignore */
    }

    if (config.dryRun) {
      return rememberJob({
        ok: true,
        engine: config.sendEngine || 'winspool',
        dryRun: true,
        dpi: batch.dpi,
        pages: pngs.length,
        widthDots: batch.widthDots,
        heightDots: batch.heightDots,
        widthMm: batch.widthMm,
        heightMm: batch.heightMm,
        printer: device.name,
        uid: device.uid,
        role,
      });
    }

    const sends = [];
    const jobs = batch.jobs || [];
    const engine = config.sendEngine || 'winspool';
    // Un solo envío con todo el ZPL cuando cabe.
    // Browser Print falla con lotes grandes (TypeError / ECONNRESET en /write):
    // partimos en chunks de BP_CHUNK_PAGES / BP_CHUNK_MAX_BYTES.
    // Opt-out total: PRINT_SEND_PER_LABEL=1.
    const useSingleDoc = !config.sendPerLabel && jobs.length >= 1;

    const md =
      printDarkness != null && Number.isFinite(Number(printDarkness))
        ? Math.max(-30, Math.min(30, Math.round(Number(printDarkness))))
        : null;
    const preamble = [
      '^XA',
      printMode === 'cutter' ? '^MMC' : '^MMT',
      thermalMethod === 'direct' ? '^MTD' : '^MTT',
      mediaType === 'continuous' ? '^MNN' : '^MNY',
      `^PR${Math.round(printSpeedIps)}`,
      ...(md != null ? [`^MD${md}`] : []),
      `^PW${batch.widthDots}`,
      `^LL${batch.heightDots}`,
      '^JUS',
      '^XZ',
      '',
    ].join('\r\n');

    function buildCombined(jobSlice) {
      return `${preamble}${jobSlice.map((j) => j.zpl).join('')}`;
    }

    async function sendLabelZplRetry(payload, label = 'send') {
      try {
        return await sendLabelZpl(payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[zpl] ${label} fallo, reintento en 1s: ${msg}`);
        await sleep(1000);
        return sendLabelZpl(payload);
      }
    }

    function splitBpChunks(allJobs) {
      const maxPages = Number(config.bpChunkPages) || 8;
      const maxBytes = Number(config.bpChunkMaxBytes) || 350_000;
      const chunks = [];
      let cur = [];
      let curBytes = preamble.length;
      for (const job of allJobs) {
        const jobBytes = Number(job.zplBytes) || String(job.zpl || '').length;
        const wouldExceed =
          cur.length > 0 &&
          (cur.length >= maxPages || curBytes + jobBytes > maxBytes);
        if (wouldExceed) {
          chunks.push(cur);
          cur = [];
          curBytes = preamble.length;
        }
        cur.push(job);
        curBytes += jobBytes;
      }
      if (cur.length) chunks.push(cur);
      return chunks;
    }

    const combinedFull = `${preamble}${batch.zpl}`;
    const needsBpChunk =
      useSingleDoc &&
      (engine === 'browser-print' || engine === 'auto') &&
      (jobs.length > (Number(config.bpChunkPages) || 8) ||
        combinedFull.length > (Number(config.bpChunkMaxBytes) || 350_000));

    if (useSingleDoc && !needsBpChunk) {
      console.log(
        `[zpl] send BATCH pages=${jobs.length} bytes=${combinedFull.length} engine=${engine} «${preferred}» ^PW=${batch.widthDots} ^LL=${batch.heightDots}`,
      );
      const tSend = Date.now();
      const send = await sendLabelZplRetry({
        zpl: combinedFull,
        preferred,
        role,
        device,
      }, 'batch');
      sends.push(send);
      console.log(
        `[zpl] OK batch method=${send.method} device=${send.device || send.printer} conn=${send.connection || '-'} sendMs=${Date.now() - tSend}`,
      );
    } else if (useSingleDoc && needsBpChunk) {
      const chunks = splitBpChunks(jobs);
      console.log(
        `[zpl] send CHUNKED pages=${jobs.length} chunks=${chunks.length} maxPages=${config.bpChunkPages} maxBytes=${config.bpChunkMaxBytes} engine=${engine}`,
      );
      for (let c = 0; c < chunks.length; c += 1) {
        const slice = chunks[c];
        const combined = buildCombined(slice);
        console.log(
          `[zpl] chunk ${c + 1}/${chunks.length} pages=${slice.length} bytes=${combined.length} «${preferred}»`,
        );
        const tSend = Date.now();
        const send = await sendLabelZplRetry({
          zpl: combined,
          preferred,
          role,
          device,
        }, `chunk ${c + 1}/${chunks.length}`);
        sends.push(send);
        console.log(
          `[zpl] OK chunk ${c + 1}/${chunks.length} method=${send.method} sendMs=${Date.now() - tSend}`,
        );
        if (c < chunks.length - 1) {
          const gapMs = Number(config.bpChunkGapMs) || 1200;
          const drainPer = Number(config.bpDrainMsPerPage) || 450;
          const drainMs = Math.max(gapMs, slice.length * drainPer);
          console.log(
            `[zpl] cola: espera ${drainMs}ms (gap=${gapMs} drain=${drainPer}×${slice.length}) antes del siguiente trozo`,
          );
          await sleep(drainMs);
        }
      }
    } else {
      const gapMs =
        printMode === 'cutter' ? Number(config.cutterGapMs) || 900 : Number(config.pageGapMs) || 0;
      for (let i = 0; i < jobs.length; i += 1) {
        const job = jobs[i];
        console.log(
          `[zpl] send ${i + 1}/${jobs.length} engine=${engine} «${preferred}» role=${role || '-'} ^PW=${job.widthDots} ^LL=${job.heightDots} zplBytes=${job.zplBytes || job.zpl.length}`,
        );
        const tSend = Date.now();
        const send = await sendLabelZplRetry({
          zpl: job.zpl,
          preferred,
          role,
          device,
        }, `page ${i + 1}/${jobs.length}`);
        sends.push(send);
        console.log(
          `[zpl] OK page=${job.page} method=${send.method} device=${send.device || send.printer} conn=${send.connection || '-'} sendMs=${Date.now() - tSend}`,
        );
        if (gapMs > 0 && i < jobs.length - 1) {
          await sleep(gapMs);
        }
      }
    }

    const lastSend = sends[sends.length - 1] || null;
    return rememberJob({
      ok: true,
      engine: lastSend?.method || config.sendEngine || 'winspool',
      mode: 'ZPL II',
      dpi: batch.dpi,
      pages: pngs.length,
      labels: pngs.length,
      jobs: sends.length,
      widthMm: batch.widthMm,
      heightMm: batch.heightMm,
      widthDots: batch.widthDots,
      heightDots: batch.heightDots,
      printer: lastSend?.printer || lastSend?.device || device.name,
      uid: device.uid,
      role,
      send: lastSend,
      sends,
      pagesMeta: batch.pages,
      totalMs: Date.now() - t0,
      batchMode: useSingleDoc,
    });
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function printTestLabel(options = {}) {
  const dpi = Number(options.dpi) || config.printDpi;
  const widthMm = Number(options.widthMm) || 100;
  const heightMm = Number(options.heightMm) || 150;
  const labels = Math.max(1, Math.min(10, Number(options.labels) || 1));
  const mode = String(options.mode || 'text').toLowerCase() === 'graphic' ? 'graphic' : 'text';
  const widthDots = Math.round((widthMm / 25.4) * dpi);
  const heightDots = Math.round((heightMm / 25.4) * dpi);
  const preferred = options.printerName || config.printerName;

  const device = await resolveDevice(preferred);
  const role = device.role || roleFromHint(preferred) || 'TEST';

  if (config.dryRun) {
    return rememberJob({
      ok: true,
      dryRun: true,
      test: true,
      mode,
      role,
      labels,
      widthMm,
      heightMm,
      widthDots,
      heightDots,
      printer: device.name,
      uid: device.uid,
    });
  }

  const sends = [];
  for (let i = 0; i < labels; i += 1) {
    let zpl;
    if (mode === 'graphic') {
      const bytesPerRow = Math.ceil(widthDots / 8);
      const totalBytes = bytesPerRow * heightDots;
      const bitmap = Buffer.alloc(totalBytes, 0x00);
      const setPx = (x, y) => {
        if (x < 0 || y < 0 || x >= widthDots || y >= heightDots) return;
        bitmap[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      };
      for (let x = 20; x < widthDots - 20; x += 1) {
        for (let t = 0; t < 4; t += 1) {
          setPx(x, 20 + t);
          setPx(x, heightDots - 24 + t);
        }
      }
      for (let y = 20; y < heightDots - 20; y += 1) {
        for (let t = 0; t < 4; t += 1) {
          setPx(20 + t, y);
          setPx(widthDots - 24 + t, y);
        }
      }
      for (let y = 80; y < heightDots - 80; y += 40) {
        for (let x = 40; x < widthDots - 40; x += 1) {
          setPx(x, y);
          setPx(x, y + 1);
        }
      }
      const graphicData = encodeBitmapZ64(bitmap);
      zpl = [
        '^XA',
        '^PON',
        '^LRN',
        '^LH0,0',
        `^PW${widthDots}`,
        `^LL${heightDots}`,
        `^FO0,0^GFA,${totalBytes},${totalBytes},${bytesPerRow},${graphicData}^FS`,
        `^FO40,50^A0N,50,50^FDGFA ${i + 1}/${labels}^FS`,
        `^FO40,120^A0N,28,28^FD${widthMm}x${heightMm}mm^FS`,
        '^PQ1,0,1,Y',
        '^XZ',
        '',
      ].join('\r\n');
    } else {
      zpl = [
        '^XA',
        '^PON',
        '^LRN',
        '^LH0,0',
        '^LS0',
        '^LT0',
        `^PW${widthDots}`,
        `^LL${heightDots}`,
        `^FO20,20^GB${widthDots - 40},${heightDots - 40},4^FS`,
        `^FO40,50^A0N,70,70^FD${role} ${i + 1}/${labels}^FS`,
        `^FO40,140^A0N,32,32^FD${config.sendEngine || 'winspool'}^FS`,
        `^FO40,190^A0N,28,28^FD${device.name || '-'} ^FS`,
        `^FO40,240^A0N,24,24^FD${widthMm}x${heightMm}mm  ${dpi}dpi^FS`,
        '^PQ1,0,1,Y',
        '^XZ',
        '',
      ].join('\r\n');
    }

    console.log(
      `[test] send ${i + 1}/${labels} mode=${mode} preferred=${preferred} ^PW=${widthDots} ^LL=${heightDots} zplBytes=${zpl.length}`,
    );
    const send = await sendLabelZpl({
      zpl,
      preferred,
      role,
      device,
    });
    sends.push(send);
  }

  return rememberJob({
    ok: true,
    test: true,
    mode,
    role,
    labels,
    widthMm,
    heightMm,
    widthDots,
    heightDots,
    dpi,
    printer: sends[sends.length - 1]?.printer || device.name,
    uid: device.uid,
    send: sends[sends.length - 1] || null,
    sends,
  });
}

module.exports = {
  printPdfZpl,
  printTestLabel,
  resolvePortAndPrinter,
  clearDetectCache,
  getLastJob,
};
