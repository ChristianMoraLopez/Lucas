import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, GASTO_ASADERO, one, P, U } from './harness';

// La propina aparte también se reescala al cambiar el total en pesos (00000000000430_propina_al_cambiar_el_total.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const { paseoValeria: VALE, paseoSanti: SANTI, caro: CARO, felipe: FELIPE } = P;

describe('propina y moneda', () => {
  it('lo que de verdad cobró la tarjeta: ítems, propina y partes en la misma proporción', async () => {
    await as(db, U.laura, async (tx) => {
      // La factura ($272.500) con 10 % de propina aparte: $299.750 entre cuatro
      await tx.query('select public.split_by_consumption($1, null, $2, $3, 10, 27250)', [
        GASTO_ASADERO,
        JSON.stringify([
          { name: 'Picada para 8', total_cop: 180_000, people: [] },
          { name: 'Limonada de coco', quantity: 5, total_cop: 47_500, people: [] },
          { name: 'Patacones', quantity: 3, total_cop: 45_000, people: [] },
        ]),
        JSON.stringify([
          { person_id: VALE, amount_cop: 74_938 },
          { person_id: CARO, amount_cop: 74_938 },
          { person_id: SANTI, amount_cop: 74_937 },
          { person_id: FELIPE, amount_cop: 74_937 },
        ]),
      ]);
      // Era en pesos chilenos y la tarjeta cobró $301.000
      await tx.query('select public.set_expense_currency($1, $2, $3, $4, $5, $6, $7)', [GASTO_ASADERO, 'CLP', 92_700, 3.247, '2026-09-28', 301_000, null]);
      const g = await one<{ total: number; tip: number; items: number; partes: number }>(
        tx,
        `select e.total_cop::int as total, e.tip_cop::int as tip,
           (select sum(i.total_cop)::int from public.expense_items i where i.expense_id = e.id) as items,
           (select sum(s.amount_cop)::int from public.expense_splits s where s.expense_id = e.id) as partes
         from public.expenses e where e.id = $1`,
        [GASTO_ASADERO],
      );
      expect(g.total).toBe(301_000);
      expect(g.partes).toBe(301_000);
      // $27.250 × 301.000 / 299.750
      expect(g.tip).toBe(27_364);
      // Los ítems más la propina siguen dando el total (±1 por ítem, por el redondeo)
      expect(Math.abs(g.items + g.tip - g.total)).toBeLessThanOrEqual(3);
    });
  });

  it('sin propina aparte, nada cambia en eso', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.query('select public.set_expense_currency($1, $2, $3, $4, $5, $6, $7)', [GASTO_ASADERO, 'CLP', 65_300, 4.17, '2026-09-28', 272_301, null]);
      expect(await one(tx, 'select tip_cop::int as tip from public.expenses where id = $1', [GASTO_ASADERO])).toEqual({ tip: 0 });
    });
  });
});
