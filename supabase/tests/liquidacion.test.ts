import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, count, createDb, GASTO_CASA, GASTO_HOSTAL, impersonate, one, P, PASEO, U } from './harness';

// Liquidar (00000000000120_liquidacion.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

interface Persona {
  id: string;
  name: string;
  paid: number;
  share: number;
  balance: number;
  expenses: number;
}
interface Transferencia {
  id: string;
  from: string;
  to: string;
  amount: number;
  paid_at: string | null;
  paid_by: string | null;
}
interface Vista {
  account: { type: string; status: string };
  is_admin: boolean;
  my_person_id: string | null;
  month: string | null;
  pending_count: number;
  incomplete_count: number;
  people: Persona[];
  expenses: { id: string; total_cop: number; shares: { person_id: string; amount_cop: number }[] }[];
  settlement: null | { id: string; transfers: Transferencia[] };
  settled_months: string[] | null;
}

// Persona de cada usuario en el paseo (seed.sql)
const EN_PASEO: Record<string, string> = {
  [U.valeria]: P.paseoValeria,
  [U.juanCamilo]: '30000000-0000-4000-8000-000000000004',
  [U.mafe]: '30000000-0000-4000-8000-000000000005',
  [U.andres]: '30000000-0000-4000-8000-000000000006',
  [U.laura]: '30000000-0000-4000-8000-000000000007',
  [U.santi]: P.paseoSanti,
};

async function vista(tx: Transaction, cuenta: string, mes: string | null = null) {
  const { r } = await one<{ r: Vista }>(tx, 'select public.settlement_overview($1, $2) as r', [cuenta, mes]);
  return r;
}

/** Transferencias que dejan a todos en cero: el que más debe le paga al que más le deben. */
function transferencias(people: Persona[]) {
  const deben = people.filter((p) => p.balance < 0).map((p) => ({ id: p.id, v: -p.balance }));
  const reciben = people.filter((p) => p.balance > 0).map((p) => ({ id: p.id, v: p.balance }));
  const out: { from: string; to: string; amount: number }[] = [];
  while (deben.length && reciben.length) {
    deben.sort((a, b) => b.v - a.v);
    reciben.sort((a, b) => b.v - a.v);
    const [d, r] = [deben[0], reciben[0]];
    const m = Math.min(d.v, r.v);
    out.push({ from: d.id, to: r.id, amount: m });
    d.v -= m;
    r.v -= m;
    if (!d.v) deben.shift();
    if (!r.v) reciben.shift();
  }
  return out;
}

