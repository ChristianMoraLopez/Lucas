import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, createDb, impersonate, one, P, PASEO, U } from './harness';

// Fase 5: lo que el connector de WhatsApp usa de la base (00000000000080_whatsapp_connector.sql).

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const DENIED = /permission denied/;
const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const GRUPO_NUEVO = '120363099999999999@g.us';
const GRUPO_CASA = '120363040987654321@g.us';
const GRUPO_PASEO = '120363040123456789@g.us';
const CODIGO_PASEO = 'PASEO-7K2Q'; // invitación vigente de la semilla
const CODIGO_REVOCADO = 'PASEO-3HWD';
const MAFE_WA = '573016667788';
const NUEVO_WA = '573009998877';

async function comoConnector(tx: Transaction) {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
}

/** Corre algo que debe fallar sin dañar la transacción; devuelve el error (o null si no falló). */
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

async function rpc<T = Record<string, unknown>>(tx: Transaction, sql: string, params: unknown[] = []) {
  const { r } = await one<{ r: T }>(tx, `select ${sql} as r`, params);
  return r;
}

async function enlazar(tx: Transaction, jid = GRUPO_NUEVO, code = CODIGO_PASEO, sender: string | null = MAFE_WA) {
  return rpc<{ ok: boolean; error?: string; already?: boolean; account_id?: string; account_name?: string; group_id?: string }>(
    tx,
    'public.connector_link_group($1, $2, $3, $4, $5)',
    [CONTADOR, jid, 'Paseo de prueba', code, sender],
  );
}

async function ingerir(
  tx: Transaction,
  o: { jid?: string; id: string; from?: string | null; name?: string; text?: string; kind?: string; path?: string | null; at?: string },
) {
  return rpc<{ ingest: boolean; reason?: string; message_id?: string; known_sender?: boolean }>(
    tx,
    'public.connector_ingest_message($1, $2, $3, $4, $5::public.message_kind, $6, $7, $8, $9, $10)',
    [
      o.jid ?? GRUPO_NUEVO,
      o.id,
      o.from === undefined ? NUEVO_WA : o.from,
      o.name ?? 'Pipe',
      o.kind ?? 'text',
      o.text ?? 'taxi al aeropuerto 45 lucas',
      o.path ?? null,
      null,
      o.kind === 'photo' ? 'image/jpeg' : null,
      o.at ?? new Date().toISOString(),
    ],
  );
}

describe('enlazar un grupo con «lucas CÓDIGO»', () => {
  it('con un código vigente el grupo queda en la cuenta, una sola vez', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      const r = await enlazar(tx, GRUPO_NUEVO, 'paseo-7k2q'); // como lo escriban
      expect(r).toMatchObject({ ok: true, already: false, account_id: PASEO, account_name: 'Paseo Santa Marta' });
      expect(await enlazar(tx)).toMatchObject({ ok: true, already: true });

      await tx.exec('reset role');
      const l = await one<{ account_id: string; linked_by: string | null; linked_by_wa_id: string }>(
        tx,
        `select l.account_id, l.linked_by, l.linked_by_wa_id from public.account_group_links l
         join public.whatsapp_groups g on g.id = l.group_id where g.wa_group_jid = $1`,
        [GRUPO_NUEVO],
      );
      // Mafe ya tiene usuario: queda como quien enlazó
      expect(l).toEqual({ account_id: PASEO, linked_by: U.mafe, linked_by_wa_id: MAFE_WA });
    });
  });

  it('códigos revocados, vencidos, agotados o de cuentas cerradas no sirven', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      expect(await enlazar(tx, GRUPO_NUEVO, CODIGO_REVOCADO)).toEqual({ ok: false, error: 'codigo_invalido' });
      expect(await enlazar(tx, GRUPO_NUEVO, 'NADA-0000')).toEqual({ ok: false, error: 'codigo_invalido' });

      await tx.exec('reset role');
      await tx.query(`update public.invitations set uses = max_uses where code = $1`, [CODIGO_PASEO]);
      await comoConnector(tx);
      expect(await enlazar(tx)).toEqual({ ok: false, error: 'codigo_invalido' });

      await tx.exec('reset role');
      await tx.query(`update public.invitations set uses = 0, expires_at = now() - interval '1 minute' where code = $1`, [CODIGO_PASEO]);
      await comoConnector(tx);
      expect(await enlazar(tx)).toEqual({ ok: false, error: 'codigo_invalido' });

      await tx.exec('reset role');
      await tx.query(`update public.invitations set expires_at = null where code = $1`, [CODIGO_PASEO]);
      await tx.query(`update public.accounts set status = 'closed' where id = $1`, [PASEO]);
      await comoConnector(tx);
      expect(await enlazar(tx)).toEqual({ ok: false, error: 'codigo_invalido' });
    });
  });

  it('un grupo de otra cuenta no se roba con un código', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      expect(await enlazar(tx, GRUPO_CASA)).toEqual({ ok: false, error: 'otra_cuenta' });
    });
  });
});

