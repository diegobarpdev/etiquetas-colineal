import { describe, expect, it } from 'vitest';
import {
  ean13ForBarcode,
  formatEan13Display,
  generateEan13DataUri,
} from '../barcode';

describe('barcode', () => {
  it('calcula dígito de control EAN-13', () => {
    expect(ean13ForBarcode('7861214835924')).toBe('7861214835924');
    expect(ean13ForBarcode('0008300000001')).toBe('0008300000003');
  });

  it('genera PNG para referencias con dígito inválido', async () => {
    const uri = await generateEan13DataUri('0008300000001');
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('formatea display EAN-13', () => {
    expect(formatEan13Display('7861214835924')).toBe('7 861214 835924');
    expect(formatEan13Display('0008300000001')).toBe('0 008300 000003');
  });
});
