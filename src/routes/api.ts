import { Router, Request, Response } from 'express';
import { buildLabelPreview } from '../services/label-explosion.service';
import {
  applyLabelSelection,
  parseLabelSelection,
} from '../services/label-selection.service';
import { buildLabelsHtml, generateLabelsPdf } from '../services/pdf-generator.service';
import {
  getOrderById,
  listTemplates,
  listOrders,
  searchOrders,
} from '../services/manufacturing-order.service';
import { listAvailableTemplates } from '../templates/registry';

const router = Router();

function resolveTemplateOverride(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const code = raw.trim();
  if (!code || code === 'auto') return undefined;
  const available = listAvailableTemplates();
  if (!available.includes(code)) {
    throw new Error(`Plantilla no válida: ${code}`);
  }
  return code;
}

function handleApiError(error: unknown, res: Response, defaultMessage: string) {
  if (error instanceof Error) {
    if (error.message.startsWith('Plantilla no válida')) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error.message === 'Índice de etiqueta fuera de rango') {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error.message === 'No hay etiquetas que coincidan con la selección') {
      res.status(400).json({ error: error.message });
      return;
    }
  }
  console.error(error);
  res.status(500).json({ error: defaultMessage });
}

function parseLabelIndex(raw: unknown, total: number): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const index = parseInt(String(raw), 10);
  if (isNaN(index) || index < 0 || index >= total) {
    throw new Error('Índice de etiqueta fuera de rango');
  }
  return index;
}

function resolveLabelsFromRequest(
  order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>,
  query: Record<string, unknown>,
  templateOverride?: string,
) {
  const preview = buildLabelPreview(order, templateOverride);
  const selection = parseLabelSelection(query);
  const labels = applyLabelSelection(preview.labels, selection);

  if (labels.length === 0 && preview.labels.length > 0) {
    throw new Error('No hay etiquetas que coincidan con la selección');
  }

  return { preview, selection, labels };
}

router.get('/orders', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    if (!q.trim()) {
      const orders = await listOrders();
      res.json(orders);
      return;
    }
    const orders = await searchOrders(q.trim());
    res.json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al buscar órdenes' });
  }
});

router.get('/orders/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }

    const order = await getOrderById(id);
    if (!order) {
      res.status(404).json({ error: 'Orden no encontrada' });
      return;
    }

    const templateOverride = resolveTemplateOverride(req.query.template);
    const { preview, labels } = resolveLabelsFromRequest(
      order,
      req.query as Record<string, unknown>,
      templateOverride,
    );
    res.json({
      order: {
        id: order.id,
        name: order.name,
        lotNumber: order.lotNumber,
        productionDate: order.productionDate,
        state: order.state,
        inspectorName: order.inspectorName,
        lines: order.lines.map((l) => ({
          productName: l.product.name,
          internalRef: l.product.internalRef,
          quantity: Number(l.quantity.toString()),
          bomType: l.product.boms[0]?.type || 'manufacture',
        })),
      },
      preview: {
        totalLabels: labels.length,
        totalLabelsAll: preview.totalLabels,
        summary: preview.summary,
        groups: preview.groups,
      },
    });
  } catch (error) {
    handleApiError(error, res, 'Error al obtener la orden');
  }
});

router.get('/orders/:id/labels/preview', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }

    const order = await getOrderById(id);
    if (!order) {
      res.status(404).json({ error: 'Orden no encontrada' });
      return;
    }

    const templateOverride = resolveTemplateOverride(req.query.template);
    const { preview, labels } = resolveLabelsFromRequest(
      order,
      req.query as Record<string, unknown>,
      templateOverride,
    );
    res.json({
      ...preview,
      totalLabels: labels.length,
      labels,
    });
  } catch (error) {
    handleApiError(error, res, 'Error al generar vista previa');
  }
});

router.get('/orders/:id/labels/html', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }

    const order = await getOrderById(id);
    if (!order) {
      res.status(404).json({ error: 'Orden no encontrada' });
      return;
    }

    const templateOverride = resolveTemplateOverride(req.query.template);
    const { labels } = resolveLabelsFromRequest(
      order,
      req.query as Record<string, unknown>,
      templateOverride,
    );
    if (labels.length === 0) {
      res.status(400).json({ error: 'La orden no tiene etiquetas para generar' });
      return;
    }

    const labelIndex = parseLabelIndex(req.query.index, labels.length);
    const html = await buildLabelsHtml(labels, {
      preview: true,
      labelIndex,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    handleApiError(error, res, 'Error al generar vista previa HTML');
  }
});

router.get('/orders/:id/labels/pdf', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }

    const order = await getOrderById(id);
    if (!order) {
      res.status(404).json({ error: 'Orden no encontrada' });
      return;
    }

    const templateOverride = resolveTemplateOverride(req.query.template);
    const { labels } = resolveLabelsFromRequest(
      order,
      req.query as Record<string, unknown>,
      templateOverride,
    );
    if (labels.length === 0) {
      res.status(400).json({ error: 'La orden no tiene etiquetas para generar' });
      return;
    }

    const labelIndex = parseLabelIndex(req.query.index, labels.length);
    const labelsToPrint =
      labelIndex !== undefined
        ? labels.slice(labelIndex, labelIndex + 1)
        : labels;

    const pdf = await generateLabelsPdf(labelsToPrint);
    const filename = `etiquetas-${order.name.replace(/\//g, '-')}.pdf`;

    const download = req.query.download === '1' || req.query.download === 'true';
    const disposition = download ? 'attachment' : 'inline';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (error) {
    handleApiError(error, res, 'Error al generar PDF');
  }
});

router.post('/orders/:id/labels/generate', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }

    const order = await getOrderById(id);
    if (!order) {
      res.status(404).json({ error: 'Orden no encontrada' });
      return;
    }

    const templateOverride = resolveTemplateOverride(
      req.body?.template ?? req.query.template,
    );
    const { labels } = resolveLabelsFromRequest(
      order,
      { ...(req.query as Record<string, unknown>), ...(req.body ?? {}) },
      templateOverride,
    );
    if (labels.length === 0) {
      res.status(400).json({ error: 'La orden no tiene etiquetas para generar' });
      return;
    }

    const pdf = await generateLabelsPdf(labels);
    const filename = `etiquetas-${order.name.replace(/\//g, '-')}.pdf`;

    const download = req.query.download === '1' || req.query.download === 'true';
    const disposition = download ? 'attachment' : 'inline';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (error) {
    handleApiError(error, res, 'Error al generar PDF');
  }
});

router.get('/templates', async (_req: Request, res: Response) => {
  try {
    const templates = await listTemplates();
    res.json(templates);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al listar plantillas' });
  }
});

export default router;
