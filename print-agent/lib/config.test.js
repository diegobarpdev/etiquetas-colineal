const test = require('node:test');
const assert = require('node:assert/strict');

const { stockSizeMm } = require('./config');

test('producto terminado llega horizontal para que el agente lo rote', () => {
  assert.deepEqual(stockSizeMm('producto-terminado'), {
    widthMm: 150,
    heightMm: 100,
  });
});