describe('ingesta de mensajes', () => {
  it('guarda lo de grupos enlazados, crea el trabajo y anota al remitente desconocido', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      await enlazar(tx);
      const r = await ingerir(tx, { id: 'WA-1' });
      expect(r).toMatchObject({ ingest: true, account_id: PASEO, known_sender: false });

      await tx.exec('reset role');
      const m = await one<{ source: string; kind: string; sender_wa_id: string; sender_name: string; sender_person_id: string | null }>(
        tx,
        'select source, kind, sender_wa_id, sender_name, sender_person_id from public.messages where id = $1',
        [r.message_id],
      );
      expect(m).toEqual({ source: 'whatsapp', kind: 'text', sender_wa_id: NUEVO_WA, sender_name: 'Pipe', sender_person_id: null });
      const job = await one<{ n: number }>(tx, `select count(*)::int as n from public.jobs where payload ->> 'message_id' = $1`, [r.message_id]);
      expect(job.n).toBe(1);
      const s = await one<{ push_name: string; message_count: number }>(
        tx,
        'select push_name, message_count from public.whatsapp_senders where account_id = $1 and wa_id = $2',
        [PASEO, NUEVO_WA],
      );
      expect(s).toEqual({ push_name: 'Pipe', message_count: 1 });
    });
  });

  it('el mismo mensaje no entra dos veces', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      await enlazar(tx);
      expect((await ingerir(tx, { id: 'WA-2' })).ingest).toBe(true);
      expect(await ingerir(tx, { id: 'WA-2' })).toMatchObject({ ingest: false, reason: 'repetido' });
      const pre = await rpc(tx, 'public.connector_should_ingest($1, $2, now())', [GRUPO_NUEVO, 'WA-2']);
      expect(pre).toMatchObject({ ingest: false, reason: 'repetido' });
    });
  });

  it('nada de grupos sin enlazar, de antes del enlace ni de cuentas cerradas', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      expect(await ingerir(tx, { jid: '120363011111111111@g.us', id: 'WA-3' })).toMatchObject({ ingest: false, reason: 'grupo_sin_enlazar' });

      await enlazar(tx);
      const ayer = new Date(Date.now() - 86_400_000).toISOString();
      expect(await ingerir(tx, { id: 'WA-4', at: ayer })).toMatchObject({ ingest: false, reason: 'antes_del_enlace' });

      await tx.exec('reset role');
      await tx.query(`update public.accounts set status = 'closed' where id = $1`, [CASA]);
      await comoConnector(tx);
      expect(await ingerir(tx, { jid: GRUPO_CASA, id: 'WA-5', at: new Date().toISOString() })).toMatchObject({
        ingest: false,
        reason: 'cuenta_cerrada',
      });
    });
  });

  it('las fotos tienen que estar en la carpeta de la cuenta', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      await enlazar(tx);
      expect(await ingerir(tx, { id: 'WA-6', kind: 'photo', text: '', path: `${CASA}/whatsapp/x.jpg` })).toMatchObject({
        ingest: false,
        reason: 'archivo_fuera_de_la_cuenta',
      });
      expect(await ingerir(tx, { id: 'WA-7', kind: 'photo', text: 'almuerzo', path: `${PASEO}/whatsapp/WA-7.jpg` })).toMatchObject({ ingest: true });
    });
  });

  it('si el número ya es de alguien, el mensaje queda a su nombre', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      await enlazar(tx);
      const r = await ingerir(tx, { id: 'WA-8', from: MAFE_WA, name: 'Mafe' });
      expect(r.known_sender).toBe(true);
      await tx.exec('reset role');
      const m = await one<{ sender_person_id: string }>(tx, 'select sender_person_id from public.messages where id = $1', [r.message_id]);
      expect(m.sender_person_id).toBe('30000000-0000-4000-8000-000000000005');
    });
  });
});

