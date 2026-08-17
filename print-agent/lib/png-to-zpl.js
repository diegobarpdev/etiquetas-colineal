'use strict';

const fs = require('fs');
const zlib = require('zlib');
const { PNG } = require('pngjs');

const DEFAULT_DPI = 203;

function resolvePrintDpi(explicitDpi) {
  const n = Number(explicitDpi);
  if (Number.isFinite(n) && n >= 150 && n <= 600) return Math.round(n);
  return DEFAULT_DPI;
}

function mmToDots(mm, dpi) {
  return Math.max(1, Math.round((Number(mm) / 25.4) * dpi));
}

function scaleRgbaNearest(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src;
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y += 1) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x += 1) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      const si = (sy * sw + sx) * 4;
      const di = (y * dw + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return out;
}

/** Rota 90° antihorario (CSS rotate(-90deg)). */
function rotateRgba90Ccw(src, sw, sh) {
  const dw = sh;
  const dh = sw;
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const si = (y * sw + x) * 4;
      const dx = y;
      const dy = sw - 1 - x;
      const di = (dy * dw + dx) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return { data: out, width: dw, height: dh };
}

/** @deprecated usar rotateRgba90Ccw */
function rotateRgba90Cw(src, sw, sh) {
  const dw = sh;
  const dh = sw;
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const si = (y * sw + x) * 4;
      const dx = sh - 1 - y;
      const dy = x;
      const di = (dy * dw + dx) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return { data: out, width: dw, height: dh };
}

/** Ancho máx. típico cabezal ZT230 200dpi (~4"). */
const MAX_PRINT_WIDTH_MM = 104;

/** CRC-16/XMODEM requerido por ZB64: init 0x0000. */
function crc16Ccitt(buf) {
  let crc = 0x0000;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i] << 8;
    for (let b = 0; b < 8; b += 1) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * Bitmap → :Z64: (zlib + base64). ~10× más chico que hex → apto para miles/día.
 */
function encodeBitmapZ64(bitmap) {
  const compressed = zlib.deflateSync(bitmap, { level: 9 });
  const b64 = compressed.toString('base64');
  // Zebra valida el CRC sobre el campo Base64 codificado, no sobre el zlib binario.
  const crc = crc16Ccitt(Buffer.from(b64, 'ascii'))
    .toString(16)
    .toUpperCase()
    .padStart(4, '0');
  return `:Z64:${b64}:${crc}`;
}

/**
 * Convierte los ajustes de hardware de la UI en comandos ZPL.
 * printMode     → ^MM (T=tear-off, C=cutter)
 * thermal       → ^MT (T=transferencia, D=directa)
 * mediaType     → ^MN (Y=muesca/gap, N=continua)
 * printSpeed    → ^PR (ips; ZT230 ~6, ZM400 hasta 10)
 * printDarkness → ^MD (-30..30; positivo = más oscuro)
 */
function buildHardwareZpl({
  printMode,
  thermalMethod,
  mediaType,
  printSpeedIps,
  printDarkness,
} = {}) {
  const cmds = [];
  if (printMode) cmds.push(printMode === 'cutter' ? '^MMC' : '^MMT');
  if (thermalMethod) cmds.push(thermalMethod === 'direct' ? '^MTD' : '^MTT');
  if (mediaType) cmds.push(mediaType === 'continuous' ? '^MNN' : '^MNY');
  const speed = Number(printSpeedIps);
  if (Number.isFinite(speed) && speed >= 2) {
    const ips = Math.max(2, Math.min(14, Math.round(speed)));
    cmds.push(`^PR${ips}`);
  }
  const md = Number(printDarkness);
  if (Number.isFinite(md)) {
    const darkness = Math.max(-30, Math.min(30, Math.round(md)));
    cmds.push(`^MD${darkness}`);
  }
  cmds.push('^JUS');
  return cmds;
}

function buildZplSizePreamble({ widthDots, heightDots }) {
  return [
    '^XA',
    '^PON',
    '^LRN',
    '^LH0,0',
    '^LS0',
    '^LT0',
    `^PW${widthDots}`,
    `^LL${heightDots}`,
    '^XZ',
    '',
  ].join('\r\n');
}

