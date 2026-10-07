/* Fechas en español colombiano (o en inglés de Estados Unidos). Las columnas
   `date` de Postgres llegan como 'AAAA-MM-DD': se leen por partes para que la
   zona horaria no corra el día. Las horas son las de Bogotá. */

import type { Idioma } from '@/lib/i18n';

const MESES: Record<Idioma, string[]> = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const MESES_LARGOS: Record<Idioma, string[]> = {
  es: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

type Dia = { y: number; m: number; d: number };

function parts(value: string | Date): Dia {
  // Un instante (timestamptz) es el día que era en Bogotá: igual en el servidor (UTC) y en el celular
  if (value instanceof Date) return parts(todayInBogota(value));
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

/** Hoy en Bogotá como 'AAAA-MM-DD' (el servidor puede estar en UTC). */
export function todayInBogota(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now);
}

/** '2026-10-05' → '5 oct' (con año si no es el de `ref`); en inglés, 'Oct 5' / 'Oct 5, 2025' */
export function formatDay(value: string | Date, ref: string = todayInBogota(), idioma: Idioma = 'es') {
  const p = parts(value);
  const sameYear = p.y === parts(ref).y;
  const mes = MESES[idioma][p.m - 1];
  if (idioma === 'en') return `${mes} ${p.d}${sameYear ? '' : `, ${p.y}`}`;
  return `${p.d} ${mes}${sameYear ? '' : ` ${p.y}`}`;
}

/** '24 – 28 sep 2026', '30 sep – 2 oct 2026', '28 dic 2026 – 3 ene 2027'; en inglés, 'Sep 24 – 28, 2026'… */
export function formatRange(start: string | null, end: string | null, idioma: Idioma = 'es') {
  if (!start && !end) return null;
  const M = MESES[idioma];
  const en = idioma === 'en';
  if (!start || !end || start === end) {
    const p = parts((start ?? end) as string);
    return en ? `${M[p.m - 1]} ${p.d}, ${p.y}` : `${p.d} ${M[p.m - 1]} ${p.y}`;
  }
  const a = parts(start);
  const b = parts(end);
  if (en) {
    if (a.y !== b.y) return `${M[a.m - 1]} ${a.d}, ${a.y} – ${M[b.m - 1]} ${b.d}, ${b.y}`;
    if (a.m !== b.m) return `${M[a.m - 1]} ${a.d} – ${M[b.m - 1]} ${b.d}, ${b.y}`;
    return `${M[a.m - 1]} ${a.d} – ${b.d}, ${b.y}`;
  }
  if (a.y !== b.y) return `${a.d} ${M[a.m - 1]} ${a.y} – ${b.d} ${M[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${M[a.m - 1]} – ${b.d} ${M[b.m - 1]} ${b.y}`;
  return `${a.d} – ${b.d} ${M[b.m - 1]} ${b.y}`;
}

/** 'sep' / 'Sep' */
export function mesCorto(value: string | Date, idioma: Idioma = 'es') {
  return MESES[idioma][parts(value).m - 1];
}

/** 'Septiembre' / 'September' */
export function monthName(value: string | Date = todayInBogota(), idioma: Idioma = 'es') {
  return MESES_LARGOS[idioma][parts(value).m - 1];
}

function daysBetween(a: string, b: string) {
  const pa = parts(a);
  const pb = parts(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** Estado de un evento en palabras: 'Empieza mañana', 'Va en el día 2', 'Terminó ayer'… (o en inglés) */
export function eventMoment(start: string | null, end: string | null, today: string = todayInBogota(), idioma: Idioma = 'es') {
  const en = idioma === 'en';
  if (start && daysBetween(today, start) > 0) {
    const n = daysBetween(today, start);
    if (en) return n === 1 ? 'Starts tomorrow' : `Starts in ${n} days`;
    return n === 1 ? 'Empieza mañana' : `Empieza en ${n} días`;
  }
  if (end && daysBetween(end, today) > 0) {
    const n = daysBetween(end, today);
    if (en) return n === 1 ? 'Ended yesterday' : `Ended ${n} days ago`;
    return n === 1 ? 'Terminó ayer' : `Terminó hace ${n} días`;
  }
  if (start) {
    const n = daysBetween(start, today) + 1;
    if (en) return n === 1 ? 'Started today' : `Day ${n}`;
    return n === 1 ? 'Empezó hoy' : `Va en el día ${n}`;
  }
  return en ? 'In progress' : 'En curso';
}

/** '26 sep · 11:52 p. m.' (hora de Bogotá); en inglés, 'Sep 26 · 11:52 PM' */
export function formatWhen(iso: string, idioma: Idioma = 'es') {
  const d = new Date(iso);
  const p = parts(d);
  const hora = espacios(
    new Intl.DateTimeFormat(idioma === 'en' ? 'en-US' : 'es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' }).format(d),
  );
  if (idioma === 'en') return `${MESES.en[p.m - 1]} ${p.d} · ${hora}`;
  const dia = espacios(new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' }).format(d).replace('.', ''));
  return `${dia} · ${hora}`;
}

/**
 * Intl separa «9:48 p. m.» con espacios especiales que cambian según la versión
 * (el servidor y cada navegador traen la suya): con espacios normales, el texto
 * es el mismo en todos y React no ve diferencias al hidratar.
 */
function espacios(s: string) {
  return s.replace(/[\u00A0\u202F\u2009]/g, ' ');
}

/** 'Hoy 7:42', 'Ayer 19:10' o '27 sep' para listas de gastos ('Today 7:42 PM', 'Yesterday'…) */
export function formatRecent(date: string, createdAt?: string, today: string = todayInBogota(), idioma: Idioma = 'es') {
  const dias = daysBetween(date, today);
  const en = idioma === 'en';
  const hora = createdAt
    ? espacios(
        new Intl.DateTimeFormat(en ? 'en-US' : 'es-CO', {
          hour: 'numeric',
          minute: '2-digit',
          ...(en ? {} : { hourCycle: 'h23' as const }),
          timeZone: 'America/Bogota',
        }).format(new Date(createdAt)),
      )
    : '';
  const hoy = en ? 'Today' : 'Hoy';
  const ayer = en ? 'Yesterday' : 'Ayer';
  if (dias === 0) return hora ? `${hoy} ${hora}` : hoy;
  if (dias === 1) return hora ? `${ayer} ${hora}` : ayer;
  return formatDay(date, today, idioma);
}

/** '2026-09-28' → '28/09/2026'; en inglés, '09/28/2026' */
export function formatDateCO(date: string, idioma: Idioma = 'es') {
  const p = parts(date);
  const d = String(p.d).padStart(2, '0');
  const m = String(p.m).padStart(2, '0');
  return idioma === 'en' ? `${m}/${d}/${p.y}` : `${d}/${m}/${p.y}`;
}

/** ¿Pasaron menos de `days` días desde `iso`? */
export function isRecent(iso: string, days: number, now = new Date()) {
  return now.getTime() - new Date(iso).getTime() < days * 86_400_000;
}