describe('«¿Quién es este número?»', () => {
  async function conDesconocido(tx: Transaction) {
    await comoConnector(tx);
    await enlazar(tx);
    const r = await ingerir(tx, { id: 'WA-Q1' });
    // El worker lo procesó y quedó por revisar, sin pagador
    await tx.exec('reset role');
    const { id } = await one<{ id: string }>(
      tx,
      `insert into public.expenses (account_id, message_id, merchant, expense_date, total_cop, status, source, created_by)
       values ($1, $2, 'Taxi', current_date, 45000, 'pending_review', 'whatsapp', null) returning id`,
      [PASEO, r.message_id],
    );
    return id;
  }

  it('el admin ve los números sin identificar; un miembro no', async () => {
    await as(db, null, async (tx) => {
      await conDesconocido(tx);
      await impersonate(tx, U.valeria);
      const o = await rpc<{ is_admin: boolean; code: string; unknown_senders: { wa_id: string; push_name: string }[]; groups: { name: string }[] }>(
        tx,
        'public.whatsapp_overview($1)',
        [PASEO],
      );
      expect(o.is_admin).toBe(true);
      expect(o.code).toBe(CODIGO_PASEO);
      expect(o.unknown_senders.map((s) => [s.wa_id, s.push_name])).toEqual([[NUEVO_WA, 'Pipe']]);
      expect(o.groups.map((g) => g.name)).toContain('Paseo de prueba');

      await impersonate(tx, U.santi);
      const m = await rpc<{ is_admin: boolean; code: string | null; unknown_senders: unknown[] }>(tx, 'public.whatsapp_overview($1)', [PASEO]);
      expect(m).toMatchObject({ is_admin: false, code: null, unknown_senders: [] });
      const { rows } = await tx.query('select * from public.whatsapp_senders');
      expect(rows).toHaveLength(0);

      await impersonate(tx, U.nuevo);
      expect(await falla(tx, 'select public.whatsapp_overview($1)', [PASEO])).toMatch('No eres miembro');
    });
  });

  it('decir que es alguien de la cuenta le pone el nombre a sus mensajes y paga lo que quedó sin pagador', async () => {
    await as(db, null, async (tx) => {
      const gasto = await conDesconocido(tx);
      await impersonate(tx, U.santi);
      expect(await falla(tx, 'select public.identify_wa_sender($1, $2, $3)', [PASEO, NUEVO_WA, P.felipe])).toMatch('Solo quienes administran');

      await impersonate(tx, U.valeria);
      await tx.query('select public.identify_wa_sender($1, $2, $3)', [PASEO, NUEVO_WA, P.felipe]);
      const o = await rpc<{ unknown_senders: unknown[] }>(tx, 'public.whatsapp_overview($1)', [PASEO]);
      expect(o.unknown_senders).toEqual([]);

      await tx.exec('reset role');
      const e = await one<{ payer_person_id: string }>(tx, 'select payer_person_id from public.expenses where id = $1', [gasto]);
      expect(e.payer_person_id).toBe(P.felipe);
      const w = await one<{ n: number }>(tx, 'select count(*)::int as n from public.person_whatsapp_ids where person_id = $1 and wa_id = $2', [
        P.felipe,
        NUEVO_WA,
      ]);
      expect(w.n).toBe(1);
      // Lo siguiente que mande ya llega con su nombre
      await comoConnector(tx);
      expect((await ingerir(tx, { id: 'WA-Q2' })).known_sender).toBe(true);
    });
  });

  it('o alguien nuevo, o descartarlo', async () => {
    await as(db, null, async (tx) => {
      await conDesconocido(tx);
      await impersonate(tx, U.valeria);
      expect(await falla(tx, 'select public.identify_wa_sender($1, $2)', [PASEO, NUEVO_WA])).toMatch('escribe cómo le dicen');
      const { r: persona } = await one<{ r: string }>(tx, 'select public.identify_wa_sender($1, $2, null, $3) as r', [PASEO, NUEVO_WA, 'Pipe']);
      const p = await one<{ display_name: string; account_id: string }>(tx, 'select display_name, account_id from public.people where id = $1', [persona]);
      expect(p).toEqual({ display_name: 'Pipe', account_id: PASEO });
      expect(await falla(tx, 'select public.identify_wa_sender($1, $2, $3)', [PASEO, NUEVO_WA, P.caro])).toMatch('ya es de alguien');
    });

    await as(db, null, async (tx) => {
      await conDesconocido(tx);
      await impersonate(tx, U.valeria);
      await tx.query('select public.dismiss_wa_sender($1, $2)', [PASEO, NUEVO_WA]);
      const o = await rpc<{ unknown_senders: unknown[] }>(tx, 'public.whatsapp_overview($1)', [PASEO]);
      expect(o.unknown_senders).toEqual([]);
    });
  });
});

