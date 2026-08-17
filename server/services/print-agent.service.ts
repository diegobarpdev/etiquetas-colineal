import { getDriverPaperName, listDriverPaperNames } from '../config/constants';

const DEFAULT_AGENT_URL = 'http://192.168.80.89:9120';
/** Base si no hay env; lotes grandes se escalan por tamaño de PDF. */
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 1_200_000;

export function getDefaultPrintAgentUrl(): string {
  return (process.env.PRINT_AGENT_URL || DEFAULT_AGENT_URL).replace(/\/$/, '');
}

/** Etiquetas por PDF enviado al agente (cola: varios trozos seguidos). */
export function getLabelPrintChunkSize(): number {
  const raw = Number(process.env.PRINT_LABEL_CHUNK_SIZE);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(60, Math.max(5, Math.floor(raw)));
  }
  return 30;
}

/** Pausa corta entre trozos (ms). La cola sigue; no hace falta esperar tanto. */
export function getLabelPrintChunkGapMs(): number {
  const raw = Number(process.env.PRINT_CHUNK_GAP_MS);
  if (Number.isFinite(raw) && raw >= 0) {
    return Math.min(30_000, Math.floor(raw));
  }
  return 400;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Timeout HTTP hacia el agente: respeta PRINT_AGENT_TIMEOUT_MS como mínimo
 * y escala con el tamaño del PDF (render ZPL + chunks BP tardan minutos).
 */
export function getPrintAgentTimeoutMs(pdfBytes = 0): number {
  const raw = Number(process.env.PRINT_AGENT_TIMEOUT_MS);
  const envBase = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
  const mb = Math.max(0, pdfBytes) / (1024 * 1024);
  // ~45s por MB de PDF + 2 min de margen (render + cola USB)
  const scaled = Math.ceil(120_000 + mb * 45_000);
  return Math.min(MAX_TIMEOUT_MS, Math.max(envBase, scaled, DEFAULT_TIMEOUT_MS));
}

function getTimeoutMs(): number {
  return getPrintAgentTimeoutMs(0);
}

function normalizeAgentUrl(url?: string | null): string {
  const raw = (url || getDefaultPrintAgentUrl()).trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error(`URL de agente inválida: ${raw}`);
  }
  return raw;
}

export interface PrintAgentHealth {
  ok: boolean;
  reachable: boolean;
  agentUrl: string;
  printer?: string;
  printerFound?: boolean;
  printers?: string[];
  paperNames?: string[];
  papers?: Record<string, string>;
  configuredPrinters?: string[];
  missingPrinters?: string[];
  dryRun?: boolean;
  error?: string;
}

export function extractPrinterNames(data: Record<string, unknown>): string[] {
  if (Array.isArray(data.printers)) {
    const legacy = data.printers
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);
    if (legacy.length) return [...new Set(legacy)];
  }

  if (!Array.isArray(data.devices)) return [];
  const usbDevices = data.devices.filter(
    (value): value is Record<string, unknown> =>
      Boolean(value) &&
      typeof value === 'object' &&
      String((value as Record<string, unknown>).connection || '').toLowerCase() === 'usb',
  );
  return [
    ...new Set(
      usbDevices
        .map((device) => {
          const uid = typeof device.uid === 'string' ? device.uid.trim() : '';
          const name = typeof device.name === 'string' ? device.name.trim() : '';
          return uid || name;
        })
        .filter(Boolean),
    ),
  ];
}

