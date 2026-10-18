import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, GASTO_ASADERO, one, P, U } from './harness';

// Propina aparte, ítems extra y unidades (00000000000380_propina_extras_y_unidades.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

// El asadero (por revisar): $272.500 = picada 180.000 + limonadas 47.500 + patacones 45.000
const PICADA = '70000000-0000-4000-8000-000000000005';
const LIMONADA = '70000000-0000-4000-8000-000000000006';
const PATACONES = '70000000-0000-4000-8000-000000000007';
const { paseoValeria: VALE, paseoSanti: SANTI, caro: CARO, felipe: FELIPE } = P;

const DIVIDIR = 'select public.split_by_consumption($1, $2, $3, $4, $5, $6) as r';

type Item = { id?: string | null; name: string; quantity?: number; total_cop: number; people?: string[]; units?: Record<string, number>; extra?: boolean };
const dividir = (tx: Transaction, items: Item[], partes: Record<string, number>, propina: number | null = null, tip = 0) =>
  tx.query<{ r: { total_cop: number; tip_cop: number; extras_cop: number } }>(DIVIDIR, [
    GASTO_ASADERO,
    FELIPE,
    JSON.stringify(items),
    JSON.stringify(Object.entries(partes).map(([person_id, amount_cop]) => ({ person_id, amount_cop }))),
    propina,
    tip,
  ]);

// Las limonadas (5): Vale se tomó 3 y Caro 2. Felipe pidió un postre que no estaba en la factura.
const ITEMS: Item[] = [
  { id: PICADA, name: 'Picada para 8', total_cop: 180_000, people: [] },
  { id: LIMONADA, name: 'Limonada de coco', quantity: 5, total_cop: 47_500, people: [VALE, CARO], units: { [VALE]: 3, [CARO]: 2 } },
  { id: PATACONES, name: 'Patacones', quantity: 3, total_cop: 45_000, people: [SANTI] },
  { name: 'Postre', total_cop: 20_000, people: [FELIPE], extra: true },
];

const gasto = (tx: Transaction) =>
  one<{ total: number; tip: number; pct: string | null; method: string }>(
    tx,
    'select total_cop::int as total, tip_cop::int as tip, tip_percent::text as pct, split_method as method from public.expenses where id = $1',
    [GASTO_ASADERO],
  );

describe('propina aparte, extras y unidades', () => {
  it('la propina y los extras suman al total; cada quien marca cuántas unidades', async () => {
    await as(db, U.laura, async (tx) => {
      // Factura 272.500 + postre 20.000 + 5 % de 292.500 (14.625) = 307.125
      const { rows } = await dividir(tx, ITEMS, { [FELIPE]: 100_000, [VALE]: 70_000, [CARO]: 67_125, [SANTI]: 70_000 }, 5, 14_625);
      expect(rows[0].r).toEqual({ total_cop: 307_125, tip_cop: 14_625, extras_cop: 20_000 });
      expect(await gasto(tx)).toEqual({ total: 307_125, tip: 14_625, pct: '5.00', method: 'items' });

      const { rows: items } = await tx.query<{ name: string; extra: boolean }>(
        'select name, extra from public.expense_items where expense_id = $1 order by created_at',
        [GASTO_ASADERO],
      );
      expect(items).toEqual([
        { name: 'Picada para 8', extra: false },
        { name: 'Limonada de coco', extra: false },
        { name: 'Patacones', extra: false },
        { name: 'Postre', extra: true },
      ]);
      const { rows: unidades } = await tx.query<{ person_id: string; units: string }>(
        'select person_id, units::text from public.expense_item_people where item_id = $1 order by units desc',
        [LIMONADA],
      );
      expect(unidades).toEqual([
        { person_id: VALE, units: '3.000' },
        { person_id: CARO, units: '2.000' },
      ]);
      // Quien no marcó unidades cuenta una
      expect((await one<{ u: string }>(tx, 'select units::text as u from public.expense_item_people where item_id = $1', [PATACONES])).u).toBe('1.000');

      // Otra vez, con el 10 % y sin el postre: la factura sigue siendo 272.500
      await dividir(tx, ITEMS.slice(0, 3), { [FELIPE]: 99_750, [VALE]: 70_000, [CARO]: 60_000, [SANTI]: 70_000 }, 10, 27_250);
      expect(await gasto(tx)).toEqual({ total: 299_750, tip: 27_250, pct: '10.00', method: 'items' });

      // Sin propina: vuelve a lo de la factura
      await dividir(tx, ITEMS.slice(0, 3), { [FELIPE]: 72_500, [VALE]: 70_000, [CARO]: 60_000, [SANTI]: 70_000 });
      expect(await gasto(tx)).toEqual({ total: 272_500, tip: 0, pct: null, method: 'items' });
    });
  });

  it('las partes tienen que sumar el total nuevo', async () => {
    await as(db, U.laura, async (tx) => {
      await expect(dividir(tx, ITEMS, { [FELIPE]: 292_500 }, 5, 14_625)).rejects.toThrow('Las partes suman $292.500 y el gasto es de $307.125');
    });
  });

  it('valida la propina y las unidades', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.exec('savepoint a');
      await expect(dividir(tx, ITEMS, { [FELIPE]: 272_500 }, 120, 0)).rejects.toThrow('La propina va de 0 % a 100 %');
      await tx.exec('rollback to savepoint a');
      await expect(dividir(tx, ITEMS, { [FELIPE]: 900_000 }, null, 400_000)).rejects.toThrow('La propina no puede ser más que la cuenta');
      await tx.exec('rollback to savepoint a');
      await expect(dividir(tx, [{ name: 'Limonada', total_cop: 47_500, people: [VALE], units: { [VALE]: 0 } }], { [FELIPE]: 272_500 })).rejects.toThrow(
        'Las unidades de cada uno tienen que ser mayores que cero',
      );
      await tx.exec('rollback to savepoint a');
      await expect(dividir(tx, [{ name: 'Algo', total_cop: 1_000, extra: 'si' as unknown as boolean }], { [FELIPE]: 272_500 })).rejects.toThrow(
        'Los ítems no llegaron bien',
      );
    });
  });

  it('el monto del recibo en otra moneda sube con la propina', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update public.expenses set original_currency = 'CLP', original_total = 84_000, fx_rate = 3.2440476 where id = $1`, [GASTO_ASADERO]);
      await tx.exec('set local role authenticated');
      await dividir(tx, ITEMS.slice(0, 3), { [FELIPE]: 286_125 }, 5, 13_625);
      expect((await one<{ o: number }>(tx, 'select original_total::int as o from public.expenses where id = $1', [GASTO_ASADERO])).o).toBe(88_200);
    });
  });

  it('solo quien administra', async () => {
    await as(db, U.mafe, async (tx) => {
      await expect(dividir(tx, ITEMS, { [FELIPE]: 307_125 }, 5, 14_625)).rejects.toThrow('Solo quienes administran la cuenta dividen los gastos');
    });
    await as(db, null, async (tx) => {
      await expect(dividir(tx, ITEMS, { [FELIPE]: 307_125 }, 5, 14_625)).rejects.toThrow(/permission denied/);
    });
  });
});
