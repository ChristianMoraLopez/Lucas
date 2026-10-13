import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, one, PASEO, U } from './harness';

// Preguntas a @mrluks, «¿privado o aquí?» y «no me cuentes» (00000000000350_preguntas_a_mister_luks.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const GRUPO_PASEO = '120363040123456789@g.us';
const MAFE = '573016667788';

async function comoConnector(tx: Transaction) {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
}

interface Pregunta {
  ok: boolean;
  reason?: string;
  identity_id: string;
  pref: string | null;
  contador_en_grupo: boolean;
  account: { name: string; type: string; currency: string; month: string | null };
  optout: boolean;
  total: number;
  count: number;
  people: { name: string; paid: number; share: number; balance: number }[];
  settlement: { from: string; to: string; amount: number; paid: boolean }[] | null;
  me: { name: string; paid_total: number; paid_count: number; expenses: { merchant: string; total: number }[] } | null;
}

const pregunta = async (tx: Transaction, jid = GRUPO_PASEO, wa = MAFE) =>
  (await one<{ r: Pregunta }>(tx, 'select public.connector_question($1, $2, $2, null, $3) as r', [jid, wa, 'Mafe'])).r;

describe('connector_question: los números para responder', () => {
  it('del Paseo (un evento): el total, los saldos que cuadran y lo de quien pregunta', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      const r = await pregunta(tx);
      expect(r).toMatchObject({
        ok: true,
        pref: null,
        contador_en_grupo: true,
        optout: false,
        account: { name: 'Paseo Santa Marta', type: 'evento', month: null },
      });
      await tx.exec('reset role');
      const { total, n } = await one<{ total: number; n: number }>(
        tx,
        'select coalesce(sum(total_cop), 0)::bigint as total, count(*)::int as n from public.expenses where account_id = $1',
        [PASEO],
      );
      expect(Number(r.total)).toBe(Number(total));
      expect(r.count).toBe(n);
      // Los saldos de todos suman cero (de ahí salen las transferencias)
      expect(r.people.reduce((s, p) => s + Number(p.balance), 0)).toBe(0);
      expect(r.me?.name).toBe('Mafe');
      expect(r.me?.expenses.length).toBeLessThanOrEqual(5);
    });
  });

  it('de un grupo sin cuenta o que no es grupo', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      await tx.query(`select public.connector_upsert_group($1, '120363099999999999@g.us', 'Sin cuenta')`, [CONTADOR]);
      expect(await pregunta(tx, '120363099999999999@g.us')).toMatchObject({ ok: false, reason: 'sin_cuenta' });
      expect(await pregunta(tx, '573001112233@s.whatsapp.net')).toEqual({ ok: false, reason: 'sin_grupo' });
    });
  });

  it('a quien no está en la cuenta no lo reconoce', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      expect((await pregunta(tx, GRUPO_PASEO, '573009990077')).me).toBeNull();
    });
  });
});

describe('«¿privado o aquí?»', () => {
  it('lo personal queda esperando la respuesta; «privado» la guarda y devuelve la pregunta', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      const { identity_id } = await pregunta(tx);
      await tx.query('select public.connector_ask_answer_pref($1, $2, $3)', [GRUPO_PASEO, identity_id, 'mi_saldo']);
      // Un «aquí» en otro grupo no cuenta
      expect((await one<{ r: unknown }>(tx, `select public.connector_answer_pref('otro@g.us', $1, $1, null, 'Mafe', 'aqui', true) as r`, [MAFE])).r).toEqual({
        changed: false,
      });
      expect(
        (await one<{ r: unknown }>(tx, `select public.connector_answer_pref($1, $2, $2, null, 'Mafe', 'privado', true) as r`, [GRUPO_PASEO, MAFE])).r,
      ).toEqual({ changed: true, mode: 'privado', pending_intent: 'mi_saldo' });
      expect((await pregunta(tx)).pref).toBe('privado');
      // Ya respondida: un «aquí» suelto no cambia nada; con «luks dímelo aquí», sí
      expect(
        (await one<{ r: unknown }>(tx, `select public.connector_answer_pref($1, $2, $2, null, 'Mafe', 'aqui', true) as r`, [GRUPO_PASEO, MAFE])).r,
      ).toEqual({ changed: false });
      expect(
        (await one<{ r: unknown }>(tx, `select public.connector_answer_pref($1, $2, $2, null, 'Mafe', 'aqui', false) as r`, [GRUPO_PASEO, MAFE])).r,
      ).toEqual({ changed: true, mode: 'aqui', pending_intent: null });
    });
  });

  it('la pregunta que espera vence a los 15 minutos', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      const { identity_id } = await pregunta(tx);
      await tx.query('select public.connector_ask_answer_pref($1, $2, $3)', [GRUPO_PASEO, identity_id, 'mis_gastos']);
      await tx.exec('reset role');
      await tx.query(`update public.whatsapp_answer_prefs set pending_at = now() - interval '16 minutes'`);
      await comoConnector(tx);
      expect(
        (await one<{ r: unknown }>(tx, `select public.connector_answer_pref($1, $2, $2, null, 'Mafe', 'privado', true) as r`, [GRUPO_PASEO, MAFE])).r,
      ).toEqual({ changed: false });
    });
  });
});

