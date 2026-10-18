import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, count, createDb, impersonate, one, PASEO, U } from './harness';

// Conectar un grupo y crear su cuenta, por los dos caminos (00000000000330_grupos_detectados.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const JID = '120363555000111222@g.us';
const NUEVO = '573005550001';
const OTRO = '573005550002';
const GENTE = [
  { id: NUEVO, phone: NUEVO, name: 'Pipe' },
  { id: OTRO, phone: OTRO, name: 'Juana' },
  { id: '573005550003', phone: '573005550003', name: 'Toño' },
];

async function comoConnector(tx: Transaction) {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
}

/** Mister Luks entra a un grupo sin cuenta con tres personas */
async function misterLuksEntra(tx: Transaction) {
  await comoConnector(tx);
  const { r } = await one<{ r: { group_id: string; account_id: string | null; members: number; hello: { say_hello: boolean; luks_users: string[] } } }>(
    tx,
    'select public.connector_group_detected($1, $2, $3, 4, $4) as r',
    [CONTADOR, JID, 'Finca en Guatapé', JSON.stringify(GENTE)],
  );
  return r;
}

/** El saludo queda en la bandeja con el grupo; al mandarlo se crea el código del link /g/ */
async function linkDelSaludo(tx: Transaction, grupo: string) {
  await comoConnector(tx);
  await tx.query('select public.connector_outbox_enqueue($1)', [
    JSON.stringify([{ chat_jid: JID, reason: 'group_hello', body: 'Hola 👉 {grupo}', group_id: grupo, dedupe_key: `group_hello:${grupo}` }]),
  ]);
  const { id } = await one<{ id: string }>(tx, `select id from public.whatsapp_outbox where dedupe_key = $1`, [`group_hello:${grupo}`]);
  return (await one<{ token: string | null }>(tx, 'select public.connector_group_link_mint($1) as token', [id])).token;
}

async function verificar(tx: Transaction, usuario: string, numero: string) {
  await tx.exec('reset role');
  await tx.query(`update public.whatsapp_identities set user_id = $1, verified_at = now(), verify_method = 'link_privado' where phone = $2`, [usuario, numero]);
}

describe('Mister Luks entra a un grupo', () => {
  it('guarda el grupo, su gente y el saludo en una sola llamada (sin cuenta: nadie conocido)', async () => {
    await as(db, null, async (tx) => {
      const r = await misterLuksEntra(tx);
      expect(r).toMatchObject({ account_id: null, members: 3, hello: { say_hello: true, luks_users: [] } });
      // El saludo es una sola vez
      await comoConnector(tx);
      const { r: otra } = await one<{ r: { hello: { say_hello: boolean } } }>(tx, 'select public.connector_group_detected($1, $2, $3, 4, $4) as r', [
        CONTADOR,
        JID,
        'Finca en Guatapé',
        JSON.stringify(GENTE),
      ]);
      expect(otra.hello.say_hello).toBe(false);
    });
  });

  it('solo Mister Luks detecta grupos', async () => {
    await expect(
      as(db, U.nuevo, async (tx) => {
        const { r } = await one<{ r: string }>(tx, 'select public.request_personal_whatsapp(null) as r');
        await comoConnector(tx);
        await tx.query(`select public.connector_group_detected($1, $2, 'X', null, null)`, [r, JID]);
      }),
    ).rejects.toThrow('Solo Mister Luks');
  });

  it('el link /g/ se crea al mandarlo (solo el hash) y no se crea si el grupo ya tiene cuenta', async () => {
    await as(db, null, async (tx) => {
      const { group_id } = await misterLuksEntra(tx);
      const token = await linkDelSaludo(tx, group_id);
      expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
      await tx.exec('reset role');
      expect(await count(tx, 'select 1 from public.group_links where token_hash = public.hash_codigo($1) and group_id = $2', [token, group_id])).toBe(1);

      // Ya conectado: no hay link que mandar
      await tx.query('insert into public.account_group_links (group_id, account_id) values ($1, $2)', [group_id, PASEO]);
      await comoConnector(tx);
      await tx.query('select public.connector_outbox_enqueue($1)', [
        JSON.stringify([{ chat_jid: JID, reason: 'guide', body: 'Guía {grupo}', group_id, dedupe_key: 'guide:x' }]),
      ]);
      const { id } = await one<{ id: string }>(tx, `select id from public.whatsapp_outbox where dedupe_key = 'guide:x'`);
      expect(await one(tx, 'select public.connector_group_link_mint($1) as token', [id])).toEqual({ token: null });
    });
  });
});

