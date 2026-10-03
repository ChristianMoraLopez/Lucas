import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, createDb, impersonate, one, PASEO, U } from './harness';

// Agregar a alguien que ya está conmigo en otra cuenta (00000000000190_agregar_conocidos.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

type Conocido = { user_id: string; name: string; tone: string | null; accounts: string[] };
type Invitacion = { id: string; account_id: string; account_name: string; invited_by: string; person_name: string; people_count: number };

const rpc = async <T>(tx: Transaction, sql: string, params: unknown[] = []) => (await one<{ r: T }>(tx, `select ${sql} as r`, params)).r;
const fiesta = (tx: Transaction) => rpc<string>(tx, `public.create_account('Fiesta viernes', 'evento', null, null, 'Valeria')`);
const conocidos = (tx: Transaction, cuenta: string) => rpc<Conocido[]>(tx, 'public.people_to_add($1)', [cuenta]);
const invitar = (tx: Transaction, cuenta: string, ids: string[]) =>
  rpc<{ invited: number; person_ids: string[] }>(tx, 'public.invite_people($1, $2)', [cuenta, `{${ids.join(',')}}`]);
const misInvitaciones = (tx: Transaction) => rpc<Invitacion[]>(tx, 'public.my_invites()');

describe('agregar a alguien de mis otras cuentas', () => {
  it('Valeria ve a la gente de la casa y del paseo; agrega a Andrés y a él le llega para aceptar', async () => {
    await as(db, U.valeria, async (tx) => {
      const cuenta = await fiesta(tx);
      const lista = await conocidos(tx, cuenta);
      const andres = lista.find((c) => c.user_id === U.andres);
      // Andrés está con ella en la casa y en el paseo; ella no se ve a sí misma
      expect(andres?.accounts).toEqual(['Casa', 'Paseo Santa Marta']);
      expect(lista.some((c) => c.user_id === U.valeria)).toBe(false);
      expect(lista.map((c) => c.user_id)).toEqual(expect.arrayContaining([U.laura, U.mafe, U.santi, U.juanCamilo]));

      const r = await invitar(tx, cuenta, [U.andres]);
      expect(r.invited).toBe(1);
      // Ya es persona de la cuenta (se pueden dividir gastos con él) y no sale otra vez para agregar
      const { rows: personas } = await tx.query<{ display_name: string; claimed_by: string | null }>(
        'select display_name, claimed_by from public.people where account_id = $1 order by created_at',
        [cuenta],
      );
      expect(personas).toEqual([
        { display_name: 'Valeria', claimed_by: U.valeria },
        { display_name: 'Andrés', claimed_by: null },
      ]);
      expect((await conocidos(tx, cuenta)).some((c) => c.user_id === U.andres)).toBe(false);
      // Invitar otra vez no repite nada
      expect((await invitar(tx, cuenta, [U.andres])).invited).toBe(0);

      // Andrés lo ve en su home y acepta: entra como miembro con esa persona
      await impersonate(tx, U.andres);
      const [inv] = await misInvitaciones(tx);
      expect(inv).toMatchObject({ account_id: cuenta, account_name: 'Fiesta viernes', invited_by: 'Valeria', person_name: 'Andrés', people_count: 2 });
      expect(await rpc<string>(tx, 'public.accept_invite($1)', [inv.id])).toBe(cuenta);
      expect(await misInvitaciones(tx)).toEqual([]);
      const { rows } = await tx.query<{ role: string; display_name: string }>(
        `select m.role, p.display_name from public.account_members m join public.people p on p.id = m.person_id
         where m.account_id = $1 and m.user_id = $2`,
        [cuenta, U.andres],
      );
      expect(rows).toEqual([{ role: 'member', display_name: 'Andrés' }]);
    });
  });

  it('si ya estaba con su nombre y sin usuario, es esa persona (no se duplica)', async () => {
    await as(db, U.valeria, async (tx) => {
      const cuenta = await fiesta(tx);
      await tx.query(`select public.add_people($1, array['Mafe'])`, [cuenta]);
      await invitar(tx, cuenta, [U.mafe]);
      const { rows } = await tx.query<{ n: number }>(`select count(*)::int as n from public.people where account_id = $1 and display_name = 'Mafe'`, [cuenta]);
      expect(rows[0].n).toBe(1);
    });
  });

  it('«Ahora no» y cancelar: se borra la invitación, el nombre queda en la cuenta', async () => {
    await as(db, U.valeria, async (tx) => {
      const cuenta = await fiesta(tx);
      await invitar(tx, cuenta, [U.mafe, U.santi]);

      await impersonate(tx, U.mafe);
      const [deMafe] = await misInvitaciones(tx);
      await tx.query('select public.decline_invite($1)', [deMafe.id]);
      expect(await misInvitaciones(tx)).toEqual([]);
      // Mafe no puede aceptar ni cancelar la de Santi
      await impersonate(tx, U.santi);
      const [deSanti] = await misInvitaciones(tx);
      await impersonate(tx, U.mafe);
      await tx.exec('savepoint a');
      await expect(tx.query('select public.accept_invite($1)', [deSanti.id])).rejects.toThrow('Esa invitación ya no está');
      await tx.exec('rollback to savepoint a');
      await expect(tx.query('select public.cancel_invite($1)', [deSanti.id])).rejects.toThrow('Solo quien administra');
      await tx.exec('rollback to savepoint a');

      await impersonate(tx, U.valeria);
      await tx.query('select public.cancel_invite($1)', [deSanti.id]);
      const { rows } = await tx.query<{ n: number }>('select count(*)::int as n from public.account_invites where account_id = $1', [cuenta]);
      expect(rows[0].n).toBe(0);
      const { rows: personas } = await tx.query<{ n: number }>('select count(*)::int as n from public.people where account_id = $1', [cuenta]);
      expect(personas[0].n).toBe(3);
    });
  });

  it('solo quien administra, y solo gente de sus otras cuentas', async () => {
    await as(db, U.valeria, async (tx) => {
      const cuenta = await fiesta(tx);
      await tx.exec('savepoint a');
      await expect(invitar(tx, cuenta, [U.otro])).rejects.toThrow('no está en tus otras cuentas');
      await tx.exec('rollback to savepoint a');

      // Andrés es miembro (no admin) del paseo: no puede agregar ahí
      await impersonate(tx, U.andres);
      await expect(conocidos(tx, PASEO)).rejects.toThrow('Solo quien administra');
      await tx.exec('rollback to savepoint a');
      await impersonate(tx, U.andres); // volver al savepoint también deshizo el cambio de usuario
      await expect(invitar(tx, PASEO, [U.valeria])).rejects.toThrow('Solo quien administra');
    });
  });

  it('cada quien ve solo sus invitaciones; quien administra, las de su cuenta', async () => {
    await as(db, U.valeria, async (tx) => {
      const cuenta = await fiesta(tx);
      await invitar(tx, cuenta, [U.andres]);
      const leer = () => tx.query('select * from public.account_invites where account_id = $1', [cuenta]).then((x) => x.rows.length);
      expect(await leer()).toBe(1);
      await impersonate(tx, U.andres);
      expect(await leer()).toBe(1);
      await impersonate(tx, U.mafe);
      expect(await leer()).toBe(0);
      await tx.exec('savepoint a');
      await expect(tx.query('delete from public.account_invites returning id')).rejects.toThrow(/permission denied/);
      await tx.exec('rollback to savepoint a');
      // La casa no tiene nada que ver: Valeria no ve invitaciones de otras cuentas
      expect(CASA).toBeTruthy();
    });
  });
});
