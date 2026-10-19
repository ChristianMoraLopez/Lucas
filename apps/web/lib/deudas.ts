/* Liquidar, una tarjeta por persona: al abrir su nombre ve a quién le paga,
   cuánto y por qué (los gastos que esa persona pagó por ella, ítem por ítem),
   lo que ya le pagó y lo que se cruzó. Con muchos cruces, la lista de
   transferencias sola no dice por qué Bruna no sale (ya se la pagó a Santi). */

import { type Recibo, reciboDe } from './recibo';
import type { SettlementExpense, SettlementPayment, SettlementTransfer } from './types';

/** Un gasto que `to` pagó por la persona, con lo suyo */
export interface PorQue {
  e: SettlementExpense;
  r: Recibo;
}

export type EstadoDeuda =
  /** Falta pagarla (o, antes de liquidar, así quedaría) */
  | 'pendiente'
  /** La marcaron pagada */
  | 'pagada'
  /** Ya se la pagó antes de que se reabriera la liquidación */
  | 'ya_pagada'
  /** Se cruza con lo que `to` le debía: no hay nada que pagar */
  | 'a_mano';

export interface Deuda {
  to: string;
  estado: EstadoDeuda;
  /** Lo que falta (pendiente), lo que pagó (pagada / ya_pagada) o 0 */
  monto: number;
  transfer: SettlementTransfer | null;
  /** Cuándo se pagó */
  paidAt: string | null;
  gastos: PorQue[];
  /** Lo que `to` le debía (su parte de lo que pagó la persona): se resta */
  cruce: number;
  /** Lo que ya le había pagado (liquidaciones que se reabrieron) */
  pagado: number;
  /** Lo que `to` ya le había pagado a ella */
  devuelto: number;
}

export interface Tarjeta {
  person: string;
  deudas: Deuda[];
  /** Lo que le falta pagar */
  pendiente: number;
  /** Quiénes le pagan a ella (pagadas o no) */
  cobros: SettlementTransfer[];
  /** Lo que le falta recibir */
  porRecibir: number;
}

const ORDEN: Record<EstadoDeuda, number> = { pendiente: 0, pagada: 1, ya_pagada: 2, a_mano: 3 };

/**
 * Una tarjeta por cada quien que paga o recibe algo: primero la tuya, después
 * quien más debe. `cruza`: se cruzaron las deudas (entonces solo cuentan las
 * transferencias; no a quien pagó por ella).
 */
export function porPersona({
  people,
  expenses,
  transfers,
  payments = [],
  cruza,
  yo = null,
}: {
  people: { id: string }[];
  expenses: SettlementExpense[];
  transfers: SettlementTransfer[];
  payments?: SettlementPayment[];
  cruza: boolean;
  yo?: string | null;
}): Tarjeta[] {
  const suma = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
  const ultima = (xs: { paid_at: string }[]) => xs.reduce<string | null>((u, x) => (!u || x.paid_at > u ? x.paid_at : u), null);
  const tarjetas: Tarjeta[] = [];

  for (const { id } of people) {
    // A quiénes: las transferencias, lo ya pagado y, sin cruzar, quien pagó algo suyo
    const aQuien = new Set<string>([...transfers.filter((x) => x.from === id).map((x) => x.to), ...payments.filter((x) => x.from === id).map((x) => x.to)]);
    if (!cruza) {
      for (const e of expenses) {
        if (e.payer_person_id && e.payer_person_id !== id && reciboDe(e, id)) aQuien.add(e.payer_person_id);
      }
    }

    const deudas = [...aQuien].map((to): Deuda => {
      const gastos = expenses.flatMap((e) => {
        const r = e.payer_person_id === to ? reciboDe(e, id) : null;
        return r ? [{ e, r }] : [];
      });
      const cruce = cruza ? 0 : expenses.filter((e) => e.payer_person_id === id).reduce((s, e) => s + (reciboDe(e, to)?.parte ?? 0), 0);
      const pagos = payments.filter((x) => x.from === id && x.to === to);
      const devuelto = suma(payments.filter((x) => x.from === to && x.to === id));
      const transfer = transfers.find((x) => x.from === id && x.to === to) ?? null;
      const pagado = suma(pagos);
      const base = { to, transfer, gastos, cruce, pagado, devuelto };
      if (transfer) {
        return { ...base, estado: transfer.paid_at ? 'pagada' : 'pendiente', monto: transfer.amount, paidAt: transfer.paid_at };
      }
      if (pagado > 0) return { ...base, estado: 'ya_pagada', monto: pagado, paidAt: ultima(pagos) };
      return { ...base, estado: 'a_mano', monto: 0, paidAt: null };
    });
    deudas.sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || b.monto - a.monto);

    const cobros = transfers.filter((x) => x.to === id);
    if (!deudas.length && !cobros.length) continue;
    tarjetas.push({
      person: id,
      deudas,
      pendiente: deudas.reduce((s, d) => s + (d.estado === 'pendiente' ? d.monto : 0), 0),
      cobros,
      porRecibir: cobros.reduce((s, x) => s + (x.paid_at ? 0 : x.amount), 0),
    });
  }

  // La tuya primero; después quien más debe y, al final, a quienes solo les pagan
  const peso = (t: Tarjeta) => (t.person === yo ? 0 : t.pendiente > 0 ? 1 : t.porRecibir > 0 ? 2 : 3);
  return tarjetas.sort((a, b) => peso(a) - peso(b) || b.pendiente - a.pendiente || b.porRecibir - a.porRecibir);
}
