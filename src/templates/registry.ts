import Handlebars from 'handlebars';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import QRCode from 'qrcode';
import { FACTORY_INFO } from '../config/constants';
import { LabelData } from '../types';
import {
  formatEan13Display,
  generateEan13DataUri,
} from '../utils/barcode';

const TEMPLATES_DIR = join(process.cwd(), 'src', 'templates', 'labels');

export interface RenderedLabel {
  html: string;
  templateCode: string;
}

function loadFile(dir: string, filename: string): string {
  const path = join(dir, filename);
  if (!existsSync(path)) {
    throw new Error(`Archivo de plantilla no encontrado: ${path}`);
  }
  return readFileSync(path, 'utf-8');
}

const LOGO_CANDIDATES = ['colineallogo.png', 'logo-colineal.png'];
const CARPENTER_LOGO_CANDIDATES = ['carpenter-logo.svg', 'carpenter-logo.png', 'logo-carpenter.png'];
const LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp']);

function fileToDataUri(filePath: string): string {
  const buffer = readFileSync(filePath);
  const mimeByExt: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  const mime = mimeByExt[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function getLogoFromCandidates(candidates: string[]): string | null {
  const assetsDir = join(process.cwd(), 'assets');

  for (const name of candidates) {
    const logoPath = join(assetsDir, name);
    if (existsSync(logoPath)) {
      return fileToDataUri(logoPath);
    }
  }

  return null;
}

function getLogoDataUri(): string {
  const fromCandidates = getLogoFromCandidates(LOGO_CANDIDATES);
  if (fromCandidates) return fromCandidates;

  const assetsDir = join(process.cwd(), 'assets');
  if (existsSync(assetsDir)) {
    const imageFile = readdirSync(assetsDir).find((file) =>
      LOGO_EXTENSIONS.has(extname(file).toLowerCase()),
    );
    if (imageFile) {
      return fileToDataUri(join(assetsDir, imageFile));
    }
  }

  // SVG placeholder si no hay logo
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect width="64" height="64" fill="#000"/>
    <text x="32" y="38" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="7" font-weight="bold">COLINEAL</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function getCarpenterLogoDataUri(): string {
  return getLogoFromCandidates(CARPENTER_LOGO_CANDIDATES) ?? getLogoDataUri();
}

async function generateQrDataUri(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 120,
    margin: 1,
    errorCorrectionLevel: 'M',
  });
}

interface TemplateCacheEntry {
  template: Handlebars.TemplateDelegate;
  css: string;
  htmlMtime: number;
  cssMtime: number;
}

const templateCache = new Map<string, TemplateCacheEntry>();

function getFileMtime(path: string): number {
  return statSync(path).mtimeMs;
}

export function getTemplateFromFiles(code: string) {
  const dir = join(TEMPLATES_DIR, code);
  const htmlPath = join(dir, 'template.hbs');
  const cssPath = join(dir, 'styles.css');
  const htmlMtime = getFileMtime(htmlPath);
  const cssMtime = getFileMtime(cssPath);

  const cached = templateCache.get(code);
  if (cached && cached.htmlMtime === htmlMtime && cached.cssMtime === cssMtime) {
    return cached;
  }

  const htmlSource = loadFile(dir, 'template.hbs');
  const css = loadFile(dir, 'styles.css');
  const template = Handlebars.compile(htmlSource);

  const entry: TemplateCacheEntry = { template, css, htmlMtime, cssMtime };
  templateCache.set(code, entry);
  return entry;
}

export async function renderLabel(
  label: LabelData,
  dbHtml?: string,
  dbCss?: string,
): Promise<RenderedLabel> {
  const code = label.templateCode;
  let template: Handlebars.TemplateDelegate;
  let css: string;

  try {
    const fromFiles = getTemplateFromFiles(code);
    template = fromFiles.template;
    css = fromFiles.css;
  } catch {
    if (!dbHtml) {
      throw new Error(`Plantilla no encontrada: ${code}`);
    }
    template = Handlebars.compile(dbHtml);
    css = dbCss || '';
  }

  const [qrSku, qrLotNumber, barcodeEan, barcodeRef] = await Promise.all([
    generateQrDataUri(label.qrSku),
    generateQrDataUri(label.qrLotNumber),
    code === 'carpinteria' ? generateEan13DataUri(label.ean) : Promise.resolve(''),
    code === 'carpinteria'
      ? generateEan13DataUri(label.internalRef)
      : Promise.resolve(''),
  ]);

  const qrInternalRef = label.showInternalRefQr
    ? await generateQrDataUri(label.qrInternalRef)
    : '';

  const bodyHtml = template({
    ...label,
    qrSku,
    qrInternalRef,
    qrLotNumber,
    logoDataUri: getLogoDataUri(),
    carpenterLogoDataUri: getCarpenterLogoDataUri(),
    barcodeEan,
    barcodeRef,
    barcodeEanDisplay: formatEan13Display(label.ean),
    barcodeRefDisplay: formatEan13Display(label.internalRef),
    factoryAddress: FACTORY_INFO.address,
    factoryPhone: FACTORY_INFO.phone,
    factoryEmail: FACTORY_INFO.email,
    factoryFooter:
      label.factoryFooter ??
      `${FACTORY_INFO.address} ${FACTORY_INFO.phone} ${FACTORY_INFO.email}`,
  });

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>${css}</style>
</head>
<body>${bodyHtml}</body>
</html>`;

  return { html, templateCode: code };
}

export function listAvailableTemplates(): string[] {
  const { readdirSync } = require('fs') as typeof import('fs');
  return readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}
