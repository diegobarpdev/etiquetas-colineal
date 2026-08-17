'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_DPI = 203;

let mupdfPromise = null;

function loadMupdf() {
  if (!mupdfPromise) mupdfPromise = import('mupdf');
  return mupdfPromise;
}

/**
 * PDF → PNG por página a DPI fijo (203 para ZT230-200dpi).
 */
async function renderPdfToPngPages(pdfPath, outDir, dpi = DEFAULT_DPI) {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const mupdf = await loadMupdf();
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const scale = dpi / 72;
  const matrix = mupdf.Matrix.scale(scale, scale);
  const files = [];

  try {
    const pageCount = doc.countPages();
    for (let i = 0; i < pageCount; i += 1) {
      const page = doc.loadPage(i);
      try {
        const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
        try {
          const file = path.join(outDir, `page-${String(i + 1).padStart(3, '0')}.png`);
          fs.writeFileSync(file, Buffer.from(pixmap.asPNG()));
          files.push(file);
        } finally {
          pixmap.destroy();
        }
      } finally {
        page.destroy();
      }
    }
  } finally {
    doc.destroy();
  }

  return files;
}

module.exports = { renderPdfToPngPages, DEFAULT_DPI };