describe('crear la cuenta con el link /g/', () => {
  it('cualquiera con el link la crea: el grupo queda conectado, su gente en la cuenta y Mister Luks lo cuenta', async () => {
    await as(db, U.otro, async (tx) => {
      const { group_id } = await misterLuksEntra(tx);
      const token = await linkDelSaludo(tx, group_id);
      await impersonate(tx, U.otro);

      const { v } = await one<{ v: Record<string, unknown> }>(tx, 'select public.preview_group($1) as v', [token]);
      expect(v).toMatchObject({ status: 'ok', via: 'link', name: 'Finca en Guatapé', mister_luks: true, member_count: 3, linked: null, in_group: false });
      // Nombres y últimos 4, nunca el número completo
      expect(JSON.stringify(v)).not.toContain(NUEVO);
      expect(v.members).toContainEqual({ name: 'Juana', last4: '0002', me: false, user: false });

      const { cuenta } = await one<{ cuenta: string }>(
        tx,
        `select public.create_account_from_group(null, $1, 'Finca', 'evento', null, null, 'Yo', 'USD', 'en') as cuenta`,
        [token],
      );
      await tx.exec('reset role');
      expect(await one(tx, 'select currency, language from public.accounts where id = $1', [cuenta])).toEqual({ currency: 'USD', language: 'en' });
      expect(await one(tx, 'select account_id, linked_by from public.account_group_links where group_id = $1', [group_id])).toEqual({
        account_id: cuenta,
        linked_by: U.otro,
      });
      // Yo y las 3 personas del grupo
      expect(await one(tx, 'select count(*)::int as n from public.people where account_id = $1', [cuenta])).toEqual({ n: 4 });
      expect(await one(tx, `select body from public.whatsapp_outbox where reason = 'link' and group_id = $1`, [group_id])).toEqual({
        body: expect.stringContaining('This group is now connected to “Finca” and its 3 members'),
      });
      // El link ya se usó
      expect(await one(tx, 'select used_by from public.group_links where group_id = $1', [group_id])).toEqual({ used_by: U.otro });
    });
  });

  it('es idempotente para quien la creó, y otro con el link usado no entra si su número no está verificado en el grupo', async () => {
    await as(db, U.otro, async (tx) => {
      const { group_id } = await misterLuksEntra(tx);
      const token = await linkDelSaludo(tx, group_id);
      await impersonate(tx, U.otro);
      const crear = `select public.create_account_from_group(null, $1, 'Finca', 'hogar') as cuenta`;
      const { cuenta } = await one<{ cuenta: string }>(tx, crear, [token]);
      expect(await one(tx, crear, [token])).toEqual({ cuenta });

      await impersonate(tx, U.nuevo);
      expect((await one<{ v: { status: string; linked: unknown } }>(tx, 'select public.preview_group($1) as v', [token])).v).toEqual({
        status: 'used',
        name: 'Finca en Guatapé',
        linked: { account_id: null, account_name: 'Finca', member: false },
      });
      await tx.exec('savepoint a');
      await expect(tx.query(crear, [token])).rejects.toThrow('luks soy yo');
      await tx.exec('rollback to savepoint a');

      // Con su número verificado y en el grupo, entra como la persona de su número
      await verificar(tx, U.nuevo, NUEVO);
      await impersonate(tx, U.nuevo);
      expect(await one(tx, crear, [token])).toEqual({ cuenta });
      expect(
        await one(
          tx,
          `select p.display_name from public.account_members am join public.people p on p.id = am.person_id
           where am.account_id = $1 and am.user_id = auth.uid()`,
          [cuenta],
        ),
      ).toEqual({ display_name: 'Pipe' });
    });
  });

  it('un link inventado o vencido no sirve', async () => {
    await as(db, U.otro, async (tx) => {
      expect((await one<{ v: unknown }>(tx, `select public.preview_group('no-existe-este-codigo-123') as v`)).v).toEqual({ status: 'invalid' });
      const { group_id } = await misterLuksEntra(tx);
      const token = await linkDelSaludo(tx, group_id);
      await tx.exec('reset role');
      await tx.query(`update public.group_links set expires_at = now() - interval '1 minute'`);
      await impersonate(tx, U.otro);
      expect((await one<{ v: { status: string } }>(tx, 'select public.preview_group($1) as v', [token])).v.status).toBe('expired');
      await expect(tx.query(`select public.create_account_from_group(null, $1, 'Finca', 'hogar')`, [token])).rejects.toThrow('ya no sirve');
    });
  });
});

