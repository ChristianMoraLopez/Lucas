import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, PASEO, U } from './harness';

// Un paseo liquidado y llega otro gasto: Mister Luks pregunta si reabre o abre cuenta nueva
// (00000000000450_preguntar_si_reabre.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const JID = '120363040123456789@g.us';
const MAFE_WA = '573016667788';
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

/** Dani (aquí Santi) manda al grupo la cuenta del restaurante y el worker la lee */
async function llega(tx: Transaction, envio: string, comercio = 'Trattoria') {
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
      merchant: comercio,
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
  return r;
}

const decidir = async (tx: Transaction, wa: string, modo: string, citado: string | null = null) => {
  await como(tx, 'service_role');
  const { r } = await one<{ r: Record<string, unknown> }>(tx, `select public.connector_decidir_liquidada($1, $2, $3, $3, null, null, $4) as r`, [
    JID,
    citado,
    wa,
    modo,
  ]);
  await como(tx, null);
  return r;
};

describe('un paseo liquidado y llega otro gasto', () => {
  it('queda en espera (no se reabre solo) y se pregunta una vez', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      expect(await llega(tx, 'WA-R1')).toEqual({ skipped: true, status: 'en_espera' });
      await llega(tx, 'WA-R2', 'Heladería');
      expect(await one(tx, 'select status from public.accounts where id = $1', [PASEO])).toEqual({ status: 'settling' });
      expect(await one(tx, `select count(*)::int as n from public.expenses where merchant in ('Trattoria', 'Heladería')`)).toEqual({ n: 0 });
      const { rows } = await tx.query<{ body: string }>(`select body from public.whatsapp_outbox where dedupe_key like 'reabrir:%'`);
      expect(rows).toHaveLength(1);
      expect(rows[0].body).toContain('Santi mandó un gasto nuevo: *Trattoria* · $120.000');
    });
  });

  it('«1» reabre, entran los dos y sale la lista de quién pidió qué', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      await llega(tx, 'WA-R3');
      await llega(tx, 'WA-R4', 'Heladería');
      // Respondiendo (citando) la pregunta
      await tx.query(`update public.whatsapp_outbox set sent_at = now(), wa_message_id = 'WA-PREGUNTA' where dedupe_key like 'reabrir:%'`);
      expect(await decidir(tx, MAFE_WA, 'reabrir', 'OTRO')).toEqual({ ok: false, reason: 'no_es_pregunta' });
      const r = await decidir(tx, MAFE_WA, 'reabrir', 'WA-PREGUNTA');
      expect(r).toMatchObject({ ok: true, modo: 'reabrir', account_id: PASEO, cuenta: 'Paseo Santa Marta', name: 'Mafe' });
      expect((r.gastos as { merchant: string; items: number }[]).map((g) => [g.merchant, g.items])).toEqual([
        ['Trattoria', 2],
        ['Heladería', 2],
      ]);
      expect(await one(tx, 'select status from public.accounts where id = $1', [PASEO])).toEqual({ status: 'active' });

      await como(tx, 'service_role');
      const { r: lista } = await one<{ r: { merchant: string }[] }>(tx, 'select public.connector_items_por_preguntar() as r');
      await como(tx, null);
      expect(lista.map((x) => x.merchant)).toEqual(expect.arrayContaining(['Heladería', 'Trattoria']));
      // Ya respondida
      expect(await decidir(tx, MAFE_WA, 'nueva')).toEqual({ ok: false, reason: 'no_es_pregunta' });
    });
  });

  it('«2» abre «Paseo Santa Marta 2» con la misma gente, el grupo pasa a ella y el gasto se anota allá', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      await llega(tx, 'WA-R5');
      const r = await decidir(tx, SANTI_WA, 'nueva');
      expect(r).toMatchObject({ ok: true, modo: 'nueva', cuenta: 'Paseo Santa Marta 2', anterior: 'Paseo Santa Marta' });
      const { id: nueva } = await one<{ id: string }>(tx, `select id from public.accounts where name = 'Paseo Santa Marta 2'`);
      expect(await one(tx, 'select status from public.accounts where id = $1', [PASEO])).toEqual({ status: 'settling' });
      expect(await one(tx, `select a.name from public.account_group_links l join public.accounts a on a.id = l.account_id join public.whatsapp_groups g on g.id = l.group_id where g.wa_group_jid = $1`, [JID])).toEqual({
        name: 'Paseo Santa Marta 2',
      });
      // El gasto, con quien pagó en la cuenta nueva
      const g = await one<{ payer: string; items: number }>(
        tx,
        `select p.display_name as payer, (select count(*)::int from public.expense_items i where i.expense_id = e.id) as items
         from public.expenses e join public.people p on p.id = e.payer_person_id where e.account_id = $1 and e.merchant = 'Trattoria'`,
        [nueva],
      );
      expect(g).toEqual({ payer: 'Santi', items: 2 });
      // La misma gente que usa Luks, con su rol
      const { rows } = await tx.query<{ n: number }>(`select count(*)::int as n from public.account_members where account_id = $1`, [nueva]);
      expect(rows[0].n).toBeGreaterThan(1);
      // Y no anuncia la cuenta siguiente por su cuenta (ya lo dice la respuesta)
      expect(await one(tx, `select count(*)::int as n from public.whatsapp_outbox where dedupe_key = 'siguiente:' || $1`, [nueva])).toEqual({ n: 0 });
    });
  });

  it('si quien administra reabre en la app, lo que esperaba entra solo', async () => {
    await as(db, null, async (tx) => {
      const liq = await liquidar(tx);
      await llega(tx, 'WA-R6');
      await impersonate(tx, U.laura);
      await tx.query('select public.reopen_settlement($1)', [liq]);
      await como(tx, null);
      expect(await one(tx, `select count(*)::int as n from public.expenses where account_id = $1 and merchant = 'Trattoria'`, [PASEO])).toEqual({ n: 1 });
      expect(await one(tx, `select decision from public.preguntas_reabrir where settlement_id = $1`, [liq])).toEqual({ decision: 'reabrir' });
    });
  });

  it('solo responde alguien del paseo, y solo el connector', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      await llega(tx, 'WA-R7');
      expect(await decidir(tx, '573009990000', 'reabrir')).toMatchObject({ ok: false, reason: 'no_te_conozco' });
    });
    await as(db, U.laura, async (tx) => {
      await expect(tx.query(`select public.connector_decidir_liquidada('a', null, 'b', null, null, null, 'reabrir')`)).rejects.toThrow(/permission denied/);
    });
  });
});