describe('«no me cuentes»', () => {
  it('desde ahí no se anota lo que manda; lo de antes queda igual, y «cuéntame» lo deshace', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      await tx.exec('reset role');
      const antes = await one<{ n: number }>(
        tx,
        `select count(*)::int as n from public.expense_splits s join public.people p on p.id = s.person_id where p.display_name = 'Mafe' and p.account_id = $1`,
        [PASEO],
      );
      await comoConnector(tx);
      expect((await one<{ r: unknown }>(tx, `select public.connector_optout($1, $2, $2, null, 'Mafe', true) as r`, [GRUPO_PASEO, MAFE])).r).toEqual({
        changed: true,
        account_name: 'Paseo Santa Marta',
        language: 'es',
      });
      const ingesta = async () =>
        (
          await one<{ r: { ingest: boolean; reason?: string } }>(tx, `select public.connector_should_ingest_sender($1, 'WA-NUEVO', now(), $2) as r`, [
            GRUPO_PASEO,
            MAFE,
          ])
        ).r;
      expect(await ingesta()).toMatchObject({ ingest: false, reason: 'no_me_cuentes' });
      // Los demás sí
      expect(
        (await one<{ r: { ingest: boolean } }>(tx, `select public.connector_should_ingest_sender($1, 'WA-NUEVO', now(), '573001112233') as r`, [GRUPO_PASEO])).r
          .ingest,
      ).toBe(true);
      expect((await pregunta(tx)).optout).toBe(true);
      // Sus partes de antes no se tocan
      await tx.exec('reset role');
      expect(
        await one(
          tx,
          `select count(*)::int as n from public.expense_splits s join public.people p on p.id = s.person_id where p.display_name = 'Mafe' and p.account_id = $1`,
          [PASEO],
        ),
      ).toEqual(antes);

      await comoConnector(tx);
      expect(
        (await one<{ r: { changed: boolean } }>(tx, `select public.connector_optout($1, $2, $2, null, 'Mafe', false) as r`, [GRUPO_PASEO, MAFE])).r.changed,
      ).toBe(true);
      expect((await ingesta()).ingest).toBe(true);
    });
  });

  it('lo que responde Mister Luks no es un gasto', async () => {
    await as(db, null, async (tx) => {
      expect(
        await one(tx, `select public.es_mensaje_de_luks('🧾 En «Paseo» llevan $1.234.000 (12 gastos).' || chr(10) || '📊 Más detalle en mrluks.com') as luks`),
      ).toEqual({ luks: true });
      expect(await one(tx, `select public.es_mensaje_de_luks('taxi 45 lucas') as luks`)).toEqual({ luks: false });
    });
  });
});

describe('un grupo leído solo por un WhatsApp vinculado', () => {
  it('Mister Luks responde por privado si existe; si no, no hay a dónde', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      expect((await one<{ ok: boolean }>(tx, `select public.connector_open_private_answer($1) as ok`, [`${MAFE}@s.whatsapp.net`])).ok).toBe(true);
      expect(await one(tx, `select chat_kind from public.whatsapp_groups where wa_group_jid = $1`, [`${MAFE}@s.whatsapp.net`])).toEqual({
        chat_kind: 'privado',
      });
      await tx.exec('reset role');
      await tx.query(`update public.whatsapp_connections set status = 'disconnected' where kind = 'contador'`);
      await comoConnector(tx);
      expect((await one<{ ok: boolean }>(tx, `select public.connector_open_private_answer('573009990077@s.whatsapp.net') as ok`)).ok).toBe(false);
    });
  });
});

describe('permisos', () => {
  it('las preferencias y los «no me cuentes» no se leen desde la web, y lo del connector no se llama desde ahí', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.exec('savepoint a');
      await expect(tx.query('select * from public.whatsapp_answer_prefs')).rejects.toThrow(/permission denied/);
      await tx.exec('rollback to savepoint a');
      await expect(tx.query('select * from public.account_optouts')).rejects.toThrow(/permission denied/);
      await tx.exec('rollback to savepoint a');
      await expect(tx.query(`select public.connector_question($1, $2)`, [GRUPO_PASEO, MAFE])).rejects.toThrow(/permission denied/);
      await tx.exec('rollback to savepoint a');
      await expect(tx.query(`select public.connector_optout($1, $2, null, null, null, true)`, [GRUPO_PASEO, MAFE])).rejects.toThrow(/permission denied/);
    });
  });
});