export async function getPrintAgentStatus(agentUrl?: string): Promise<PrintAgentHealth> {
  let url: string;
  try {
    url = normalizeAgentUrl(agentUrl);
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      agentUrl: String(agentUrl || ''),
      error: error instanceof Error ? error.message : String(error),
      paperNames: listDriverPaperNames(),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(getTimeoutMs(), 8_000));

  try {
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    if (!res.ok) {
      return {
        ok: false,
        reachable: true,
        agentUrl: url,
        error: `Agente respondió HTTP ${res.status}`,
        paperNames: listDriverPaperNames(),
      };
    }

    const data = (await res.json()) as Record<string, unknown>;
    return {
      ok: Boolean(data.ok),
      reachable: true,
      agentUrl: url,
      printer: typeof data.printer === 'string' ? data.printer : undefined,
      printerFound: typeof data.printerFound === 'boolean' ? data.printerFound : undefined,
      printers: extractPrinterNames(data),
      paperNames: Array.isArray(data.paperNames)
        ? (data.paperNames as string[])
        : listDriverPaperNames(),
      papers:
        data.papers && typeof data.papers === 'object'
          ? (data.papers as Record<string, string>)
          : undefined,
      configuredPrinters: Array.isArray(data.configuredPrinters)
        ? (data.configuredPrinters as string[])
        : undefined,
      missingPrinters: Array.isArray(data.missingPrinters)
        ? (data.missingPrinters as string[])
        : undefined,
      dryRun: typeof data.dryRun === 'boolean' ? data.dryRun : undefined,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'Tiempo de espera agotado al contactar el agente'
          : error.message
        : String(error);
    return {
      ok: false,
      reachable: false,
      agentUrl: url,
      error: message,
      paperNames: listDriverPaperNames(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface SendPdfToAgentOptions {
  pdf: Buffer;
  stockSize: string;
  copies?: number;
  filename?: string;
  printerName?: string;
  /** URL del agente de la PC destino. */
  agentUrl?: string;
  /** Modo de impresión Zebra: tear-off o cortadora. */
  printMode?: 'tear' | 'cutter';
  /** Método térmico: transferencia o directa. */
  thermalMethod?: 'transfer' | 'direct';
  /** Tipo de medio: muesca/gap o continua. */
  mediaType?: 'gap' | 'continuous';
  widthMm?: number;
  heightMm?: number;
}

export interface SendPdfToAgentResult {
  ok: true;
  paperName: string;
  stockSize: string;
  copies: number;
  printer?: string;
  agentUrl: string;
  dryRun?: boolean;
}

export async function sendPdfToPrintAgent(
  options: SendPdfToAgentOptions,
): Promise<SendPdfToAgentResult> {
  const agentUrl = normalizeAgentUrl(options.agentUrl);
  const copies = Math.max(1, Math.min(99, Number(options.copies) || 1));
  const paperName = getDriverPaperName(options.stockSize);
  const filename = options.filename || 'etiquetas.pdf';

  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(options.pdf)], { type: 'application/pdf' }),
    filename,
  );
  form.append('copies', String(copies));
  form.append('paperName', paperName);
  form.append('stockSize', options.stockSize);
  if (options.printerName?.trim()) {
    form.append('printerName', options.printerName.trim());
  }
  if (options.printMode) form.append('printMode', options.printMode);
  if (options.thermalMethod) form.append('thermalMethod', options.thermalMethod);
  if (options.mediaType) form.append('mediaType', options.mediaType);
  if (options.widthMm) form.append('widthMm', String(options.widthMm));
  if (options.heightMm) form.append('heightMm', String(options.heightMm));

  const controller = new AbortController();
  const timeoutMs = getPrintAgentTimeoutMs(options.pdf.length);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${agentUrl}/print`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const error =
        typeof payload.error === 'string'
          ? payload.error
          : `Agente de impresión respondió HTTP ${res.status}`;
      throw new Error(error);
    }

    return {
      ok: true,
      paperName,
      stockSize: options.stockSize,
      copies,
      printer: typeof payload.printer === 'string' ? payload.printer : undefined,
      agentUrl,
      dryRun: Boolean(payload.dryRun),
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Tiempo de espera agotado (${Math.round(timeoutMs / 1000)}s) al enviar a ${agentUrl}. ¿Está encendido el agente en la PC USB?`,
      );
    }
    if (error instanceof TypeError) {
      throw new Error(
        `No se pudo contactar el agente en ${agentUrl}. Verifica que esté corriendo en la PC de la Zebra.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
