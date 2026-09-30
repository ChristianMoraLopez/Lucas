import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, createDb, PASEO, U } from './harness';

// La semilla tiene que cuadrar con las pantallas de referencia del kit
// (lucas-design-kit/referencia/pantallas/_datos-y-marcos.jsx).

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

describe('Paseo Santa Marta', () => {
  it('suma $4.816.000 entre 8 personas y tiene 3 gastos por revisar', async () => {
    const { rows } = await db.query<{ total: number; pendientes: number; personas: number }>(
      `select (select sum(total_cop)::int from public.expenses where account_id = $1) as total,
              (select count(*)::int from public.expenses where account_id = $1 and status = 'pending_review') as pendientes,
              (select count(*)::int from public.people where account_id = $1) as personas`,
      [PASEO],
    );
    expect(rows[0]).toEqual({ total: 4_816_000, pendientes: 3, personas: 8 });
  });

  it('a cada quien le tocan exactamente $602.000', async () => {
    const { rows } = await db.query<{ debe: number }>(
      `select sum(s.amount_cop)::int as debe
       from public.people p join public.expense_splits s on s.person_id = p.id
       where p.account_id = $1 group by p.id`,
      [PASEO],
    );
    expect(rows).toHaveLength(8);
    for (const r of rows) expect(r.debe).toBe(602_000);
  });

  it('cada persona pagó lo mismo que en la referencia', async () => {
    const { rows } = await db.query<{ display_name: string; pago: number }>(
      `select p.display_name, coalesce(sum(e.total_cop), 0)::int as pago
       from public.people p left join public.expenses e on e.payer_person_id = p.id
       where p.account_id = $1 group by p.id order by pago desc`,
      [PASEO],
    );
    expect(rows.map((r) => [r.display_name, r.pago])).toEqual([
      ['Valeria', 1_014_500],
      ['Laura', 870_000],
      ['Mafe', 753_500],
      ['Caro', 502_000],
      ['Juan Camilo', 469_500],
      ['Felipe', 450_500],
      ['Andrés', 434_000],
      ['Santi', 322_000],
    ]);
  });

  it('las divisiones de cada gasto suman su total', async () => {
    const { rows } = await db.query(
      `select e.id from public.expenses e join public.expense_splits s on s.expense_id = e.id
       group by e.id, e.total_cop having sum(s.amount_cop) <> e.total_cop`,
    );
    expect(rows).toEqual([]);
  });
});

describe('Casa', () => {
  it('va en $2.395.200 de $2.600.000 este mes, con 1 por revisar', async () => {
    const fila = await as(db, U.valeria, async (tx) => {
      const { rows } = await tx.query<{ total_cop: number; budget_cop: number; pending_count: number; people_count: number }>(
        `select total_cop::int, budget_cop::int, pending_count, people_count from public.account_overview() where id = $1`,
        [CASA],
      );
      return rows[0];
    });
    expect(fila).toEqual({ total_cop: 2_395_200, budget_cop: 2_600_000, pending_count: 1, people_count: 2 });
  });
});

describe('Selector de cuentas', () => {
  it('Valeria ve sus dos cuentas; Santi solo el paseo', async () => {
    const deValeria = await as(db, U.valeria, (tx) => tx.query<{ name: string }>('select name from public.account_overview() order by name'));
    expect(deValeria.rows.map((r) => r.name)).toEqual(['Casa', 'Paseo Santa Marta']);

    const deSanti = await as(db, U.santi, (tx) => tx.query<{ name: string; total_cop: number }>('select name, total_cop::int from public.account_overview()'));
    expect(deSanti.rows).toEqual([{ name: 'Paseo Santa Marta', total_cop: 4_816_000 }]);
  });

  it('alguien sin cuentas ve la lista vacía', async () => {
    const r = await as(db, U.nuevo, (tx) => tx.query('select * from public.account_overview()'));
    expect(r.rows).toEqual([]);
  });
});
