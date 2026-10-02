import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, count, createDb, impersonate, one, P, PASEO, U } from './harness';

// Perfil (00000000000140_perfil.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

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

interface Perfil {
  email: string;
  full_name: string | null;
  accounts: { id: string; name: string; role: string; person_id: string; person_name: string }[];
  whatsapp: string[];
}

const perfil = async (tx: Transaction) => (await one<{ p: Perfil }>(tx, 'select public.my_profile() as p')).p;

describe('ver el perfil', () => {
  it('cada quien ve su correo, sus cuentas (y cómo lo llaman) y sus números', async () => {
    await as(db, U.valeria, async (tx) => {
      const p = await perfil(tx);
      expect(p.email).toMatch('@');
      expect(p.accounts.map((a) => a.id).sort()).toEqual([CASA, PASEO].sort());
      expect(p.accounts.find((a) => a.id === PASEO)).toMatchObject({ role: 'owner', person_id: P.paseoValeria });
      expect(p.whatsapp).toEqual(['573001112233']);
    });
    await as(db, U.nuevo, async (tx) => {
      expect(await perfil(tx)).toMatchObject({ email: 'nuevo@example.com', accounts: [], whatsapp: [] });
    });
  });

  it('sin sesión no hay perfil', async () => {
    await as(db, null, async (tx) => {
      expect(await falla(tx, 'select public.my_profile()')).toMatch('permission denied');
    });
  });
});

describe('cambiar el nombre', () => {
  it('el suyo y el de cada cuenta, nada más', async () => {
    await as(db, U.santi, async (tx) => {
      expect(await one(tx, `select public.update_my_name('  Santiago   Ruiz ') as n`)).toEqual({ n: 'Santiago Ruiz' });
      expect((await perfil(tx)).full_name).toBe('Santiago Ruiz');
      expect(await falla(tx, `select public.update_my_name('   ')`)).toMatch('Escribe tu nombre');

      await tx.query(`select public.update_my_person_name($1, 'Santi R.')`, [P.paseoSanti]);
      expect(await one(tx, 'select display_name from public.people where id = $1', [P.paseoSanti])).toEqual({ display_name: 'Santi R.' });
      // La persona de otro, no
      expect(await falla(tx, `select public.update_my_person_name($1, 'Caro X')`, [P.caro])).toMatch('no eres tú');
    });
  });
});

describe('su WhatsApp', () => {
  it('«300 999 8877» queda como 573009998877 en sus cuentas y lo de ese número pasa a su nombre', async () => {
    await as(db, U.santi, async (tx) => {
      await tx.exec('reset role');
      const { id } = await one<{ id: string }>(
        tx,
        `insert into public.messages (account_id, group_id, source, wa_message_id, kind, text_body, sender_wa_id)
         values ($1, 'd0000000-0000-4000-8000-000000000001', 'whatsapp', 'PRUEBA-PERFIL', 'text', 'hielo 12 lucas', '573009998877') returning id`,
        [PASEO],
      );
      await impersonate(tx, U.santi);
      const r = await one<{ r: { wa_id: string; accounts: number; taken_in: string[] } }>(tx, `select public.add_my_whatsapp('300 999 8877') as r`);
      expect(r.r).toEqual({ wa_id: '573009998877', accounts: 1, taken_in: [] });
      expect((await perfil(tx)).whatsapp.sort()).toEqual(['573009998877', '573128880365']);
      await tx.exec('reset role');
      expect(await one(tx, 'select sender_person_id from public.messages where id = $1', [id])).toEqual({ sender_person_id: P.paseoSanti });
      await impersonate(tx, U.santi);

      expect(await one(tx, `select public.remove_my_whatsapp('573009998877') as n`)).toEqual({ n: 1 });
      expect((await perfil(tx)).whatsapp).toEqual(['573128880365']);
      expect(await falla(tx, `select public.add_my_whatsapp('12345')`)).toMatch('indicativo');
    });
  });

  it('en una cuenta donde ese número ya es de otra persona, no se pone', async () => {
    await as(db, U.santi, async (tx) => {
      // El de Caro (sin cuenta) en el paseo
      const r = await one<{ r: { accounts: number; taken_in: string[] } }>(tx, `select public.add_my_whatsapp('+57 300 222 4471') as r`);
      expect(r.r).toMatchObject({ accounts: 0, taken_in: ['Paseo Santa Marta'] });
    });
  });
});

describe('sus datos', () => {
  it('descarga lo que pagó, su parte de cada gasto y sus mensajes', async () => {
    await as(db, U.valeria, async (tx) => {
      const { d } = await one<{ d: { profile: Perfil; expenses_paid: unknown[]; my_shares: unknown[]; messages: unknown[] } }>(
        tx,
        'select public.my_data_export() as d',
      );
      expect(d.profile.email).toMatch('@');
      expect(d.expenses_paid.length).toBeGreaterThan(0);
      expect(d.my_shares.length).toBeGreaterThan(0);
    });
  });

  it('borrar la cuenta: sus cuentas pasan a otra persona, su WhatsApp se borra y, si quiere, su nombre también', async () => {
    await as(db, U.santi, async (tx) => {
      await tx.query('select public.delete_my_account(true)');
      await tx.exec('reset role');
      expect(await count(tx, 'select 1 from auth.users where id = $1', [U.santi])).toBe(0);
      expect(await one(tx, 'select display_name, claimed_by from public.people where id = $1', [P.paseoSanti])).toEqual({
        display_name: 'Persona eliminada',
        claimed_by: null,
      });
      expect(await count(tx, `select 1 from public.person_whatsapp_ids where wa_id = '573128880365'`)).toBe(0);
      // Sus gastos siguen ahí: el paseo cuadra igual
      expect(await count(tx, 'select 1 from public.expense_splits where person_id = $1', [P.paseoSanti])).toBeGreaterThan(0);
    });
    await as(db, U.valeria, async (tx) => {
      await tx.query('select public.delete_my_account(false)');
      await tx.exec('reset role');
      // Sin anonimizar: su nombre se queda; sus cuentas pasan a otra persona
      expect(await one(tx, 'select display_name from public.people where id = $1', [P.paseoValeria])).toEqual({ display_name: 'Valeria' });
      expect(await one(tx, 'select owner_id from public.accounts where id = $1', [CASA])).toEqual({ owner_id: U.andres });
    });
  });
});
