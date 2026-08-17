'use strict';

/**
 * Agente de impresión Zebra — PDF→ZPL→Zebra Browser Print.
 * Panel: http://<IP-PC>:9120/
 * Browser Print usa 9100/9101 — este agente NO debe usar esos puertos.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const { config, stockSizeMm, paperNameForStock } = require('./lib/config');
const {
  getBrowserPrintHealth,
  listDevices,
  saveUsbRoleMap,
  loadUsbRoleMap,
} = require('./lib/browser-print');
const {
  printPdfZpl,
  printTestLabel,
  resolvePortAndPrinter,
  clearDetectCache,
  getLastJob,
} = require('./lib/print-zpl');

const startedAt = Date.now();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, _file, cb) => {
      cb(null, `etiquetas-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
    },
  }),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
      return;
    }
    cb(new Error('Solo se aceptan archivos PDF'));
  },
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function buildStatus() {
  const bp = await getBrowserPrintHealth();
  const resolved = await resolvePortAndPrinter(config.printerName);
  const usbRoleMap = bp.usbRoleMap || loadUsbRoleMap();
  return {
    ok: true,
    service: 'etiquetas-print-agent',
    engine: 'browser-print',
    dpi: config.printDpi,
    printer: resolved.printer || config.printerName,
    uid: resolved.uid || null,
    role: resolved.role || null,
    usbRoleMap,
    browserPrint: {
      reachable: bp.reachable,
      url: bp.url,
      deviceCount: bp.deviceCount,
      error: bp.error || null,
      defaultDevice: bp.defaultDevice,
      usbRoleMap,
      usbCount: bp.usbCount ?? 0,
      driverCount: bp.driverCount ?? 0,
    },
    devices: bp.devices || [],
    dryRun: config.dryRun,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    config: {
      host: config.host,
      port: config.port,
      printerName: config.printerName,
      browserPrintUrl: config.browserPrintUrl,
      printDpi: config.printDpi,
      printSpeedIps: config.printSpeedIps,
      sendPerLabel: config.sendPerLabel,
      dryRun: config.dryRun,
    },
    lastJob: getLastJob(),
  };
}

app.get('/health', async (_req, res) => {
  try {
    const s = await buildStatus();
    const usbPrinters = (s.devices || [])
      .filter((d) => String(d.connection || '').toLowerCase() === 'usb')
      .map((d) => d.uid || d.name)
      .filter(Boolean);
    res.json({
      ok: s.ok && s.browserPrint.reachable,
      service: s.service,
      engine: s.engine,
      dpi: s.dpi,
      printer: s.printer,
      // Compatibilidad con servidores anteriores, que sincronizan este arreglo.
      printers: [...new Set(usbPrinters)],
      browserPrint: s.browserPrint,
      devices: (s.devices || []).map((d) => ({
        name: d.name,
        uid: d.uid,
        role: d.role,
        connection: d.connection,
      })),
      dryRun: s.dryRun,
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get('/api/status', async (_req, res) => {
  try {
    res.json(await buildStatus());
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get('/printers', async (_req, res) => {
  try {
    const devices = await listDevices();
    res.json({
      ok: true,
      printers: devices.map((d) => ({
        name: d.name,
        uid: d.uid,
        role: d.role,
        connection: d.connection,
      })),
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/refresh', async (_req, res) => {
  try {
    clearDetectCache();
    const bp = await getBrowserPrintHealth();
    const resolved = await resolvePortAndPrinter(config.printerName);
    res.json({
      ok: bp.reachable,
      printer: resolved.printer,
      uid: resolved.uid,
      role: resolved.role,
      devices: bp.devices || [],
      browserPrint: bp,
      usbRoleMap: loadUsbRoleMap(),
    });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/** Guarda UID USB por rol. Body: { ADHESIVO: "52n…", PAPEL: "52j…" } */
