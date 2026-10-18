import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, count, createDb, impersonate, one, P, PASEO, U } from './harness';

// Una sola persona aunque entre por Gmail y por WhatsApp (00000000000320_una_sola_persona.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const CARO = '573002224471';

async function comoConnector(tx: Transaction) {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
}

/** «luks soy yo» desde el número de Caro y el link /v/ que le llega por privado */
async function linkDeCaro(tx: Transaction) {
  await comoConnector(tx);
  const { r } = await one<{ r: { identity_id: string } }>(tx, 'select public.connector_soy_yo($1, $2, $3, null, $4) as r', [
    CONTADOR,
    `${CARO}@s.whatsapp.net`,
    CARO,
    'Caro',
  ]);
  await tx.query('select public.connector_outbox_enqueue($1)', [
    JSON.stringify([
      { chat_jid: `${CARO}@s.whatsapp.net`, reason: 'verify', body: 'Abre {link}', dedupe_key: `verify:${Math.random()}`, identity_id: r.identity_id },
    ]),
  ]);
  const { id } = await one<{ id: string }>(tx, `select id from public.whatsapp_outbox where reason = 'verify' order by created_at desc limit 1`);
  return (await one<{ token: string }>(tx, 'select public.connector_verify_mint($1) as token', [id])).token;
}

/** Lo que mueve plata en la cuenta: el total de cada gasto, lo que suman sus partes y lo que pagó cada quien */
async function plata(tx: Transaction) {
  await tx.exec('reset role');
  const { rows } = await tx.query<{ expense_id: string; total: number; partes: number }>(
    `select e.id as expense_id, e.total_cop::int as total, coalesce(sum(s.amount_cop), 0)::int as partes
     from public.expenses e left join public.expense_splits s on s.expense_id = e.id
     where e.account_id = $1 group by e.id order by e.id`,
    [PASEO],
  );
  return rows;
}

