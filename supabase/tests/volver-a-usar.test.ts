import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, PASEO, U } from './harness';

// Una cuenta liquidada y cerrada se vuelve a usar desde la app: la siguiente en ceros, con la
// misma gente, sus categorías y su grupo (00000000000750_volver_a_usar.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const GRUPO = '120363011111111111@g.us';

/** El Paseo con su grupo, liquidado y cerrado (todas las transferencias pagadas) */
async function cerrado(tx: Transaction) {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
  await tx.query('select public.connector_link_group($1, $2, $3, $4, $5)', [CONTADOR, GRUPO, 'Paseo de prueba', 'PASEO-7K2Q', '573016667788']);
  await tx.exec('reset role');
  await tx.query(`update public.expenses set status = 'confirmed' where account_id = $1 and status = 'pending_review'`, [PASEO]);
  await impersonate(tx, U.valeria);
  const { r } = await one<{ r: { direct_transfers: unknown[] } }>(tx, 'select public.settlement_overview($1, null) as r', [PASEO]);
  await tx.query('select public.start_settlement($1, null, $2)', [PASEO, JSON.stringify(r.direct_transfers)]);
  await tx.exec('reset role');
  await tx.query('update public.settlement_transfers set paid_at = now() where account_id = $1', [PASEO]);
  await impersonate(tx, U.valeria);
  await tx.query('select public.close_account($1)', [PASEO]);
}

describe('volver a usar una cuenta cerrada', () => {
  it('abre la siguiente en ceros, con toda la gente, sus categorías y su grupo; la cerrada se archiva para quien la usa', async () => {
    await as(db, null, async (tx) => {
      await cerrado(tx);
      const { id } = await one<{ id: string }>(tx, 'select public.volver_a_usar($1) as id', [PASEO]);
      expect(id).not.toBe(PASEO);

      await tx.exec('reset role');
      expect(await one(tx, 'select name, type, status, previous_account_id, owner_id from public.accounts where id = $1', [id])).toEqual({
        name: 'Paseo Santa Marta 2',
        type: 'evento',
        status: 'active',
        previous_account_id: PASEO,
        owner_id: U.valeria,
      });
      expect(await one(tx, 'select count(*)::int as n from public.expenses where account_id = $1', [id])).toEqual({ n: 0 });
      // Toda la gente, también la que no usa Luks (Caro y Felipe); quienes la usan, con su rol
      const gente = await tx.query<{ display_name: string; role: string | null }>(
        `select p.display_name, m.role from public.people p left join public.account_members m on m.person_id = p.id
         where p.account_id = $1 order by p.display_name`,
        [id],
      );
      const antes = await one<{ n: number }>(tx, 'select count(*)::int as n from public.people where account_id = $1', [PASEO]);
      expect(gente.rows).toHaveLength(antes.n);
      expect(gente.rows).toContainEqual({ display_name: 'Caro', role: null });
      expect(gente.rows).toContainEqual({ display_name: 'Valeria', role: 'owner' });
      expect(gente.rows).toContainEqual({ display_name: 'Laura', role: 'admin' });
      const cats = await one<{ n: number }>(tx, 'select count(*)::int as n from public.categories where account_id = $1', [id]);
      expect(cats.n).toBeGreaterThan(0);
      // Sus grupos (el del seed y el que se conectó) anotan desde ya en la nueva
      expect(
        await one(
          tx,
          `select l.account_id, l.history from public.account_group_links l join public.whatsapp_groups g on g.id = l.group_id
           where g.wa_group_jid = $1`,
          [GRUPO],
        ),
      ).toEqual({ account_id: id, history: 'desde_ya' });
      expect(await one(tx, 'select count(*)::int as n from public.account_group_links where account_id = $1', [PASEO])).toEqual({ n: 0 });
      // La cerrada sigue igual, archivada solo para Valeria
      expect(await one(tx, 'select status from public.accounts where id = $1', [PASEO])).toEqual({ status: 'closed' });
      expect(await one(tx, 'select archived_at is not null as archivada from public.account_members where account_id = $1 and user_id = $2', [PASEO, U.valeria])).toEqual({
        archivada: true,
      });
      expect(await one(tx, 'select archived_at is not null as archivada from public.account_members where account_id = $1 and user_id = $2', [PASEO, U.laura])).toEqual({
        archivada: false,
      });

      // Otro clic no abre otra: va a la misma
      await impersonate(tx, U.laura);
      expect(await one(tx, 'select public.volver_a_usar($1) as id', [PASEO])).toEqual({ id });
    });
  });

  it('solo quien administra, y solo si ya se liquidó', async () => {
    await as(db, U.mafe, async (tx) => {
      await expect(tx.query('select public.volver_a_usar($1)', [PASEO])).rejects.toThrow(/Solo quien administra/);
    });
    await as(db, U.valeria, async (tx) => {
      await expect(tx.query('select public.volver_a_usar($1)', [PASEO])).rejects.toThrow(/liquidada o cerrada/);
    });
  });
});
