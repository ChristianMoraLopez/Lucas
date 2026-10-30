import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, one, PASEO, U } from './harness';

// Al primer recibo que alguien manda en una cuenta, Mister Luks le contesta aunque el grupo
// no confirme cada gasto (00000000000660_primer_gasto.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const GRUPO = '120363099999999999@g.us';
const MAFE_WA = '573016667788';
const MAFE = '30000000-0000-4000-8000-000000000005';
const NUEVO_WA = '573009998877';

type Pendiente = {
  message_id: string;
  group_jid: string;
  primera_vez: boolean;
  sender_person_id: string | null;
  sender_name: string | null;
  con_sesion: boolean;
  account_id: string;
  expense: { id: string; merchant: string } | null;
};

async function como(tx: Transaction, rol: 'service_role' | null) {
  await tx.exec('reset role');
  if (rol) await tx.exec(`set local role ${rol}`);
}

async function enlazar(tx: Transaction) {
  await como(tx, 'service_role');
  await tx.query('select public.connector_link_group($1, $2, $3, $4, $5)', [CONTADOR, GRUPO, 'Paseo de prueba', 'PASEO-7K2Q', MAFE_WA]);
  await como(tx, null);
}

/** Llega un recibo al grupo y el worker lo anota */
async function anotado(tx: Transaction, id: string, de = MAFE_WA) {
  await como(tx, 'service_role');
  const { r } = await one<{ r: { message_id: string } }>(
    tx,
    `select public.connector_ingest_message($1, $2, $3, 'Mafe', 'text'::public.message_kind, 'arriendo 800 lucas', null, null, null, now()) as r`,
    [GRUPO, id, de],
  );
  await como(tx, null);
  await tx.query(`update public.messages set status = 'done' where id = $1`, [r.message_id]);
  await tx.query(
    `insert into public.expenses (account_id, message_id, merchant, expense_date, total_cop, status, source, payer_person_id)
     values ($1, $2, 'Arriendo', current_date, 800000, 'confirmed', 'whatsapp', $3)`,
    [PASEO, r.message_id, MAFE],
  );
  return r.message_id;
}

async function delGrupo(tx: Transaction) {
  await como(tx, 'service_role');
  const { p } = await one<{ p: Pendiente[] }>(tx, 'select public.connector_pending_replies() as p');
  await como(tx, null);
  return p.filter((x) => x.group_jid === GRUPO);
}

const marcar = async (tx: Transaction, ids: string[]) => {
  await como(tx, 'service_role');
  await tx.query('select public.connector_mark_replied($1)', [ids]);
  await como(tx, null);
};

describe('el primer gasto de alguien', () => {
  it('se le contesta aunque el grupo no confirme, con su nombre y el gasto; el siguiente ya no', async () => {
    await as(db, null, async (tx) => {
      await enlazar(tx);
      const a = await anotado(tx, 'WA-1');
      const [p, ...resto] = await delGrupo(tx);
      expect(resto).toEqual([]);
      expect(p).toMatchObject({
        message_id: a,
        primera_vez: true,
        sender_person_id: MAFE,
        sender_name: 'Mafe',
        con_sesion: true,
        account_id: PASEO,
        expense: { merchant: 'Arriendo' },
      });
      expect(p.expense?.id).toMatch(/^[0-9a-f-]{36}$/);

      await marcar(tx, [a]);
      const b = await anotado(tx, 'WA-2');
      expect(await delGrupo(tx)).toEqual([]);
      // Y queda callado, como cualquier gasto de un grupo que no confirma
      expect(await one(tx, 'select group_reply_at is not null as callado from public.messages where id = $1', [b])).toEqual({ callado: true });
    });
  });

  it('si manda varios seguidos, todos van como su primera vez', async () => {
    await as(db, null, async (tx) => {
      await enlazar(tx);
      const a = await anotado(tx, 'WA-3');
      const b = await anotado(tx, 'WA-4');
      expect((await delGrupo(tx)).map((p) => [p.message_id, p.primera_vez])).toEqual([
        [a, true],
        [b, true],
      ]);
    });
  });

  it('no es su primera vez si ya había subido un gasto en la app', async () => {
    await as(db, null, async (tx) => {
      await enlazar(tx);
      await tx.query(
        `insert into public.messages (account_id, source, kind, status, sender_person_id, uploaded_by, received_at)
         values ($1, 'web', 'photo', 'done', $2, $3, now() - interval '3 days')`,
        [PASEO, MAFE, U.mafe],
      );
      await anotado(tx, 'WA-5');
      expect(await delGrupo(tx)).toEqual([]);
    });
  });

  it('a quien no es de la cuenta no se le contesta así', async () => {
    await as(db, null, async (tx) => {
      await enlazar(tx);
      await anotado(tx, 'WA-6', NUEVO_WA);
      expect(await delGrupo(tx)).toEqual([]);
    });
  });
});