describe('confirmaciones en el grupo', () => {
  it('cuenta lo que procesó el worker una vez, y nada si el grupo las apagó', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      await enlazar(tx);
      const a = await ingerir(tx, { id: 'WA-R1', from: MAFE_WA });
      const b = await ingerir(tx, { id: 'WA-R2', from: MAFE_WA });
      await tx.exec('reset role');
      for (const m of [a.message_id, b.message_id]) {
        await tx.query(`update public.messages set status = 'done' where id = $1`, [m]);
        await tx.query(
          `insert into public.expenses (account_id, message_id, merchant, expense_date, total_cop, status, source, payer_person_id)
           values ($1, $2, 'Asadero', current_date, 272500, 'confirmed', 'whatsapp', '30000000-0000-4000-8000-000000000005')`,
          [PASEO, m],
        );
      }
      await comoConnector(tx);
      type Pendiente = { message_id: string; group_jid: string; expense: { merchant: string; payer: string; total_cop: number } };
      const delGrupo = async () => (await rpc<Pendiente[]>(tx, 'public.connector_pending_replies()')).filter((p) => p.group_jid === GRUPO_NUEVO);
      const pend = await delGrupo();
      expect(pend.map((p) => p.message_id)).toEqual([a.message_id, b.message_id]);
      expect(pend[0]).toMatchObject({ group_jid: GRUPO_NUEVO, expense: { merchant: 'Asadero', payer: 'Mafe', total_cop: 272500 } });

      await tx.query('select public.connector_mark_replied($1)', [[a.message_id]]);
      expect(await delGrupo()).toHaveLength(1);

      // Un admin apaga las confirmaciones de ese grupo
      await tx.exec('reset role');
      const g = await one<{ id: string }>(tx, 'select id from public.whatsapp_groups where wa_group_jid = $1', [GRUPO_NUEVO]);
      await impersonate(tx, U.valeria);
      await tx.query('select public.set_group_confirmations($1, false)', [g.id]);
      await comoConnector(tx);
      expect(await delGrupo()).toEqual([]);
    });
  });

  it('un miembro no cambia las confirmaciones', async () => {
    await as(db, U.santi, async (tx) => {
      await expect(tx.query('select public.set_group_confirmations($1, false)', ['d0000000-0000-4000-8000-000000000001'])).rejects.toThrow(
        'Solo quienes administran',
      );
    });
  });
});

