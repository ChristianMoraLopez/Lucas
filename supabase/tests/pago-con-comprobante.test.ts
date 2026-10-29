import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, PASEO, U } from './harness';

// El pantallazo de la transferencia es un pago entre ellos, no un gasto (00000000000510_pago_con_comprobante.sql)

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
  await tx.query('select public.start_settlement($1, null, $2)', [PASEO, JSON.stringify(r.direct_transfers)]);
  await como(tx, null);
}

/** Santi manda la foto del comprobante al grupo y el worker la lee */
async function comprobante(tx: Transaction, envio: string, monto: number, para: string[]) {
  await como(tx, 'service_role');
  const { m } = await one<{ m: { message_id: string } }>(
    tx,
    `select public.connector_ingest_message($1, $2, $3, 'Santi', 'photo'::public.message_kind, 'ya pagué ❤️', $4, null, 'image/jpeg', now()) as m`,
    [JID, envio, SANTI_WA, `${PASEO}/whatsapp/2026-10/${envio}.jpg`],
  );
  const { r } = await one<{ r: { handled: boolean; tipo?: string; transfer_id?: string } }>(
    tx,
    'select public.worker_pago_con_comprobante($1, $2, $3) as r',
    [m.message_id, monto, para],
  );
  await como(tx, null);
  return r;
}

/** Lo que Santi le debe a cada quien, con lo que se vería del nombre en el banco («Val*****» → val) */
async function deudasDeSanti(tx: Transaction) {
  const { rows } = await tx.query<{ id: string; amount_cop: number; nombre: string; paid_at: string | null }>(
    `select t.id, t.amount_cop::int, p.display_name as nombre, t.paid_at
     from public.settlement_transfers t
     join public.people p on p.id = t.to_person_id
     join public.people s on s.id = t.from_person_id
     where t.account_id = $1 and s.id = public.wa_person($1, $2)
     order by t.amount_cop desc`,
    [PASEO, SANTI_WA],
  );
  return rows;
}
const tapado = (nombre: string) =>
  nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((p) => p.slice(0, 3));

const salio = async (tx: Transaction, clave: string) =>
  (await tx.query<{ body: string }>('select body from public.whatsapp_outbox where dedupe_key like $1', [clave])).rows.map((r) => r.body);

describe('un comprobante de transferencia', () => {
  it('marca pagado lo que le debía a quien recibe, y Mister Luks lo dice en el grupo', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      const [deuda] = await deudasDeSanti(tx);
      expect(deuda).toBeTruthy();
      const r = await comprobante(tx, 'WA-C1', deuda.amount_cop, tapado(deuda.nombre));
      expect(r).toMatchObject({ handled: true, tipo: 'pagada', transfer_id: deuda.id });
      expect((await deudasDeSanti(tx)).find((x) => x.id === deuda.id)?.paid_at).toBeTruthy();
      expect(await one(tx, 'select paid_via from public.settlement_transfers where id = $1', [deuda.id])).toEqual({ paid_via: 'whatsapp' });
      const [body] = await salio(tx, 'comprobante:%');
      expect(body).toContain(`✅ Vi el comprobante: Santi le pagó`);
      expect(body).toContain('Queda marcado en «Paseo Santa Marta»');
      // No quedó como gasto ni en espera, ni se preguntó si reabrir
      expect(await one(tx, `select count(*)::int as n from public.gastos_en_espera`)).toEqual({ n: 0 });
      expect(await salio(tx, 'reabrir:%')).toEqual([]);

      // Otra vez la misma foto: ya estaba
      expect(await comprobante(tx, 'WA-C2', deuda.amount_cop, tapado(deuda.nombre))).toMatchObject({ handled: true, tipo: 'ya_estaba' });
    });
  });

  it('si el monto no es lo que debía, lo dice y no marca nada', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      const [deuda] = await deudasDeSanti(tx);
      const r = await comprobante(tx, 'WA-C3', Math.round(deuda.amount_cop / 2), tapado(deuda.nombre));
      expect(r).toMatchObject({ handled: true, tipo: 'distinto' });
      expect((await deudasDeSanti(tx)).find((x) => x.id === deuda.id)?.paid_at).toBeNull();
      expect((await salio(tx, 'comprobante:%'))[0]).toContain('así que no lo marqué');
    });
  });

  it('a alguien que no es de la cuenta es un gasto (sigue como siempre)', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      expect(await comprobante(tx, 'WA-C4', 8_200, ['porcelanas'])).toEqual({ handled: false });
      expect(await salio(tx, 'comprobante:%')).toEqual([]);
    });
  });

  it('sin liquidar, queda como un pago hecho que cuenta en los saldos', async () => {
    await as(db, null, async (tx) => {
      await como(tx, null);
      const { nombre, id } = await one<{ nombre: string; id: string }>(
        tx,
        `select p.display_name as nombre, p.id from public.people p
         where p.account_id = $1 and p.id <> public.wa_person($1, $2) and p.claimed_by is not null order by p.created_at limit 1`,
        [PASEO, SANTI_WA],
      );
      const r = await comprobante(tx, 'WA-C5', 50_000, tapado(nombre));
      expect(r).toMatchObject({ handled: true, tipo: 'abono', to: id });
      expect(await one(tx, 'select amount_cop::int, period from public.settlement_payments where to_person_id = $1', [id])).toEqual({
        amount_cop: 50_000,
        period: null,
      });
      expect((await salio(tx, 'comprobante:%'))[0]).toContain('al liquidar solo se pide lo que falta');
    });
  });

  it('solo el worker', async () => {
    await as(db, U.laura, async (tx) => {
      await expect(tx.query(`select public.worker_pago_con_comprobante(gen_random_uuid(), 1000, '{}')`)).rejects.toThrow(/permission denied/);
    });
  });
});
