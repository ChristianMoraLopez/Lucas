import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, P, PASEO, U } from './harness';

// Números verificados: identidades, «luks soy yo» y el link /v/ (00000000000310_numeros_verificados.sql)

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

const identidad = (tx: Transaction, phone: string) =>
  one<{ user_id: string | null; verified: boolean; verify_method: string | null }>(
    tx,
    'select user_id, verified_at is not null as verified, verify_method from public.whatsapp_identities where phone = $1',
    [phone],
  );

/** «luks soy yo» de Caro y el mensaje privado con el link, como lo deja el connector */
async function soyYo(tx: Transaction) {
  await comoConnector(tx);
  const { r } = await one<{ r: { identity_id: string; verified: boolean; last4: string; name: string | null } }>(
    tx,
    'select public.connector_soy_yo($1, $2, $3, null, $4) as r',
    [CONTADOR, `${CARO}@s.whatsapp.net`, CARO, 'Caro'],
  );
  await tx.query('select public.connector_outbox_enqueue($1)', [
    JSON.stringify([
      { chat_jid: `${CARO}@s.whatsapp.net`, reason: 'verify', body: 'Abre {link}', dedupe_key: `verify:${Math.random()}`, identity_id: r.identity_id },
    ]),
  ]);
  const { id } = await one<{ id: string }>(tx, `select id from public.whatsapp_outbox where reason = 'verify' order by created_at desc limit 1`);
  const { token } = await one<{ token: string }>(tx, 'select public.connector_verify_mint($1) as token', [id]);
  return { soyYo: r, token };
}

describe('identidades', () => {
  it('cada número de las personas, del grupo y de quien escribe tiene su identidad', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.exec('reset role');
      const { sin } = await one<{ sin: number }>(tx, 'select count(*)::int as sin from public.person_whatsapp_ids where identity_id is null');
      expect(sin).toBe(0);
      // Un integrante nuevo con número y LID: una sola identidad con los dos
      await comoConnector(tx);
      await tx.query('select public.connector_set_group_members($1, $2)', [
        'd0000000-0000-4000-8000-000000000001',
        JSON.stringify([{ id: '573009990077', phone: '573009990077', lid: '77770000', name: 'Pipe' }]),
      ]);
      await tx.exec('reset role');
      expect(await one(tx, `select phone, lid, push_name from public.whatsapp_identities where phone = '573009990077'`)).toEqual({
        phone: '573009990077',
        lid: '77770000',
        push_name: 'Pipe',
      });
    });
  });

  it('el número de un WhatsApp vinculado queda verificado para su dueño', async () => {
    await as(db, U.valeria, async (tx) => {
      const { r } = await one<{ r: string }>(tx, 'select public.request_personal_whatsapp(null) as r');
      await comoConnector(tx);
      await tx.query(`select public.connector_set_status($1, 'connected', '573170000000@s.whatsapp.net', null, '573170000000')`, [r]);
      await tx.exec('reset role');
      expect(await identidad(tx, '573170000000')).toEqual({ user_id: U.valeria, verified: true, verify_method: 'sesion_vinculada' });
    });
  });

  it('un número agregado en el perfil es suyo, pero heredado: no cuenta como verificado', async () => {
    await as(db, U.santi, async (tx) => {
      await tx.query(`select public.add_my_whatsapp('300 999 6655')`);
      await tx.exec('reset role');
      expect(await identidad(tx, '573009996655')).toEqual({ user_id: U.santi, verified: false, verify_method: 'heredado' });
    });
  });
});

