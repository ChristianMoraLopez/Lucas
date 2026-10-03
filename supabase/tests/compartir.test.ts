import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, createDb, impersonate, one, PASEO, U } from './harness';

// Compartir las cuentas y agregar varias personas (00000000000150_compartir.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

interface Publica {
  account: { name: string; type: string };
  people: { id: string; name: string; paid: number; share: number; balance: number }[];
  expenses: { id: string; total_cop: number; shares: { person_id: string; amount_cop: number }[] }[];
  settlement: unknown;
  is_admin?: boolean;
  my_person_id?: string;
}

/** El mensaje de error, sin abortar la transacción de la prueba. */
async function falla(tx: Transaction, sql: string, params: unknown[] = []) {
  await tx.exec('savepoint antes');
  try {
    await tx.query(sql, params);
  } catch (e) {
    await tx.exec('rollback to savepoint antes');
    return (e as Error).message;
  }
  await tx.exec('release savepoint antes');
  return null;
}

const crear = async (tx: Transaction, cuenta: string, renovar = false) =>
  (await one<{ r: string }>(tx, 'select public.create_share_link($1, $2) as r', [cuenta, renovar])).r;

const publica = async (tx: Transaction, token: string | null, mes: string | null = null) =>
  (await one<{ r: Publica | null }>(tx, 'select public.shared_overview($1, $2) as r', [token, mes])).r;

async function comoAnonimo(tx: Transaction) {
  await impersonate(tx, null);
}

