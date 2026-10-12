import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, U } from './harness';

// Presencia por sesión, chats privados y la bandeja de salida (00000000000290_presencia_privados_y_salida.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const GRUPO_PASEO = 'd0000000-0000-4000-8000-000000000001';
const JID_PASEO = '120363040123456789@g.us';
const JID_NUEVO = '120363033333333333@g.us';
const PRIVADO = '573001112233@s.whatsapp.net';

async function comoConnector(tx: Transaction) {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
}

/** El WhatsApp de Valeria, vinculado y conectado */
async function whatsappDeValeria(tx: Transaction) {
  await impersonate(tx, U.valeria);
  const { r } = await one<{ r: string }>(tx, 'select public.request_personal_whatsapp(null) as r');
  await comoConnector(tx);
  await tx.query(`select public.connector_set_status($1, 'connected', '573170000000@s.whatsapp.net', null, '573170000000')`, [r]);
  return r;
}

const upsert = async (tx: Transaction, conexion: string, jid: string, nombre = 'Grupo') =>
  (
    await one<{ r: { group_id: string; account_id: string | null; language: string | null; say_hello: boolean } }>(
      tx,
      'select public.connector_upsert_group($1, $2, $3) as r',
      [conexion, jid, nombre],
    )
  ).r;

const lector = async (tx: Transaction, jid: string) =>
  one<{ connection_id: string; left_at: string | null }>(tx, 'select connection_id, left_at from public.whatsapp_groups where wa_group_jid = $1', [jid]);

const encolar = async (tx: Transaction, items: Record<string, unknown>[]) =>
  (await one<{ r: string[] }>(tx, 'select public.connector_outbox_enqueue($1) as r', [JSON.stringify(items)])).r;

describe('Mister Luks y un WhatsApp vinculado en el mismo grupo', () => {
  it('ninguno pisa al otro: lo lee Mister Luks, y si sale, el WhatsApp vinculado', async () => {
    await as(db, U.valeria, async (tx) => {
      const mio = await whatsappDeValeria(tx);
      // El grupo del paseo ya lo leía Mister Luks (semilla); ahora también el WhatsApp de Valeria
      await upsert(tx, mio, JID_PASEO);
      expect((await lector(tx, JID_PASEO)).connection_id).toBe(CONTADOR);
      const { n } = await one<{ n: number }>(tx, 'select count(*)::int as n from public.whatsapp_group_sessions where group_id = $1 and left_at is null', [
        GRUPO_PASEO,
      ]);
      expect(n).toBe(2);

      await tx.query('select public.connector_group_left($1, $2)', [JID_PASEO, CONTADOR]);
      expect(await lector(tx, JID_PASEO)).toEqual({ connection_id: mio, left_at: null });

      // Vuelve Mister Luks: el grupo es otra vez suyo
      await upsert(tx, CONTADOR, JID_PASEO);
      expect((await lector(tx, JID_PASEO)).connection_id).toBe(CONTADOR);

      // Salen los dos: nadie lo lee
      await tx.query('select public.connector_group_left($1, $2)', [JID_PASEO, CONTADOR]);
      await tx.query('select public.connector_group_left($1, $2)', [JID_PASEO, mio]);
      expect((await lector(tx, JID_PASEO)).left_at).not.toBeNull();
    });
  });

  it('el WhatsApp vinculado llegó primero; al entrar Mister Luks, lo lee él', async () => {
    await as(db, U.valeria, async (tx) => {
      const mio = await whatsappDeValeria(tx);
      await upsert(tx, mio, JID_NUEVO);
      expect((await lector(tx, JID_NUEVO)).connection_id).toBe(mio);
      await upsert(tx, CONTADOR, JID_NUEVO);
      expect((await lector(tx, JID_NUEVO)).connection_id).toBe(CONTADOR);
    });
  });

  it('saluda una vez por grupo, también si ya tiene cuenta, y dice el idioma de la cuenta', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      const r = await upsert(tx, CONTADOR, JID_PASEO);
      expect(r).toMatchObject({ say_hello: true, language: 'es' });
      expect(r.account_id).not.toBeNull();
      await tx.query('select public.connector_mark_hello($1)', [r.group_id]);
      expect((await upsert(tx, CONTADOR, JID_PASEO)).say_hello).toBe(false);
    });
  });
});

