import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, GASTO_ASADERO, one, P, PASEO, U } from './harness';

// Dividir un gasto por consumo (00000000000170_dividir_por_consumo.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

// El asadero (por revisar): $272.500 = picada 180.000 + limonadas 47.500 + patacones 45.000
const PICADA = '70000000-0000-4000-8000-000000000005';
const LIMONADA = '70000000-0000-4000-8000-000000000006';
const PATACONES = '70000000-0000-4000-8000-000000000007';
const LICORES = '60000000-0000-4000-8000-00000000001d';
const { paseoValeria: VALE, paseoSanti: SANTI, caro: CARO, felipe: FELIPE } = P;

const DIVIDIR = 'select public.split_by_items($1, $2, $3, $4)';
const REVISAR = 'select public.review_expense($1, $2, $3, $4, $5, $6, $7, true)';

type Item = { id?: string | null; name: string; quantity?: number; total_cop: number; people?: string[] };
type Parte = { person_id: string; amount_cop: number; fixed?: boolean };
const dividir = (tx: Transaction, items: Item[], partes: Parte[], pagador: string | null = null, gasto = GASTO_ASADERO) =>
  tx.query(DIVIDIR, [gasto, pagador, JSON.stringify(items), JSON.stringify(partes)]);

// La picada entre los cuatro, limonadas Vale y Caro, patacones Santi; Felipe pone $100.000
const ITEMS: Item[] = [
  { id: PICADA, name: 'Picada para 8', total_cop: 180_000, people: [] },
  { id: LIMONADA, name: 'Limonada de coco', quantity: 5, total_cop: 47_500, people: [VALE, CARO] },
  { id: PATACONES, name: 'Patacones', quantity: 3, total_cop: 45_000, people: [SANTI] },
];
const PARTES: Parte[] = [
  { person_id: FELIPE, amount_cop: 100_000, fixed: true },
  { person_id: VALE, amount_cop: 54_500 },
  { person_id: CARO, amount_cop: 54_500 },
  { person_id: SANTI, amount_cop: 63_500 },
];

const partes = async (tx: Transaction, gasto = GASTO_ASADERO) =>
  (
    await tx.query<{ person_id: string; amount: number; fixed: boolean }>(
      'select person_id, amount_cop::int as amount, fixed from public.expense_splits where expense_id = $1 order by amount_cop desc, person_id',
      [gasto],
    )
  ).rows;

