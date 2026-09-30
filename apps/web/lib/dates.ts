/* Fechas en español colombiano. Las columnas `date` de Postgres llegan como
   'AAAA-MM-DD': se leen por partes para que la zona horaria no corra el día. */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

type Dia = { y: number; m: number; d: number };

function parts(value: string | Date): Dia {
  if (value instanceof Date) return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

/** Hoy en Bogotá como 'AAAA-MM-DD' (el servidor puede estar en UTC). */
export function todayInBogota(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now);
}

/** '2026-10-05' → '5 oct' (con año si no es el de `ref`) */
export function formatDay(value: string | Date, ref: string = todayInBogota()) {
  const p = parts(value);
  const sameYear = p.y === parts(ref).y;
  return `${p.d} ${MESES[p.m - 1]}${sameYear ? '' : ` ${p.y}`}`;
}

/** '24 – 28 sep 2026', '30 sep – 2 oct 2026', '28 dic 2026 – 3 ene 2027' */
export function formatRange(start: string | null, end: string | null) {
  if (!start && !end) return null;
  if (!start || !end || start === end) {
    const p = parts((start ?? end) as string);
    return `${p.d} ${MESES[p.m - 1]} ${p.y}`;
  }
  const a = parts(start);
  const b = parts(end);
  if (a.y !== b.y) return `${a.d} ${MESES[a.m - 1]} ${a.y} – ${b.d} ${MESES[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${MESES[a.m - 1]} – ${b.d} ${MESES[b.m - 1]} ${b.y}`;
  return `${a.d} – ${b.d} ${MESES[b.m - 1]} ${b.y}`;
}

/** 'Septiembre' */
export function monthName(value: string | Date = todayInBogota()) {
  return MESES_LARGOS[parts(value).m - 1];
}

function daysBetween(a: string, b: string) {
  const pa = parts(a);
  const pb = parts(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** Estado de un evento en palabras: 'Empieza mañana', 'Va en el día 2', 'Terminó ayer'… */
export function eventMoment(start: string | null, end: string | null, today: string = todayInBogota()) {
  if (start && daysBetween(today, start) > 0) {
    const n = daysBetween(today, start);
    return n === 1 ? 'Empieza mañana' : `Empieza en ${n} días`;
  }
  if (end && daysBetween(end, today) > 0) {
    const n = daysBetween(end, today);
    return n === 1 ? 'Terminó ayer' : `Terminó hace ${n} días`;
  }
  if (start) {
    const n = daysBetween(start, today) + 1;
    return n === 1 ? 'Empezó hoy' : `Va en el día ${n}`;
  }
  return 'En curso';
}

/** ¿Pasaron menos de `days` días desde `iso`? */
export function isRecent(iso: string, days: number, now = new Date()) {
  return now.getTime() - new Date(iso).getTime() < days * 86_400_000;
}