describe('grupo primero, Gmail después', () => {
  it('al verificar su número, la persona del grupo se une a la suya y la plata no cambia', async () => {
    await as(db, U.nuevo, async (tx) => {
      // Entró con Gmail como persona nueva aunque ya estaba en el grupo como «Caro»
      expect(await one(tx, `select public.join_with_code('PASEO-7K2Q', null, 'Carolina Díaz') as id`)).toEqual({ id: PASEO });
      const { yo } = await one<{ yo: string }>(tx, 'select id as yo from public.people where account_id = $1 and claimed_by = auth.uid()', [PASEO]);
      const antes = await plata(tx);
      const { pagos } = await one<{ pagos: number }>(tx, 'select count(*)::int as pagos from public.expenses where payer_person_id = $1', [P.caro]);
      expect(pagos).toBeGreaterThan(0);

      const token = await linkDeCaro(tx);
      await impersonate(tx, U.nuevo);
      const { r } = await one<{ r: { merged_in: string[]; taken_in: string[]; accounts: number } }>(tx, 'select public.redeem_whatsapp_verification($1) as r', [
        token,
      ]);
      expect(r).toMatchObject({ merged_in: ['Paseo Santa Marta'], taken_in: [], accounts: 1 });

      await tx.exec('reset role');
      // Una sola persona: la suya, con su nombre, su número y lo que pagó Caro
      expect(await count(tx, 'select 1 from public.people where id = $1', [P.caro])).toBe(0);
      expect(await one(tx, 'select display_name from public.people where id = $1', [yo])).toEqual({ display_name: 'Carolina Díaz' });
      expect(await count(tx, 'select 1 from public.person_whatsapp_ids where person_id = $1 and wa_id = $2', [yo, CARO])).toBe(1);
      expect(await one(tx, 'select count(*)::int as n from public.expenses where payer_person_id = $1', [yo])).toEqual({ n: pagos });
      // Los totales y las partes de cada gasto, iguales
      expect(await plata(tx)).toEqual(antes);
    });
  });

  it('si ese número es de alguien con usuario, no se toca y se avisa', async () => {
    await as(db, U.nuevo, async (tx) => {
      await tx.query(`select public.join_with_code('PASEO-7K2Q', null, 'Carolina')`);
      // Otro usuario ya es Caro (un admin lo agregó desde Personas)
      await tx.exec('reset role');
      await tx.query('insert into public.account_invites (account_id, user_id, person_id) values ($1, $2, $3)', [PASEO, U.otro, P.caro]);
      await tx.query('update public.people set claimed_by = $1 where id = $2', [U.otro, P.caro]);
      const token = await linkDeCaro(tx);
      await impersonate(tx, U.nuevo);
      const { r } = await one<{ r: { merged_in: string[]; taken_in: string[] } }>(tx, 'select public.redeem_whatsapp_verification($1) as r', [token]);
      expect(r).toMatchObject({ merged_in: [], taken_in: ['Paseo Santa Marta'] });
      await tx.exec('reset role');
      expect(await count(tx, 'select 1 from public.people where id = $1', [P.caro])).toBe(1);
    });
  });

  it('un número escrito en el perfil (sin verificar) no une a nadie', async () => {
    await as(db, U.nuevo, async (tx) => {
      await tx.query(`select public.join_with_code('PASEO-7K2Q', null, 'Carolina')`);
      const { r } = await one<{ r: { merged_in: string[]; taken_in: string[] } }>(tx, `select public.add_my_whatsapp('300 222 4471') as r`);
      expect(r).toMatchObject({ merged_in: [], taken_in: ['Paseo Santa Marta'] });
      await tx.exec('reset role');
      expect(await count(tx, 'select 1 from public.people where id = $1', [P.caro])).toBe(1);
    });
  });

  it('con el WhatsApp vinculado también se une (vincularlo es verificarlo)', async () => {
    await as(db, U.nuevo, async (tx) => {
      await tx.query(`select public.join_with_code('PASEO-7K2Q', null, 'Carolina')`);
      const { r } = await one<{ r: string }>(tx, 'select public.request_personal_whatsapp(null) as r');
      await comoConnector(tx);
      await tx.query(`select public.connector_set_status($1, 'connected', $2, null, $3)`, [r, `${CARO}@s.whatsapp.net`, CARO]);
      await tx.exec('reset role');
      expect(await count(tx, 'select 1 from public.people where id = $1', [P.caro])).toBe(0);
      expect(
        await count(
          tx,
          `select 1 from public.people p join public.person_whatsapp_ids w on w.person_id = p.id
           where p.account_id = $1 and p.claimed_by = $2 and w.wa_id = $3`,
          [PASEO, U.nuevo, CARO],
        ),
      ).toBe(1);
    });
  });

  it('quien está en una liquidación no se une sola (se avisa como antes)', async () => {
    await as(db, U.nuevo, async (tx) => {
      await tx.query(`select public.join_with_code('PASEO-7K2Q', null, 'Carolina')`);
      await tx.exec('reset role');
      const { id: st } = await one<{ id: string }>(tx, 'insert into public.settlements (account_id) values ($1) returning id', [PASEO]);
      await tx.query(
        `insert into public.settlement_transfers (settlement_id, account_id, from_person_id, to_person_id, amount_cop, position)
         values ($1, $2, $3, $4, 1000, 1)`,
        [st, PASEO, P.caro, P.paseoValeria],
      );
      const token = await linkDeCaro(tx);
      await impersonate(tx, U.nuevo);
      const { r } = await one<{ r: { merged_in: string[]; taken_in: string[] } }>(tx, 'select public.redeem_whatsapp_verification($1) as r', [token]);
      expect(r).toMatchObject({ merged_in: [], taken_in: ['Paseo Santa Marta'] });
    });
  });
});

