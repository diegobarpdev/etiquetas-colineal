import { LabelData, LabelSelectionGroup, LabelSummaryItem, OrderWithLines, ProductWithBom } from '../types';
import {
  componentGroupId,
  lineGroupId,
} from './label-selection.service';
import {
  COLCHON_FACTORY_FOOTER,
  COLCHON_V1_FINISH_INSTRUCTIONS,
  COLCHON_V2_FINISH_INSTRUCTIONS,
  PRODUCTO_CONFORME_MADE_IN,
  PRODUCTO_CONFORME_SUBTITLE,
  PRODUCTO_CONFORME_TITLE,
} from '../config/constants';

function formatDecimal(value: { toString(): string }, decimals = 4): string {
  return Number(value.toString()).toFixed(decimals).replace('.', ',');
}

function formatDimension(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(1).replace('.', ',');
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function conformeExtras() {
  return {
    finishInstructions: '',
    conformeTitle: PRODUCTO_CONFORME_TITLE,
    conformeSubtitle: PRODUCTO_CONFORME_SUBTITLE,
    madeIn: PRODUCTO_CONFORME_MADE_IN,
    showInternalRefQr: false,
  };
}

function skuQrForTemplate(templateCode: string, product: ProductWithBom): string {
  if (templateCode === 'producto-conforme') return product.internalRef;
  return product.ean;
}

function skuQrFromLabel(templateCode: string, label: LabelData): string {
  if (templateCode === 'producto-conforme') return label.internalRef;
  if (templateCode === 'producto-conforme-papel') return label.ean;
  return label.qrSku;
}

function templateExtras(templateCode: string) {
  switch (templateCode) {
    case 'colchon-v1':
      return {
        finishInstructions: COLCHON_V1_FINISH_INSTRUCTIONS,
        factoryFooter: COLCHON_FACTORY_FOOTER,
      };
    case 'colchon-v2':
      return {
        finishInstructions: COLCHON_V2_FINISH_INSTRUCTIONS,
        factoryFooter: COLCHON_FACTORY_FOOTER,
      };
    case 'producto-conforme':
    case 'producto-conforme-papel':
      return conformeExtras();
    case 'carpinteria':
      return {
        finishInstructions: '',
        madeIn: PRODUCTO_CONFORME_MADE_IN,
        showInternalRefQr: false,
      };
    default:
      return { finishInstructions: '' };
  }
}

function buildLabelData(
  product: ProductWithBom,
  order: OrderWithLines,
  bultoCurrent: number,
  bultoTotal: number,
  parentProduct?: ProductWithBom,
  serialCurrent?: number,
  serialTotal?: number,
): Omit<LabelData, 'selectionGroupIds' | 'globalIndex'> {
  const componentName = product.shortName || product.name;
  const titleName = parentProduct
    ? parentProduct.shortName || parentProduct.name
    : componentName;

  const templateCode = product.labelTemplate.code;
  const extras = templateExtras(templateCode);
  const skuQr = skuQrForTemplate(templateCode, product);

  return {
    productName: titleName,
    shortName: componentName,
    ean: product.ean,
    internalRef: product.internalRef,
    lotNumber: order.lotNumber,
    orderName: order.name,
    bultoCurrent,
    bultoTotal,
    serialCurrent: serialCurrent ?? bultoCurrent,
    serialTotal: serialTotal ?? bultoTotal,
    weightKg: formatDecimal(product.weightKg),
    productionDate: formatDate(order.productionDate),
    height: formatDimension(product.height),
    width: formatDimension(product.width),
    length: formatDimension(product.length),
    volumeM3: formatDecimal(product.volumeM3),
    templateCode,
    showInternalRefQr:
      extras.showInternalRefQr ?? product.internalRef !== product.ean,
    qrSku: skuQr,
    qrInternalRef: product.internalRef,
    qrLotNumber: order.lotNumber,
    inspectorName: order.inspectorName ?? '',
    ...extras,
  };
}

function getKitBom(product: ProductWithBom) {
  return product.boms.find((bom) => bom.type === 'kit');
}

function isConformeTemplate(templateCode: string): boolean {
  return (
    templateCode === 'producto-conforme' ||
    templateCode === 'producto-conforme-papel' ||
    templateCode === 'carpinteria'
  );
}

function explodeProduct(
  product: ProductWithBom,
  orderQty: number,
): Array<{ product: ProductWithBom; componentQty: number }> {
  const kitBom = getKitBom(product);

  if (kitBom) {
    return kitBom.lines.map((line) => ({
      product: line.componentProduct,
      componentQty: Number(line.quantity.toString()) * orderQty,
    }));
  }

  return [{ product, componentQty: orderQty }];
}

function pushLabel(
  labels: LabelData[],
  label: Omit<LabelData, 'selectionGroupIds' | 'globalIndex'>,
  selectionGroupIds: string[],
  globalIndex: number,
): void {
  labels.push({
    ...label,
    selectionGroupIds,
    globalIndex,
  });
}

export function buildLabelGroups(order: OrderWithLines): LabelSelectionGroup[] {
  const groups: LabelSelectionGroup[] = [];

  order.lines.forEach((line, lineIndex) => {
    const orderQty = Number(line.quantity.toString());
    const kitBom = getKitBom(line.product);
    const lineId = lineGroupId(lineIndex);

    if (kitBom) {
      const children = kitBom.lines.map((bomLine) => {
        const bomLineQty = Number(bomLine.quantity.toString());
        const component = bomLine.componentProduct;
        return {
          id: componentGroupId(lineIndex, component.internalRef),
          label: component.shortName || component.name,
          parentId: lineId,
          internalRef: component.internalRef,
          labelCount: orderQty * bomLineQty,
          isKitParent: false,
        };
      });

      groups.push({
        id: lineId,
        label: `${line.product.shortName || line.product.name} (kit completo)`,
        internalRef: line.product.internalRef,
        labelCount: children.reduce((sum, child) => sum + child.labelCount, 0),
        isKitParent: true,
      });
      groups.push(...children);
    } else {
      const bultosPerUnit = Math.max(1, line.product.numBultos);
      groups.push({
        id: lineId,
        label: line.product.shortName || line.product.name,
        internalRef: line.product.internalRef,
        labelCount: orderQty * bultosPerUnit,
        isKitParent: false,
      });
    }
  });

  return groups;
}

export function explodeLabels(order: OrderWithLines): LabelData[] {
  const labels: LabelData[] = [];
  let globalIndex = 0;

  order.lines.forEach((line, lineIndex) => {
    const orderQty = Number(line.quantity.toString());
    const kitBom = getKitBom(line.product);
    const lineId = lineGroupId(lineIndex);

    if (kitBom) {
      const totalBultos = kitBom.lines.length;
      for (let kitUnit = 0; kitUnit < orderQty; kitUnit++) {
        kitBom.lines.forEach((bomLine, lineIndexInKit) => {
          const bomLineQty = Number(bomLine.quantity.toString());
          const product = bomLine.componentProduct;
          const bultoCurrent = lineIndexInKit + 1;
          const compId = componentGroupId(lineIndex, product.internalRef);
          const groupIds = [lineId, compId];

          for (let i = 0; i < bomLineQty; i++) {
            pushLabel(
              labels,
              buildLabelData(product, order, bultoCurrent, totalBultos, line.product),
              groupIds,
              globalIndex,
            );
            globalIndex += 1;
          }
        });
      }
    } else {
      const bultosPerUnit = Math.max(1, line.product.numBultos);
      const isConforme = isConformeTemplate(line.product.labelTemplate.code);
      const totalSerial = orderQty * bultosPerUnit;
      let serial = 0;

      for (let unit = 0; unit < orderQty; unit++) {
        for (let bulto = 1; bulto <= bultosPerUnit; bulto++) {
          if (isConforme) serial += 1;

          pushLabel(
            labels,
            buildLabelData(
              line.product,
              order,
              bulto,
              bultosPerUnit,
              undefined,
              isConforme ? serial : undefined,
              isConforme ? totalSerial : undefined,
            ),
            [lineId],
            globalIndex,
          );
          globalIndex += 1;
        }
      }
    }
  });

  return labels;
}

export function buildLabelSummary(order: OrderWithLines) {
  const summary: LabelSummaryItem[] = [];

  for (const line of order.lines) {
    const orderQty = Number(line.quantity.toString());
    const kitBom = getKitBom(line.product);

    if (kitBom) {
      const totalBultos = kitBom.lines.length;
      const children = kitBom.lines.map((bomLine, lineIndex) => {
        const bomLineQty = Number(bomLine.quantity.toString());
        const component = bomLine.componentProduct;
        return {
          internalRef: component.internalRef,
          productName: component.name,
          componentQuantity: bomLineQty,
          bultoDisplay: `${lineIndex + 1}-${totalBultos}`,
          totalLabels: orderQty * bomLineQty,
          templateCode: component.labelTemplate.code,
          templateName: component.labelTemplate.name,
        };
      });

      summary.push({
        internalRef: line.product.internalRef,
        productName: line.product.name,
        orderQuantity: orderQty,
        isKit: true,
        bultoDisplay: String(totalBultos),
        totalLabels: children.reduce((sum, child) => sum + child.totalLabels, 0),
        templateCode: line.product.labelTemplate.code,
        templateName: line.product.labelTemplate.name,
        children,
      });
    } else {
      const bultosPerUnit = Math.max(1, line.product.numBultos);

      summary.push({
        internalRef: line.product.internalRef,
        productName: line.product.name,
        orderQuantity: orderQty,
        isKit: false,
        bultoDisplay: bultosPerUnit === 1 ? '1-1' : String(bultosPerUnit),
        totalLabels: orderQty * bultosPerUnit,
        templateCode: line.product.labelTemplate.code,
        templateName: line.product.labelTemplate.name,
      });
    }
  }

  return summary;
}

export function applyTemplateOverride(
  labels: LabelData[],
  templateCode?: string,
): LabelData[] {
  if (!templateCode) return labels;

  const serialGroups = new Map<string, number[]>();
  labels.forEach((label, idx) => {
    const key = `${label.internalRef}::${label.orderName}`;
    if (!serialGroups.has(key)) serialGroups.set(key, []);
    serialGroups.get(key)!.push(idx);
  });

  const serialAt = new Map<number, { current: number; total: number }>();
  for (const indices of serialGroups.values()) {
    indices.forEach((idx, pos) => {
      serialAt.set(idx, { current: pos + 1, total: indices.length });
    });
  }

  const withOrderSerial = isConformeTemplate(templateCode);

  return labels.map((label, idx) => {
    const extras = templateExtras(templateCode);
    const serial = serialAt.get(idx)!;
    return {
      ...label,
      templateCode,
      ...extras,
      showInternalRefQr:
        extras.showInternalRefQr ?? label.showInternalRefQr,
      qrSku: skuQrFromLabel(templateCode, label),
      selectionGroupIds: label.selectionGroupIds,
      globalIndex: label.globalIndex,
      ...(withOrderSerial
        ? { serialCurrent: serial.current, serialTotal: serial.total }
        : {}),
    };
  });
}

export function buildLabelPreview(order: OrderWithLines, templateOverride?: string) {
  const labels = applyTemplateOverride(explodeLabels(order), templateOverride);
  return {
    totalLabels: labels.length,
    summary: buildLabelSummary(order),
    groups: buildLabelGroups(order),
    labels,
  };
}

// Export helpers for testing
export const _test = {
  explodeProduct,
  getKitBom,
  buildLabelData,
};