/** Lo pendiente queda confirmado, como si alguien lo hubiera revisado. */
async function revisarTodo(tx: Transaction, usuario: string, cuenta: string) {
  await tx.exec('reset role');
  await tx.query(`update public.expenses set status = 'confirmed' where account_id = $1 and status = 'pending_review'`, [cuenta]);
  await impersonate(tx, usuario);
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

const liquidar = (tx: Transaction, cuenta: string, mes: string | null, ts: unknown[]) =>
  one<{ id: string }>(tx, 'select public.start_settlement($1, $2, $3) as id', [cuenta, mes, JSON.stringify(ts)]);

describe('ver la liquidación', () => {
  it('cada quien ve cuánto puso, cuánto le tocaba y su saldo; los saldos suman cero', async () => {
    await as(db, U.santi, async (tx) => {
      const v = await vista(tx, PASEO);
      expect(v.people).toHaveLength(8);
      expect(v.people.reduce((s, p) => s + p.balance, 0)).toBe(0);
      expect(v.people.reduce((s, p) => s + p.paid, 0)).toBe(v.people.reduce((s, p) => s + p.share, 0));
      for (const p of v.people) expect(p.balance).toBe(p.paid - p.share);
      expect(v).toMatchObject({ is_admin: false, my_person_id: P.paseoSanti, pending_count: 3, settlement: null, month: null });
      // Quién gastó qué: cada gasto con lo que le tocó a cada quien
      const hostal = v.expenses.find((e) => e.id === GASTO_HOSTAL);
      expect(hostal?.shares.reduce((s, x) => s + x.amount_cop, 0)).toBe(hostal?.total_cop);
    });
  });

  it('alguien de afuera no la ve', async () => {
    await expect(as(db, U.nuevo, (tx) => vista(tx, PASEO))).rejects.toThrow('No eres miembro');
  });
});

describe('liquidar el paseo', () => {
  it('un miembro no; con gastos por revisar tampoco', async () => {
    await expect(as(db, U.santi, (tx) => liquidar(tx, PASEO, null, []))).rejects.toThrow('Solo quienes administran');
    await expect(as(db, U.laura, (tx) => liquidar(tx, PASEO, null, []))).rejects.toThrow('Primero revisen 3 gastos pendientes');
  });

  it('transferencias que no cuadran o mal hechas, no', async () => {
    await as(db, U.laura, async (tx) => {
      await revisarTodo(tx, U.laura, PASEO);
      const ts = transferencias((await vista(tx, PASEO)).people);
      const otra = [...ts.slice(1), { ...ts[0], amount: ts[0].amount + 1 }];
      expect(await falla(tx, 'select public.start_settlement($1, null, $2)', [PASEO, JSON.stringify(otra)])).toMatch('paz y salvo');
      const negativa = [{ ...ts[0], amount: -5 }];
      expect(await falla(tx, 'select public.start_settlement($1, null, $2)', [PASEO, JSON.stringify(negativa)])).toMatch('no es válida');
      const ajena = [{ ...ts[0], to: P.casaValeria }];
      expect(await falla(tx, 'select public.start_settlement($1, null, $2)', [PASEO, JSON.stringify(ajena)])).toMatch('no es válida');
    });
  });

  it('liquida, congela los gastos y no recibe más; cada quien marca lo suyo; se cierra cuando todo está pagado', async () => {
    await as(db, U.laura, async (tx) => {
      await revisarTodo(tx, U.laura, PASEO);
      const ts = transferencias((await vista(tx, PASEO)).people);
      expect(ts.length).toBeGreaterThan(0);
      await liquidar(tx, PASEO, null, ts);

      const v = await vista(tx, PASEO);
      expect(v.account.status).toBe('settling');
      expect(v.settlement?.transfers.map((t) => [t.from, t.to, t.amount])).toEqual(ts.map((t) => [t.from, t.to, t.amount]));
      expect(await falla(tx, 'select public.start_settlement($1, null, $2)', [PASEO, '[]'])).toMatch('ya se está liquidando');

      // La plata de lo liquidado no cambia; el comercio sí se puede corregir
      await tx.exec('reset role');
      expect(await falla(tx, 'update public.expenses set total_cop = total_cop + 1 where id = $1', [GASTO_HOSTAL])).toMatch('El paseo ya se liquidó');
      expect(await falla(tx, 'delete from public.expense_splits where expense_id = $1', [GASTO_HOSTAL])).toMatch('El paseo ya se liquidó');
      expect(await falla(tx, `update public.expenses set merchant = 'Hostal Brisas' where id = $1`, [GASTO_HOSTAL])).toBeNull();

      // No entran gastos nuevos
      await impersonate(tx, U.santi);
      expect(await falla(tx, `select public.submit_upload($1, 'text', 'hielo 12 lucas')`, [PASEO])).toMatch('se está liquidando');

      // Marcar: quien no paga ni recibe, no; quien paga, sí
      const [t0] = (v.settlement as NonNullable<Vista['settlement']>).transfers;
      const ajeno = Object.keys(EN_PASEO).find((u) => ![t0.from, t0.to].includes(EN_PASEO[u]) && u !== U.laura && u !== U.valeria) as string;
      await impersonate(tx, ajeno);
      expect(await falla(tx, 'select public.mark_transfer($1, true)', [t0.id])).toMatch('Solo quien paga');
      const pagador = Object.keys(EN_PASEO).find((u) => EN_PASEO[u] === t0.from);
      await impersonate(tx, pagador ?? U.laura);
      await tx.query('select public.mark_transfer($1, true)', [t0.id]);

      await impersonate(tx, U.laura);
      expect((await vista(tx, PASEO)).settlement?.transfers[0].paid_at).not.toBeNull();
      expect(await falla(tx, 'select public.reopen_settlement($1)', [v.settlement?.id])).toMatch('Ya hay transferencias pagadas');
      if (ts.length > 1) expect(await falla(tx, 'select public.close_account($1)', [PASEO])).toMatch(/Faltan \d+ transferencias? por pagar/);

      for (const t of (v.settlement as NonNullable<Vista['settlement']>).transfers) await tx.query('select public.mark_transfer($1, true)', [t.id]);
      await tx.query('select public.close_account($1)', [PASEO]);
      expect(await one(tx, 'select status from public.accounts where id = $1', [PASEO])).toEqual({ status: 'closed' });
      expect(await count(tx, 'select 1 from public.invitations where account_id = $1 and revoked_at is null', [PASEO])).toBe(0);
      expect(await falla(tx, 'select public.mark_transfer($1, false)', [t0.id])).toMatch('cerrada');
    });
  });

  it('reabrir deshace la liquidación y el paseo vuelve a recibir gastos', async () => {
    await as(db, U.laura, async (tx) => {
      await revisarTodo(tx, U.laura, PASEO);
      const { id } = await liquidar(tx, PASEO, null, transferencias((await vista(tx, PASEO)).people));
      await impersonate(tx, U.santi);
      expect(await falla(tx, 'select public.reopen_settlement($1)', [id])).toMatch('Solo quienes administran');
      await impersonate(tx, U.laura);
      await tx.query('select public.reopen_settlement($1)', [id]);
      expect(await vista(tx, PASEO)).toMatchObject({ settlement: null, account: { status: 'active' } });
      await impersonate(tx, U.santi);
      await tx.query(`select public.submit_upload($1, 'text', 'hielo 12 lucas')`, [PASEO]);
    });
  });

  it('un paseo liquidado se puede borrar', async () => {
    await as(db, U.valeria, async (tx) => {
      await revisarTodo(tx, U.valeria, PASEO);
      await liquidar(tx, PASEO, null, transferencias((await vista(tx, PASEO)).people));
      expect(await count(tx, 'delete from public.accounts where id = $1 returning 1', [PASEO])).toBe(1);
    });
  });
});

describe('liquidar un mes del hogar', () => {
  it('ese mes queda congelado; los demás meses y la cuenta siguen abiertos', async () => {
    await as(db, U.andres, async (tx) => {
      await revisarTodo(tx, U.andres, CASA);
      const { mes } = await one<{ mes: string }>(
        tx,
        `select to_char(date_trunc('month', expense_date), 'YYYY-MM-DD') as mes from public.expenses where id = $1`,
        [GASTO_CASA],
      );
      const v = await vista(tx, CASA, mes);
      expect(v.month).toBe(mes);
      expect(v.people.reduce((s, p) => s + p.balance, 0)).toBe(0);
      await liquidar(tx, CASA, mes, transferencias(v.people));

      const despues = await vista(tx, CASA, mes);
      expect(despues.account.status).toBe('active');
      expect(despues.settled_months).toContain(mes);
      expect(await falla(tx, 'select public.start_settlement($1, $2, $3)', [CASA, mes, '[]'])).toMatch('Ese mes ya está liquidado');
      expect(await falla(tx, 'select public.start_settlement($1, null, $2)', [CASA, '[]'])).toMatch('Elige qué mes');
      expect(await falla(tx, `select public.start_settlement($1, (current_date + 70)::date, '[]')`, [CASA])).toMatch('todavía no ha empezado');

      await tx.exec('reset role');
      expect(await falla(tx, 'update public.expenses set total_cop = total_cop + 1 where id = $1', [GASTO_CASA])).toMatch('Ese mes ya se liquidó');
      // Mover un gasto de otro mes a uno liquidado tampoco
      expect(await falla(tx, `update public.expenses set expense_date = $2::date where account_id = $1 and expense_date < $2::date`, [CASA, mes])).toSatisfy(
        (m: string | null) => m === null || m.includes('Ese mes ya se liquidó'),
      );
      // Un gasto de dos meses antes entra sin problema
      expect(
        await falla(
          tx,
          `insert into public.expenses (account_id, merchant, total_cop, expense_date) values ($1, 'Tienda', 5000, ($2::date - interval '40 days')::date)`,
          [CASA, mes],
        ),
      ).toBeNull();
      await impersonate(tx, U.valeria);
      await tx.query(`select public.submit_upload($1, 'text', 'arepas 9 lucas')`, [CASA]);
    });
  });
});

describe('permisos', () => {
  it('las tablas solo se leen desde el API; las funciones internas no se llaman', async () => {
    await as(db, U.laura, async (tx) => {
      expect(await falla(tx, `insert into public.settlements (account_id) values ($1)`, [PASEO])).toMatch('permission denied');
      expect(await falla(tx, 'select * from public.period_balances($1, null)', [PASEO])).toMatch('permission denied');
    });
    await as(db, U.nuevo, async (tx) => {
      expect(await count(tx, 'select 1 from public.settlement_transfers')).toBe(0);
    });
  });
});