function pngFileToZpl(pngPath, options = {}) {
  const dpi = resolvePrintDpi(options.dpi);
  let widthMm = Number(options.widthMm);
  let heightMm = Number(options.heightMm);
  const png = PNG.sync.read(fs.readFileSync(pngPath));

  let srcW = png.width;
  let srcH = png.height;
  let rgba = png.data;

  const approxWmm =
    Number.isFinite(widthMm) && widthMm > 0 ? widthMm : (srcW / dpi) * 25.4;
  const approxHmm =
    Number.isFinite(heightMm) && heightMm > 0 ? heightMm : (srcH / dpi) * 25.4;

  // PDF horizontal > cabezal: rotar -90° (CCW) a vertical para Zebra (producto terminado 150×100).
  if (approxWmm > MAX_PRINT_WIDTH_MM && approxWmm > approxHmm) {
    console.log(
      `[zpl] rotate -90° CCW ${approxWmm.toFixed(1)}x${approxHmm.toFixed(1)}mm → ${approxHmm.toFixed(1)}x${approxWmm.toFixed(1)}mm (printhead)`,
    );
    const rot = rotateRgba90Ccw(rgba, srcW, srcH);
    rgba = rot.data;
    srcW = rot.width;
    srcH = rot.height;
    if (Number.isFinite(widthMm) && Number.isFinite(heightMm)) {
      const swap = widthMm;
      widthMm = heightMm;
      heightMm = swap;
    }
  }

  let targetW = srcW;
  let targetH = srcH;

  if (Number.isFinite(widthMm) && widthMm > 0 && Number.isFinite(heightMm) && heightMm > 0) {
    const wantW = mmToDots(widthMm, dpi);
    const wantH = mmToDots(heightMm, dpi);
    if (wantW !== srcW || wantH !== srcH) {
      console.log(
        `[zpl] scale PNG ${srcW}x${srcH}px → ${wantW}x${wantH}px (${widthMm}x${heightMm}mm @${dpi}dpi)`,
      );
      targetW = wantW;
      targetH = wantH;
      rgba = scaleRgbaNearest(rgba, srcW, srcH, targetW, targetH);
    } else {
      targetW = wantW;
      targetH = wantH;
    }
  }

  const bytesPerRow = Math.ceil(targetW / 8);
  const totalBytes = bytesPerRow * targetH;
  const bitmap = Buffer.alloc(totalBytes, 0x00);

  for (let y = 0; y < targetH; y += 1) {
    for (let x = 0; x < targetW; x += 1) {
      const i = (y * targetW + x) * 4;
      const a = rgba[i + 3];
      const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      if (a > 64 && lum < 200) {
        bitmap[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  const graphicData = encodeBitmapZ64(bitmap);
  const copies = Math.max(1, Number(options.copies) || 1);
  const mmW =
    Number.isFinite(widthMm) && widthMm > 0
      ? Math.round(widthMm * 100) / 100
      : Math.round((targetW / dpi) * 25.4 * 100) / 100;
  const mmH =
    Number.isFinite(heightMm) && heightMm > 0
      ? Math.round(heightMm * 100) / 100
      : Math.round((targetH / dpi) * 25.4 * 100) / 100;

  const hardware = buildHardwareZpl(options);

  // Sin ^JUS. Z64 correcto ~8–20 KB (antes hex ~240 KB con CRC malo → tamaño conforme).
  const zpl = [
    '^XA',
    '^PON',
    '^LRN',
    '^LH0,0',
    '^LS0',
    '^LT0',
    ...hardware,
    `^PW${targetW}`,
    `^LL${targetH}`,
    `^FO0,0^GFA,${totalBytes},${totalBytes},${bytesPerRow},${graphicData}^FS`,
    copies > 1 ? `^PQ${copies},0,1,Y` : '^PQ1,0,1,Y',
    '^XZ',
    '',
  ].join('\r\n');

  console.log(
    `[zpl] GFA Z64 ${targetW}x${targetH} raw=${totalBytes}B zpl=${zpl.length}B (${mmW}x${mmH}mm)`,
  );

  return {
    zpl,
    widthDots: targetW,
    heightDots: targetH,
    widthMm: mmW,
    heightMm: mmH,
    bytesPerRow,
    totalBytes,
    dpi,
    zplBytes: zpl.length,
  };
}

function buildZplBatch(pngPaths, options = {}) {
  if (!Array.isArray(pngPaths) || pngPaths.length === 0) {
    throw new Error('No hay páginas PNG para ZPL');
  }
  const pages = pngPaths.map((p) => pngFileToZpl(p, options));
  const first = pages[0];
  const jobs = pages.map((p, i) => ({
    page: i + 1,
    zpl: p.zpl,
    widthDots: p.widthDots,
    heightDots: p.heightDots,
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    dpi: p.dpi,
    bytes: p.totalBytes,
    zplBytes: p.zplBytes,
  }));
  return {
    zpl: jobs.map((j) => j.zpl).join(''),
    jobs,
    dpi: first.dpi,
    widthDots: first.widthDots,
    heightDots: first.heightDots,
    widthMm: first.widthMm,
    heightMm: first.heightMm,
    pages: jobs.map((j) => ({
      page: j.page,
      widthDots: j.widthDots,
      heightDots: j.heightDots,
      widthMm: j.widthMm,
      heightMm: j.heightMm,
      dpi: j.dpi,
      bytes: j.bytes,
      zplBytes: j.zplBytes,
    })),
  };
}

module.exports = {
  DEFAULT_DPI,
  resolvePrintDpi,
  pngFileToZpl,
  buildZplBatch,
  buildZplSizePreamble,
  buildHardwareZpl,
  encodeBitmapZ64,
  rotateRgba90Ccw,
  rotateRgba90Cw,
};
