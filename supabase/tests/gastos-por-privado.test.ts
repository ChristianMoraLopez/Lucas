import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, one, PASEO } from './harness';

// Un gasto que llega por privado se anota en la cuenta que elige quien lo manda, y Mister Luks
// le confirma por privado (00000000000630_gastos_por_privado.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const MAFE_WA = '573016667788';
const MAFE_PRIVADO = `${MAFE_WA}@s.whatsapp.net`;
const MAFE = '30000000-0000-4000-8000-000000000005';

async function como(tx: Transaction, rol: 'service_role' | null) {
  await tx.exec('reset role');
  if (rol) await tx.exec(`set local role ${rol}`);
}

const ingresar = async (tx: Transaction, chat: string, cuenta: string, wa: string, envio: string, texto = 'arriendo 800 lucas') => {
  await como(tx, 'service_role');
  const { r } = await one<{ r: Record<string, unknown> }>(
    tx,
    `select public.connector_ingest_privado($1, $2, $3, $4, $4, null, 'Mafe', 'text'::public.message_kind, $5, null, null, null, now()) as r`,
    [chat, cuenta, envio, wa, texto],
  );
  await como(tx, null);
  return r;
};

describe('un gasto por privado', () => {
  it('se anota en la cuenta que eligió, desde su chat privado, y el worker lo lee', async () => {
    await as(db, null, async (tx) => {
      await como(tx, null);
      await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, MAFE_PRIVADO]);
      const r = await ingresar(tx, MAFE_PRIVADO, PASEO, MAFE_WA, 'WA-P1');
      expect(r).toMatchObject({ ingest: true, account_id: PASEO, account_name: 'Paseo Santa Marta' });
      const m = await one<{ sender_person_id: string; chat_kind: string; source: string }>(
        tx,
        `select m.sender_person_id, g.chat_kind, m.source from public.messages m join public.whatsapp_groups g on g.id = m.group_id where m.id = $1`,
        [r.message_id],
      );
      expect(m).toEqual({ sender_person_id: MAFE, chat_kind: 'privado', source: 'whatsapp' });
      expect(await one(tx, `select count(*)::int as n from public.jobs where payload ->> 'message_id' = $1`, [r.message_id])).toEqual({ n: 1 });
      // El mismo mensaje dos veces no
      expect(await ingresar(tx, MAFE_PRIVADO, PASEO, MAFE_WA, 'WA-P1')).toMatchObject({ ingest: false, reason: 'repetido' });
    });
  });

  it('solo en su chat, en una cuenta abierta donde es una de las personas', async () => {
    await as(db, null, async (tx) => {
      expect(await ingresar(tx, MAFE_PRIVADO, PASEO, MAFE_WA, 'WA-P2')).toMatchObject({ ingest: false, reason: 'sin_chat' });
      await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, MAFE_PRIVADO]);
      await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, '573009990000@s.whatsapp.net']);
      expect(await ingresar(tx, '573009990000@s.whatsapp.net', PASEO, '573009990000', 'WA-P3')).toMatchObject({
        ingest: false,
        reason: 'no_es_de_la_cuenta',
      });
      await tx.query(`update public.accounts set status = 'settling' where id = $1`, [PASEO]);
      expect(await ingresar(tx, MAFE_PRIVADO, PASEO, MAFE_WA, 'WA-P4')).toMatchObject({ ingest: false, reason: 'cuenta_liquidada' });
    });
  });

  it('Mister Luks le contesta por privado siempre: anotado, repetido, no era un gasto o no se pudo leer', async () => {
    await as(db, null, async (tx) => {
      await como(tx, null);
      await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, MAFE_PRIVADO]);
      const r = await ingresar(tx, MAFE_PRIVADO, PASEO, MAFE_WA, 'WA-P5');
      await tx.query(`update public.messages set status = 'not_expense' where id = $1`, [r.message_id]);
      await como(tx, 'service_role');
      const { p } = await one<{ p: { message_id: string; group_jid: string; status: string; privado: boolean; account_name: string }[] }>(
        tx,
        'select public.connector_pending_replies() as p',
      );
      expect(p.find((x) => x.message_id === r.message_id)).toMatchObject({
        group_jid: MAFE_PRIVADO,
        status: 'not_expense',
        privado: true,
        account_name: 'Paseo Santa Marta',
      });
      await tx.query('select public.connector_mark_replied($1)', [[r.message_id]]);
      const { p: otra } = await one<{ p: { message_id: string }[] }>(tx, 'select public.connector_pending_replies() as p');
      expect(otra.some((x) => x.message_id === r.message_id)).toBe(false);
      await como(tx, null);
    });
  });
});