describe('chats privados con Mister Luks', () => {
  it('quedan sin nombre, solo los atiende Mister Luks y no se enlazan a una cuenta', async () => {
    await as(db, U.valeria, async (tx) => {
      const mio = await whatsappDeValeria(tx);
      const { id } = await one<{ id: string }>(tx, 'select public.connector_private_chat($1, $2) as id', [CONTADOR, PRIVADO]);
      const g = await one<{ chat_kind: string; name: string | null }>(tx, 'select chat_kind, name from public.whatsapp_groups where id = $1', [id]);
      expect(g).toEqual({ chat_kind: 'privado', name: null });

      await tx.exec('savepoint a');
      await expect(tx.query('select public.connector_private_chat($1, $2)', [mio, PRIVADO])).rejects.toThrow(/Solo Mister Luks/);
      await tx.exec('rollback to savepoint a');
      await expect(tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, 'status@broadcast'])).rejects.toThrow(/No es un chat privado/);
      await tx.exec('rollback to savepoint a');

      const { r } = await one<{ r: { ok: boolean; error: string } }>(tx, 'select public.connector_link_group($1, $2, null, $3, null) as r', [
        CONTADOR,
        PRIVADO,
        'PASEO-7K2Q',
      ]);
      expect(r).toEqual({ ok: false, error: 'no_es_grupo' });
    });
  });
});

describe('la bandeja de salida', () => {
  const bienvenida = {
    chat_jid: PRIVADO,
    reason: 'welcome',
    body: 'Hola',
    image_url: 'https://mrluks.com/guia/luks-guia-es.png',
    dedupe_key: 'welcome:573001112233',
  };

  it('a un chat privado solo si esa persona escribió primero, y nada se repite', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      expect(await encolar(tx, [bienvenida])).toEqual([]);
      await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, PRIVADO]);
      expect(await encolar(tx, [bienvenida])).toEqual(['welcome:573001112233']);
      expect(await encolar(tx, [bienvenida])).toEqual([]);
    });
  });

  it('a un grupo solo si Mister Luks está en él', async () => {
    await as(db, U.valeria, async (tx) => {
      const mio = await whatsappDeValeria(tx);
      await upsert(tx, mio, JID_NUEVO);
      const saludo = { chat_jid: JID_NUEVO, reason: 'group_hello', body: 'Hola, grupo', dedupe_key: 'group_hello:nuevo' };
      expect(await encolar(tx, [saludo])).toEqual([]);
      await upsert(tx, CONTADOR, JID_NUEVO);
      expect(await encolar(tx, [saludo])).toEqual(['group_hello:nuevo']);
    });
  });

  it('se marca lo enviado; a los tres fallos se deja, y lo de hace más de un día no se manda', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, PRIVADO]);
      await encolar(tx, [bienvenida, { ...bienvenida, reason: 'guide', dedupe_key: 'guide:1' }, { ...bienvenida, reason: 'guide', dedupe_key: 'guide:viejo' }]);
      await tx.exec('reset role');
      await tx.query(`update public.whatsapp_outbox set created_at = now() - interval '2 days' where dedupe_key = 'guide:viejo'`);
      await comoConnector(tx);

      const { r: pendientes } = await one<{ r: { id: string; dedupe_key?: string; reason: string }[] }>(tx, 'select public.connector_outbox_pending(10) as r');
      expect(pendientes.map((p) => p.reason)).toEqual(['welcome', 'guide']);
      const [primero, segundo] = pendientes;

      await tx.query('select public.connector_outbox_result($1, $2)', [primero.id, 'WAID-1']);
      for (let i = 0; i < 3; i++) await tx.query('select public.connector_outbox_result($1, null, $2)', [segundo.id, 'sin señal']);
      const { rows } = await tx.query<{ dedupe_key: string; sent: boolean; dropped: boolean; wa_message_id: string | null; attempts: number }>(
        `select dedupe_key, sent_at is not null as sent, dropped_at is not null as dropped, wa_message_id, attempts
         from public.whatsapp_outbox order by dedupe_key`,
      );
      expect(rows).toEqual([
        { dedupe_key: 'guide:1', sent: false, dropped: true, wa_message_id: null, attempts: 3 },
        { dedupe_key: 'guide:viejo', sent: false, dropped: true, wa_message_id: null, attempts: 0 },
        { dedupe_key: 'welcome:573001112233', sent: true, dropped: false, wa_message_id: 'WAID-1', attempts: 1 },
      ]);
      expect((await one<{ r: unknown[] }>(tx, 'select public.connector_outbox_pending(10) as r')).r).toEqual([]);
    });
  });

  it('nadie fuera del connector la toca', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.exec('savepoint a');
      await expect(tx.query('select * from public.whatsapp_outbox')).rejects.toThrow(/permission denied/);
      await tx.exec('rollback to savepoint a');
      await expect(tx.query(`select public.connector_outbox_enqueue('[]')`)).rejects.toThrow(/permission denied/);
      await tx.exec('rollback to savepoint a');
      await expect(tx.query('select * from public.whatsapp_group_sessions')).rejects.toThrow(/permission denied/);
    });
  });
});

