export const FACTORY_INFO = {
  address: 'Fabrica: Cornelio Veintimilla 2-56 y Carlos Tosi.',
  phone: 'Telf: +593 7 280 9445.',
  email: 'E-mail: documentosctin@colinealcorp.com',
};

export const COLCHON_V1_FINISH_INSTRUCTIONS =
  'TRANSPORTAR Y MANIPULAR MÍNIMO ENTRE 2 PERSONAS.\nALMACENAR EL PRODUCTO SIEMPRE EN POSICIÓN HORIZONTAL.';

/** @deprecated Use COLCHON_V1_FINISH_INSTRUCTIONS */
export const COLCHON_FINISH_INSTRUCTIONS = COLCHON_V1_FINISH_INSTRUCTIONS;

export const COLCHON_V2_FINISH_INSTRUCTIONS =
  'TRANSPORTAR Y MANIPULAR MÍNIMO ENTRE 2 PERSONAS.\nALMACENAR EL PRODUCTO SIEMPRE EN POSICION VERTICAL.\nTIEMPO DE ENRROLLADO: MAXIMO 6 MESES';

export const COLCHON_FACTORY_FOOTER =
  'Fabrica: Parque Industrial Machangara. Tel: 2805122. E-mail: colineal@colinealcorp.com www.colineal.com';

export const PRODUCTO_CONFORME_TITLE = 'PRODUCTO CONFORME';

export const PRODUCTO_CONFORME_SUBTITLE =
  'Este producto es conforme con las especificaciones de nuestra empresa.';

export const PRODUCTO_CONFORME_MADE_IN = 'CUENCA - ECUADOR';

/** Etiqueta horizontal pequeña (PDF: 312×170 pt ≈ 110×60 mm) */
export const PRODUCTO_CONFORME_SIZE = {
  widthMm: 110,
  heightMm: 60,
};

// Diseño de contenido bulto-estandar (150 mm ancho × 100 mm alto, leído en horizontal)
export const LABEL_SIZE = {
  widthMm: 150,
  heightMm: 100,
};

export interface LabelPrintSize {
  widthMm: number;
  heightMm: number;
}

/** Tamaño físico de la página PDF por plantilla (puede diferir del diseño si hay rotación). */
const TEMPLATE_PRINT_SIZE: Record<string, LabelPrintSize> = {
  'bulto-estandar': { widthMm: 100, heightMm: 150 },
  'colchon-v1': { widthMm: 100, heightMm: 150 },
  'colchon-v2': { widthMm: 100, heightMm: 150 },
  'producto-conforme': { widthMm: 110, heightMm: 60 },
  'producto-conforme-papel': { widthMm: 110, heightMm: 60 },
  carpinteria: { widthMm: 150, heightMm: 100 },
};

export function getPrintSizeForTemplate(templateCode: string): LabelPrintSize {
  return TEMPLATE_PRINT_SIZE[templateCode] ?? LABEL_SIZE;
}
