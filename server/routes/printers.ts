import { Router, Request, Response } from 'express';
import { LABEL_STOCK_SIZES, LabelStockSizeCode } from '../config/constants';
import {
  clearAdminSession,
  createAdminSession,
  getAdminSessionStatus,
  requirePrintAdmin,
  verifyAdminPin,
} from '../services/print-admin-auth.service';
import { getPrintAgentStatus } from '../services/print-agent.service';
import {
  AvailablePrinter,
  ConfiguredAgent,
  findStationsForClientIp,
  getAgentById,
  mergeSyncedPrinters,
  normalizeClientIp,
  printerKey,
  PrintersConfig,
  readConfig,
  writeConfig,
} from '../services/printers-config.service';

const router = Router();

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

/** IP del navegador operario (soporta proxy / ::ffff: / X-Forwarded-For). */
export function getRequestClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    // Primer hop = cliente real (browser → front :3001 → API :3010)
    return normalizeClientIp(forwarded.split(',')[0]);
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return normalizeClientIp(forwarded[0]);
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return normalizeClientIp(realIp);
  }
  return normalizeClientIp(req.socket.remoteAddress || req.ip || '');
}

async function buildAvailablePrinters(
  stockSize?: string,
  clientIp?: string,
): Promise<{
  printers: AvailablePrinter[];
  stationCode: string | null;
  clientIp: string;
  stationRequired: boolean;
}> {
  const config = readConfig();
  const stock =
    stockSize && stockSize in LABEL_STOCK_SIZES
      ? (stockSize as LabelStockSizeCode)
      : undefined;

  const ip = normalizeClientIp(clientIp);
  const stations = config.stations || [];
  const stationRequired = stations.length > 0;
  const matchedStations = stationRequired
    ? findStationsForClientIp(stations, ip)
    : [];
  const allowedKeys =
    stationRequired && matchedStations.length > 0
      ? new Set(
          matchedStations.flatMap((st) =>
            st.printers.map((p) => printerKey(p.agentId, p.windowsName)),
          ),
        )
      : null;
  const stationCode =
    matchedStations.length > 0
      ? matchedStations.map((st) => st.code).join(', ')
      : null;

  const results: AvailablePrinter[] = [];

  // Sin estaciones configuradas → comportamiento anterior (todas las visibles).
  // Con estaciones y IP desconocida → lista vacía.
  if (stationRequired && matchedStations.length === 0) {
    return {
      printers: [],
      stationCode: null,
      clientIp: ip,
      stationRequired: true,
    };
  }

  await Promise.all(
    config.agents
      .filter((agent) => agent.enabled)
      .map(async (agent) => {
        const health = await getPrintAgentStatus(agent.url);
        for (const printer of agent.printers) {
          if (!printer.visible) continue;
          if (allowedKeys && !allowedKeys.has(printerKey(agent.id, printer.windowsName))) {
            continue;
          }
          const matchesStock =
            !stock ||
            printer.stocks.length === 0 ||
            printer.stocks.includes(stock);
          results.push({
            agentId: agent.id,
            agentName: agent.name,
            agentUrl: agent.url,
            windowsName: printer.windowsName,
            label: printer.label || printer.windowsName,
            stocks: printer.stocks,
            online: Boolean(health.reachable),
            matchesStock,
            dryRun: Boolean(health.dryRun),
            agentError: health.error,
            stationCode: stationCode || undefined,
          });
        }
      }),
  );

  results.sort((a, b) => {
    if (a.matchesStock !== b.matchesStock) return a.matchesStock ? -1 : 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.label.localeCompare(b.label, 'es');
  });

  return {
    printers: results,
    stationCode,
    clientIp: ip,
    stationRequired,
  };
}

router.post('/admin/printers/unlock', (req: Request, res: Response) => {
  if (!verifyAdminPin(req.body?.pin)) {
    res.status(401).json({ error: 'Clave incorrecta' });
    return;
  }
  createAdminSession(res);
  res.json({ ok: true, unlocked: true });
});

router.post('/admin/printers/lock', (req: Request, res: Response) => {
  clearAdminSession(req, res);
  res.json({ ok: true, unlocked: false });
});

router.get('/admin/printers/session', (req: Request, res: Response) => {
  res.json(getAdminSessionStatus(req));
});