describe('link público de las cuentas', () => {
  it('un admin lo crea una vez; renovarlo deja el anterior sin servir', async () => {
    await as(db, U.valeria, async (tx) => {
      expect((await one<{ r: string | null }>(tx, 'select public.share_link($1) as r', [PASEO])).r).toBeNull();
      const token = await crear(tx, PASEO);
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(await crear(tx, PASEO)).toBe(token);

      const nuevo = await crear(tx, PASEO, true);
      expect(nuevo).not.toBe(token);
      await comoAnonimo(tx);
      expect(await publica(tx, token)).toBeNull();
      expect((await publica(tx, nuevo))?.account.name).toBe('Paseo Santa Marta');
    });
  });

  it('sin sesión se ven los números, sin nada de quien mira', async () => {
    await as(db, U.valeria, async (tx) => {
      const token = await crear(tx, PASEO);
      await comoAnonimo(tx);
      const d = await publica(tx, token);
      expect(d?.people.length).toBe(8);
      expect(d?.people.reduce((s, p) => s + p.balance, 0)).toBe(0);
      expect(d?.expenses.length).toBeGreaterThan(0);
      expect(d).not.toHaveProperty('is_admin');
      expect(d).not.toHaveProperty('my_person_id');
      // Lo mismo que ve un miembro en Liquidar
      await impersonate(tx, U.mafe);
      const { r: miembro } = await one<{ r: Publica }>(tx, 'select public.settlement_overview($1) as r', [PASEO]);
      expect(miembro.people).toEqual(d?.people);
      expect(miembro.my_person_id).toBeTruthy();
      expect(miembro.is_admin).toBe(false);
    });
  });

  it('links inventados, con otro formato o quitados no muestran nada', async () => {
    await as(db, U.valeria, async (tx) => {
      const token = await crear(tx, PASEO);
      await tx.query('select public.delete_share_link($1)', [PASEO]);
      await comoAnonimo(tx);
      expect(await publica(tx, token)).toBeNull();
      expect(await publica(tx, 'AAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
      expect(await publica(tx, "x' or '1'='1")).toBeNull();
      expect(await publica(tx, null)).toBeNull();
    });
  });

  it('el hogar se comparte mes a mes', async () => {
    await as(db, U.valeria, async (tx) => {
      const token = await crear(tx, CASA);
      await comoAnonimo(tx);
      const d = await publica(tx, token);
      expect(d?.account.type).toBe('hogar');
      expect(d?.expenses.length).toBeGreaterThan(0);
      const viejo = await publica(tx, token, '2020-01-01');
      expect(viejo?.expenses).toEqual([]);
    });
  });

  it('solo un admin lo crea o lo quita; un miembro solo lo ve; sin sesión nada de eso', async () => {
    await as(db, U.valeria, async (tx) => {
      const token = await crear(tx, PASEO);
      await impersonate(tx, U.mafe);
      expect((await one<{ r: string }>(tx, 'select public.share_link($1) as r', [PASEO])).r).toBe(token);
      expect(await falla(tx, 'select public.create_share_link($1)', [PASEO])).toMatch('Solo quien administra');
      expect(await falla(tx, 'select public.delete_share_link($1)', [PASEO])).toMatch('Solo quien administra');
      await impersonate(tx, U.nuevo);
      expect(await falla(tx, 'select public.share_link($1)', [PASEO])).toMatch('No eres miembro');
      await comoAnonimo(tx);
      for (const sql of [
        `select public.share_link('${PASEO}')`,
        `select public.create_share_link('${PASEO}')`,
        `select public.account_numbers('${PASEO}')`,
        'select * from public.account_shares',
      ]) {
        expect(await falla(tx, sql)).toMatch(/permission denied/);
      }
    });
  });
});

describe('agregar varias personas', () => {
  it('se agregan de una vez y entran a los gastos que estaban divididos entre todos', async () => {
    await as(db, U.valeria, async (tx) => {
      const { r } = await one<{ r: { person_ids: string[]; resplit: number } }>(tx, 'select public.add_people($1, $2, true) as r', [
        PASEO,
        ['  Pipe ', 'Juli   Gómez', ''],
      ]);
      expect(r.person_ids).toHaveLength(2);
      const { rows: nombres } = await tx.query<{ display_name: string }>('select display_name from public.people where id = any($1) order by display_name', [
        r.person_ids,
      ]);
      expect(nombres.map((n) => n.display_name)).toEqual(['Juli Gómez', 'Pipe']);
      expect(r.resplit).toBeGreaterThan(0);

      // Ahora cada gasto se reparte entre 10 y sigue sumando el total
      const { r: d } = await one<{ r: Publica }>(tx, 'select public.settlement_overview($1) as r', [PASEO]);
      expect(d.people).toHaveLength(10);
      for (const e of d.expenses) {
        expect(e.shares).toHaveLength(10);
        expect(e.shares.reduce((s, x) => s + x.amount_cop, 0)).toBe(e.total_cop);
      }
      expect(d.people.reduce((s, p) => s + p.balance, 0)).toBe(0);
      const pipe = d.people.find((p) => p.name === 'Pipe');
      expect(pipe?.paid).toBe(0);
      expect(pipe?.share).toBeGreaterThan(0);
    });
  });

  it('sin incluirlas, los gastos no cambian; los divididos solo entre algunos tampoco', async () => {
    await as(db, U.valeria, async (tx) => {
      const { rows: antes } = await tx.query('select expense_id, person_id, amount_cop from public.expense_splits order by 1, 2');
      const { r } = await one<{ r: { resplit: number } }>(tx, 'select public.add_people($1, $2, false) as r', [PASEO, ['Pipe']]);
      expect(r.resplit).toBe(0);
      const { rows: despues } = await tx.query('select expense_id, person_id, amount_cop from public.expense_splits order by 1, 2');
      expect(despues).toEqual(antes);

      // En Casa todo es a la mitad entre Valeria y Andrés (= entre todos): sí entra
      const { r: casa } = await one<{ r: { resplit: number } }>(tx, 'select public.add_people($1, $2, true) as r', [CASA, ['Roomie']]);
      expect(casa.resplit).toBeGreaterThan(0);
      // Un gasto solo de Valeria no se toca
      await tx.exec('reset role');
      const { rows: gasto } = await tx.query<{ id: string }>(`select id from public.expenses where account_id = $1 order by created_at limit 1`, [CASA]);
      await tx.query(`select public.replace_equal_split($1, array['30000000-0000-4000-8000-000000000001'::uuid])`, [gasto[0].id]);
      await impersonate(tx, U.valeria);
      await one(tx, 'select public.add_people($1, $2, true) as r', [CASA, ['Otro roomie']]);
      const { rows: solo } = await tx.query('select person_id from public.expense_splits where expense_id = $1', [gasto[0].id]);
      expect(solo).toHaveLength(1);
    });
  });

  it('nombres repetidos, vacíos o muy largos no; un miembro no agrega', async () => {
    await as(db, U.valeria, async (tx) => {
      expect(await falla(tx, 'select public.add_people($1, $2)', [PASEO, ['valeria']])).toMatch('Ya hay alguien');
      expect(await falla(tx, 'select public.add_people($1, $2)', [PASEO, ['  ', '']])).toMatch('al menos un nombre');
      expect(await falla(tx, 'select public.add_people($1, $2)', [PASEO, ['x'.repeat(41)]])).toMatch('muy largo');
      await impersonate(tx, U.mafe);
      expect(await falla(tx, 'select public.add_people($1, $2)', [PASEO, ['Pipe']])).toMatch('Solo quien administra');
    });
  });

  it('lo ya liquidado no se vuelve a dividir', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update public.expenses set status = 'confirmed' where account_id = $1`, [PASEO]);
      await tx.query(`insert into public.settlements (account_id, period) values ($1, null)`, [PASEO]);
      await impersonate(tx, U.valeria);
      const { r } = await one<{ r: { resplit: number } }>(tx, 'select public.add_people($1, $2, true) as r', [PASEO, ['Pipe']]);
      expect(r.resplit).toBe(0);
    });
  });
});
