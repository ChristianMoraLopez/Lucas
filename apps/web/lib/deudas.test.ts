import { describe, expect, it } from 'vitest';
import { porPersona } from './deudas';
import type { SettlementExpense, SettlementTransfer } from './types';

// Como DaniChile: Bruna la pagó Santi (y Christian ya se la pagó antes de reabrir),
// Místico lo pagó Dani y es lo único que le falta a Christian
const gasto = (id: string, merchant: string, payer: string, shares: Record<string, number>): SettlementExpense => ({
  id,
  merchant,
  expense_date: '2026-10-18',
  total_cop: Object.values(shares).reduce((s, x) => s + x, 0),
  status: 'confirmed',
  payer_person_id: payer,
  category: null,
  category_letter: null,
  category_tone: null,
  shares: Object.entries(shares).map(([person_id, amount_cop]) => ({ person_id, amount_cop })),
});
const transfer = (from: string, to: string, amount: number, paid_at: string | null = null): SettlementTransfer => ({
  id: `${from}-${to}`,
  from,
  to,
  amount,
  paid_at,
  paid_by: null,
});

const people = ['christian', 'dani', 'santi', 'mari'].map((id) => ({ id }));
const bruna = gasto('bruna', 'Bruna', 'santi', { christian: 37_269, dani: 37_269, santi: 37_269, mari: 37_269 });
const mistico = gasto('mistico', 'Místico', 'dani', { christian: 50_351, dani: 50_000, santi: 30_000, mari: 40_000 });
const payments = [{ id: 'p1', from: 'christian', to: 'santi', amount: 37_269, paid_at: '2026-10-18T14:34:18Z' }];

describe('liquidar por persona', () => {
  it('abre tu nombre: lo que falta, a quién, por qué, y lo que ya pagaste', () => {
    const transfers = [
      transfer('christian', 'dani', 50_351),
      transfer('santi', 'dani', 30_000),
      transfer('mari', 'dani', 40_000),
      transfer('mari', 'santi', 37_269),
    ];
    const [yo, ...resto] = porPersona({ people, expenses: [bruna, mistico], transfers, payments, cruza: false, yo: 'christian' });

    expect(yo.person).toBe('christian');
    expect(yo.pendiente).toBe(50_351);
    expect(yo.deudas.map((d) => [d.to, d.estado, d.monto])).toEqual([
      ['dani', 'pendiente', 50_351],
      ['santi', 'ya_pagada', 37_269],
    ]);
    const [aDani, aSanti] = yo.deudas;
    expect(aDani.gastos.map((g) => [g.e.merchant, g.r.parte])).toEqual([['Místico', 50_351]]);
    expect(aSanti.gastos.map((g) => g.e.merchant)).toEqual(['Bruna']);
    expect(aSanti.paidAt).toBe('2026-10-18T14:34:18Z');

    // Quien más debe va después de ti; a quien solo le pagan, al final
    expect(resto.map((t) => t.person)).toEqual(['mari', 'santi', 'dani']);
    const dani = resto.find((t) => t.person === 'dani');
    expect(dani?.pendiente).toBe(0);
    expect(dani?.porRecibir).toBe(50_351 + 30_000 + 40_000);
    expect(dani?.cobros).toHaveLength(3);
  });

  it('lo que el otro le debía se resta, y si se cruza del todo, quedan a mano', () => {
    // Santi le debe a Dani 30.000 de Místico; Dani le debía 37.269 de Bruna: Dani le paga la diferencia
    const transfers = [transfer('dani', 'santi', 7_269)];
    const tarjetas = porPersona({ people, expenses: [bruna, mistico], transfers, cruza: false });
    const santi = tarjetas.find((t) => t.person === 'santi');
    expect(santi?.deudas.find((d) => d.to === 'dani')).toMatchObject({ estado: 'a_mano', monto: 0, cruce: 37_269 });
    const dani = tarjetas.find((t) => t.person === 'dani');
    expect(dani?.deudas.find((d) => d.to === 'santi')).toMatchObject({ estado: 'pendiente', monto: 7_269, cruce: 30_000 });
    expect(dani?.deudas.find((d) => d.to === 'santi')?.gastos.map((g) => g.r.parte)).toEqual([37_269]);
  });

  it('una pagada sale pagada, y cruzando las deudas solo cuentan las transferencias', () => {
    const transfers = [transfer('christian', 'dani', 50_351, '2026-10-19T10:00:00Z')];
    const [yo] = porPersona({ people, expenses: [bruna, mistico], transfers, cruza: true, yo: 'christian' });
    expect(yo.deudas.map((d) => [d.to, d.estado])).toEqual([['dani', 'pagada']]);
    expect(yo.pendiente).toBe(0);
    expect(yo.deudas[0].cruce).toBe(0);
  });

  it('quien no paga ni recibe nada no sale', () => {
    expect(porPersona({ people, expenses: [], transfers: [], cruza: false })).toEqual([]);
  });
});
