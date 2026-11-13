import { formatCOP, type Idioma, type Moneda, plano } from './text.js';

/*
 * Lo que entra (migración 810): «hoy entraron 200 lucas», «me pagaron la
 * quincena 1.600.000», «gané 3 palos», «hice 150 lukas». No es un gasto: se
 * anota como ingreso de la cuenta del grupo. Aquí está cómo se reconoce, cómo
 * se lee el monto y qué responde Mister Luks.
 */

/** Verbos de plata que entra (sobre el texto plano: sin tildes ni signos) */
const ENTRA = new RegExp(
  [
    String.raw`\b(?:me|nos)\s+(?:entr(?:aron|o)|llego|llegaron|cayo|cayeron)\b`,
    String.raw`\b(?:entraron|ingresaron)\b`,
    String.raw`\b(?:entro|llego|llegaron|cayo|cayeron)\s+(?:la\s+|el\s+)?(?:plata|platica|quincena|prima|sueldo|nomina|bono|salario)\b`,
    String.raw`\b(?:me|nos)\s+(?:pagaron|pago|consignaron|consigno|transfirieron|transfirio|giraron|depositaron|abonaron)\b`,
    String.raw`\b(?:gane|ganamos|gano|recibi|recibimos)\b`,
    String.raw`\bhice\s+(?:hoy\s+|ayer\s+)?\d`,
    String.raw`\b(?:hoy|ayer)\s+hice\b`,
    String.raw`\b(?:ingreso|ingresos|entrada|income|got paid|i earned|we earned|i made|we made)\b`,
  ].join('|'),
);

/** Si aparece esto, es un gasto o un pago que hizo quien escribe, no plata que le entra */
const SALE = /\b(?:pague|pagamos|gaste|gastamos|compre|compramos|debo|debemos|preste|factura|recibo|cobro|i paid|we paid|spent|bought|bill)\b/;

/** Lo que dice qué fue, si lo dice */
const CONCEPTOS: [RegExp, string][] = [
  [/\bquincena\b/, 'Quincena'],
  [/\b(?:sueldo|salario|nomina|salary|paycheck)\b/, 'Sueldo'],
  [/\bprima\b/, 'Prima'],
  [/\b(?:honorarios|freelance|proyecto)\b/, 'Honorarios'],
  [/\b(?:arriendo|alquiler|rent)\b/, 'Arriendo'],
  [/\b(?:venta|ventas|vendi|vendimos|sold)\b/, 'Ventas'],
  [/\b(?:bono|bonificacion|bonus)\b/, 'Bono'],
  [/\b(?:cesantias|intereses|interest)\b/, 'Cesantías o intereses'],
  [/\b(?:regalo|me regalaron|gift)\b/, 'Regalo'],
];

/**
 * El monto en la unidad grande: «200 lucas» → 200.000, «1.600.000» → 1.600.000,
 * «3 palos» → 3.000.000, «1,5 millones» → 1.500.000, «15k» → 15.000,
 * «$85» → 85. Null si no hay un monto.
 */
export function montoIngreso(texto: string): number | null {
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const m = t.match(
    /(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d{1,2})?)\s*(mil|k|lucas?|lukas?|luquitas?|lukitas?|palos?|millones|millon|mill|m(?![a-z])|barras?)?(?![a-z\d])/,
  );
  if (!m) return null;
  const crudo = m[1];
  const miles = /[.,]\d{3}(?:[.,]\d{3})*$/.test(crudo) && !/^\d+[.,]\d{1,2}$/.test(crudo);
  const n = miles ? Number(crudo.replace(/[.,]/g, '')) : Number(crudo.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const sufijo = m[2] ?? '';
  const por = /^(?:palos?|millones|millon|mill|m|barras?)$/.test(sufijo) ? 1_000_000 : sufijo ? 1000 : 1;
  return Math.round(n * por * 100) / 100;
}

export interface Ingreso {
  /** En la unidad grande (pesos, dólares) */
  monto: number;
  concepto: string | null;
}

/** «hoy entraron 200 lucas» → { monto: 200000, concepto: null }; si no es plata que entra, null */
export function leerIngreso(texto: string | null | undefined): Ingreso | null {
  if (!texto?.trim() || texto.length > 500) return null;
  const p = plano(texto);
  if (!ENTRA.test(p) || SALE.test(p)) return null;
  const monto = montoIngreso(texto);
  if (monto === null) return null;
  const concepto = CONCEPTOS.find(([re]) => re.test(p))?.[1] ?? null;
  return { monto, concepto };
}

export interface RegistroIngreso {
  ok: boolean;
  reason?: 'monto' | 'sin_cuenta' | 'cerrada';
  nuevo?: boolean;
  account?: { id: string; name: string; language: Idioma | null; currency: Moneda };
  /** En la unidad chica, como los gastos (centavos en dólares) */
  monto?: number;
  entro_mes?: number;
  salio_mes?: number;
}

const CONCEPTO_EN: Record<string, string> = {
  Quincena: 'Paycheck',
  Sueldo: 'Salary',
  Prima: 'Bonus',
  Honorarios: 'Fees',
  Arriendo: 'Rent',
  Ventas: 'Sales',
  Bono: 'Bonus',
  'Cesantías o intereses': 'Savings interest',
  Regalo: 'Gift',
};

/**
 * Lo que responde Mister Luks. Empieza por «Anotado…» o «Ya estaba anotado…» con
 * «· $monto» y firma «Más detalle en mrluks.com»: así no se lee como un gasto
 * (esMensajeDeLuks y public.es_mensaje_de_luks).
 */
export function respuestaIngreso(r: RegistroIngreso, ingreso: Ingreso, idioma: Idioma): string {
  const moneda = r.account?.currency ?? 'COP';
  const en = idioma === 'en';
  const que = ingreso.concepto ? (en ? (CONCEPTO_EN[ingreso.concepto] ?? ingreso.concepto) : ingreso.concepto) : en ? 'Income' : 'Entrada';
  const cabeza = r.nuevo === false ? (en ? 'Already logged' : 'Ya estaba anotado') : en ? 'Logged as income' : 'Anotado como entrada';
  const lineas = [`💰 ${cabeza}: ${que} · ${formatCOP(r.monto ?? 0, moneda, idioma)}`];
  if (r.entro_mes != null && r.salio_mes != null) {
    lineas.push(
      en
        ? `This month: ${formatCOP(r.entro_mes, moneda, idioma)} in, ${formatCOP(r.salio_mes, moneda, idioma)} out.`
        : `Este mes: entró ${formatCOP(r.entro_mes, moneda, idioma)} y salió ${formatCOP(r.salio_mes, moneda, idioma)}.`,
    );
  }
  lineas.push(en ? 'More detail at mrluks.com' : 'Más detalle en mrluks.com');
  return lineas.join('\n');
}
