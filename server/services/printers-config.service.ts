import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { LABEL_STOCK_SIZES, LabelStockSizeCode } from '../config/constants';

export interface ConfiguredPrinter {
  windowsName: string;
  label: string;
  visible: boolean;
  /** Si vacío, aparece para todos los stocks. */
  stocks: LabelStockSizeCode[];
}

export interface ConfiguredAgent {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  printers: ConfiguredPrinter[];
}

/** Impresora referenciada desde una estación (agente + nombre Windows/UID). */
export interface StationPrinterRef {
  agentId: string;
  windowsName: string;
}

/**
 * Estación de trabajo: ligada a un agente; varias IPs de operarios
 * ven las impresoras visibles de ese agente (las marcadas en la estación).
 */
export interface ConfiguredStation {
  id: string;
  code: string;
  name: string;
  /** Agente (PC print-agent) de esta estación. */
  agentId: string;
  /** IPs de las PCs operario que usan esta estación. */
  clientIps: string[];
  printers: StationPrinterRef[];
}

export interface PrintersConfig {
  agents: ConfiguredAgent[];
  stations: ConfiguredStation[];
}

export interface AvailablePrinter {
  agentId: string;
  agentName: string;
  agentUrl: string;
  windowsName: string;
  label: string;
  stocks: LabelStockSizeCode[];
  online: boolean;
  /** true si no tiene filtro de stock o incluye el stock pedido */
  matchesStock: boolean;
  dryRun?: boolean;
  agentError?: string;
  stationCode?: string;
}

function resolveDataDir(): string {
  const fromEnv = String(process.env.PRINTERS_CONFIG_DIR || '').trim();
  if (fromEnv) return fromEnv;
  return join(process.cwd(), 'data');
}

const DATA_DIR = resolveDataDir();
const CONFIG_PATH = join(DATA_DIR, 'printers-config.json');

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}

function slugId(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/https?:\/\//g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || `agent-${Date.now()}`
  );
}

export function normalizeClientIp(raw: string | undefined | null): string {
  let ip = String(raw || '')
    .trim()
    .toLowerCase();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  // "ip:port" raros
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.split(':')[0];
  return ip;
}

export function printerKey(agentId: string, windowsName: string): string {
  return `${String(agentId).trim().toLowerCase()}::${String(windowsName).trim().toLowerCase()}`;
}

export function findStationForClientIp(
  stations: ConfiguredStation[],
  clientIp: string | undefined | null,
): ConfiguredStation | undefined {
  return findStationsForClientIp(stations, clientIp)[0];
}

/** Todas las estaciones que incluyen la IP (una IP puede estar en varias). */
export function findStationsForClientIp(
  stations: ConfiguredStation[],
  clientIp: string | undefined | null,
): ConfiguredStation[] {
  const ip = normalizeClientIp(clientIp);
  if (!ip) return [];
  return stations.filter((st) =>
    (st.clientIps || []).some((entry) => normalizeClientIp(entry) === ip),
  );
}

function normalizeStation(raw: Partial<ConfiguredStation>, index: number): ConfiguredStation {
  const code = String(raw.code || raw.name || `ST-${index + 1}`)
    .trim()
    .toUpperCase();
  const id =
    String(raw.id || '').trim() ||
    slugId(code) ||
    `station-${index + 1}`;
  const ips = Array.isArray(raw.clientIps)
    ? [
        ...new Set(
          raw.clientIps
            .map((ip) => normalizeClientIp(ip))
            .filter(Boolean),
        ),
      ]
    : [];
  const rawPrinters = Array.isArray(raw.printers)
    ? raw.printers
        .filter((p) => p?.agentId && p?.windowsName)
        .map((p) => ({
          agentId: String(p.agentId).trim(),
          windowsName: String(p.windowsName).trim(),
        }))
    : [];

  // Migración: sin agentId → inferir del primer ref de impresora.
  let agentId = String(raw.agentId || '').trim();
  if (!agentId && rawPrinters.length > 0) {
    agentId = rawPrinters[0].agentId;
  }

  const printers = agentId
    ? rawPrinters
        .filter((p) => p.agentId === agentId)
        .map((p) => ({ agentId, windowsName: p.windowsName }))
    : [];

  return {
    id,
    code,
    name: String(raw.name || code).trim(),
    agentId,
    clientIps: ips,
    printers,
  };
}

function defaultConfig(): PrintersConfig {
  const url = normalizeUrl(process.env.PRINT_AGENT_URL || 'http://192.168.80.89:9120');
  return {
    agents: [
      {
        id: slugId(url) || 'pc-89',
        name: 'Agente principal',
        url,
        enabled: true,
        printers: [],
      },
    ],
    stations: [],
  };
}