describe('el saludo de Mister Luks', () => {
  const hola = async (tx: Transaction, grupo: string) =>
    (await one<{ r: { say_hello: boolean; language?: string; luks_users?: string[] } }>(tx, 'select public.connector_group_hello($1) as r', [grupo])).r;
  const fijar = (tx: Transaction, grupo: string, ids: string[]) =>
    tx.query('select public.connector_set_group_members($1, $2)', [grupo, JSON.stringify(ids.map((id) => ({ id, phone: id })))]);

  it('en un grupo con cuenta nombra a quienes ya tienen usuario (por su primer nombre) y saluda una sola vez', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      // Valeria y Mafe tienen usuario; Caro no
      await fijar(tx, GRUPO_PASEO, ['573001112233', '573016667788', '573002224471']);
      expect(await hola(tx, GRUPO_PASEO)).toMatchObject({ say_hello: true, language: 'es', luks_users: ['Mafe', 'Valeria'] });
      expect(await hola(tx, GRUPO_PASEO)).toEqual({ say_hello: false });
    });
  });

  it('en un grupo sin cuenta solo cuenta quien tiene su WhatsApp vinculado a Luks', async () => {
    await as(db, U.valeria, async (tx) => {
      await whatsappDeValeria(tx); // su número: 573170000000
      const { group_id } = await upsert(tx, CONTADOR, JID_NUEVO, 'Cumple de Caro');
      // Mafe tiene usuario, pero su número de este grupo no está verificado
      await fijar(tx, group_id, ['573170000000', '573016667788', '573009990001']);
      expect(await hola(tx, group_id)).toMatchObject({ say_hello: true, luks_users: ['Valeria'] });
    });
  });
});

describe('lo que escribe Luks no es un gasto', () => {
  it.each([
    '✅ Anotado: Taxi · $45.000 · pagó Andrés.',
    '🧾 Recibido: Taxi · $45.000. Queda por revisar en Luks 👀',
    '✅ Anotados 2:\n• Hielo · $8.000\n• Ron · $116.000',
    'Anotado: Taxi · $45.000.',
    '¡Hola, parche! 👋 Soy *Mister Luks* y vengo a llevar las cuentas del grupo 🧾✨ Manden «taxi 45 lucas»',
    '🎉 ¡Listo! Este grupo quedó conectado a «Paseo» y sus 8 integrantes ya están en la cuenta 🙌',
  ])('«%s»', async (texto) => {
    const { rows } = await db.query<{ r: boolean }>('select public.es_mensaje_de_luks($1) as r', [texto]);
    expect(rows[0].r).toBe(true);
  });

  it('y un gasto de verdad sí', async () => {
    const { rows } = await db.query<{ r: boolean }>('select public.es_mensaje_de_luks($1) as r', ['taxi al aeropuerto 45 lucas, la pagó Andrés']);
    expect(rows[0].r).toBe(false);
  });
});
