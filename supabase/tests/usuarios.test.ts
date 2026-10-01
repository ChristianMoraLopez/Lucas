import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { CASA, createDb, PASEO, U } from './harness';

// 00000000000060_borrar_usuarios.sql: borrar un usuario no deja cuentas sin titular.

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

/** Corre `fn` en una transacción que siempre se deshace. */
async function enTransaccion(fn: (q: PGlite['query']) => Promise<void>) {
  await db.transaction(async (tx) => {
    await fn(tx.query.bind(tx) as PGlite['query']);
    await tx.rollback();
  });
}

describe('borrar un usuario', () => {
  it('sus cuentas pasan a un admin y lo que creó queda sin autor', async () => {
    await enTransaccion(async (q) => {
      await q('delete from auth.users where id = $1', [U.valeria]);
      const { rows } = await q<{ id: string; owner_id: string }>('select id, owner_id from public.accounts where id = any($1) order by name', [[CASA, PASEO]]);
      expect(rows).toEqual([
        { id: CASA, owner_id: U.andres },
        { id: PASEO, owner_id: U.laura },
      ]);
      const roles = await q<{ role: string }>(`select role from public.account_members where account_id = $1 and user_id = $2`, [PASEO, U.laura]);
      expect(roles.rows).toEqual([{ role: 'owner' }]);
      const creadas = await q(`select 1 from public.invitations where created_by = $1`, [U.valeria]);
      expect(creadas.rows).toHaveLength(0);
    });
  });

  it('si nadie más queda en la cuenta, la cuenta se borra', async () => {
    await enTransaccion(async (q) => {
      await q('delete from public.account_members where account_id = $1 and user_id <> $2', [CASA, U.valeria]);
      await q('delete from auth.users where id = $1', [U.valeria]);
      expect((await q('select 1 from public.accounts where id = $1', [CASA])).rows).toHaveLength(0);
      expect((await q('select 1 from public.accounts where id = $1', [PASEO])).rows).toHaveLength(1);
    });
  });
});