describe('«Nuevo grupo detectado»', () => {
  it('quien tiene su número verificado en el grupo lo ve en el inicio, hasta que dice «Ahora no»', async () => {
    await as(db, U.nuevo, async (tx) => {
      const { group_id } = await misterLuksEntra(tx);
      await impersonate(tx, U.nuevo);
      expect((await one<{ g: unknown[] }>(tx, 'select public.my_detected_groups() as g')).g).toEqual([]);

      await verificar(tx, U.nuevo, NUEVO);
      await impersonate(tx, U.nuevo);
      expect((await one<{ g: unknown[] }>(tx, 'select public.my_detected_groups() as g')).g).toEqual([
        { group_id, name: 'Finca en Guatapé', member_count: 3, names: ['Juana', 'Toño'] },
      ]);
      // Sin link: le basta su número verificado
      expect(
        (await one<{ v: { status: string; via: string; in_group: boolean } }>(tx, 'select public.preview_group(null, $1) as v', [group_id])).v,
      ).toMatchObject({
        status: 'ok',
        via: 'detectado',
        in_group: true,
      });

      await tx.query('select public.dismiss_detected_group($1)', [group_id]);
      expect((await one<{ g: unknown[] }>(tx, 'select public.my_detected_groups() as g')).g).toEqual([]);
    });
  });

  it('desde la tarjeta crea la cuenta y queda como la persona de su número (una sola vez)', async () => {
    await as(db, U.nuevo, async (tx) => {
      const { group_id } = await misterLuksEntra(tx);
      await verificar(tx, U.nuevo, NUEVO);
      await impersonate(tx, U.nuevo);
      const { cuenta } = await one<{ cuenta: string }>(
        tx,
        `select public.create_account_from_group($1, null, 'Finca', 'evento', null, null, 'Felipe Ruiz') as cuenta`,
        [group_id],
      );
      await tx.exec('reset role');
      // Felipe (su usuario) es «Pipe» del grupo: 3 personas, no 4
      expect(await one(tx, 'select count(*)::int as n from public.people where account_id = $1', [cuenta])).toEqual({ n: 3 });
      expect(
        await one(
          tx,
          `select p.display_name from public.people p join public.person_whatsapp_ids w on w.person_id = p.id where p.account_id = $1 and w.wa_id = $2`,
          [cuenta, NUEVO],
        ),
      ).toEqual({ display_name: 'Felipe Ruiz' });
    });
  });

  it('sin el número en el grupo ni link, no se ve ni se puede conectar', async () => {
    await as(db, U.otro, async (tx) => {
      const { group_id } = await misterLuksEntra(tx);
      await impersonate(tx, U.otro);
      expect((await one<{ v: unknown }>(tx, 'select public.preview_group(null, $1) as v', [group_id])).v).toEqual({ status: 'invalid' });
      await expect(tx.query(`select public.create_account_from_group($1, null, 'Finca', 'hogar')`, [group_id])).rejects.toThrow('ya no sirve');
    });
  });
});

