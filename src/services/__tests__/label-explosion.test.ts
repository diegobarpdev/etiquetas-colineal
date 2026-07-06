import { describe, it, expect } from 'vitest';
import {
  explodeLabels,
  buildLabelSummary,
  applyTemplateOverride,
  _test,
} from '../label-explosion.service';
import { OrderWithLines, ProductWithBom } from '../../types';

function makeProduct(overrides: Partial<ProductWithBom> & { internalRef: string; name: string }): ProductWithBom {
  const { internalRef, name, shortName, numBultos, boms, ...rest } = overrides;
  return {
    id: 1,
    ean: '7861223913996',
    internalRef,
    name,
    shortName: shortName || name,
    weightKg: { toString: () => '10.0000' } as never,
    height: { toString: () => '100.0' } as never,
    width: { toString: () => '50.0' } as never,
    length: { toString: () => '30.0' } as never,
    volumeM3: { toString: () => '0.1500' } as never,
    numBultos: numBultos ?? 1,
    labelTemplateId: 1,
    labelTemplate: {
      id: 1,
      code: 'bulto-estandar',
      name: 'Bulto estándar',
      htmlTemplate: '',
      css: '',
      isActive: true,
    },
    boms: boms || [],
    ...rest,
  } as ProductWithBom;
}

function makeOrder(
  lines: OrderWithLines['lines'],
  overrides: Partial<OrderWithLines> = {},
): OrderWithLines {
  return {
    id: 1,
    name: 'PLDOR/OPR/00564',
    lotNumber: 'PLDOR/OPR/00564',
    productionDate: new Date('2026-06-24'),
    state: 'confirmed',
    lines,
    ...overrides,
  };
}

