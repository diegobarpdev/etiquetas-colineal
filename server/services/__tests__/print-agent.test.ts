import { describe, expect, it } from 'vitest';
import {
  extractPrinterNames,
  getLabelPrintChunkSize,
  getPrintAgentTimeoutMs,
} from '../print-agent.service';

describe('extractPrinterNames', () => {
  it('usa los UID USB de devices cuando el agente nuevo no devuelve printers', () => {
    expect(
      extractPrinterNames({
        devices: [
          { name: 'Zebra Printer', uid: 'jay247401', connection: 'usb' },
          { name: 'ZDesigner ZT230', uid: 'driver-1', connection: 'driver' },
        ],
      }),
    ).toEqual(['jay247401']);
  });

  it('mantiene compatibilidad con printers del agente anterior', () => {
    expect(
      extractPrinterNames({
        printers: ['ZDesigner ZT230-200dpi ZPL'],
        devices: [{ name: 'Zebra Printer', uid: 'jay247401', connection: 'usb' }],
      }),
    ).toEqual(['ZDesigner ZT230-200dpi ZPL']);
  });
});

describe('timeouts y chunks de impresión', () => {
  it('escala el timeout con el tamaño del PDF', () => {
    const small = getPrintAgentTimeoutMs(100_000);
    const large = getPrintAgentTimeoutMs(8 * 1024 * 1024);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThanOrEqual(1_200_000);
    expect(small).toBeGreaterThanOrEqual(300_000);
  });

  it('usa chunk size por defecto entre 5 y 60', () => {
    const n = getLabelPrintChunkSize();
    expect(n).toBeGreaterThanOrEqual(5);
    expect(n).toBeLessThanOrEqual(60);
  });
});
