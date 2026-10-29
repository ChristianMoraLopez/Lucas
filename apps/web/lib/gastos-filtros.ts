import { DECIMALES, type Moneda } from '@/lib/moneda';
import { normalizarBusqueda, uuidOrNull } from '@/lib/search';

/*
 * Los filtros de Gastos en la URL (?q=&cat=&quien=&mes=&ver=&orden=). Los lee
 * la lista y también el Excel, así que el Excel trae justo lo que se ve.
 */

/** Cómo se ordena: por fecha (los más recientes o los más antiguos primero) o por valor */
export const ORDENES = ['recientes', 'antiguos', 'mayor', 'menor'] as const;
export type Orden = (typeof ORDENES)[number];

export interface FiltrosGastos {
  /** Lo que se escribió (para mostrarlo) y sin tildes (para buscar) */
  q: string;
  busqueda: string;
  /** Si lo que se buscó es un valor («105 mil», «$105.000»): en la unidad de la base (pesos o centavos) */
  monto: number | null;
  cat: string | null;
  quien: string | null;
  /** «2026-09» o null (todos los meses) */
  mes: string | null;
  soloPendientes: boolean;
  orden: Orden;
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

const leer = (sp: Params, k: string) => {
  const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
  return typeof v === 'string' ? v : undefined;
};

/** Qué tanto se aleja un valor buscado: «105 mil» encuentra de $94.500 a $115.500 */
export const MARGEN = 0.1;

/**
 * «105 mil», «105k», «105 lucas», «$105.000», «105.000», «1,2 palos» → el
 * valor en la unidad de la base. Un número suelto de menos de mil, en pesos, son
 * miles («105» es $105.000, como se dice). En dólares y bolivianos, a centavos.
 * null si no es un valor.
 */
export function montoBuscado(texto: string, moneda: Moneda = 'COP'): number | null {
  const m = texto
    .trim()
    .toLowerCase()
    .match(/^\$?\s*(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(mil|k|lucas?|luquitas?|palos?|millon(?:es)?|millón|m|usd|cop|pesos?)?\.?$/);
  if (!m) return null;
  const num = m[1].replace(/\s/g, '');
  const corte = Math.max(num.lastIndexOf('.'), num.lastIndexOf(','));
  // «105.000» y «1,785,000» son miles; «12,50» y «1,2» llevan decimales
  const n =
    corte === -1 || num.length - corte - 1 === 3
      ? Number(num.replace(/[.,]/g, ''))
      : Number(`${num.slice(0, corte).replace(/[.,]/g, '')}.${num.slice(corte + 1)}`);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unidad = m[2] ?? '';
  const pesos = DECIMALES[moneda] === 0;
  const por = /^(?:palo|millon|millón|m$)/.test(unidad) ? 1_000_000 : /^(?:mil|k|luca|luquita)/.test(unidad) ? 1000 : !unidad && pesos && n < 1000 ? 1000 : 1;
  return Math.round(n * por * 10 ** DECIMALES[moneda]);
}

export function leerFiltros(sp: Params, moneda: Moneda = 'COP'): FiltrosGastos {
  const q = (leer(sp, 'q') ?? '').trim().slice(0, 60);
  const mes = leer(sp, 'mes');
  const orden = leer(sp, 'orden') as Orden;
  return {
    q,
    busqueda: normalizarBusqueda(q),
    monto: montoBuscado(q, moneda),
    cat: uuidOrNull(leer(sp, 'cat')),
    quien: uuidOrNull(leer(sp, 'quien')),
    mes: mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? mes : null,
    soloPendientes: leer(sp, 'ver') === 'pendientes',
    orden: ORDENES.includes(orden) ? orden : 'recientes',
  };
}

/** Los filtros como quedan en la URL (sin los que están en su valor de siempre) */
export function aParams(f: FiltrosGastos, cambios: Record<string, string | null> = {}) {
  const todos: Record<string, string | null> = {
    q: f.q,
    cat: f.cat,
    quien: f.quien,
    mes: f.mes,
    ver: f.soloPendientes ? 'pendientes' : null,
    orden: f.orden === 'recientes' ? null : f.orden,
    ...cambios,
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(todos)) if (v) p.set(k, v);
  return p;
}

export const porValor = (f: FiltrosGastos) => f.orden === 'mayor' || f.orden === 'menor';

/** ¿Hay algo que acote la lista (además del mes)? */
export const filtrando = (f: FiltrosGastos) => Boolean(f.busqueda || f.cat || f.quien || f.soloPendientes);

/** Buscando un valor y sin otro orden elegido: los más cercanos primero */
export const porCercania = (f: FiltrosGastos) => f.monto !== null && f.orden === 'recientes';

/** Los más cercanos al valor buscado primero (y, entre iguales, como venían) */
export function ordenarPorCercania<R extends { total_cop: number }>(rows: R[], monto: number): R[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Math.abs(a.r.total_cop - monto) - Math.abs(b.r.total_cop - monto) || a.i - b.i)
    .map((x) => x.r);
}

/** «2026-09» → «2026-10-01» (primer día del mes siguiente) */
export function mesSiguiente(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Lo que se usa del builder de PostgREST (sus métodos devuelven el mismo builder) */
interface Consulta<Q> {
  eq(columna: string, valor: unknown): Q;
  gte(columna: string, valor: unknown): Q;
  lt(columna: string, valor: unknown): Q;
  ilike(columna: string, patron: string): Q;
  or(filtros: string): Q;
  order(columna: string, opciones: { ascending: boolean }): Q;
}

/** Los filtros y el orden sobre una consulta de `expenses` */
export function aplicarFiltros<Q extends Consulta<Q>>(query: Q, f: FiltrosGastos): Q {
  let q = query;
  if (f.soloPendientes) q = q.eq('status', 'pending_review');
  if (f.mes) q = q.gte('expense_date', `${f.mes}-01`).lt('expense_date', mesSiguiente(f.mes));
  if (f.monto) {
    // Un valor: los gastos de más o menos eso (o un comercio que lo diga, como «La 33»)
    const margen = Math.round(f.monto * MARGEN);
    const desde = f.monto - margen;
    const hasta = f.monto + margen;
    q = q.or(`and(total_cop.gte.${desde},total_cop.lte.${hasta}),merchant_normalized.ilike.%${f.busqueda}%`);
  } else if (f.busqueda) q = q.ilike('merchant_normalized', `%${f.busqueda}%`);
  if (f.cat) q = q.eq('category_id', f.cat);
  if (f.quien) q = q.eq('payer_person_id', f.quien);
  if (porValor(f)) q = q.order('total_cop', { ascending: f.orden === 'menor' });
  const asc = f.orden === 'antiguos';
  return q.order('expense_date', { ascending: asc }).order('created_at', { ascending: asc });
}
