/* Lo de cada uno en un gasto: los ítems que pidió (con su parte en plata) y
   lo demás (propina, servicio, lo que alguien puso de más). Para el link
   público y el mensaje de cobro: que cada quien vea qué le cobran. */

import type { SettlementExpense } from './types';

export interface LineaRecibo {
  name: string;
  /** Cuántas unidades fueron suyas (si el ítem traía varias) */
  units: number | null;
  /** Entre cuántos se partió (1 = solo suyo) */
  entre: number;
  amount: number;
}

export interface Recibo {
  /** Lo que le toca del gasto (su parte en la división) */
  parte: number;
  items: LineaRecibo[];
  /** Parte − ítems: propina, servicio o ajustes (negativo: alguien puso más por él) */
  resto: number;
}

/** Lo de `personId` en el gasto; null si no le toca nada */
export function reciboDe(e: Pick<SettlementExpense, 'shares' | 'items'>, personId: string): Recibo | null {
  const parte = e.shares.find((s) => s.person_id === personId)?.amount_cop ?? 0;
  if (!parte) return null;
  const estaban = e.shares.filter((s) => s.amount_cop > 0).map((s) => s.person_id);
  const items: LineaRecibo[] = [];
  for (const it of e.items ?? []) {
    const total = Number(it.total) || 0;
    if (!total) continue;
    const pidieron = it.people.length ? it.people : estaban.map((id) => ({ id, units: 1 }));
    const mio = pidieron.find((p) => p.id === personId);
    if (!mio) continue;
    const unidades = pidieron.reduce((s, p) => s + (Number(p.units) || 1), 0);
    const suyas = Number(mio.units) || 1;
    // «2 de las 3 Coca-Colas»: solo si marcaron quiénes (entre todos, se dice entre cuántos)
    const varias = it.people.length > 1 && Number(it.quantity) > 1;
    items.push({
      name: it.name,
      units: varias ? suyas : null,
      entre: pidieron.length,
      amount: Math.round((total * suyas) / unidades),
    });
  }
  return { parte, items, resto: items.length ? parte - items.reduce((s, i) => s + i.amount, 0) : 0 };
}
