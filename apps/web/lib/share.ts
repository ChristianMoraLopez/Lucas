/* Compartir las cuentas con quien no usa la app (el link /r/TOKEN) y cobrar
   por WhatsApp. Funciones puras: las usan Liquidar y la página pública. */

import { formatCOP, lucas } from '@/components/lucas-core';
import { minTransfers } from './settlement';
import type { SettlementPerson, SettlementTransfer } from './types';

/** El dominio que se muestra como publicidad en los mensajes y en la página pública */
export const MARCA = 'mrluks.com';
export const MARCA_URL = `https://${MARCA}`;

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
  lineas.push('', `Cuentas hechas con Luks · ${MARCA}`);
  return lineas.join('\n');
}

/** Para mandar al grupo: el total y el link donde cada uno ve lo suyo */
export function resumenMessage({ accountName, total, people, link }: { accountName: string; total: number; people: number; link: string }) {
  return [
    `Las cuentas de «${accountName}»: gastamos ${formatCOP(total)} entre ${people}.`,
    `Cada uno ve aquí cuánto le toca y a quién le paga: ${link}`,
    '',
    `Hecho con Luks · ${MARCA}`,
  ].join('\n');
}

export type Transferencia = Pick<SettlementTransfer, 'from' | 'to' | 'amount' | 'paid_at'>;

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
