/* Compartir las cuentas con quien no usa la app (el link /r/TOKEN) y cobrar
   por WhatsApp. Funciones puras: las usan Liquidar y la página pública. */

import { crearT, type Idioma, type T } from '@/lib/i18n';
import { corto, DECIMALES, dinero, type Moneda } from '@/lib/moneda';
import { reciboDe } from './recibo';
import { aQuienPagoPor, minTransfers } from './settlement';
import type { SettlementExpense, SettlementPerson, SettlementTransfer } from './types';

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
  detalle = [],
  t = ES,
  moneda = 'COP',
}: {
  debtor: string;
  creditor: string;
  amount: number;
  accountName: string;
  link?: string | null;
  creditorIsMe: boolean;
  /** Lo suyo, gasto por gasto (detalleCobro) */
  detalle?: string[];
  t?: T;
  moneda?: Moneda;
}) {
  const vars = { nombre: debtor, cuenta: accountName, monto: plata(amount, t, moneda), acreedor: creditor };
  const lineas = [
    creditorIsMe ? t('Hola {nombre} 👋 De «{cuenta}» me debes {monto}.', vars) : t('Hola {nombre} 👋 De «{cuenta}» le debes a {acreedor} {monto}.', vars),
  ];
  if (detalle.length) lineas.push('', ...detalle);
  if (link && detalle.length) lineas.push('');
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

type DatosLiquidar = {
  people: Pick<SettlementPerson, 'id' | 'name' | 'balance'>[];
  expenses?: Pick<SettlementExpense, 'payer_person_id' | 'shares'>[];
  direct?: boolean;
  direct_transfers?: { from: string; to: string; amount: number }[];
};

/** Quién pagó algo de cada uno: deudor → los que pagaron gastos en los que tuvo parte */
export function pagaronPorDe(expenses: Pick<SettlementExpense, 'payer_person_id' | 'shares'>[]) {
  const out = new Map<string, Set<string>>();
  for (const e of expenses) {
    if (!e.payer_person_id) continue;
    for (const s of e.shares) {
      if (s.person_id === e.payer_person_id || s.amount_cop <= 0) continue;
      if (!out.has(s.person_id)) out.set(s.person_id, new Set());
      out.get(s.person_id)?.add(e.payer_person_id);
    }
  }
  return out;
}

/**
 * Cómo quedarían si se liquidara hoy (migración 400): cada quien le paga solo
 * a quien pagó algo suyo, con pocas transferencias (si así no cuadra, pareja
 * por pareja, como las calcula la base); o, si la cuenta cruza las deudas, el
 * mínimo de transferencias.
 */
export function calcularTransferencias(d: DatosLiquidar) {
  const saldos = d.people.map((p) => ({ id: p.id, name: p.name, balance: p.balance }));
  if (d.direct !== false && d.direct_transfers) {
    const directas = d.expenses ? aQuienPagoPor(saldos, pagaronPorDe(d.expenses)) : null;
    return directas ?? d.direct_transfers.map((x) => ({ from: x.from, to: x.to, amount: Number(x.amount) }));
  }
  return minTransfers(saldos);
}

/** Se cruzan las deudas (la cuenta lo eligió, o la base todavía no trae las directas) */
export const cruzaDeudas = (d: DatosLiquidar) => !(d.direct !== false && d.direct_transfers);

/** Quién le paga a quién: las que se guardaron al liquidar o, si no, el cálculo. */
export function transfersFor(d: DatosLiquidar & { settlement: { transfers: SettlementTransfer[] } | null }): Transferencia[] {
  if (d.settlement) return d.settlement.transfers;
  try {
    return calcularTransferencias(d).map((t) => ({ ...t, paid_at: null }));
  } catch {
    return [];
  }
}

/**
 * Para el mensaje de cobro: lo que le tocó al deudor, ítem por ítem en los
 * gastos divididos por consumo (en los demás, su parte), y cómo se reparte lo
 * que debe si le paga a varios. Si le paga a alguien que no pagó nada suyo (se
 * cruzaron las deudas), por qué.
 *
 *   🧾 *Lo tuyo, ítem por ítem:*
 *
 *   *Le Due Torri* (pagó Daniel)
 *   • Coca Cola Zero (2 de 3): $20.000
 *   • Ravioli: $90.000
 *   • Propina y servicio: $55.000
 *   Total: *$165.000*
 *
 *   *Bruna* (pagó Santiago)
 *   • Tu parte (entre 6): $30.000
 *
 *   Le pagas $150.000 a Daniel y $45.000 a Santiago.
 */
export function detalleCobro({
  expenses,
  debtorId,
  creditorId,
  transfers,
  nombre,
  t = ES,
  moneda = 'COP',
}: {
  expenses: Pick<SettlementExpense, 'merchant' | 'payer_person_id' | 'shares' | 'items'>[];
  debtorId: string;
  creditorId: string;
  /** Todas las transferencias (se usan las del deudor) */
  transfers: Pick<Transferencia, 'from' | 'to' | 'amount'>[];
  nombre: (personId: string) => string;
  t?: T;
  moneda?: Moneda;
}) {
  const $ = (n: number) => dinero(n, moneda, t.idioma);
  const gastos = expenses
    .filter((e) => e.payer_person_id && e.payer_person_id !== debtorId)
    .flatMap((e) => {
      const r = reciboDe(e, debtorId);
      return r ? [{ e, r }] : [];
    });
  if (!gastos.length) return [];
  const conItems = gastos.some((x) => x.r.items.length > 0);
  const lineas = [conItems ? t('🧾 *Lo tuyo, ítem por ítem:*') : t('🧾 *Lo tuyo:*')];
  const MAX_GASTOS = 6;
  const MAX_ITEMS = 12;
  for (const { e, r } of gastos.slice(0, MAX_GASTOS)) {
    lineas.push('', t('*{comercio}* (pagó {nombre})', { comercio: sinFormato(e.merchant), nombre: sinFormato(nombre(e.payer_person_id as string)) }));
    if (!r.items.length) {
      const entre = e.shares.filter((x) => x.amount_cop > 0).length;
      lineas.push(`• ${entre > 1 ? t('Tu parte (entre {n})', { n: entre }) : t('Tu parte')}: ${$(r.parte)}`);
      continue;
    }
    for (const i of r.items.slice(0, MAX_ITEMS)) {
      const cuantas = i.units ? t('{n} de {total}', { n: i.units, total: i.de }) : i.entre > 1 ? t('entre {n}', { n: i.entre }) : '';
      lineas.push(`• ${sinFormato(i.name)}${cuantas ? ` (${cuantas})` : ''}: ${$(i.amount)}`);
    }
    if (r.items.length > MAX_ITEMS) lineas.push(`• ${t('… y {n} más en el link', { n: r.items.length - MAX_ITEMS })}`);
    if (Math.abs(r.resto) > r.items.length) {
      lineas.push(r.resto > 0 ? `• ${t('Propina y servicio')}: ${$(r.resto)}` : `• ${t('Lo que otro puso de más')}: −${$(-r.resto)}`);
    }
    lineas.push(t('Total: {monto}', { monto: `*${$(r.parte)}*` }));
  }
  if (gastos.length > MAX_GASTOS) lineas.push('', t('… y {n} más en el link', { n: gastos.length - MAX_GASTOS }));

  const suyas = transfers.filter((x) => x.from === debtorId);
  const debe = suyas.reduce((s, x) => s + x.amount, 0);
  const consumo = gastos.reduce((s, x) => s + x.r.parte, 0);
  const cierre: string[] = [];
  // Lo que pagó por otros (o ya pagó) le baja lo que debe
  if (consumo > debe) cierre.push(t('➖ {monto} de lo que tú pagaste por otros o ya pagaste', { monto: $(consumo - debe) }));
  if (suyas.length > 1) {
    const cada = suyas.map((x) => t('{monto} a {nombre}', { monto: $(x.amount), nombre: sinFormato(nombre(x.to)) }));
    cierre.push(t('Le pagas {lista}.', { lista: `${cada.slice(0, -1).join(', ')}${t(' y ')}${cada.at(-1)}` }));
  }
  if (!gastos.some((x) => x.e.payer_person_id === creditorId)) {
    cierre.push(t('Se cruzaron las deudas para hacer menos transferencias: por eso le pagas a {nombre}.', { nombre: sinFormato(nombre(creditorId)) }));
  }
  if (cierre.length) lineas.push('', ...cierre);
  return lineas;
}

/** Lo de una persona: a quién le paga y quién le paga a ella. */
export function personView(personId: string, transfers: Transferencia[]) {
  return {
    debe: transfers.filter((t) => t.from === personId),
    recibe: transfers.filter((t) => t.to === personId),
  };
}