app.post('/api/usb-map', (req, res) => {
  try {
    const adhesivo =
      typeof req.body?.ADHESIVO === 'string' ? req.body.ADHESIVO.trim() : '';
    const papel = typeof req.body?.PAPEL === 'string' ? req.body.PAPEL.trim() : '';
    if (!adhesivo && !papel) {
      res.status(400).json({ error: 'Indica ADHESIVO y/o PAPEL (UID USB)' });
      return;
    }
    const map = saveUsbRoleMap({ ADHESIVO: adhesivo, PAPEL: papel });
    clearDetectCache();
    res.json({ ok: true, usbRoleMap: map });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/test-print', async (req, res) => {
  try {
    const widthMm = Number(req.body?.widthMm) || 100;
    const heightMm = Number(req.body?.heightMm) || 150;
    const labels = Number(req.body?.labels) || 1;
    const mode = typeof req.body?.mode === 'string' ? req.body.mode : 'text';
    const printerName =
      typeof req.body?.printerName === 'string' ? req.body.printerName.trim() : '';
    const result = await printTestLabel({
      widthMm,
      heightMm,
      labels,
      mode,
      printerName: printerName || undefined,
    });
    res.json({ ok: true, print: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[test-print] error:', message);
    res.status(502).json({ error: message });
  }
});

app.post('/print', upload.single('file'), async (req, res) => {
  const tempPath = req.file?.path;
  try {
    if (!tempPath) {
      res.status(400).json({ error: 'Falta el PDF (campo multipart "file")' });
      return;
    }

    const copies = Math.max(1, Math.min(99, Number(req.body?.copies) || 1));
    const stockSize = typeof req.body?.stockSize === 'string' ? req.body.stockSize.trim() : '';
    const paperFromBody =
      typeof req.body?.paperName === 'string' ? req.body.paperName.trim() : '';
    const printerFromBody =
      typeof req.body?.printerName === 'string' ? req.body.printerName.trim() : '';
    const printMode = req.body?.printMode === 'cutter' ? 'cutter' : 'tear';
    const thermalMethod = req.body?.thermalMethod === 'transfer' ? 'transfer' : 'direct';
    const mediaType = req.body?.mediaType === 'continuous' ? 'continuous' : 'gap';

    const stockMm = stockSizeMm(stockSize);
    const paperName = paperFromBody || paperNameForStock(stockSize);
    if (!paperName && !stockSize) {
      res.status(400).json({
        error:
          'Falta paperName o stockSize válido (producto-terminado, producto-conforme, conforme-papel, carpinteria).',
      });
      return;
    }

    // El tamaño mm sale del PDF (plantilla). El stock solo elige papel/impresora/hardware.
    const widthMm = Number(req.body?.widthMm) || undefined;
    const heightMm = Number(req.body?.heightMm) || undefined;

    console.log(
      `[print] printer="${printerFromBody || config.printerName}" paper="${paperName || '-'}" stock="${stockSize || '-'}" size=${widthMm || 'pdf'}x${heightMm || 'pdf'}mm copies=${copies} mode=${printMode} thermal=${thermalMethod} media=${mediaType} dryRun=${config.dryRun}`,
    );

    const result = await printPdfZpl(tempPath, {
      printerName: printerFromBody || config.printerName,
      copies,
      widthMm,
      heightMm,
      dpi: config.printDpi,
      stockSize,
      printMode,
      thermalMethod,
      mediaType,
      printSpeedIps: config.printSpeedIps,
    });

    res.json({
      ok: true,
      engine: 'browser-print',
      printer: result.printer,
      uid: result.uid,
      role: result.role,
      paperName,
      stockSize: stockSize || null,
      copies,
      form: {
        name: paperName,
        widthMm: result.widthMm ?? stockMm?.widthMm,
        heightMm: result.heightMm ?? stockMm?.heightMm,
      },
      print: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[print] error:', message);
    res.status(502).json({ error: `No se pudo imprimir: ${message}` });
  } finally {
    if (tempPath) fs.promises.unlink(tempPath).catch(() => {});
  }
});

app.use((error, _req, res, _next) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(400).json({ error: message });
});

if (config.port === 9100 || config.port === 9101) {
  console.error(
    `ERROR: PORT=${config.port} está reservado por Zebra Browser Print. Pon PORT=9120 en .env y reinicia.`,
  );
  process.exit(1);
}

const server = app.listen(config.port, config.host, async () => {
  console.log(`Print agent listening on http://${config.host}:${config.port}`);
  console.log(`Panel UI: http://127.0.0.1:${config.port}/`);
  console.log(`Engine: Browser Print + ZPL @ ${config.printDpi} dpi`);
  console.log(`Browser Print URL: ${config.browserPrintUrl}`);
  console.log(`Printer hint: ${config.printerName}`);
  try {
    const bp = await getBrowserPrintHealth();
    if (bp.reachable) {
      console.log(`Browser Print OK — devices=${bp.deviceCount}`);
      for (const d of bp.devices || []) {
        console.log(`  [${d.role || '?'}] ${d.name} (${d.uid}) ${d.connection}`);
      }
    } else {
      console.warn(`Browser Print OFFLINE: ${bp.error}`);
      console.warn('Instala Zebra Browser Print y deja el icono Zebra en la bandeja.');
    }
  } catch (err) {
    console.warn('Browser Print check falló:', err instanceof Error ? err.message : err);
  }
  if (config.dryRun) console.log('PRINT_DRY_RUN=1 — no se enviará a la impresora');
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `ERROR: el puerto ${config.port} ya está en uso. Si es 9100/9101, cámbialo a 9120 en .env (Browser Print usa esos).`,
    );
  } else {
    console.error('ERROR al escuchar:', err);
  }
  process.exit(1);
});