describe('Gmail primero, grupo después', () => {
  it('con su número verificado, el grupo no lo crea otra vez', async () => {
    await as(db, U.nuevo, async (tx) => {
      // Verificó su número antes de tener cuentas
      const token = await linkDeCaro(tx);
      await impersonate(tx, U.nuevo);
      await tx.query('select public.redeem_whatsapp_verification($1)', [token]);
      // Crea su cuenta con Gmail y después conectan el grupo
      const { cuenta } = await one<{ cuenta: string }>(tx, `select public.create_account('Finca', 'evento', null, null, 'Carolina') as cuenta`);
      await comoConnector(tx);
      const { id: grupo } = await one<{ id: string }>(
        tx,
        `insert into public.whatsapp_groups (connection_id, wa_group_jid, name) values ($1, '120363999000111222@g.us', 'Finca') returning id`,
        [CONTADOR],
      );
      await tx.query('insert into public.whatsapp_group_sessions (group_id, connection_id) values ($1, $2)', [grupo, CONTADOR]);
      await tx.query('insert into public.account_group_links (group_id, account_id) values ($1, $2)', [grupo, cuenta]);
      const { r } = await one<{ r: { people_added: number } }>(tx, 'select public.connector_set_group_members($1, $2) as r', [
        grupo,
        JSON.stringify([
          { id: CARO, phone: CARO, name: 'Caro 🌻' },
          { id: '573009990001', phone: '573009990001', name: 'Mafe' },
        ]),
      ]);
      // Solo Mafe es nueva; Caro es la persona de la cuenta que ya existía
      expect(r.people_added).toBe(1);
      await tx.exec('reset role');
      expect(await one(tx, 'select count(*)::int as n from public.people where account_id = $1', [cuenta])).toEqual({ n: 2 });
      expect(
        await one(
          tx,
          `select p.display_name from public.people p join public.person_whatsapp_ids w on w.person_id = p.id
           where p.account_id = $1 and w.wa_id = $2`,
          [cuenta, CARO],
        ),
      ).toEqual({ display_name: 'Carolina' });
    });
  });

  it('un número solo escrito en el perfil (sin verificar) no basta para reconocerlo en una cuenta nueva', async () => {
    await as(db, U.nuevo, async (tx) => {
      // Lo escribió en el perfil antes de tener cuentas: es «suyo», pero heredado
      await tx.query(`select public.add_my_whatsapp('300 999 0002')`);
      const { cuenta } = await one<{ cuenta: string }>(tx, `select public.create_account('Finca', 'evento', null, null, 'Carolina') as cuenta`);
      await comoConnector(tx);
      const { id: grupo } = await one<{ id: string }>(
        tx,
        `insert into public.whatsapp_groups (connection_id, wa_group_jid, name) values ($1, '120363999000111333@g.us', 'Finca') returning id`,
        [CONTADOR],
      );
      await tx.query('insert into public.whatsapp_group_sessions (group_id, connection_id) values ($1, $2)', [grupo, CONTADOR]);
      await tx.query('insert into public.account_group_links (group_id, account_id) values ($1, $2)', [grupo, cuenta]);
      const { r } = await one<{ r: { people_added: number } }>(tx, 'select public.connector_set_group_members($1, $2) as r', [
        grupo,
        JSON.stringify([{ id: '573009990002', phone: '573009990002', name: 'Caro' }]),
      ]);
      // Cualquiera puede escribir el número de otro en su perfil: sin verificar, es otra persona
      expect(r.people_added).toBe(1);
    });
  });
});

describe('reclamar una persona con WhatsApp', () => {
  it('el error explica cómo verificar el número, sin sugerir entrar como persona nueva', async () => {
    const error = await as(db, U.nuevo, (tx) => tx.query(`select public.join_with_code('PASEO-7K2Q', $1)`, [P.caro])).catch((e: Error) => e.message);
    expect(error).toContain('luks soy yo');
    expect(error).toContain('dos veces');
    expect(error).not.toContain('persona nueva');
  });
});
