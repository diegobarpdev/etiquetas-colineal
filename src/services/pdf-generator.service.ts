import puppeteer, { Browser } from 'puppeteer';
import { getPrintSizeForTemplate } from '../config/constants';
import { LabelData } from '../types';
import { renderLabel, RenderedLabel } from '../templates/registry';

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.connected) {
    browserInstance = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
  }
  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

function collectCssByTemplate(renderedLabels: RenderedLabel[]): Map<string, string> {
  const cssByTemplate = new Map<string, string>();
  for (const rendered of renderedLabels) {
    if (cssByTemplate.has(rendered.templateCode)) continue;
    const styleMatch = rendered.html.match(/<style>([\s\S]*?)<\/style>/);
    if (styleMatch) {
      cssByTemplate.set(rendered.templateCode, styleMatch[1]);
    }
  }
  return cssByTemplate;
}

function buildPageStyle(printSize: { widthMm: number; heightMm: number }): string {
  return `
    @page {
      size: ${printSize.widthMm}mm ${printSize.heightMm}mm;
      margin: 0;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
    }
    .label-page {
      width: ${printSize.widthMm}mm;
      height: ${printSize.heightMm}mm;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
      position: relative;
    }
    .label-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
  `;
}

function buildPreviewScreenStyle(): string {
  return `
    body.preview-mode {
      background: #e5e7eb;
      padding: 1.5rem;
      min-height: 100vh;
    }
    body.preview-mode .label-page {
      margin: 0 auto 1.25rem;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      background: #fff;
      page-break-after: auto;
      break-after: auto;
    }
    body.preview-mode .label-page:last-child {
      margin-bottom: 0;
    }
  `;
}

function extractLabelBody(html: string): string {
  const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
  return bodyMatch ? bodyMatch[1] : html;
}

export interface BuildLabelsHtmlOptions {
  preview?: boolean;
  labelIndex?: number;
}

export async function buildLabelsHtml(
  labels: LabelData[],
  options: BuildLabelsHtmlOptions = {},
): Promise<string> {
  if (labels.length === 0) {
    throw new Error('No hay etiquetas para generar');
  }

  const renderedLabels = await Promise.all(labels.map((label) => renderLabel(label)));
  const cssByTemplate = collectCssByTemplate(renderedLabels);

  const labelIndex =
    options.labelIndex !== undefined ? options.labelIndex : undefined;
  const slice =
    labelIndex !== undefined
      ? renderedLabels.slice(labelIndex, labelIndex + 1)
      : renderedLabels;

  if (slice.length === 0) {
    throw new Error('Índice de etiqueta fuera de rango');
  }

  const printSize = getPrintSizeForTemplate(slice[0].templateCode);
  const pageStyle = buildPageStyle(printSize);
  const previewStyle = options.preview ? buildPreviewScreenStyle() : '';

  const labelPages = slice.map((r) => {
    const size = getPrintSizeForTemplate(r.templateCode);
    const body = extractLabelBody(r.html);
    const styleAttr =
      options.preview && size.widthMm !== printSize.widthMm
        ? ` style="width:${size.widthMm}mm;height:${size.heightMm}mm"`
        : '';
    return `<div class="label-page" data-template="${r.templateCode}"${styleAttr}>${body}</div>`;
  });

  const bodyClass = options.preview ? ' class="preview-mode"' : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>${pageStyle}</style>
  ${previewStyle ? `<style>${previewStyle}</style>` : ''}
  ${[...cssByTemplate.entries()].map(([code, css]) => `<style data-template="${code}">${css}</style>`).join('\n')}
</head>
<body${bodyClass}>
  ${labelPages.join('\n')}
</body>
</html>`;
}

export async function generateLabelsPdf(labels: LabelData[]): Promise<Buffer> {
  const combinedHtml = await buildLabelsHtml(labels);
  const printSize = getPrintSizeForTemplate(labels[0].templateCode);

  const browser = await getBrowser();
  const page = await browser.newPage();

  await page.setContent(combinedHtml, { waitUntil: 'load' });

  const pdf = await page.pdf({
    width: `${printSize.widthMm}mm`,
    height: `${printSize.heightMm}mm`,
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    preferCSSPageSize: true,
  });

  await page.close();
  return Buffer.from(pdf);
}