router.get('/admin/printers/config', requirePrintAdmin, async (_req: Request, res: Response) => {
  const config = readConfig();
  const agents = await Promise.all(
    config.agents.map(async (agent) => {
      const health = await getPrintAgentStatus(agent.url);
      return {
        ...agent,
        status: {
          online: Boolean(health.reachable),
          reachable: health.reachable,
          healthy: Boolean(health.ok),
          error: health.error,
          windowsPrinters: health.printers || [],
        },
      };
    }),
  );
  res.json({
    agents,
    stations: config.stations || [],
    stockSizes: Object.keys(LABEL_STOCK_SIZES),
  });
});

router.put('/admin/printers/config', requirePrintAdmin, (req: Request, res: Response) => {
  try {
    const body = req.body as PrintersConfig;
    if (!body || !Array.isArray(body.agents)) {
      res.status(400).json({ error: 'Body inválido: se espera { agents: [...], stations?: [...] }' });
      return;
    }
    const saved = writeConfig({
      agents: body.agents,
      stations: Array.isArray(body.stations) ? body.stations : readConfig().stations,
    });
    res.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
  }
});

router.post('/admin/printers/agents', requirePrintAdmin, (req: Request, res: Response) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const url = typeof req.body?.url === 'string' ? req.body.url.trim().replace(/\/$/, '') : '';
    if (!name || !url) {
      res.status(400).json({ error: 'name y url son obligatorios' });
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      res.status(400).json({ error: 'La URL debe empezar con http:// o https://' });
      return;
    }

    const config = readConfig();
    let id =
      typeof req.body?.id === 'string' && req.body.id.trim()
        ? req.body.id.trim()
        : slugId(url);
    if (config.agents.some((a) => a.id === id)) {
      id = `${id}-${Date.now().toString(36)}`;
    }

    const agent: ConfiguredAgent = {
      id,
      name,
      url,
      enabled: req.body?.enabled !== false,
      printers: [],
    };
    config.agents.push(agent);
    const saved = writeConfig(config);
    res.status(201).json(saved.agents.find((a) => a.id === id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
  }
});

router.delete(
  '/admin/printers/agents/:agentId',
  requirePrintAdmin,
  (req: Request, res: Response) => {
    const config = readConfig();
    const agentId = String(req.params.agentId);
    const nextAgents = config.agents.filter((a) => a.id !== agentId);
    if (nextAgents.length === config.agents.length) {
      res.status(404).json({ error: 'Agente no encontrado' });
      return;
    }
    const stations = (config.stations || [])
      .filter((st) => st.agentId !== agentId)
      .map((st) => ({
        ...st,
        printers: st.printers.filter((p) => p.agentId !== agentId),
      }));
    const saved = writeConfig({ agents: nextAgents, stations });
    res.json(saved);
  },
);

router.post(
  '/admin/printers/agents/:agentId/sync',
  requirePrintAdmin,
  async (req: Request, res: Response) => {
    const agent = getAgentById(String(req.params.agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agente no encontrado' });
      return;
    }

    const health = await getPrintAgentStatus(agent.url);
    if (!health.reachable) {
      res.status(502).json({
        error: health.error || 'No se pudo contactar el agente',
        status: health,
      });
      return;
    }

    const windowsPrinters = health.printers || [];
    const merged = mergeSyncedPrinters(agent, windowsPrinters);
    const config = readConfig();
    const agents = config.agents.map((a) => (a.id === agent.id ? merged : a));
    const saved = writeConfig({ agents, stations: config.stations });

    res.json({
      agent: saved.agents.find((a) => a.id === agent.id),
      status: {
        online: Boolean(health.ok),
        reachable: health.reachable,
        error: health.error,
        windowsPrinters,
      },
    });
  },
);

/** Lista pública para la UI de impresión (solo visibles + filtro por estación/IP). */
router.get('/printers/available', async (req: Request, res: Response) => {
  try {
    const stock =
      typeof req.query.stockSize === 'string' ? req.query.stockSize : undefined;
    const clientIp = getRequestClientIp(req);
    const result = await buildAvailablePrinters(stock, clientIp);
    res.json({
      printers: result.printers,
      stationCode: result.stationCode,
      clientIp: result.clientIp,
      stationRequired: result.stationRequired,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export { buildAvailablePrinters };
export default router;
