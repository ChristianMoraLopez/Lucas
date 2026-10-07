/* Compartir las cuentas con quien no usa la app (el link /r/TOKEN) y cobrar
   por WhatsApp. Funciones puras: las usan Liquidar y la página pública. */

import { crearT, type Idioma, type T } from '@/lib/i18n';
import { corto, DECIMALES, dinero, type Moneda } from '@/lib/moneda';
import { minTransfers } from './settlement';
import type { SettlementPerson, SettlementTransfer } from './types';

const ES = crearT('es');

/** La plata en el mensaje: «$45.000 (45 lucas)» en pesos y en español; si no, solo el monto */
function plata(n: number, t: T, moneda: Moneda, conCorto = true) {
  const m = dinero(n, moneda, t.idioma);
  return conCorto && t.idioma === 'es' && !DECIMALES[moneda] ? `${m} (${corto(n, moneda, 'es')})` : m;
}

/** El dominio que se muestra como publicidad en los mensajes y en la página pública */
export const MARCA = 'mrluks.com';
export const MARCA_URL = `https://${MARCA}`;
/** La publicidad que va en los mensajes, la imagen del link y la página pública */
export const publicidad = (t: T = ES) => t('Esto se hizo en {marca}', { marca: MARCA });
export const PUBLICIDAD = publicidad();

/** Para recomendar Luks a otros (el home): el mensaje y el link */
export function recomendacionMessage(t: T = ES) {
  return {
    url: MARCA_URL,
    texto: [
      t('Te recomiendo *Luks* 🧾'),
      '',
      t('👥 *Para las cuentas del grupo:* mandan la foto del recibo al grupo de WhatsApp y Luks anota el gasto, lo divide y dice quién le paga a quién.'),
      '',
      t(
        '🙋 *Y para tus gastos personales:* arma un grupo de WhatsApp contigo mismo (solo tú y Luks), mándate ahí tus facturas y Luks las organiza por categoría para que las veas en la app.',
      ),
      '',
      t('Es gratis 👉 {url}', { url: MARCA_URL }),
    ].join('\n'),
  };
}

/**
 * /r/TOKEN, con la vista de una persona (?p=) y el mes de un hogar
 * (?mes=2026-09). Si el mensaje va en inglés, la página también (?l=en).
 */
export function sharedLink(origin: string, token: string, o: { person?: string | null; month?: string | null; idioma?: Idioma } = {}) {
  const q = new URLSearchParams();
  if (o.person) q.set('p', o.person);
  if (o.month) q.set('mes', o.month.slice(0, 7));
  if (o.idioma && o.idioma !== 'es') q.set('l', o.idioma);
  const s = q.toString();
  return `${origin}/r/${token}${s ? `?${s}` : ''}`;
}

