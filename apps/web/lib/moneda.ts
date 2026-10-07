/* La plata de cada cuenta: pesos colombianos (lo de siempre), pesos chilenos,
   bolivianos o dólares. Los montos se guardan enteros en la unidad más chica
   de la moneda: pesos (COP, CLP, que no usan centavos) o centavos (BOB, USD).
   Las columnas de la base se siguen llamando *_cop por historia. */

import type { Idioma } from '@/lib/i18n';

export type Moneda = 'COP' | 'CLP' | 'BOB' | 'USD';
export const MONEDAS: Moneda[] = ['COP', 'CLP', 'BOB', 'USD'];
export const esMoneda = (v: unknown): v is Moneda => typeof v === 'string' && (MONEDAS as string[]).includes(v);

/** Cuántos decimales usa (y cuántos guarda la base) */
export const DECIMALES: Record<Moneda, 0 | 2> = { COP: 0, CLP: 0, BOB: 2, USD: 2 };
const SIMBOLO: Record<Moneda, string> = { COP: '$', CLP: '$', BOB: 'Bs ', USD: '$' };
/** Para elegirla (el texto pasa por t) */
export const NOMBRE_MONEDA: Record<Moneda, string> = {
  COP: 'Pesos colombianos',
  CLP: 'Pesos chilenos',
  BOB: 'Bolivianos',
  USD: 'Dólares',
};

function miles(n: number, idioma: Idioma) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, idioma === 'en' ? ',' : '.');
}

/**
 * 84300 → «$84.300» (en inglés «$84,300»); en dólares 1250 (centavos) → «$12,50»
 * («$12.50» en inglés); en bolivianos «Bs 12,50».
 */
export function dinero(n: number, moneda: Moneda = 'COP', idioma: Idioma = 'es', { sign = false }: { sign?: boolean } = {}) {
  const v = Math.round(Number(n) || 0);
  const d = DECIMALES[moneda];
  const abs = Math.abs(v);
  const base = 10 ** d;
  const entero = Math.floor(abs / base);
  const resto = d ? (idioma === 'en' ? '.' : ',') + String(abs % base).padStart(d, '0') : '';
  return (v < 0 ? '−' : sign && v > 0 ? '+' : '') + SIMBOLO[moneda] + miles(entero, idioma) + resto;
}

/**
 * Corto, para decirlo en voz alta: «412 lucas» o «1,2 palos» en pesos (en
 * Colombia y en Chile se dice igual); en inglés «$412K»; en dólares y
 * bolivianos, sin centavos («$412», «$1.2K»).
 */
export function corto(n: number, moneda: Moneda = 'COP', idioma: Idioma = 'es') {
  const v = Math.abs(Number(n) || 0);
  if (DECIMALES[moneda]) {
    const unidades = v / 10 ** DECIMALES[moneda];
    if (unidades >= 10_000) return `${SIMBOLO[moneda]}${(unidades / 1000).toFixed(unidades >= 100_000 ? 0 : 1).replace('.0', '')}K`;
    return dinero(Math.round(unidades) * 10 ** DECIMALES[moneda], moneda, idioma).replace(/[.,]00$/, '');
  }
  const k = v / 1000;
  if (idioma === 'en') return k >= 1000 ? `$${(k / 1000).toFixed(1).replace('.0', '')}M` : `$${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  return k >= 1000 ? `${(k / 1000).toFixed(1).replace('.0', '').replace('.', ',')} palos` : `${Number.isInteger(k) ? k : k.toFixed(1).replace('.', ',')} lucas`;
}

/**
 * Lo que alguien escribe en un campo de plata → la unidad chica. Los campos
 * muestran siempre todos los decimales («$12.50»), así que los dígitos que
 * quedan son centavos: «$12.505» (un 5 de más) → 12505 → $125.05.
 */
export function deCampo(texto: string) {
  return Number(texto.replace(/\D/g, '')) || 0;
}

/** Cuánto es en la unidad grande (para mostrar en gráficas o redondear) */
export const unidades = (n: number, moneda: Moneda) => n / 10 ** DECIMALES[moneda];

/** Para etiquetas cortas (las barras de los meses): «1,25M», «340K», «$85» */
export function abreviado(n: number, moneda: Moneda = 'COP', idioma: Idioma = 'es') {
  const u = Math.abs(unidades(n, moneda));
  const dec = (v: number, d: number) => (idioma === 'en' ? v.toFixed(d) : v.toFixed(d).replace('.', ','));
  if (u >= 1e6) return `${dec(u / 1e6, 2)}M`;
  if (u >= 1e3) return `${dec(u / 1e3, u >= 1e5 ? 0 : 1)}K`;
  return String(Math.round(u));
}
