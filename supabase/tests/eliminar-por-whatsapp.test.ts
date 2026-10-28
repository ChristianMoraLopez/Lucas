import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, PASEO, U } from './harness';

// «luks elimina este gasto» citando el mensaje del gasto (00000000000510_eliminar_por_whatsapp.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const JID = '120363040123456789@g.us';
const MAFE_WA = '573016667788';
const SANTI_WA = '573128880365';
const LAURA_WA = '573105550142';

async function como(tx: Transaction, rol: 'service_role' | null) {
  await tx.exec('reset role');
  if (rol) await tx.exec(`set local role ${rol}`);
}

/** Santi manda la foto de la cuenta al grupo; si `leer`, el worker la vuelve gasto (pagó Santi) */
async function llega(tx: Transaction, envio: string, leer = true) {
  await como(tx, 'service_role');
  const { m } = await one<{ m: { message_id: string } }>(
    tx,
    `select public.connector_ingest_message($1, $2, $3, 'Santi', 'photo'::public.message_kind, null, $4, null, 'image/jpeg', now()) as m`,
    [JID, envio, SANTI_WA, `${PASEO}/whatsapp/2026-10/${envio}.jpg`],
  );
  if (leer) {
    const { santi } = await one<{ santi: string }>(tx, `select public.wa_person($1, $2) as santi`, [PASEO, SANTI_WA]);
    await tx.query('select public.worker_save_expense($1, $2)', [
      m.message_id,
      JSON.stringify({ merchant: 'Arepas Doña Rosa', total_cop: 5_000, expense_date: '2026-09-25', status: 'confirmed', payer_person_id: santi }),
    ]);
  }
  await como(tx, null);
  return m.message_id;
}

const eliminar = async (tx: Transaction, wa: string, citado: string | null) => {
  await como(tx, 'service_role');
  const { r } = await one<{ r: Record<string, unknown> }>(tx, 'select public.connector_eliminar_gasto($1, $2, $3, $3, null, null) as r', [JID, citado, wa]);
  await como(tx, null);
  return r;
};

const cuantos = async (tx: Transaction, message: string) =>
  (await one<{ n: number }>(tx, 'select count(*)::int as n from public.expenses where message_id = $1', [message])).n;

describe('«luks elimina este gasto»', () => {
  it('quien lo mandó lo elimina citando su mensaje, y el mensaje ya no se vuelve a leer', async () => {
    await as(db, null, async (tx) => {
      const m = await llega(tx, 'WA-E1');
      expect(await cuantos(tx, m)).toBe(1);
      const r = await eliminar(tx, SANTI_WA, 'WA-E1');
      expect(r).toMatchObject({
        ok: true,
        account_id: PASEO,
        account_name: 'Paseo Santa Marta',
        name: 'Santi',
        gastos: [{ merchant: 'Arepas Doña Rosa', total: 5000 }],
      });
      expect(await cuantos(tx, m)).toBe(0);
      expect(await one(tx, 'select status from public.messages where id = $1', [m])).toEqual({ status: 'not_expense' });
      // Ya no hay gasto que eliminar
      expect(await eliminar(tx, SANTI_WA, 'WA-E1')).toMatchObject({ ok: false, reason: 'no_es_gasto' });
    });
  });

  it('otro del grupo no lo puede eliminar; quien administra sí', async () => {
    await as(db, null, async (tx) => {
      const m = await llega(tx, 'WA-E2');
      expect(await eliminar(tx, MAFE_WA, 'WA-E2')).toMatchObject({ ok: false, reason: 'no_puedes', name: 'Mafe' });
      expect(await cuantos(tx, m)).toBe(1);
      expect(await eliminar(tx, LAURA_WA, 'WA-E2')).toMatchObject({ ok: true, name: 'Laura' });
      expect(await cuantos(tx, m)).toBe(0);
    });
  });

  it('sin cita, citando otra cosa o mientras se lee: no elimina nada', async () => {
    await as(db, null, async (tx) => {
      expect(await eliminar(tx, SANTI_WA, null)).toEqual({ ok: false, reason: 'sin_cita' });
      expect(await eliminar(tx, SANTI_WA, 'NO-EXISTE')).toMatchObject({ ok: false, reason: 'no_es_gasto' });
      await llega(tx, 'WA-E3', false);
      expect(await eliminar(tx, SANTI_WA, 'WA-E3')).toMatchObject({ ok: false, reason: 'procesando' });
    });
  });

  it('citando la lista de «¿quién pidió qué?» de Mister Luks', async () => {
    await as(db, null, async (tx) => {
      const m = await llega(tx, 'WA-E4');
      const { id: gasto } = await one<{ id: string }>(tx, 'select id from public.expenses where message_id = $1', [m]);
      const { id: outbox } = await one<{ id: string }>(
        tx,
        `insert into public.whatsapp_outbox (chat_jid, reason, body, dedupe_key, sent_at, wa_message_id)
         values ($1, 'guide', '¿Quién pidió qué?', 'items:prueba', now(), 'WA-LISTA') returning id`,
        [JID],
      );
      await tx.query('insert into public.item_prompts (expense_id, outbox_id, chat_jid, items) values ($1, $2, $3, $4)', [gasto, outbox, JID, []]);
      expect(await eliminar(tx, SANTI_WA, 'WA-LISTA')).toMatchObject({ ok: true });
      expect(await cuantos(tx, m)).toBe(0);
      expect(await one(tx, 'select status from public.messages where id = $1', [m])).toEqual({ status: 'not_expense' });
    });
  });

  it('lo liquidado no se toca', async () => {
    await as(db, null, async (tx) => {
      const m = await llega(tx, 'WA-E5');
      await tx.query(`update public.expenses set status = 'confirmed' where account_id = $1 and status = 'pending_review'`, [PASEO]);
      await impersonate(tx, U.laura);
      const { r } = await one<{ r: { direct_transfers: unknown[] } }>(tx, 'select public.settlement_overview($1, null) as r', [PASEO]);
      await tx.query('select public.start_settlement($1, null, $2)', [PASEO, JSON.stringify(r.direct_transfers)]);
      await como(tx, null);
      expect(await eliminar(tx, SANTI_WA, 'WA-E5')).toMatchObject({ ok: false, reason: 'liquidado', account_name: 'Paseo Santa Marta' });
      expect(await cuantos(tx, m)).toBe(1);
    });
  });
});
