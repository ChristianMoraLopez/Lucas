import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, PASEO, U } from './harness';

// Avisos de cobro (00000000000410_avisos_de_cobro.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const GRUPO_PASEO = '120363040123456789@g.us';
const MAFE = '30000000-0000-4000-8000-000000000005';
const MAFE_PRIVADO = '573016667788@s.whatsapp.net';

interface Cobro {
  transfer_id: string;
  avisos: number;
  account: { name: string; currency: string };
  from: { id: string; name: string };
  to: { id: string; name: string };
  amount: number;
  private_jid: string | null;
  group_jid: string | null;
  token: string | null;
  transfers: { to: string; amount: number }[];
  expenses: { merchant: string; payer_name: string; shares: { person_id: string }[] }[];
}

/** El Paseo liquidado como lo haría la app (todo revisado y con las transferencias directas) */
async function liquidar(tx: Transaction) {
  await tx.exec('reset role');
  await tx.query(`update public.expenses set status = 'confirmed' where account_id = $1 and status = 'pending_review'`, [PASEO]);
  await impersonate(tx, U.laura);
  const { r } = await one<{ r: { direct_transfers: unknown[] } }>(tx, 'select public.settlement_overview($1, null) as r', [PASEO]);
  await tx.query('select public.start_settlement($1, null, $2)', [PASEO, JSON.stringify(r.direct_transfers)]);
}

async function cobros(tx: Transaction) {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
  const { r } = await one<{ r: Cobro[] }>(tx, 'select public.connector_cobros() as r');
  await tx.exec('reset role');
  return r;
}

describe('avisos de cobro', () => {
  it('apagados, no hay nada que avisar', async () => {
    await as(db, U.laura, async (tx) => {
      await liquidar(tx);
      expect(await cobros(tx)).toEqual([]);
    });
  });

  it('prendidos: a quien debe, por privado si ya le escribió a Mister Luks; si no, en el grupo', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.query('select public.set_auto_cobros($1, true)', [PASEO]);
      // Mafe le escribió a Mister Luks por privado
      await tx.exec('reset role');
      await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, MAFE_PRIVADO]);
      await impersonate(tx, U.laura);
      const estado = await one<{ r: { on: boolean; grupo: boolean; por_privado: string[] } }>(tx, 'select public.auto_cobros_estado($1) as r', [PASEO]);
      expect(estado.r).toEqual({ on: true, grupo: true, por_privado: [MAFE] });

      await liquidar(tx);
      const r = await cobros(tx);
      expect(r.length).toBeGreaterThan(0);
      for (const c of r) {
        expect(c.group_jid).toBe(GRUPO_PASEO);
        expect(c.private_jid).toBe(c.from.id === MAFE ? MAFE_PRIVADO : null);
        expect(c.account.name).toBe('Paseo Santa Marta');
        expect(c.token).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
        // Lo que tuvo de los gastos que pagaron otros, para decirle por qué
        expect(c.expenses.length).toBeGreaterThan(0);
        for (const e of c.expenses) expect(e.shares.some((s) => s.person_id === c.from.id)).toBe(true);
        expect(c.transfers.reduce((s, t) => s + Number(t.amount), 0)).toBeGreaterThanOrEqual(Number(c.amount));
      }

      // Avisado: hasta dentro de 3 días no se repite
      await tx.exec('set local role service_role');
      await tx.query('select public.connector_cobros_avisados($1)', [r.map((c) => c.transfer_id)]);
      expect(await cobros(tx)).toEqual([]);
      await tx.query(`update public.settlement_transfers set avisado_at = now() - interval '4 days' where account_id = $1`, [PASEO]);
      const otra = await cobros(tx);
      expect(otra.length).toBe(r.length);
      expect(otra.every((c) => c.avisos === 1)).toBe(true);

      // Lo pagado ya no se cobra; tres recordatorios como mucho
      await tx.query(`update public.settlement_transfers set paid_at = now() where id = $1`, [r[0].transfer_id]);
      expect((await cobros(tx)).map((c) => c.transfer_id)).not.toContain(r[0].transfer_id);
      await tx.query(`update public.settlement_transfers set avisos = 4 where account_id = $1`, [PASEO]);
      expect(await cobros(tx)).toEqual([]);
    });
  });

  it('quien dijo «no me cuentes» no recibe nada por privado', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.query('select public.set_auto_cobros($1, true)', [PASEO]);
      await tx.exec('reset role');
      await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, MAFE_PRIVADO]);
      const { id } = await one<{ id: string }>(tx, `select public.wa_identidad('573016667788', '573016667788', null, 'Mafe') as id`);
      await tx.query('insert into public.account_optouts (account_id, identity_id) values ($1, $2)', [PASEO, id]);
      await impersonate(tx, U.laura);
      expect((await one<{ r: { por_privado: string[] } }>(tx, 'select public.auto_cobros_estado($1) as r', [PASEO])).r.por_privado).toEqual([]);
    });
  });

  it('solo quien administra los prende; los miembros ven el estado; nadie más', async () => {
    await as(db, U.mafe, async (tx) => {
      await expect(tx.query('select public.set_auto_cobros($1, true)', [PASEO])).rejects.toThrow('Solo quienes administran');
    });
    await as(db, U.mafe, async (tx) => {
      expect((await one<{ r: { on: boolean } }>(tx, 'select public.auto_cobros_estado($1) as r', [PASEO])).r.on).toBe(false);
    });
    await as(db, U.otro, async (tx) => {
      await expect(tx.query('select public.auto_cobros_estado($1)', [PASEO])).rejects.toThrow('No eres miembro');
    });
    await as(db, U.laura, async (tx) => {
      await expect(tx.query('select public.connector_cobros()')).rejects.toThrow(/permission denied/);
    });
  });
});