describe('«luks soy yo» y el link /v/', () => {
  it('sin verificar: los últimos 4 números, y el chat privado queda abierto (lo pidió)', async () => {
    await as(db, U.nuevo, async (tx) => {
      const { soyYo: r, token } = await soyYo(tx);
      expect(r).toMatchObject({ verified: false, last4: '4471', name: null });
      expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
      // Solo se guarda el hash, nunca el código
      await tx.exec('reset role');
      const { n } = await one<{ n: number }>(
        tx,
        `select count(*)::int as n from public.whatsapp_verifications where token_hash = extensions.digest(convert_to($1, 'UTF8'), 'sha256')`,
        [token],
      );
      expect(n).toBe(1);
      const { privado } = await one<{ privado: string }>(tx, `select chat_kind as privado from public.whatsapp_groups where wa_group_jid = $1`, [
        `${CARO}@s.whatsapp.net`,
      ]);
      expect(privado).toBe('privado');
    });
  });

  it('con la sesión iniciada se ve el número (solo 4 dígitos) y al confirmarlo queda verificado y suyo', async () => {
    await as(db, U.nuevo, async (tx) => {
      const { token } = await soyYo(tx);
      await impersonate(tx, U.nuevo);
      expect((await one<{ r: unknown }>(tx, 'select public.preview_whatsapp_verification($1) as r', [token])).r).toEqual({
        status: 'ok',
        last4: '4471',
        mine: false,
        other: false,
      });
      await tx.query('select public.redeem_whatsapp_verification($1)', [token]);
      await tx.exec('reset role');
      expect(await identidad(tx, CARO)).toEqual({ user_id: U.nuevo, verified: true, verify_method: 'link_privado' });

      // Sirve una sola vez
      await impersonate(tx, U.nuevo);
      expect((await one<{ r: { status: string; mine: boolean } }>(tx, 'select public.preview_whatsapp_verification($1) as r', [token])).r).toMatchObject({
        status: 'used',
        mine: true,
      });
      await tx.exec('savepoint a');
      await expect(tx.query('select public.redeem_whatsapp_verification($1)', [token])).rejects.toThrow('ya se usó');
      await tx.exec('rollback to savepoint a');

      // Y con el número verificado, ya puede entrar como Caro
      expect(await one(tx, `select public.join_with_code('PASEO-7K2Q', $1) as id`, [P.caro])).toEqual({ id: PASEO });
    });
  });

  it('un link vencido o inventado no sirve', async () => {
    await as(db, U.nuevo, async (tx) => {
      const { token } = await soyYo(tx);
      await tx.exec('reset role');
      await tx.query(`update public.whatsapp_verifications set expires_at = now() - interval '1 minute'`);
      await impersonate(tx, U.nuevo);
      await tx.exec('savepoint a');
      await expect(tx.query('select public.redeem_whatsapp_verification($1)', [token])).rejects.toThrow('ya venció');
      await tx.exec('rollback to savepoint a');
      expect((await one<{ r: unknown }>(tx, `select public.preview_whatsapp_verification('inventado') as r`)).r).toEqual({ status: 'invalid' });
    });
  });

  it('quien tiene el teléfono es el dueño: si otro lo había verificado, pasa a quien abre el link', async () => {
    await as(db, U.nuevo, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update public.whatsapp_identities set user_id = $1, verified_at = now(), verify_method = 'link_privado' where phone = $2`, [
        U.otro,
        CARO,
      ]);
      const { soyYo: r, token } = await soyYo(tx);
      expect(r).toMatchObject({ verified: true });
      await impersonate(tx, U.nuevo);
      expect((await one<{ r: { other: boolean } }>(tx, 'select public.preview_whatsapp_verification($1) as r', [token])).r.other).toBe(true);
      await tx.query('select public.redeem_whatsapp_verification($1)', [token]);
      await tx.exec('reset role');
      expect((await identidad(tx, CARO)).user_id).toBe(U.nuevo);
    });
  });

  it('el link solo lo crea un mensaje de verificación de la bandeja', async () => {
    await as(db, U.nuevo, async (tx) => {
      await comoConnector(tx);
      await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, `${CARO}@s.whatsapp.net`]);
      await tx.query('select public.connector_outbox_enqueue($1)', [
        JSON.stringify([{ chat_jid: `${CARO}@s.whatsapp.net`, reason: 'guide', body: 'La guía', dedupe_key: 'guia-x' }]),
      ]);
      const { id } = await one<{ id: string }>(tx, `select id from public.whatsapp_outbox where dedupe_key = 'guia-x'`);
      await expect(tx.query('select public.connector_verify_mint($1)', [id])).rejects.toThrow('no lleva un link');
    });
  });
});

describe('reclamar una persona que tiene WhatsApp', () => {
  it('la invitación avisa a quién hay que verificar antes de elegirlo', async () => {
    await as(db, U.nuevo, async (tx) => {
      const { r } = await one<{ r: { unclaimed_people: { display_name: string; needs_verification: boolean }[] } }>(
        tx,
        `select public.preview_invitation('PASEO-7K2Q') as r`,
      );
      expect(r.unclaimed_people.find((p) => p.display_name === 'Caro')?.needs_verification).toBe(true);
    });
  });

  it('si un admin lo agregó desde Personas, entra sin verificar', async () => {
    await as(db, U.nuevo, async (tx) => {
      await tx.exec('reset role');
      const { id } = await one<{ id: string }>(
        tx,
        `insert into public.account_invites (account_id, user_id, person_id, invited_by) values ($1, $2, $3, $4) returning id`,
        [PASEO, U.nuevo, P.caro, U.valeria],
      );
      await impersonate(tx, U.nuevo);
      await tx.query('select public.accept_invite($1)', [id]);
      expect(await one(tx, 'select claimed_by from public.people where id = $1', [P.caro])).toEqual({ claimed_by: U.nuevo });
    });
  });
});

describe('el saludo de Mister Luks', () => {
  it('en un grupo sin cuenta nombra solo a quienes tienen su número verificado', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      const { r } = await one<{ r: { group_id: string } }>(tx, 'select public.connector_upsert_group($1, $2, $3) as r', [
        CONTADOR,
        '120363044444444444@g.us',
        'Cumple',
      ]);
      // Mafe tiene usuario pero su número está heredado; Valeria lo tiene verificado
      await tx.query('select public.connector_set_group_members($1, $2)', [
        r.group_id,
        JSON.stringify([
          { id: '573001112233', phone: '573001112233' },
          { id: '573016667788', phone: '573016667788' },
        ]),
      ]);
      await tx.exec('reset role');
      await tx.query(`update public.whatsapp_identities set user_id = $1, verified_at = now(), verify_method = 'link_privado' where phone = '573001112233'`, [
        U.valeria,
      ]);
      await comoConnector(tx);
      expect((await one<{ r: { luks_users: string[] } }>(tx, 'select public.connector_group_hello($1) as r', [r.group_id])).r.luks_users).toEqual(['Valeria']);
    });
  });
});

describe('permisos', () => {
  it('las identidades y los códigos no se leen desde la web', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.exec('savepoint a');
      await expect(tx.query('select * from public.whatsapp_identities')).rejects.toThrow(/permission denied/);
      await tx.exec('rollback to savepoint a');
      await expect(tx.query('select * from public.whatsapp_verifications')).rejects.toThrow(/permission denied/);
      await tx.exec('rollback to savepoint a');
      await expect(tx.query(`select public.connector_soy_yo($1, 'x', null, null, null)`, [CONTADOR])).rejects.toThrow(/permission denied/);
    });
    await expect(as(db, null, (tx) => tx.query(`select public.preview_whatsapp_verification('x')`))).rejects.toThrow(/permission denied/);
  });
});
