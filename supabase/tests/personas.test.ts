import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, count, createDb, impersonate, one, P, PASEO, U } from './harness';

// Eliminar a alguien y pasarle sus gastos a otra persona (00000000000130_eliminar_personas.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const JUAN_CAMILO = '30000000-0000-4000-8000-000000000004';
const LAURA = '30000000-0000-4000-8000-000000000007';

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

/** Lo que pagó y lo que le tocaba a cada quien en el paseo, y si cada gasto sigue cuadrando. */
async function cuentas(tx: Transaction) {
  await tx.exec('savepoint ver');
  await tx.exec('reset role');
  const { rows } = await tx.query<{ id: string; paid: string; share: string }>('select person_id as id, paid, share from public.period_balances($1, null)', [PASEO]);
  const { descuadrados } = await one<{ descuadrados: number }>(
    tx,
    `select count(*)::int as descuadrados from public.expenses e
     where e.account_id = $1 and e.total_cop <> (select coalesce(sum(s.amount_cop), 0) from public.expense_splits s where s.expense_id = e.id)`,
    [PASEO],
  );
  await tx.exec('rollback to savepoint ver');
  return { personas: new Map(rows.map((r) => [r.id, { paid: Number(r.paid), share: Number(r.share) }])), descuadrados };
}

describe('eliminar a alguien', () => {
  it('sus gastos y su parte pasan a otra persona; los totales no cambian', async () => {
    await as(db, U.laura, async (tx) => {
      const antes = await cuentas(tx);
      const caro = antes.personas.get(P.caro) as { paid: number; share: number };
      const felipe = antes.personas.get(P.felipe) as { paid: number; share: number };

      await tx.query('select public.delete_person($1, $2)', [P.caro, P.felipe]);

      const despues = await cuentas(tx);
      expect(despues.personas.has(P.caro)).toBe(false);
      expect(despues.personas.get(P.felipe)).toEqual({ paid: felipe.paid + caro.paid, share: felipe.share + caro.share });
      expect(despues.descuadrados).toBe(antes.descuadrados);
      // Nadie más cambió
      for (const [id, v] of antes.personas) if (id !== P.caro && id !== P.felipe) expect(despues.personas.get(id)).toEqual(v);
      // Su WhatsApp no pasa (no se pidió): ese número vuelve a ser desconocido
      expect(await count(tx, `select 1 from public.person_whatsapp_ids where wa_id = '573002224471'`)).toBe(0);
    });
  });

  it('si tenía usuario, deja de ver la cuenta; si era la misma persona, su WhatsApp y sus mensajes también pasan', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update public.messages set sender_person_id = $1 where sender_wa_id = '573128880365'`, [P.paseoSanti]);
      await impersonate(tx, U.valeria);
      await tx.query('select public.delete_person($1, $2, true)', [P.paseoSanti, JUAN_CAMILO]);
      expect(await count(tx, 'select 1 from public.people where id = $1', [P.paseoSanti])).toBe(0);
      await tx.exec('reset role');
      expect(await count(tx, 'select 1 from public.account_members where account_id = $1 and user_id = $2', [PASEO, U.santi])).toBe(0);
      expect(await count(tx, `select 1 from public.person_whatsapp_ids where person_id = $1 and wa_id = '573128880365'`, [JUAN_CAMILO])).toBe(1);
      expect(await count(tx, `select 1 from public.messages where sender_wa_id = '573128880365' and sender_person_id = $1`, [JUAN_CAMILO])).toBeGreaterThan(0);
      await impersonate(tx, U.santi);
      expect(await count(tx, 'select 1 from public.accounts where id = $1', [PASEO])).toBe(0);
    });
  });

  it('quién puede: un miembro no; nadie al titular, a sí mismo ni un admin a otro admin', async () => {
    await expect(as(db, U.santi, (tx) => tx.query('select public.delete_person($1, $2)', [P.caro, P.felipe]))).rejects.toThrow('Solo quienes administran');
    await as(db, U.laura, async (tx) => {
      expect(await falla(tx, 'select public.delete_person($1, $2)', [P.paseoValeria, P.felipe])).toMatch('titular');
      expect(await falla(tx, 'select public.delete_person($1, $2)', [LAURA, P.felipe])).toMatch('Salir de esta cuenta');
    });
    await as(db, U.valeria, async (tx) => {
      // Laura pasa a ser solo admin… y el otro admin (Andrés) no la puede eliminar
      await tx.query(`select public.set_member_role($1, $2, 'admin')`, [PASEO, U.andres]);
      await impersonate(tx, U.andres);
      expect(await falla(tx, 'select public.delete_person($1, $2)', [LAURA, P.felipe])).toMatch('otro administrador');
    });
  });

  it('a quién pasan: tiene que ser otra persona de la misma cuenta, y si tiene gastos hay que elegir', async () => {
    await as(db, U.laura, async (tx) => {
      expect(await falla(tx, 'select public.delete_person($1, null)', [P.caro])).toMatch('Elige a quién pasan');
      expect(await falla(tx, 'select public.delete_person($1, $2)', [P.caro, P.caro])).toMatch('otra persona');
      expect(await falla(tx, 'select public.delete_person($1, $2)', [P.caro, P.casaValeria])).toMatch('otra persona');
      // Alguien recién agregado, sin gastos, se elimina sin pasarle nada a nadie
      await tx.exec('reset role');
      const { id } = await one<{ id: string }>(tx, `insert into public.people (account_id, display_name) values ($1, 'Primo') returning id`, [PASEO]);
      await impersonate(tx, U.laura);
      await tx.query('select public.delete_person($1, null)', [id]);
      expect(await count(tx, 'select 1 from public.people where id = $1', [id])).toBe(0);
    });
  });

  it('quien está en una liquidación no se elimina; en una cuenta ajena tampoco', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update public.expenses set status = 'confirmed' where account_id = $1`, [PASEO]);
      const { sid } = await one<{ sid: string }>(tx, `insert into public.settlements (account_id) values ($1) returning id as sid`, [PASEO]);
      await tx.query(
        `insert into public.settlement_transfers (settlement_id, account_id, from_person_id, to_person_id, amount_cop, position) values ($1, $2, $3, $4, 1000, 1)`,
        [sid, PASEO, P.caro, P.paseoValeria],
      );
      await impersonate(tx, U.laura);
      expect(await falla(tx, 'select public.delete_person($1, $2)', [P.caro, P.felipe])).toMatch('está en una liquidación');
    });
    await expect(as(db, U.laura, (tx) => tx.query('select public.delete_person($1, null)', [P.casaValeria]))).rejects.toThrow('Solo quienes administran');
  });
});

describe('sacar sigue igual', () => {
  it('quita el acceso pero la persona y sus gastos se quedan', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.query('select public.remove_member($1, $2)', [PASEO, U.santi]);
      expect(await one(tx, 'select claimed_by from public.people where id = $1', [P.paseoSanti])).toEqual({ claimed_by: null });
      expect(await count(tx, 'select 1 from public.people where account_id = $1', [CASA])).toBeGreaterThan(0);
    });
  });
});
