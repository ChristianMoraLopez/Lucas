import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, PASEO, U } from './harness';

// «Ya pagué» por WhatsApp (00000000000420_ya_pague.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const GRUPO_PASEO = '120363040123456789@g.us';

interface Transferencia {
  id: string;
  settlement_id: string;
  account: { id: string; name: string; currency: string };
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  amount: number;
}
interface Pendientes {
  grupo: boolean;
  contador_en_grupo: boolean;
  conocido: boolean;
  account: { id: string; name: string; liquidada: boolean } | null;
  pendientes: Transferencia[];
}
interface YaPague {
  pagadas: (Transferencia & { to_private_jid: string | null; group_jid: string | null; todos_pagaron: boolean })[];
  quedan: Transferencia[];
}

/** El Paseo liquidado como lo haría la app */
async function liquidar(tx: Transaction) {
  await tx.exec('reset role');
  await tx.query(`update public.expenses set status = 'confirmed' where account_id = $1 and status = 'pending_review'`, [PASEO]);
  await impersonate(tx, U.laura);
  const { r } = await one<{ r: { direct_transfers: unknown[] } }>(tx, 'select public.settlement_overview($1, null) as r', [PASEO]);
  await tx.query('select public.start_settlement($1, null, $2)', [PASEO, JSON.stringify(r.direct_transfers)]);
  await tx.exec('reset role');
}

/** Alguien que debe en el Paseo y su número */
async function deudor(tx: Transaction) {
  return one<{ person_id: string; wa_id: string; claimed_by: string | null }>(
    tx,
    `select t.from_person_id as person_id, w.wa_id, p.claimed_by
     from public.settlement_transfers t
     join public.person_whatsapp_ids w on w.person_id = t.from_person_id
     join public.people p on p.id = t.from_person_id
     where t.account_id = $1 order by t.position limit 1`,
    [PASEO],
  );
}

async function servicio<T>(tx: Transaction, sql: string, params: unknown[]) {
  await tx.exec('set local role service_role');
  const { r } = await one<{ r: T }>(tx, sql, params);
  await tx.exec('reset role');
  return r;
}
const pendientes = (tx: Transaction, jid: string, wa: string | null, phone: string | null = wa, lid: string | null = null) =>
  servicio<Pendientes>(tx, 'select public.connector_pendientes($1, $2, $3, $4, null) as r', [jid, wa, phone, lid]);
const yaPague = (tx: Transaction, jid: string, wa: string | null, ids: string[], phone: string | null = wa, lid: string | null = null) =>
  servicio<YaPague>(tx, 'select public.connector_ya_pague($1, $2, $3, $4, $5) as r', [jid, wa, phone, lid, ids]);

