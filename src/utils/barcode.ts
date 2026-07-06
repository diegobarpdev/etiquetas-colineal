import bwipjs from 'bwip-js';

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function computeEan13CheckDigit(base12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = Number(base12[i]);
    sum += i % 2 === 0 ? n : n * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

/** EAN-13 válido para barcode: 12 dígitos base + dígito de control calculado. */
export function ean13ForBarcode(value: string): string {
  const digits = digitsOnly(value);
  const base12 = digits.slice(0, 12).padStart(12, '0');
  return base12 + computeEan13CheckDigit(base12);
}

/** Formato legible EAN-13: "7 861214 835924" */
export function formatEan13Display(value: string): string {
  const d = ean13ForBarcode(value);
  return `${d[0]} ${d.slice(1, 7)} ${d.slice(7)}`;
}

export async function generateEan13DataUri(value: string): Promise<string> {
  const png = await bwipjs.toBuffer({
    bcid: 'ean13',
    text: ean13ForBarcode(value),
    scale: 3,
    height: 12,
    includetext: false,
  });
  return `data:image/png;base64,${png.toString('base64')}`;
}