describe('con el WhatsApp vinculado', () => {
  /** Valeria vincula su WhatsApp y el connector ve un grupo suyo (solo el nombre: no hay cuenta) */
  async function grupoDeValeria(tx: Transaction) {
    const { r } = await one<{ r: string }>(tx, 'select public.request_personal_whatsapp(null) as r');
    await comoConnector(tx);
    await tx.query(`select public.connector_set_status($1, 'connected', '573170000001@s.whatsapp.net', null, '573170000001')`, [r]);
    const { g } = await one<{ g: { group_id: string } }>(
      tx,
      `select public.connector_upsert_group($1, '120363777000111222@g.us', 'Asado del sábado', 6) as g`,
      [r],
    );
    // Sin cuenta no se guardan sus integrantes
    const { m } = await one<{ m: { stored: boolean } }>(tx, 'select public.connector_set_group_members($1, $2) as m', [g.group_id, JSON.stringify(GENTE)]);
    expect(m.stored).toBe(false);
    return { conexion: r, grupo: g.group_id };
  }

  it('ve sus grupos (solo el nombre) y conecta uno a una cuenta que administra', async () => {
    await as(db, U.valeria, async (tx) => {
      const { conexion, grupo } = await grupoDeValeria(tx);
      await impersonate(tx, U.valeria);
      expect((await one<{ g: unknown[] }>(tx, 'select public.my_whatsapp_groups() as g')).g).toContainEqual({
        group_id: grupo,
        name: 'Asado del sábado',
        account_id: null,
        account_name: null,
        linked_elsewhere: false,
        mister_luks: false,
      });
      expect((await one<{ v: { via: string; members: unknown[] } }>(tx, 'select public.preview_group(null, $1) as v', [grupo])).v).toMatchObject({
        via: 'mi_whatsapp',
        members: [],
      });

      expect(await one(tx, 'select public.link_group_to_account($1, null, $2) as id', [grupo, PASEO])).toEqual({ id: PASEO });
      // El connector lee la gente en su próxima vuelta
      await comoConnector(tx);
      expect((await one<{ p: unknown[] }>(tx, 'select public.connector_groups_pending_members($1) as p', [[conexion]])).p).toEqual([
        { group_id: grupo, jid: '120363777000111222@g.us', connection_id: conexion },
      ]);
      await tx.query('select public.connector_set_group_members($1, $2)', [grupo, JSON.stringify(GENTE)]);
      expect((await one<{ p: unknown[] }>(tx, 'select public.connector_groups_pending_members($1) as p', [[conexion]])).p).toEqual([]);
      // Mister Luks no está: no escribe nada
      await tx.exec('reset role');
      expect(await count(tx, `select 1 from public.whatsapp_outbox where group_id = $1`, [grupo])).toBe(0);
    });
  });

  it('solo conecta a una cuenta que administra', async () => {
    await expect(
      as(db, U.santi, async (tx) => {
        const { r } = await one<{ r: string }>(tx, 'select public.request_personal_whatsapp(null) as r');
        await comoConnector(tx);
        const { g } = await one<{ g: { group_id: string } }>(tx, `select public.connector_upsert_group($1, '120363777000999222@g.us', 'X', 3) as g`, [r]);
        await impersonate(tx, U.santi);
        await tx.query('select public.link_group_to_account($1, null, $2)', [g.group_id, PASEO]);
      }),
    ).rejects.toThrow('Solo quienes administran');
  });

  it('crea la cuenta nueva desde su grupo', async () => {
    await as(db, U.valeria, async (tx) => {
      const { grupo } = await grupoDeValeria(tx);
      await impersonate(tx, U.valeria);
      const { cuenta } = await one<{ cuenta: string }>(tx, `select public.create_account_from_group($1, null, '', 'hogar') as cuenta`, [grupo]);
      // Sin nombre, el del grupo
      expect(await one(tx, 'select name, type from public.accounts where id = $1', [cuenta])).toEqual({ name: 'Asado del sábado', type: 'hogar' });
      expect(
        (await one<{ g: { account_id: string }[] }>(tx, 'select public.my_whatsapp_groups() as g', [])).g.find((x) => x.account_id === cuenta),
      ).toBeTruthy();
    });
  });
});
