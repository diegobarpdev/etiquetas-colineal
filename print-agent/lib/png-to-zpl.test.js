const test = require('node:test');
const assert = require('node:assert/strict');

const { encodeBitmapZ64 } = require('./png-to-zpl');

function crc16XmodemAscii(value) {
  const bytes = Buffer.from(value, 'ascii');
  let crc = 0x0000;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

test('Z64 calcula CRC-16/XMODEM sobre el texto Base64', () => {
  const encoded = encodeBitmapZ64(Buffer.from([0x00, 0xff, 0x55, 0xaa]));
  const match = encoded.match(/^:Z64:([^:]+):([0-9A-F]{4})$/);

  assert.ok(match, `Formato Z64 inválido: ${encoded}`);
  assert.equal(match[2], crc16XmodemAscii(match[1]));
});

test('hardware ZPL incluye velocidad ^PR10 (ZM400)', () => {
  const { buildHardwareZpl } = require('./png-to-zpl');
  const cmds = buildHardwareZpl({
    printMode: 'tear',
    thermalMethod: 'direct',
    mediaType: 'gap',
    printSpeedIps: 10,
  });
  assert.deepEqual(cmds, ['^MMT', '^MTD', '^MNY', '^PR10']);
});

test('hardware conforme papel usa cortadora + transferencia + continua', () => {
  const { buildHardwareZpl } = require('./png-to-zpl');
  const cmds = buildHardwareZpl({
    printMode: 'cutter',
    thermalMethod: 'transfer',
    mediaType: 'continuous',
    printSpeedIps: 6,
  });
  assert.deepEqual(cmds, ['^MMC', '^MTT', '^MNN', '^PR6']);
});

test('hardware papel incluye ^MD para más oscuridad', () => {
  const { buildHardwareZpl } = require('./png-to-zpl');
  const cmds = buildHardwareZpl({
    printMode: 'cutter',
    thermalMethod: 'transfer',
    mediaType: 'continuous',
    printSpeedIps: 6,
    printDarkness: 22,
  });
  assert.deepEqual(cmds, ['^MMC', '^MTT', '^MNN', '^PR6', '^MD22']);
});

test('^MD se acota a -30..30', () => {
  const { buildHardwareZpl } = require('./png-to-zpl');
  assert.ok(buildHardwareZpl({ printDarkness: 99 }).includes('^MD30'));
  assert.ok(buildHardwareZpl({ printDarkness: -99 }).includes('^MD-30'));
});

test('rotateRgba90Ccw gira -90° (antihorario)', () => {
  const { rotateRgba90Ccw } = require('./png-to-zpl');
  // 2×1: pixel rojo en (0,0), verde en (1,0)
  const src = Buffer.from([
    255, 0, 0, 255,
    0, 255, 0, 255,
  ]);
  const { data, width, height } = rotateRgba90Ccw(src, 2, 1);
  assert.equal(width, 1);
  assert.equal(height, 2);
  // (0,0) rojo → (0,1); (1,0) verde → (0,0)
  assert.deepEqual([...data.slice(0, 4)], [0, 255, 0, 255]);
  assert.deepEqual([...data.slice(4, 8)], [255, 0, 0, 255]);
});