describe('dividir un gasto por consumo', () => {
  it('quien administra guarda quién pidió qué, la parte de cada uno, lo fijo y quién pagó', async () => {
    await as(db, U.laura, async (tx) => {
      await dividir(tx, [...ITEMS, { name: 'Propina', total_cop: 0 }], PARTES, FELIPE);

      const g = await one<{ split_method: string; payer: string; status: string }>(
        tx,
        'select split_method, payer_person_id as payer, status from public.expenses where id = $1',
        [GASTO_ASADERO],
      );
      // Dividirlo no lo confirma: eso se hace al revisarlo
      expect(g).toEqual({ split_method: 'items', payer: FELIPE, status: 'pending_review' });
      expect(await partes(tx)).toEqual([
        { person_id: FELIPE, amount: 100_000, fixed: true },
        { person_id: SANTI, amount: 63_500, fixed: false },
        { person_id: VALE, amount: 54_500, fixed: false },
        { person_id: CARO, amount: 54_500, fixed: false },
      ]);

      // Los ítems conservan su id, en el orden en que llegaron, y quién los consumió
      const { rows: items } = await tx.query<{ id: string; name: string; quantity: string; people: string[] | null }>(
        `select i.id, i.name, i.quantity::text, array_agg(p.person_id order by p.person_id) filter (where p.person_id is not null) as people
         from public.expense_items i left join public.expense_item_people p on p.item_id = i.id
         where i.expense_id = $1 group by i.id order by i.created_at`,
        [GASTO_ASADERO],
      );
      expect(items.map((i) => i.name)).toEqual(['Picada para 8', 'Limonada de coco', 'Patacones', 'Propina']);
      expect(items.slice(0, 3).map((i) => i.id)).toEqual([PICADA, LIMONADA, PATACONES]);
      expect(items[1].people).toEqual([VALE, CARO].sort());
      expect(items[0].people).toBeNull();

      // Cuenta en Liquidar como cualquier división: los saldos siguen dando cero
      const { r } = await one<{
        r: { people: { paid: number; share: number }[]; expenses: { id: string; shares: { person_id: string; amount_cop: number }[] }[] };
      }>(tx, 'select public.settlement_overview($1, null) as r', [PASEO]);
      const sum = (k: 'paid' | 'share') => r.people.reduce((s, p) => s + Number(p[k]), 0);
      expect(sum('share')).toBe(sum('paid'));
      const asadero = r.expenses.find((x) => x.id === GASTO_ASADERO);
      expect(asadero?.shares.find((x) => x.person_id === FELIPE)?.amount_cop).toBe(100_000);
    });
  });

  it('las partes tienen que sumar el total y ser de gente de la cuenta', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.exec('savepoint a');
      await expect(dividir(tx, ITEMS, [{ person_id: VALE, amount_cop: 200_000 }])).rejects.toThrow('Las partes suman $200.000 y el gasto es de $272.500');
      await tx.exec('rollback to savepoint a');
      await expect(dividir(tx, ITEMS, [...PARTES.slice(1), { person_id: P.casaValeria, amount_cop: 100_000 }])).rejects.toThrow(
        'Alguien de la división no es de esta cuenta',
      );
      await tx.exec('rollback to savepoint a');
      await expect(dividir(tx, [{ name: 'Algo', total_cop: 1000, people: [P.casaValeria] }], PARTES)).rejects.toThrow(
        'Alguien de los ítems no es de esta cuenta',
      );
      await tx.exec('rollback to savepoint a');
      await expect(dividir(tx, [{ name: '  ', total_cop: 1000 }], PARTES)).rejects.toThrow('Cada ítem necesita nombre y precio');
      await tx.exec('rollback to savepoint a');
      await expect(dividir(tx, ITEMS, [...PARTES, { person_id: VALE, amount_cop: 0 }])).rejects.toThrow('Alguien está dos veces');
      await tx.exec('rollback to savepoint a');
      // Un ítem de otro gasto no se roba: entra como ítem nuevo
      await dividir(tx, [{ id: '70000000-0000-4000-8000-000000000001', name: 'Aguardiente', total_cop: 272_500 }], PARTES);
      const { rows } = await tx.query<{ n: number }>('select count(*)::int as n from public.expense_items where expense_id = $1', [LICORES]);
      expect(rows[0].n).toBe(4);
    });
  });

  it('solo quien administra; y nadie escribe a mano en quién pidió qué', async () => {
    await as(db, U.mafe, async (tx) => {
      await expect(dividir(tx, ITEMS, PARTES)).rejects.toThrow('Solo quienes administran la cuenta dividen los gastos');
    });
    await as(db, U.otro, async (tx) => {
      await expect(dividir(tx, ITEMS, PARTES)).rejects.toThrow('El gasto no existe');
    });
    await as(db, U.laura, async (tx) => {
      await dividir(tx, ITEMS, PARTES);
      await expect(tx.query('insert into public.expense_item_people (item_id, person_id) values ($1, $2)', [PICADA, FELIPE])).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it('los miembros ven quién pidió qué; los de otra cuenta, no', async () => {
    const leer = (tx: Transaction) => tx.query('select * from public.expense_item_people where item_id = $1', [LIMONADA]);
    // La semilla no trae asignaciones: se guarda una y se lee en la misma transacción
    await as(db, U.laura, async (tx) => {
      await dividir(tx, ITEMS, PARTES);
      expect((await leer(tx)).rows).toHaveLength(2);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.mafe, role: 'authenticated' })]);
      expect((await leer(tx)).rows).toHaveLength(2);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.andres, role: 'authenticated' })]);
      // Andrés es de la casa y del paseo: sí lo ve. Alguien sin cuentas, no.
      expect((await leer(tx)).rows).toHaveLength(2);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.otro, role: 'authenticated' })]);
      expect((await leer(tx)).rows).toHaveLength(0);
    });
  });

  it('al revisar se queda la división por consumo si el total no cambia; si cambia, hay que volver a dividir', async () => {
    const RESTAURANTE = '40000000-0000-4000-8000-000000000016';
    await as(db, U.laura, async (tx) => {
      await dividir(tx, ITEMS, PARTES, FELIPE);
      await tx.query(REVISAR, [GASTO_ASADERO, 'Asadero El Rodadero', '2026-09-28', 272_500, RESTAURANTE, FELIPE, null]);
      expect((await one<{ status: string }>(tx, 'select status from public.expenses where id = $1', [GASTO_ASADERO])).status).toBe('confirmed');
      expect((await partes(tx))[0]).toEqual({ person_id: FELIPE, amount: 100_000, fixed: true });

      await tx.exec('savepoint b');
      await expect(tx.query(REVISAR, [GASTO_ASADERO, 'Asadero El Rodadero', '2026-09-28', 300_000, RESTAURANTE, FELIPE, null])).rejects.toThrow(
        'El total cambió',
      );
      await tx.exec('rollback to savepoint b');

      // Volver a dividir igual: deja de ser por consumo (lo de quién pidió qué queda guardado)
      await tx.query(REVISAR, [GASTO_ASADERO, 'Asadero El Rodadero', '2026-09-28', 300_000, RESTAURANTE, FELIPE, `{${[VALE, SANTI].join(',')}}`]);
      expect((await one<{ m: string }>(tx, 'select split_method as m from public.expenses where id = $1', [GASTO_ASADERO])).m).toBe('equal');
      expect((await partes(tx)).map((p) => p.amount)).toEqual([150_000, 150_000]);
      expect((await one<{ n: number }>(tx, 'select count(*)::int as n from public.expense_item_people where item_id = $1', [LIMONADA])).n).toBe(2);
    });
  });

  it('una cuenta cerrada no se vuelve a dividir', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update public.accounts set status = 'closed' where id = $1`, [PASEO]);
      await tx.exec('set local role authenticated');
      await expect(dividir(tx, ITEMS, PARTES)).rejects.toThrow('La cuenta está cerrada');
    });
  });
});
