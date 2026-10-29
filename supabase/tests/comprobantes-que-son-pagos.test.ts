import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, PASEO, U } from './harness';

// Un comprobante que no se supo leer del todo: se marca solo si cuadra con una sola deuda, y si
// no, en un paseo liquidado se pregunta si es un pago o un gasto (00000000000590_comprobantes_que_son_pagos.sql)

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

async function liquidar(tx: Transaction) {
  await como(tx, null);
  await tx.query(`update public.expenses set status = 'confirmed' where account_id = $1 and status = 'pending_review'`, [PASEO]);
  await impersonate(tx, U.laura);
  const { r } = await one<{ r: { direct_transfers: unknown[] } }>(tx, 'select public.settlement_overview($1, null) as r', [PASEO]);
  const { id } = await one<{ id: string }>(tx, 'select public.start_settlement($1, null, $2) as id', [PASEO, JSON.stringify(r.direct_transfers)]);
  await como(tx, null);
  return id;
}

/** Santi manda una foto al grupo */
async function foto(tx: Transaction, envio: string) {
  await como(tx, 'service_role');
  const { m } = await one<{ m: { message_id: string } }>(
    tx,
    `select public.connector_ingest_message($1, $2, $3, 'Santi', 'photo'::public.message_kind, null, $4, null, 'image/jpeg', now()) as m`,
    [JID, envio, SANTI_WA, `${PASEO}/whatsapp/2026-10/${envio}.jpg`],
  );
  await como(tx, null);
  return m.message_id;
}

async function pagoSinNombre(tx: Transaction, mensaje: string, monto: number) {
  await como(tx, 'service_role');
  const { r } = await one<{ r: { handled: boolean; tipo?: string; transfer_id?: string } }>(
    tx,
    `select public.worker_pago_con_comprobante($1, $2, '{}'::text[]) as r`,
    [mensaje, monto],
  );
  await como(tx, null);
  return r;
}

const deudasDeSanti = async (tx: Transaction) =>
  (
    await tx.query<{ id: string; amount_cop: number; paid_at: string | null }>(
      `select t.id, t.amount_cop::int, t.paid_at from public.settlement_transfers t
       where t.account_id = $1 and t.from_person_id = public.wa_person($1, $2) order by t.amount_cop desc`,
      [PASEO, SANTI_WA],
    )
  ).rows;

describe('un comprobante que no se supo leer del todo', () => {
  it('sin el nombre, lo marca pagado solo si una sola deuda cuadra con el monto', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      const [deuda] = await deudasDeSanti(tx);
      expect(deuda).toBeTruthy();
      expect(await pagoSinNombre(tx, await foto(tx, 'WA-S1'), deuda.amount_cop + 50_000)).toEqual({ handled: false });
      expect(await pagoSinNombre(tx, await foto(tx, 'WA-S2'), deuda.amount_cop)).toMatchObject({ handled: true, tipo: 'pagada', transfer_id: deuda.id });
    });
  });

  it('si le debe eso mismo a dos, no adivina a cuál', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      const [a, b] = await deudasDeSanti(tx);
      expect(b).toBeTruthy();
      await tx.query('update public.settlement_transfers set amount_cop = $2 where id = $1', [b.id, a.amount_cop]);
      expect(await pagoSinNombre(tx, await foto(tx, 'WA-S3'), a.amount_cop)).toEqual({ handled: false });
      expect((await deudasDeSanti(tx)).every((x) => !x.paid_at)).toBe(true);
    });
  });

  it('en un paseo liquidado pregunta «¿pago o gasto?»; «pago» no lo anota', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      const mensaje = await foto(tx, 'WA-S4');
      await como(tx, 'service_role');
      const { r } = await one<{ r: Record<string, unknown> }>(tx, 'select public.worker_save_expense($1, $2) as r', [
        mensaje,
        JSON.stringify({
          merchant: 'Comprobante de transferencia',
          total_cop: 9_800,
          expense_date: '2026-10-29',
          status: 'pending_review',
          ai_snapshot: { parece_pago: true },
        }),
      ]);
      expect(r).toEqual({ skipped: true, status: 'en_espera' });
      const { rows } = await tx.query<{ body: string }>(`select body from public.whatsapp_outbox where dedupe_key like 'reabrir:%'`);
      expect(rows).toHaveLength(1);
      expect(rows[0].body).toContain('Santi mandó un comprobante de transferencia · $9.800');
      expect(rows[0].body).toContain('*pago* · Es un pago: no lo anoto como gasto');

      const { d } = await one<{ d: Record<string, unknown> }>(
        tx,
        `select public.connector_decidir_liquidada($1, null, $2, $2, null, null, 'pago') as d`,
        [JID, SANTI_WA],
      );
      expect(d).toMatchObject({ ok: true, modo: 'pago', gastos: [{ merchant: 'Comprobante de transferencia', total: 9_800 }] });
      expect(await one(tx, 'select status::text from public.messages where id = $1', [mensaje])).toEqual({ status: 'not_expense' });
      expect(await one(tx, `select status::text from public.accounts where id = $1`, [PASEO])).toEqual({ status: 'settling' });
      expect(await one(tx, `select count(*)::int as n from public.expenses where merchant = 'Comprobante de transferencia'`)).toEqual({ n: 0 });
      // Ya no hay pregunta: «1» después no reabre nada
      const { d: otra } = await one<{ d: Record<string, unknown> }>(
        tx,
        `select public.connector_decidir_liquidada($1, null, $2, $2, null, null, 'reabrir') as d`,
        [JID, SANTI_WA],
      );
      expect(otra).toEqual({ ok: false, reason: 'no_es_pregunta' });
    });
  });
});