/** El link sin protocolo, para mostrarlo: «mrluks.com/r/abc…» */
export function displayShare(link: string) {
  return link.replace(/^https?:\/\//, '');
}

/** «Hola Mafe 👋 De «Noche de bolos» me debes $45.000 (45 lucas)…» */
export function cobroMessage({
  debtor,
  creditor,
  amount,
  accountName,
  link,
  creditorIsMe,
  t = ES,
  moneda = 'COP',
}: {
  debtor: string;
  creditor: string;
  amount: number;
  accountName: string;
  link?: string | null;
  creditorIsMe: boolean;
  t?: T;
  moneda?: Moneda;
}) {
  const vars = { nombre: debtor, cuenta: accountName, monto: plata(amount, t, moneda), acreedor: creditor };
  const lineas = [
    creditorIsMe ? t('Hola {nombre} 👋 De «{cuenta}» me debes {monto}.', vars) : t('Hola {nombre} 👋 De «{cuenta}» le debes a {acreedor} {monto}.', vars),
  ];
  if (link) lineas.push(t('Acá ves cuánto puso cada uno y en qué se fue la plata: {link}', { link }));
  lineas.push('', `_${publicidad(t)}_`);
  return lineas.join('\n');
}

export type Transferencia = Pick<SettlementTransfer, 'from' | 'to' | 'amount' | 'paid_at'>;

/** Los nombres van tal cual, sin los signos con que WhatsApp pone negrilla, cursiva o tachado */
const sinFormato = (s: string) => s.replace(/[*_~`]/g, '').trim();

/**
 * Para mandar al grupo: cuánto fue, quién le paga a quién (las pagadas,
 * tachadas) y el link donde cada uno ve lo suyo. Con el formato de WhatsApp:
 *
 *   🧾 *Noche de bolos*
 *   Gastamos *$480.000* (480 lucas) entre 6: *$80.000* cada uno.
 *
 *   💸 *Quién le paga a quién*
 *   • Mafe → Christian: *$45.000*
 *   • ~Santi → Christian: $45.000~ ✅
 */
export function grupoMessage({
  accountName,
  periodo,
  total,
  people,
  porCabeza,
  transfers,
  nombre,
  liquidada,
  link,
  t = ES,
  moneda = 'COP',
}: {
  accountName: string;
  /** «septiembre 2026» en un hogar; nada en un evento */
  periodo?: string | null;
  total: number;
  people: number;
  /** Lo de cada uno, si a todos les toca lo mismo */
  porCabeza: number | null;
  transfers: Transferencia[];
  nombre: (personId: string) => string;
  liquidada: boolean;
  link?: string | null;
  t?: T;
  moneda?: Moneda;
}) {
  const $ = (n: number) => dinero(n, moneda, t.idioma);
  const lineas = [`🧾 *${sinFormato(accountName)}*${periodo ? ` · ${periodo}` : ''}`];
  const vars = {
    total: `*${$(total)}*${t.idioma === 'es' && !DECIMALES[moneda] ? ` (${corto(total, moneda, 'es')})` : ''}`,
    entre: people === 1 ? t('1 persona') : String(people),
    cada: porCabeza ? `*${$(porCabeza)}*` : '',
  };
  lineas.push(porCabeza ? t('Gastamos {total} entre {entre}: {cada} cada uno.', vars) : t('Gastamos {total} entre {entre}, cada quien su parte.', vars), '');

  if (transfers.length) {
    const pagadas = transfers.filter((x) => x.paid_at).length;
    lineas.push(t('💸 *Quién le paga a quién*'));
    for (const x of transfers) {
      const quien = `${sinFormato(nombre(x.from))} → ${sinFormato(nombre(x.to))}`;
      lineas.push(x.paid_at ? `• ~${quien}: ${$(x.amount)}~ ✅` : `• ${quien}: *${$(x.amount)}*`);
    }
    if (liquidada && pagadas === transfers.length) lineas.push('', t('✅ Todo pagado: quedamos a mano 🙌'));
    else if (pagadas > 0) lineas.push('', t('Van {n} de {total} pagadas.', { n: pagadas, total: transfers.length }));
  } else {
    lineas.push(t('✨ Nadie le debe a nadie: cada quien puso lo suyo.'));
  }

  if (link) lineas.push('', t('👀 Cuánto puso cada uno y en qué se fue la plata:'), link);
  lineas.push('', `_${publicidad(t)}_`);
  return lineas.join('\n');
}

/** Quién le paga a quién: las que se guardaron al liquidar o, si no, el cálculo. */
export function transfersFor(d: {
  people: Pick<SettlementPerson, 'id' | 'name' | 'balance'>[];
  settlement: { transfers: SettlementTransfer[] } | null;
}): Transferencia[] {
  if (d.settlement) return d.settlement.transfers;
  try {
    return minTransfers(d.people.map((p) => ({ id: p.id, name: p.name, balance: p.balance }))).map((t) => ({ ...t, paid_at: null }));
  } catch {
    return [];
  }
}

/** Lo de una persona: a quién le paga y quién le paga a ella. */
export function personView(personId: string, transfers: Transferencia[]) {
  return {
    debe: transfers.filter((t) => t.from === personId),
    recibe: transfers.filter((t) => t.to === personId),
  };
}