describe('sesiones', () => {
  it('las llaves cifradas se guardan, cambian y se borran', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      const v1 = Buffer.from('uno').toString('base64');
      const v2 = Buffer.from('dos').toString('base64');
      await tx.query('select public.connector_set_keys($1, $2::jsonb)', [
        CONTADOR,
        JSON.stringify([
          { t: 'pre-key', i: '1', v: v1 },
          { t: 'pre-key', i: '2', v: v1 },
        ]),
      ]);
      await tx.query('select public.connector_set_keys($1, $2::jsonb)', [
        CONTADOR,
        JSON.stringify([
          { t: 'pre-key', i: '1', v: v2 },
          { t: 'pre-key', i: '2', v: null },
        ]),
      ]);
      const { rows } = await tx.query<{ key_id: string; ciphertext: string }>('select * from public.connector_get_keys($1, $2, $3)', [
        CONTADOR,
        'pre-key',
        ['1', '2', '3'],
      ]);
      expect(rows).toEqual([{ key_id: '1', ciphertext: v2 }]);

      await tx.query('select public.connector_save_creds($1, $2)', [CONTADOR, v1]);
      expect(await rpc(tx, 'public.connector_get_creds($1)', [CONTADOR])).toBe(v1);

      await tx.query(`select public.connector_clear_session($1, 'Se cerró la sesión desde el teléfono')`, [CONTADOR]);
      expect(await rpc(tx, 'public.connector_get_creds($1)', [CONTADOR])).toBeNull();
      const { rows: quedan } = await tx.query('select * from public.connector_get_keys($1, $2, $3)', [CONTADOR, 'pre-key', ['1']]);
      expect(quedan).toEqual([]);
    });
  });

  it('vincular el WhatsApp propio: código, conexión y cierre', async () => {
    await as(db, U.nuevo, async (tx) => {
      expect(await falla(tx, `select public.request_personal_whatsapp('123')`)).toMatch('indicativo');
      const { r: id } = await one<{ r: string }>(tx, `select public.request_personal_whatsapp('+57 300 123 4567') as r`);
      expect((await rpc<{ status: string; qr: string | null }>(tx, 'public.my_whatsapp_link()')).status).toBe('connecting');

      await comoConnector(tx);
      const { rows } = await tx.query<{ id: string; kind: string; pairing_phone: string }>('select id, kind, pairing_phone from public.connector_sessions()');
      expect(rows).toContainEqual({ id, kind: 'personal', pairing_phone: '573001234567' });
      await tx.query(`select public.connector_set_pairing($1, 'data:image/png;base64,QR', 'ABCD1234', now() + interval '1 minute')`, [id]);

      await impersonate(tx, U.nuevo);
      expect(await rpc(tx, 'public.my_whatsapp_link()')).toMatchObject({ status: 'connecting', qr: 'data:image/png;base64,QR', code: 'ABCD1234' });

      await comoConnector(tx);
      await tx.query(`select public.connector_set_status($1, 'connected', '573001234567@s.whatsapp.net', null, '573001234567')`, [id]);
      await impersonate(tx, U.nuevo);
      expect(await rpc(tx, 'public.my_whatsapp_link()')).toMatchObject({ status: 'connected', qr: null, phone: '573001234567' });

      await tx.query('select public.stop_personal_whatsapp()');
      await comoConnector(tx);
      const { rows: s } = await tx.query<{ stop_requested: boolean }>('select stop_requested from public.connector_sessions() where id = $1', [id]);
      expect(s[0].stop_requested).toBe(true);
    });
  });

  it('la pantalla de conectar sabe quién de la cuenta lee los grupos con su WhatsApp', async () => {
    await as(db, U.valeria, async (tx) => {
      const { r: id } = await one<{ r: string }>(tx, `select public.request_personal_whatsapp(null) as r`);
      // Pedido pero sin vincular: todavía no lee nada
      type Lectores = { lectores: { name: string; is_me: boolean }[] };
      expect((await rpc<Lectores>(tx, 'public.whatsapp_overview($1)', [PASEO])).lectores).toEqual([]);

      await comoConnector(tx);
      await tx.query(`select public.connector_set_status($1, 'connected', '573001112233@s.whatsapp.net', null, '573001112233')`, [id]);
      await impersonate(tx, U.valeria);
      expect((await rpc<Lectores>(tx, 'public.whatsapp_overview($1)', [PASEO])).lectores).toEqual([{ name: 'Valeria', is_me: true }]);
      // Otro miembro de la cuenta ve que Valeria lee los grupos
      await impersonate(tx, U.mafe);
      expect((await rpc<Lectores>(tx, 'public.whatsapp_overview($1)', [PASEO])).lectores).toEqual([{ name: 'Valeria', is_me: false }]);

      // Si el connector deja de dar señales (o piden desvincular), ya no cuenta
      await comoConnector(tx);
      await tx.query(`update public.whatsapp_connections set last_seen_at = now() - interval '10 minutes' where id = $1`, [id]);
      await impersonate(tx, U.valeria);
      expect((await rpc<Lectores>(tx, 'public.whatsapp_overview($1)', [PASEO])).lectores).toEqual([]);
    });
    // El WhatsApp de alguien que no es de la cuenta no aparece
    await as(db, U.nuevo, async (tx) => {
      const { r: id } = await one<{ r: string }>(tx, `select public.request_personal_whatsapp(null) as r`);
      await comoConnector(tx);
      await tx.query(`select public.connector_set_status($1, 'connected', null, null, '573009990000')`, [id]);
      await impersonate(tx, U.valeria);
      expect((await rpc<{ lectores: unknown[] }>(tx, 'public.whatsapp_overview($1)', [PASEO])).lectores).toEqual([]);
    });
  });

  it('nadie más que el connector toca las sesiones, las llaves ni la ingesta', async () => {
    await as(db, U.valeria, async (tx) => {
      for (const sql of [
        'select public.connector_sessions()',
        `select public.connector_get_creds('${CONTADOR}')`,
        `select public.connector_link_group('${CONTADOR}', 'x@g.us', 'x', '${CODIGO_PASEO}', null)`,
        `select public.connector_ingest_message('${GRUPO_PASEO}', 'X', null, null, 'text', 'taxi 10 lucas', null, null, null, now())`,
        'select public.connector_pending_replies()',
        'select * from public.whatsapp_session_keys',
      ]) {
        expect(await falla(tx, sql)).toMatch(DENIED);
      }
    });
  });
});