function ensureConfigFile(): PrintersConfig {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!existsSync(CONFIG_PATH)) {
    const seed = defaultConfig();
    writeFileSync(CONFIG_PATH, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
  return readConfig();
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function readConfig(): PrintersConfig {
  if (!existsSync(CONFIG_PATH)) {
    return ensureConfigFile();
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as PrintersConfig;
    if (!parsed || !Array.isArray(parsed.agents)) {
      return defaultConfig();
    }
    return {
      agents: parsed.agents.map((agent) => ({
        id: String(agent.id || slugId(agent.url || 'agent')),
        name: String(agent.name || agent.id || 'Agente'),
        url: normalizeUrl(String(agent.url || '')),
        enabled: agent.enabled !== false,
        printers: Array.isArray(agent.printers)
          ? agent.printers.map((p) => ({
              windowsName: String(p.windowsName || ''),
              label: String(p.label || p.windowsName || ''),
              visible: Boolean(p.visible),
              stocks: Array.isArray(p.stocks)
                ? (p.stocks.filter((s) => s in LABEL_STOCK_SIZES) as LabelStockSizeCode[])
                : [],
            }))
          : [],
      })),
      stations: Array.isArray(parsed.stations)
        ? parsed.stations.map((st, i) => normalizeStation(st, i))
        : [],
    };
  } catch {
    return defaultConfig();
  }
}

export function writeConfig(config: PrintersConfig): PrintersConfig {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  const normalized: PrintersConfig = {
    agents: (config.agents || []).map((agent) => ({
      id: String(agent.id || slugId(agent.url)).trim(),
      name: String(agent.name || 'Agente').trim(),
      url: normalizeUrl(String(agent.url || '')),
      enabled: agent.enabled !== false,
      printers: (agent.printers || [])
        .filter((p) => p.windowsName?.trim())
        .map((p) => ({
          windowsName: p.windowsName.trim(),
          label: (p.label || p.windowsName).trim(),
          visible: Boolean(p.visible),
          stocks: Array.isArray(p.stocks)
            ? (p.stocks.filter((s) => s in LABEL_STOCK_SIZES) as LabelStockSizeCode[])
            : [],
        })),
    })),
    stations: (config.stations || []).map((st, i) => normalizeStation(st, i)),
  };

  for (const agent of normalized.agents) {
    if (!agent.id) throw new Error('Cada agente necesita un id');
    if (!agent.url) throw new Error(`El agente «${agent.name}» necesita URL`);
  }

  const ids = normalized.agents.map((a) => a.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Hay ids de agente duplicados');
  }

  const stationIds = normalized.stations.map((s) => s.id);
  if (new Set(stationIds).size !== stationIds.length) {
    throw new Error('Hay ids de estación duplicados');
  }
  const stationCodes = normalized.stations.map((s) => s.code.toUpperCase());
  if (new Set(stationCodes).size !== stationCodes.length) {
    throw new Error('Hay códigos de estación duplicados');
  }

  const agentIdSet = new Set(normalized.agents.map((a) => a.id));
  for (const st of normalized.stations) {
    if (!st.agentId) {
      throw new Error(`La estación «${st.code}» necesita un agente`);
    }
    if (!agentIdSet.has(st.agentId)) {
      throw new Error(`La estación «${st.code}» apunta a un agente inexistente`);
    }
    for (const p of st.printers) {
      if (p.agentId !== st.agentId) {
        throw new Error(
          `La estación «${st.code}» solo puede usar impresoras del agente asignado`,
        );
      }
    }
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

export function getAgentById(agentId: string): ConfiguredAgent | undefined {
  return readConfig().agents.find((a) => a.id === agentId);
}

export function mergeSyncedPrinters(
  agent: ConfiguredAgent,
  windowsPrinters: string[],
): ConfiguredAgent {
  const existing = new Map(agent.printers.map((p) => [p.windowsName.toLowerCase(), p]));
  const next: ConfiguredPrinter[] = [];

  for (const name of windowsPrinters) {
    const key = name.toLowerCase();
    const prev = existing.get(key);
    if (prev) {
      next.push(prev);
      existing.delete(key);
    } else {
      next.push({
        windowsName: name,
        label: name,
        visible: false,
        stocks: [],
      });
    }
  }

  for (const leftover of existing.values()) {
    next.push(leftover);
  }

  return { ...agent, printers: next };
}

/** Inicializa el archivo si no existe (llamar al arranque). */
export function initPrintersConfig(): PrintersConfig {
  return ensureConfigFile();
}
