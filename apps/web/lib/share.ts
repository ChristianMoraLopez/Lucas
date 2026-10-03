/* Compartir las cuentas con quien no usa la app (el link /r/TOKEN) y cobrar
   por WhatsApp. Funciones puras: las usan Liquidar y la página pública. */

import { formatCOP, lucas } from '@/components/lucas-core';
import { minTransfers } from './settlement';
import type { SettlementPerson, SettlementTransfer } from './types';

/** El dominio que se muestra como publicidad en los mensajes y en la página pública */
export const MARCA = 'mrluks.com';
export const MARCA_URL = `https://${MARCA}`;
/** La publicidad que va en los mensajes, la imagen del link y la página pública */
export const PUBLICIDAD = `Esto se hizo en ${MARCA}`;

/** /r/TOKEN, con la vista de una persona (?p=) y el mes de un hogar (?mes=2026-09) */
export function sharedLink(origin: string, token: string, o: { person?: string | null; month?: string | null } = {}) {
  const q = new URLSearchParams();
  if (o.person) q.set('p', o.person);
  if (o.month) q.set('mes', o.month.slice(0, 7));
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
}: {
  debtor: string;
  creditor: string;
  amount: number;
  accountName: string;
  link?: string | null;
  creditorIsMe: boolean;
}) {
  const quien = creditorIsMe ? 'me debes' : `le debes a ${creditor}`;
  const lineas = [`Hola ${debtor} 👋 De «${accountName}» ${quien} ${formatCOP(amount)} (${lucas(amount)}).`];
  if (link) lineas.push(`Acá ves cuánto puso cada uno y en qué se fue la plata: ${link}`);
  lineas.push('', `_${PUBLICIDAD}_`);
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
}) {
  const lineas = [`🧾 *${sinFormato(accountName)}*${periodo ? ` · ${periodo}` : ''}`];
  const entre = people === 1 ? '1 persona' : `${people}`;
  lineas.push(
    porCabeza
      ? `Gastamos *${formatCOP(total)}* (${lucas(total)}) entre ${entre}: *${formatCOP(porCabeza)}* cada uno.`
      : `Gastamos *${formatCOP(total)}* (${lucas(total)}) entre ${entre}, cada quien su parte.`,
    '',
  );

  if (transfers.length) {
    const pagadas = transfers.filter((t) => t.paid_at).length;
    lineas.push('💸 *Quién le paga a quién*');
    for (const t of transfers) {
      const quien = `${sinFormato(nombre(t.from))} → ${sinFormato(nombre(t.to))}`;
      lineas.push(t.paid_at ? `• ~${quien}: ${formatCOP(t.amount)}~ ✅` : `• ${quien}: *${formatCOP(t.amount)}*`);
    }
    if (liquidada && pagadas === transfers.length) lineas.push('', '✅ Todo pagado: quedamos a mano 🙌');
    else if (pagadas > 0) lineas.push('', `Van ${pagadas} de ${transfers.length} pagadas.`);
  } else {
    lineas.push('✨ Nadie le debe a nadie: cada quien puso lo suyo.');
  }

  if (link) lineas.push('', '👀 Cuánto puso cada uno y en qué se fue la plata:', link);
  lineas.push('', `_${PUBLICIDAD}_`);
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
