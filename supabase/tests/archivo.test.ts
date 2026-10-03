import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, count, createDb, impersonate, one, PASEO, U } from './harness';

// Archivar una cuenta cerrada (cada quien) y borrarla del todo (el titular) (00000000000210_archivar_y_borrar.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

async function cerrarPaseo(tx: Transaction, quien: string) {
  await tx.exec('reset role');
  await tx.query(`update public.accounts set status = 'closed', closed_at = now() where id = $1`, [PASEO]);
  await impersonate(tx, quien);
}

const archivar = (tx: Transaction, cuenta: string, si: boolean) =>
  one<{ r: string | null }>(tx, 'select public.set_account_archived($1, $2) as r', [cuenta, si]).then((x) => x.r);

const archivada = async (tx: Transaction, usuario: string) =>
  (await one<{ archived_at: string | null }>(tx, 'select archived_at from public.account_members where account_id = $1 and user_id = $2', [PASEO, usuario]))
    .archived_at;

describe('archivar', () => {
  it('solo una cuenta cerrada; cada quien la archiva para sí y la saca cuando quiera', async () => {
    await as(db, U.mafe, async (tx) => {
      await tx.exec('savepoint a');
      await expect(archivar(tx, PASEO, true)).rejects.toThrow('Solo se archivan las cuentas cerradas');
      await tx.exec('rollback to savepoint a');

      await cerrarPaseo(tx, U.mafe);
      expect(await archivar(tx, PASEO, true)).not.toBeNull();
      expect(await archivada(tx, U.mafe)).not.toBeNull();
      // Para Valeria sigue igual
      expect(await archivada(tx, U.valeria)).toBeNull();

      expect(await archivar(tx, PASEO, false)).toBeNull();
      expect(await archivada(tx, U.mafe)).toBeNull();
    });
  });

  it('alguien de afuera no', async () => {
    await as(db, U.otro, async (tx) => {
      await cerrarPaseo(tx, U.otro);
      await expect(archivar(tx, PASEO, true)).rejects.toThrow('No eres miembro');
    });
  });
});

describe('borrar del todo', () => {
  it('solo el titular, escribiendo el nombre; se va todo, también lo que esperaba en la cola', async () => {
    await as(db, U.laura, async (tx) => {
      await cerrarPaseo(tx, U.laura);
      await tx.exec('reset role');
      await tx.query(`insert into public.jobs (type, payload) values ('process_message', jsonb_build_object('account_id', $1::text))`, [PASEO]);
      await impersonate(tx, U.laura);

      await tx.exec('savepoint a');
      // Laura administra, pero no es la titular
      await expect(tx.query('select public.delete_account_forever($1, $2)', [PASEO, 'Paseo Santa Marta'])).rejects.toThrow('Solo el titular');
      await tx.exec('rollback to savepoint a');

      await impersonate(tx, U.valeria);
      await expect(tx.query('select public.delete_account_forever($1, $2)', [PASEO, 'Paseo'])).rejects.toThrow('«Paseo Santa Marta»');
      await tx.exec('rollback to savepoint a');

      await impersonate(tx, U.valeria);
      expect(await one(tx, 'select public.delete_account_forever($1, $2) as r', [PASEO, '  paseo santa marta '])).toEqual({ r: 'Paseo Santa Marta' });

      await tx.exec('reset role');
      for (const tabla of ['accounts', 'people', 'expenses', 'messages', 'account_members', 'invitations']) {
        const col = tabla === 'accounts' ? 'id' : 'account_id';
        expect(await count(tx, `select 1 from public.${tabla} where ${col} = $1`, [PASEO]), tabla).toBe(0);
      }
      expect(await count(tx, `select 1 from public.jobs where payload ->> 'account_id' = $1`, [PASEO])).toBe(0);
    });
  });

  it('una cuenta liquidada también (sus gastos congelados no la detienen)', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update public.expenses set status = 'confirmed' where account_id = $1`, [PASEO]);
      const { rows } = await tx.query<{ id: string }>(`insert into public.settlements (account_id, created_by) values ($1, $2) returning id`, [
        PASEO,
        U.valeria,
      ]);
      expect(rows).toHaveLength(1);
      await cerrarPaseo(tx, U.valeria);
      await tx.query('select public.delete_account_forever($1, $2)', [PASEO, 'Paseo Santa Marta']);
      expect(await count(tx, 'select 1 from public.accounts where id = $1', [PASEO])).toBe(0);
    });
  });
});
