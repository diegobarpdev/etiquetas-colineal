import { BomType, LabelTemplate, Product } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export interface LabelData {
  productName: string;
  shortName: string;
  ean: string;
  internalRef: string;
  lotNumber: string;
  orderName: string;
  bultoCurrent: number;
  bultoTotal: number;
  /** En conforme: posición en la cantidad de la línea (1/54), no bulto físico */
  serialCurrent: number;
  serialTotal: number;
  weightKg: string;
  productionDate: string;
  height: string;
  width: string;
  length: string;
  volumeM3: string;
  templateCode: string;
  showInternalRefQr: boolean;
  qrSku: string;
  qrInternalRef: string;
  qrLotNumber: string;
  finishInstructions: string;
  factoryFooter?: string;
  conformeTitle?: string;
  conformeSubtitle?: string;
  madeIn?: string;
  inspectorName?: string;
}

export interface ProductWithBom extends Product {
  labelTemplate: LabelTemplate;
  boms: Array<{
    type: BomType;
    lines: Array<{
      quantity: Decimal;
      componentProduct: ProductWithBom;
    }>;
  }>;
}

export interface OrderWithLines {
  id: number;
  name: string;
  lotNumber: string;
  productionDate: Date;
  state: string;
  inspectorName?: string | null;
  lines: Array<{
    quantity: Decimal;
    product: ProductWithBom;
  }>;
}

export interface LabelSummaryChild {
  internalRef: string;
  productName: string;
  componentQuantity: number | null;
  bultoDisplay: string;
  totalLabels: number;
  templateCode: string;
  templateName: string;
}

export interface LabelSummaryItem {
  internalRef: string;
  productName: string;
  orderQuantity: number;
  isKit: boolean;
  bultoDisplay: string;
  totalLabels: number;
  templateCode: string;
  templateName: string;
  children?: LabelSummaryChild[];
}

export interface LabelPreview {
  totalLabels: number;
  summary: LabelSummaryItem[];
  labels: LabelData[];
}