describe('«ya pagué» por WhatsApp', () => {
  it('antes de liquidar no hay nada que marcar (y se sabe que falta liquidar)', async () => {
    await as(db, null, async (tx) => {
      const r = await pendientes(tx, GRUPO_PASEO, '573016667788');
      expect(r).toMatchObject({ grupo: true, contador_en_grupo: true, conocido: true, pendientes: [] });
      expect(r.account).toMatchObject({ name: 'Paseo Santa Marta', liquidada: false });
    });
  });

  it('en el grupo: lo que le falta pagar a quien escribe, y queda pagado (por WhatsApp)', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      const yo = await deudor(tx);
      const r = await pendientes(tx, GRUPO_PASEO, yo.wa_id);
      expect(r.account?.liquidada).toBe(true);
      expect(r.pendientes.length).toBeGreaterThan(0);
      for (const t of r.pendientes) expect(t).toMatchObject({ from_id: yo.person_id, account: { id: PASEO } });

      const [primera, ...resto] = r.pendientes;
      const m = await yaPague(tx, GRUPO_PASEO, yo.wa_id, [primera.id]);
      expect(m.pagadas).toEqual([expect.objectContaining({ id: primera.id, group_jid: GRUPO_PASEO, to_private_jid: null, todos_pagaron: false })]);
      expect(m.quedan.map((t) => t.id)).toEqual(resto.map((t) => t.id));
      const fila = await one<{ paid_at: string | null; paid_by: string | null; paid_via: string | null }>(
        tx,
        'select paid_at, paid_by, paid_via from public.settlement_transfers where id = $1',
        [primera.id],
      );
      expect(fila).toMatchObject({ paid_by: yo.claimed_by, paid_via: 'whatsapp' });
      expect(fila.paid_at).not.toBeNull();

      // Otra vez no cambia nada
      expect((await yaPague(tx, GRUPO_PASEO, yo.wa_id, [primera.id])).pagadas).toEqual([]);
    });
  });

  it('nadie marca lo que paga otro', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      const yo = await deudor(tx);
      const { id: ajena } = await one<{ id: string }>(
        tx,
        'select id from public.settlement_transfers where account_id = $1 and from_person_id <> $2 limit 1',
        [PASEO, yo.person_id],
      );
      expect((await yaPague(tx, GRUPO_PASEO, yo.wa_id, [ajena])).pagadas).toEqual([]);
      expect((await one<{ paid_at: string | null }>(tx, 'select paid_at from public.settlement_transfers where id = $1', [ajena])).paid_at).toBeNull();
      // Un número que no está en la cuenta no ve nada
      expect(await pendientes(tx, GRUPO_PASEO, '573009990000')).toMatchObject({ conocido: false, pendientes: [] });
    });
  });

  it('por privado: por el chat, por el número o por su LID; y a quien recibe se le avisa por su privado si ya le escribió', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      const yo = await deudor(tx);
      const chat = `${yo.wa_id}@s.whatsapp.net`;
      const r = await pendientes(tx, chat, yo.wa_id);
      expect(r).toMatchObject({ grupo: false, account: null, conocido: true });
      expect(r.pendientes.length).toBeGreaterThan(0);

      // Si WhatsApp solo deja ver el LID, se reconoce igual una vez que se sabe que es el mismo número
      await tx.query(`select public.wa_identidad($1, $1, '98765432100001', null)`, [yo.wa_id]);
      expect((await pendientes(tx, '98765432100001@lid', 'lid:98765432100001', null, '98765432100001')).pendientes.map((t) => t.id)).toEqual(
        r.pendientes.map((t) => t.id),
      );

      // Quien recibe ya le escribió a Mister Luks por privado
      const t = r.pendientes[0];
      const { wa_id: suyo } = await one<{ wa_id: string }>(tx, 'select wa_id from public.person_whatsapp_ids where person_id = $1 limit 1', [t.to_id]);
      await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, `${suyo}@s.whatsapp.net`]);
      const m = await yaPague(tx, chat, yo.wa_id, [t.id]);
      expect(m.pagadas[0]).toMatchObject({ id: t.id, to_private_jid: `${suyo}@s.whatsapp.net`, group_jid: GRUPO_PASEO });
    });
  });

  it('en el grupo de otra cuenta no se ve lo del Paseo', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      const yo = await deudor(tx);
      await tx.query(
        `insert into public.whatsapp_groups (connection_id, wa_group_jid, name, chat_kind) values ($1, '120363000000000999@g.us', 'Otro', 'grupo')`,
        [CONTADOR],
      );
      expect(await pendientes(tx, '120363000000000999@g.us', yo.wa_id)).toMatchObject({ account: null, pendientes: [] });
    });
  });

  it('avisos de cobro: a quien solo se le avisó en el grupo le llega el detalle cuando escribe por privado', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.query('select public.set_auto_cobros($1, true)', [PASEO]);
      await liquidar(tx);
      const yo = await deudor(tx);
      const cobros = () =>
        servicio<{ transfer_id: string; from: { id: string }; private_jid: string | null; avisado_privado: boolean }[]>(tx, 'select public.connector_cobros() as r', []);
      const todos = await cobros();
      const mios = todos.filter((c) => c.from.id === yo.person_id).map((c) => c.transfer_id);
      expect(mios.length).toBeGreaterThan(0);
      expect(todos.every((c) => c.private_jid === null)).toBe(true);
      await tx.exec('set local role service_role');
      await tx.query('select public.connector_cobros_enviados($1, $2)', [[], todos.map((c) => c.transfer_id)]);
      await tx.exec('reset role');
      expect(await cobros()).toEqual([]);

      // Le escribe a Mister Luks: ahora sí, por privado (y una sola vez)
      await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, `${yo.wa_id}@s.whatsapp.net`]);
      const ahora = await cobros();
      expect(ahora.map((c) => c.transfer_id).sort()).toEqual([...mios].sort());
      for (const c of ahora) expect(c).toMatchObject({ private_jid: `${yo.wa_id}@s.whatsapp.net`, avisado_privado: false });
      await tx.exec('set local role service_role');
      await tx.query('select public.connector_cobros_enviados($1, $2)', [ahora.map((c) => c.transfer_id), []]);
      await tx.exec('reset role');
      expect(await cobros()).toEqual([]);
    });
  });

  it('solo el connector', async () => {
    await as(db, U.laura, async (tx) => {
      await expect(tx.query(`select public.connector_pendientes($1, '573016667788')`, [GRUPO_PASEO])).rejects.toThrow(/permission denied/);
    });
    await as(db, U.laura, async (tx) => {
      await expect(tx.query(`select public.connector_ya_pague($1, '573016667788', null, null, '{}')`, [GRUPO_PASEO])).rejects.toThrow(/permission denied/);
    });
    await as(db, U.laura, async (tx) => {
      await expect(tx.query(`select public.pendientes_de_wa($1, '573016667788', null, null)`, [GRUPO_PASEO])).rejects.toThrow(/permission denied/);
    });
  });
});