describe('LabelExplosionService', () => {
  describe('producto simple (velador)', () => {
    const velador = makeProduct({
      internalRef: '7861223924572',
      name: 'VELADOR CALABRIA',
      ean: '7861223924572',
      numBultos: 1,
      boms: [{ type: 'manufacture', lines: [] }],
    });

    it('oculta QR de referencia interna cuando ref = EAN', () => {
      const order = makeOrder([
        { quantity: { toString: () => '1' } as never, product: velador },
      ]);

      const labels = explodeLabels(order);
      expect(labels[0].showInternalRefQr).toBe(false);
    });

    it('genera una etiqueta 1-1 por unidad de orden', () => {
      const order = makeOrder([
        { quantity: { toString: () => '2' } as never, product: velador },
      ]);

      const labels = explodeLabels(order);
      expect(labels).toHaveLength(2);
      expect(labels.every((l) => l.bultoCurrent === 1 && l.bultoTotal === 1)).toBe(true);
    });

    it('titulo y centro usan el mismo producto sin kit', () => {
      const order = makeOrder([
        { quantity: { toString: () => '1' } as never, product: velador },
      ]);

      const labels = explodeLabels(order);
      expect(labels[0].productName).toBe('VELADOR CALABRIA');
      expect(labels[0].shortName).toBe('VELADOR CALABRIA');
    });

    it('resumen muestra 1-1 para producto sin kit', () => {
      const order = makeOrder([
        { quantity: { toString: () => '1' } as never, product: velador },
      ]);

      const summary = buildLabelSummary(order);
      expect(summary[0].bultoDisplay).toBe('1-1');
      expect(summary[0].children).toBeUndefined();
      expect(summary[0].totalLabels).toBe(1);
    });

    it('incluye indicaciones de acabado en plantilla colchon-v1', () => {
      const colchon = makeProduct({
        internalRef: 'SMT01COL10400DI010',
        name: 'SEM TABLEROS SILLON AUX DIDI SUITE',
        ean: '7861223913996',
        labelTemplate: {
          id: 2,
          code: 'colchon-v1',
          name: 'Colchón v1',
          htmlTemplate: '',
          css: '',
          isActive: true,
        },
        boms: [{ type: 'manufacture', lines: [] }],
      });

      const order = makeOrder([
        { quantity: { toString: () => '1' } as never, product: colchon },
      ]);

      const labels = explodeLabels(order);
      expect(labels[0].finishInstructions).toContain('TRANSPORTAR Y MANIPULAR');
      expect(labels[0].finishInstructions).toContain('POSICIÓN HORIZONTAL');
    });
  });

  describe('kit cama', () => {
    const cab = makeProduct({
      internalRef: 'CAB7861223913996',
      name: 'CAB CAMA VARI III PLUS KING',
      numBultos: 2,
      boms: [{ type: 'manufacture', lines: [] }],
    });

    const lar = makeProduct({
      internalRef: 'LAR7861223913996',
      name: 'LARGUEROS CAMA VARI III PLUS KING',
      numBultos: 1,
      boms: [{ type: 'manufacture', lines: [] }],
    });

    const pie = makeProduct({
      internalRef: 'PIE7861223913996',
      name: 'PIECERO CAMA VARI III PLUS KING',
      numBultos: 1,
      boms: [{ type: 'manufacture', lines: [] }],
    });

    const vel = makeProduct({
      internalRef: 'VEL7861223913996',
      name: 'VELADOR CAMA VARI III PLUS KING',
      numBultos: 1,
      boms: [{ type: 'manufacture', lines: [] }],
    });

    const kitCama = makeProduct({
      internalRef: '7861223913996',
      name: 'CAMA VARI III PLUS KING C/VELADORES',
      boms: [
        {
          type: 'kit',
          lines: [
            { quantity: { toString: () => '1' } as never, componentProduct: cab },
            { quantity: { toString: () => '1' } as never, componentProduct: lar },
            { quantity: { toString: () => '1' } as never, componentProduct: pie },
            { quantity: { toString: () => '2' } as never, componentProduct: vel },
          ],
        },
      ],
    });

    it('explota kit en componentes y genera etiquetas correctas', () => {
      const order = makeOrder([
        { quantity: { toString: () => '1' } as never, product: kitCama },
      ]);

      const labels = explodeLabels(order);
      // CAB(1) + LAR(1) + PIE(1) + VEL(2) = 5 etiquetas según cantidades LdM
      expect(labels).toHaveLength(5);

      const cabLabels = labels.filter((l) => l.internalRef === 'CAB7861223913996');
      expect(cabLabels).toHaveLength(1);
      expect(cabLabels[0].productName).toBe('CAMA VARI III PLUS KING C/VELADORES');
      expect(cabLabels[0].shortName).toBe('CAB CAMA VARI III PLUS KING');
      expect(cabLabels[0].bultoCurrent).toBe(1);
      expect(cabLabels[0].bultoTotal).toBe(4);

      const velLabels = labels.filter((l) => l.internalRef === 'VEL7861223913996');
      expect(velLabels).toHaveLength(2);
      expect(velLabels[0].bultoCurrent).toBe(4);
      expect(velLabels[1].bultoCurrent).toBe(4);
      expect(velLabels[0].bultoTotal).toBe(4);
    });

    it('muestra QR de referencia interna en componentes de kit', () => {
      const order = makeOrder([
        { quantity: { toString: () => '1' } as never, product: kitCama },
      ]);

      const labels = explodeLabels(order);
      expect(labels.every((l) => l.showInternalRefQr)).toBe(true);
    });

    it('genera resumen jerárquico con padre kit y 4 bultos', () => {
      const order = makeOrder([
        { quantity: { toString: () => '1' } as never, product: kitCama },
      ]);

      const summary = buildLabelSummary(order);
      expect(summary).toHaveLength(1);

      const parent = summary[0];
      expect(parent.internalRef).toBe('7861223913996');
      expect(parent.isKit).toBe(true);
      expect(parent.bultoDisplay).toBe('4');
      expect(parent.totalLabels).toBe(5);
      expect(parent.children).toHaveLength(4);

      const cabChild = parent.children!.find((c) => c.internalRef === 'CAB7861223913996');
      expect(cabChild?.totalLabels).toBe(1);
      expect(cabChild?.bultoDisplay).toBe('1-4');

      const velChild = parent.children!.find((c) => c.internalRef === 'VEL7861223913996');
      expect(velChild?.componentQuantity).toBe(2);
      expect(velChild?.bultoDisplay).toBe('4-4');
      expect(velChild?.totalLabels).toBe(2);
    });
  });

  describe('orden mixta (kit + velador)', () => {
    it('combina etiquetas de kit y producto simple', () => {
      const velador = makeProduct({
        internalRef: '7861223924572',
        name: 'VELADOR CALABRIA',
        ean: '7861223924572',
        numBultos: 1,
        boms: [{ type: 'manufacture', lines: [] }],
      });

      const component = makeProduct({
        internalRef: 'CAB7861223913996',
        name: 'CAB',
        numBultos: 2,
        boms: [],
      });

      const kit = makeProduct({
        internalRef: '7861223913996',
        name: 'KIT CAMA',
        boms: [
          {
            type: 'kit',
            lines: [
              { quantity: { toString: () => '1' } as never, componentProduct: component },
            ],
          },
        ],
      });

      const order = makeOrder([
        { quantity: { toString: () => '1' } as never, product: kit },
        { quantity: { toString: () => '1' } as never, product: velador },
      ]);

      const labels = explodeLabels(order);
      // kit: 1 (CAB qty 1 en LdM) + velador: 1 = 2
      expect(labels).toHaveLength(2);

      const summary = buildLabelSummary(order);
      expect(summary).toHaveLength(2);
      expect(summary[0].isKit).toBe(true);
      expect(summary[1].isKit).toBe(false);
      expect(summary[1].internalRef).toBe('7861223924572');
      expect(summary[1].bultoDisplay).toBe('1-1');
    });
  });

  describe('explodeProduct helper', () => {
    it('no explota productos manufacture', () => {
      const product = makeProduct({
        internalRef: '7861223924572',
        name: 'VELADOR',
        boms: [{ type: 'manufacture', lines: [] }],
      });

      const result = _test.explodeProduct(product, 3);
      expect(result).toHaveLength(1);
      expect(result[0].componentQty).toBe(3);
    });
  });

  describe('applyTemplateOverride', () => {
    it('sobreescribe templateCode y finishInstructions', () => {
      const labels = [
        {
          templateCode: 'bulto-estandar',
          finishInstructions: '',
          productName: 'Test',
        },
      ] as Parameters<typeof applyTemplateOverride>[0];

      const overridden = applyTemplateOverride(labels, 'colchon-v1');
      expect(overridden[0].templateCode).toBe('colchon-v1');
      expect(overridden[0].finishInstructions).not.toBe('');
    });

    it('no modifica si no hay override', () => {
      const labels = [{ templateCode: 'bulto-estandar', productName: 'Test' }] as Parameters<
        typeof applyTemplateOverride
      >[0];
      expect(applyTemplateOverride(labels)).toBe(labels);
    });
  });

  describe('producto conforme', () => {
    it('genera una etiqueta por bulto físico cuando numBultos > 1', () => {
      const product = makeProduct({
        internalRef: 'SMT01COL10400DI010',
        name: 'SEM TABLEROS SILLON AUX DIDI SUITE',
        numBultos: 2,
        labelTemplate: {
          id: 5,
          code: 'producto-conforme',
          name: 'Producto conforme',
          htmlTemplate: '',
          css: '',
          isActive: true,
        },
        boms: [{ type: 'manufacture', lines: [] }],
      });

      const order = makeOrder([
        { quantity: { toString: () => '1' } as never, product },
      ], {
        name: 'PSTAB/OPR/00859',
        lotNumber: 'LOTE TAB-0620-001',
        inspectorName: 'LOPEZ FAJARDO LUIS VICENTE',
      });

      const labels = explodeLabels(order);
      expect(labels).toHaveLength(2);
      expect(labels[0].lotNumber).toBe('LOTE TAB-0620-001');
      expect(labels[0].orderName).toBe('PSTAB/OPR/00859');
      expect(labels[0].qrLotNumber).toBe('LOTE TAB-0620-001');
      expect(labels[0].bultoCurrent).toBe(1);
      expect(labels[0].bultoTotal).toBe(2);
      expect(labels[1].bultoCurrent).toBe(2);
      expect(labels[0].serialCurrent).toBe(1);
      expect(labels[0].serialTotal).toBe(2);
      expect(labels[1].serialCurrent).toBe(2);
      expect(labels[0].conformeTitle).toBe('PRODUCTO CONFORME');
      expect(labels[0].madeIn).toBe('CUENCA - ECUADOR');
      expect(labels[0].inspectorName).toBe('LOPEZ FAJARDO LUIS VICENTE');
      expect(labels[0].qrSku).toBe('SMT01COL10400DI010');
      expect(labels[0].showInternalRefQr).toBe(false);
    });
  });

  describe('producto conforme papel', () => {
    it('usa EAN en QR SKU, bulto 1-1 y serial por cantidad de orden', () => {
      const product = makeProduct({
        internalRef: 'REF-VEL-CAPRI',
        ean: '7861214835924',
        name: 'VELADOR CAPRI C/HONEY WASH V3',
        numBultos: 1,
        labelTemplate: {
          id: 6,
          code: 'producto-conforme-papel',
          name: 'Producto conforme de papel',
          htmlTemplate: '',
          css: '',
          isActive: true,
        },
        boms: [{ type: 'manufacture', lines: [] }],
      });

      const order = makeOrder(
        [{ quantity: { toString: () => '54' } as never, product }],
        {
          name: 'PLCAJ/OPR/00083',
          lotNumber: 'LOTE CAJ-0618-CAPRI',
          productionDate: new Date('2026-06-18'),
          inspectorName: 'CHACA TENESACA VICENTE',
        },
      );

      const labels = explodeLabels(order);
      const summary = buildLabelSummary(order);

      expect(labels).toHaveLength(54);
      expect(labels.every((l) => l.bultoCurrent === 1 && l.bultoTotal === 1)).toBe(true);
      expect(labels[0].serialCurrent).toBe(1);
      expect(labels[0].serialTotal).toBe(54);
      expect(labels[53].serialCurrent).toBe(54);
      expect(labels[0].qrSku).toBe('7861214835924');
      expect(labels[0].lotNumber).toBe('LOTE CAJ-0618-CAPRI');
      expect(summary[0].orderQuantity).toBe(54);
      expect(summary[0].bultoDisplay).toBe('1-1');
      expect(summary[0].totalLabels).toBe(54);
    });
  });

  describe('carpinteria', () => {
    it('numera N/S por cantidad de orden y BULTO por bulto físico', () => {
      const product = makeProduct({
        internalRef: '0008300000001',
        ean: '7861214835924',
        name: 'VELADOR CAPRI C/HONEY WASH V3',
        numBultos: 1,
        labelTemplate: {
          id: 4,
          code: 'carpinteria',
          name: 'Producto conforme Carpenter',
          htmlTemplate: '',
          css: '',
          isActive: true,
        },
        boms: [{ type: 'manufacture', lines: [] }],
      });

      const order = makeOrder(
        [{ quantity: { toString: () => '54' } as never, product }],
        {
          name: 'PLCAJ/OPR/00084',
          lotNumber: 'LOTE CAJ-0618-CAPRI',
          productionDate: new Date('2026-06-18'),
          inspectorName: 'CHACA TENESACA VICENTE',
        },
      );

      const labels = explodeLabels(order);

      expect(labels).toHaveLength(54);
      expect(labels[0].serialCurrent).toBe(1);
      expect(labels[0].serialTotal).toBe(54);
      expect(labels[53].serialCurrent).toBe(54);
      expect(labels.every((l) => l.bultoCurrent === 1 && l.bultoTotal === 1)).toBe(true);
      expect(labels[0].madeIn).toBe('CUENCA - ECUADOR');
      expect(labels[0].qrSku).toBe('7861214835924');
    });
  });
});
