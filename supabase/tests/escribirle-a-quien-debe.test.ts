import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, PASEO, U } from './harness';

// El primer aviso de cobro le llega por privado a quien debe aunque nunca le haya escrito a
// Mister Luks, si está en el grupo, y los recordatorios también
// (00000000000600_escribirle_a_quien_debe.sql, 00000000000610_mister_luks_cobra.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const GRUPO = 'd0000000-0000-4000-8000-000000000001';
const SANTI = '30000000-0000-4000-8000-000000000008';
const SANTI_WA = '573128880365';
const MAFE = '30000000-0000-4000-8000-000000000005';
const MAFE_PRIVADO = '573016667788@s.whatsapp.net';

interface Aviso {
  transfer_id: string;
  from: { id: string };
  private_jid: string | null;
  group_jid: string | null;
  primera_vez: boolean;
}

async function liquidar(tx: Transaction) {
  await tx.exec('reset role');
  await tx.query(`update public.expenses set status = 'confirmed' where account_id = $1 and status = 'pending_review'`, [PASEO]);
  await impersonate(tx, U.laura);
  const { r } = await one<{ r: { direct_transfers: unknown[] } }>(tx, 'select public.settlement_overview($1, null) as r', [PASEO]);
  await tx.query('select public.start_settlement($1, null, $2)', [PASEO, JSON.stringify(r.direct_transfers)]);
}

async function avisos(tx: Transaction, rpc = 'connector_avisos_de_cobro') {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
  const { r } = await one<{ r: Aviso[] }>(tx, `select public.${rpc}() as r`);
  await tx.exec('reset role');
  return r;
}

/** Prendidos, Santi en el grupo (nunca le ha escrito a Mister Luks) y Mafe con su chat abierto */
async function preparar(tx: Transaction) {
  await impersonate(tx, U.laura);
  await tx.query('select public.set_auto_cobros($1, true)', [PASEO]);
  await tx.exec('reset role');
  await tx.query(`insert into public.whatsapp_group_members (group_id, wa_id, phone, name) values ($1, $2, $2, 'Santi')`, [GRUPO, SANTI_WA]);
  await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, MAFE_PRIVADO]);
  await liquidar(tx);
}

describe('escribirle a quien debe', () => {
  it('el primer aviso le llega por privado (presentándose) aunque nunca le haya escrito', async () => {
    await as(db, U.laura, async (tx) => {
      await preparar(tx);
      const r = await avisos(tx);
      const santi = r.filter((c) => c.from.id === SANTI);
      expect(santi.length).toBeGreaterThan(0);
      for (const c of santi) expect(c).toMatchObject({ private_jid: `${SANTI_WA}@s.whatsapp.net`, primera_vez: true });
      for (const c of r.filter((x) => x.from.id === MAFE)) expect(c).toMatchObject({ private_jid: MAFE_PRIVADO, primera_vez: false });
      for (const c of r.filter((x) => x.from.id !== SANTI && x.from.id !== MAFE)) expect(c.private_jid).toBeNull();
      // Liquidar lo cuenta entre los que reciben por privado
      await impersonate(tx, U.laura);
      const { e } = await one<{ e: { por_privado: string[] } }>(tx, 'select public.auto_cobros_estado($1) as e', [PASEO]);
      expect(e.por_privado.sort()).toEqual([MAFE, SANTI].sort());
      // El connector de antes sigue como estaba
      expect((await avisos(tx, 'connector_cobros')).filter((c) => c.from.id === SANTI).every((c) => c.private_jid === null)).toBe(true);

      // Avisado por privado: aunque no conteste, los recordatorios también van por privado (la 610)
      await tx.exec('set local role service_role');
      await tx.query('select public.connector_cobros_enviados($1, $2)', [
        r.filter((c) => c.private_jid).map((c) => c.transfer_id),
        r.filter((c) => !c.private_jid).map((c) => c.transfer_id),
      ]);
      expect(await avisos(tx)).toEqual([]);
      await tx.query(`update public.settlement_transfers set avisado_at = now() - interval '4 days' where account_id = $1`, [PASEO]);
      const recordatorios = (await avisos(tx)).filter((x) => x.from.id === SANTI);
      expect(recordatorios.length).toBeGreaterThan(0);
      for (const c of recordatorios) expect(c).toMatchObject({ private_jid: `${SANTI_WA}@s.whatsapp.net`, primera_vez: true });
    });
  });

  it('quien dijo «no me escribas» (prefiere el grupo) no recibe nada por privado', async () => {
    await as(db, U.laura, async (tx) => {
      await preparar(tx);
      await tx.exec('reset role');
      const { id } = await one<{ id: string }>(tx, `select public.wa_identidad($1, $1, null, 'Santi') as id`, [SANTI_WA]);
      await tx.query(`insert into public.whatsapp_answer_prefs (identity_id, mode) values ($1, 'aqui')`, [id]);
      const santi = (await avisos(tx)).filter((x) => x.from.id === SANTI);
      expect(santi.length).toBeGreaterThan(0);
      for (const c of santi) expect(c.private_jid).toBeNull();
    });
  });

  it('quien ya no está en el grupo tampoco', async () => {
    await as(db, U.laura, async (tx) => {
      await preparar(tx);
      await tx.exec('reset role');
      await tx.query('update public.whatsapp_group_members set left_at = now() where group_id = $1 and wa_id = $2', [GRUPO, SANTI_WA]);
      const santi = (await avisos(tx)).filter((x) => x.from.id === SANTI);
      expect(santi.length).toBeGreaterThan(0);
      for (const c of santi) expect(c.private_jid).toBeNull();
    });
  });

  it('la bandeja de salida acepta su aviso de cobro, y nada más, aunque nunca le haya escrito (la 620)', async () => {
    await as(db, U.laura, async (tx) => {
      await preparar(tx);
      const [c] = (await avisos(tx)).filter((x) => x.from.id === SANTI);
      const encolar = async (chat: string, clave: string) => {
        await tx.exec('reset role');
        await tx.exec('set local role service_role');
        const { r } = await one<{ r: string[] }>(tx, 'select public.connector_outbox_enqueue($1) as r', [
          JSON.stringify([{ chat_jid: chat, reason: 'answer', body: '💸 Hola', dedupe_key: clave }]),
        ]);
        await tx.exec('reset role');
        return r;
      };
      const suyo = `${SANTI_WA}@s.whatsapp.net`;
      expect(await encolar(suyo, `cobro:${c.transfer_id}:1`)).toEqual([`cobro:${c.transfer_id}:1`]);
      // Otro chat con esa clave, u otra cosa a su chat: no
      expect(await encolar('573009990000@s.whatsapp.net', `cobro:${c.transfer_id}:2`)).toEqual([]);
      expect(await encolar(suyo, 'answer:hola')).toEqual([]);
      // Ya pagada: tampoco
      await tx.query('update public.settlement_transfers set paid_at = now() where id = $1', [c.transfer_id]);
      expect(await encolar(suyo, `cobro:${c.transfer_id}:3`)).toEqual([]);
    });
  });
});
