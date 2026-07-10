const STORAGE_KEY = 'colineal-printer-settings';
const BROWSER_PRINT_SCRIPT = 'https://localhost:9100/ssl_script/BrowserPrint-3.1.250.min.js';

const DEFAULT_SETTINGS = {
  mode: 'system',
  printerName: '',
  printerUid: '',
  copies: 1,
};

let browserPrintReady = false;
let browserPrintError = null;
let zebraDevices = [];

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function loadBrowserPrintScript() {
  return new Promise((resolve, reject) => {
    if (window.BrowserPrint) {
      resolve(window.BrowserPrint);
      return;
    }

    const existing = document.querySelector('script[data-browser-print]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.BrowserPrint));
      existing.addEventListener('error', () =>
        reject(new Error('No se pudo cargar Zebra Browser Print')),
      );
      return;
    }

    const script = document.createElement('script');
    script.src = BROWSER_PRINT_SCRIPT;
    script.dataset.browserPrint = 'true';
    script.onload = () => {
      if (window.BrowserPrint) {
        resolve(window.BrowserPrint);
      } else {
        reject(new Error('Zebra Browser Print no está disponible'));
      }
    };
    script.onerror = () =>
      reject(
        new Error(
          'Zebra Browser Print no detectado. Instálalo desde zebra.com/browserprint',
        ),
      );
    document.head.appendChild(script);
  });
}

function listZebraPrinters() {
  return new Promise((resolve, reject) => {
    if (!window.BrowserPrint) {
      reject(new Error('Zebra Browser Print no está cargado'));
      return;
    }

    window.BrowserPrint.getLocalDevices(
      (devices) => {
        zebraDevices = devices || [];
        resolve(zebraDevices);
      },
      (error) => reject(error || new Error('Error al buscar impresoras Zebra')),
      'printer',
    );
  });
}

function findDeviceByUid(uid) {
  return zebraDevices.find((device) => device.uid === uid) || null;
}

function sendPdfToZebra(device, pdfUrl) {
  return new Promise((resolve, reject) => {
    if (typeof device.convertAndSendFile === 'function') {
      device.convertAndSendFile(
        pdfUrl,
        { action: 'print' },
        () => resolve(),
        (error) => reject(error || new Error('Error al enviar a la impresora')),
      );
      return;
    }

    if (typeof device.sendFile === 'function') {
      device.sendFile(
        pdfUrl,
        () => resolve(),
        (error) => reject(error || new Error('Error al enviar a la impresora')),
      );
      return;
    }

    reject(new Error('La impresora seleccionada no soporta envío de archivos'));
  });
}

function printPdfWithSystem(pdfUrl, printerName) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.title = 'Impresión de etiquetas';

    const cleanup = () => {
      frame.remove();
    };

    frame.onload = () => {
      try {
        const hint = printerName
          ? `Selecciona "${printerName}" en el diálogo de impresión.`
          : 'Selecciona tu impresora Zebra en el diálogo.';
        console.info(`[Impresión] ${hint}`);

        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve({ hint });
      } catch (error) {
        cleanup();
        reject(error);
      }

      setTimeout(cleanup, 60_000);
    };

    frame.onerror = () => {
      cleanup();
      reject(new Error('No se pudo cargar el PDF para imprimir'));
    };

    frame.src = pdfUrl;
    document.body.appendChild(frame);
  });
}

async function initZebraBrowserPrint() {
  browserPrintError = null;
  browserPrintReady = false;

  try {
    await loadBrowserPrintScript();
    await listZebraPrinters();
    browserPrintReady = true;
    return zebraDevices;
  } catch (error) {
    browserPrintError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

async function printPdf(pdfUrl, settings = loadSettings()) {
  const copies = Math.max(1, Number(settings.copies) || 1);

  if (settings.mode === 'zebra') {
    if (!browserPrintReady) {
      await initZebraBrowserPrint();
    }

    const device =
      findDeviceByUid(settings.printerUid) ||
      zebraDevices.find((entry) => entry.name === settings.printerName);

    if (!device) {
      throw new Error('Selecciona una impresora Zebra en la configuración');
    }

    for (let copy = 0; copy < copies; copy += 1) {
      await sendPdfToZebra(device, pdfUrl);
    }

    return { mode: 'zebra', device: device.name, copies };
  }

  for (let copy = 0; copy < copies; copy += 1) {
    await printPdfWithSystem(pdfUrl, settings.printerName);
  }

  return { mode: 'system', copies };
}

window.PrinterConfig = {
  STORAGE_KEY,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  initZebraBrowserPrint,
  listZebraPrinters,
  printPdf,
  get browserPrintReady() {
    return browserPrintReady;
  },
  get browserPrintError() {
    return browserPrintError;
  },
  get zebraDevices() {
    return zebraDevices;
  },
};
