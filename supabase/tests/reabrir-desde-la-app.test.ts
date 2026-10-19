import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, PASEO, U } from './harness';

// Un gasto que llegó por WhatsApp a un paseo liquidado: reabrir o cuenta nueva también desde la app
// (00000000000490_reabrir_desde_la_app.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const JID = '120363040123456789@g.us';
const SANTI_WA = '573128880365';

async function como(tx: Transaction, rol: 'service_role' | null) {
  await tx.exec('reset role');
  if (rol) await tx.exec(`set local role ${rol}`);
}

/** El Paseo liquidado como lo haría la app */
async function liquidar(tx: Transaction) {
  await como(tx, null);
  await tx.query(`update public.expenses set status = 'confirmed' where account_id = $1 and status = 'pending_review'`, [PASEO]);
  await impersonate(tx, U.laura);
  const { r } = await one<{ r: { direct_transfers: unknown[] } }>(tx, 'select public.settlement_overview($1, null) as r', [PASEO]);
  const { id } = await one<{ id: string }>(tx, 'select public.start_settlement($1, null, $2) as id', [PASEO, JSON.stringify(r.direct_transfers)]);
  await como(tx, null);
  return id;
}

/** Santi manda al grupo la cuenta del restaurante y el worker la lee: queda en espera */
async function llega(tx: Transaction, envio: string) {
  await como(tx, 'service_role');
  const { m } = await one<{ m: { message_id: string } }>(
    tx,
    `select public.connector_ingest_message($1, $2, $3, 'Santi', 'photo'::public.message_kind, null, $4, null, 'image/jpeg', now()) as m`,
    [JID, envio, SANTI_WA, `${PASEO}/whatsapp/2026-10/${envio}.jpg`],
  );
  const { santi } = await one<{ santi: string }>(tx, `select public.wa_person($1, $2) as santi`, [PASEO, SANTI_WA]);
  const { r } = await one<{ r: Record<string, unknown> }>(tx, 'select public.worker_save_expense($1, $2) as r', [
    m.message_id,
    JSON.stringify({
      merchant: 'Trattoria',
      total_cop: 120_000,
      expense_date: '2026-10-18',
      status: 'confirmed',
      payer_person_id: santi,
      items: [
        { name: 'Pizza', quantity: 1, unit_price_cop: 70_000, total_cop: 70_000 },
        { name: 'Cerveza', quantity: 2, unit_price_cop: 25_000, total_cop: 50_000 },
      ],
    }),
  ]);
  await como(tx, null);
  expect(r).toEqual({ skipped: true, status: 'en_espera' });
}

const enEspera = async (tx: Transaction, quien: string) => {
  await impersonate(tx, quien);
  const { r } = await one<{ r: Record<string, unknown> | null }>(tx, 'select public.gastos_en_espera_de($1) as r', [PASEO]);
  await como(tx, null);
  return r;
};

const decidir = async (tx: Transaction, quien: string, modo: string) => {
  await impersonate(tx, quien);
  const { r } = await one<{ r: Record<string, unknown> }>(tx, 'select public.decidir_liquidada($1, $2) as r', [PASEO, modo]);
  await como(tx, null);
  return r;
};

describe('reabrir o cuenta nueva desde la app', () => {
  it('la app ve lo que espera; nada si no hay', async () => {
    await as(db, null, async (tx) => {
      expect(await enEspera(tx, U.laura)).toBeNull();
      await liquidar(tx);
      await llega(tx, 'WA-APP1');
      expect(await enEspera(tx, U.laura)).toMatchObject({
        cuenta: 'Paseo Santa Marta',
        cerrada: false,
        siguiente: 'Paseo Santa Marta 2',
        gastos: [{ merchant: 'Trattoria', total: 120_000, items: 2, quien: 'Santi' }],
      });
    });
  });

  it('reabrir: entra el gasto, la pregunta queda respondida y Mister Luks lo cuenta en el grupo', async () => {
    await as(db, null, async (tx) => {
      const liq = await liquidar(tx);
      await llega(tx, 'WA-APP2');
      const r = await decidir(tx, U.laura, 'reabrir');
      expect(r).toMatchObject({ ok: true, modo: 'reabrir', account_id: PASEO, cuenta: 'Paseo Santa Marta' });
      expect(await one(tx, 'select status from public.accounts where id = $1', [PASEO])).toEqual({ status: 'active' });
      expect(await one(tx, `select count(*)::int as n from public.expenses where account_id = $1 and merchant = 'Trattoria'`, [PASEO])).toEqual({ n: 1 });
      expect(await one(tx, 'select decision from public.preguntas_reabrir where settlement_id = $1', [liq])).toEqual({ decision: 'reabrir' });
      const { body } = await one<{ body: string }>(tx, `select body from public.whatsapp_outbox where dedupe_key = 'reabrir-app:' || $1`, [liq]);
      expect(body).toBe(
        '🔓 Laura reabrió «Paseo Santa Marta» desde la app y sumó *Trattoria* ($120.000). Cuando terminen, la vuelven a liquidar en mrluks.com.\n\n📊 Más detalle en mrluks.com',
      );
      // Ya no queda nada esperando, y otra vez no hace nada
      expect(await enEspera(tx, U.laura)).toBeNull();
      expect(await decidir(tx, U.laura, 'nueva')).toEqual({ ok: false, reason: 'nada_en_espera' });
    });
  });

  it('cuenta nueva: «Paseo Santa Marta 2» con el gasto, y el grupo pasa a ella', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      await llega(tx, 'WA-APP3');
      const r = await decidir(tx, U.laura, 'nueva');
      expect(r).toMatchObject({ ok: true, modo: 'nueva', cuenta: 'Paseo Santa Marta 2' });
      expect(await one(tx, 'select status from public.accounts where id = $1', [PASEO])).toEqual({ status: 'settling' });
      expect(await one(tx, `select count(*)::int as n from public.expenses where account_id = $1 and merchant = 'Trattoria'`, [r.account_id])).toEqual({
        n: 1,
      });
      expect(
        await one(tx, `select l.account_id from public.account_group_links l join public.whatsapp_groups g on g.id = l.group_id where g.wa_group_jid = $1`, [
          JID,
        ]),
      ).toEqual({ account_id: r.account_id });
    });
  });

  it('solo alguien de la cuenta', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      await llega(tx, 'WA-APP4');
      await impersonate(tx, U.otro);
      await expect(tx.query('select public.decidir_liquidada($1, $2)', [PASEO, 'reabrir'])).rejects.toThrow(/No eres miembro/);
    });
    await as(db, U.laura, async (tx) => {
      await expect(tx.query('select public.decidir_liquidada($1, $2)', [PASEO, 'otra'])).rejects.toThrow(/reabrir o cuenta nueva/);
    });
  });
});
