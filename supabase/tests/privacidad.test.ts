import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, PASEO, U } from './harness';

// De los grupos de un WhatsApp vinculado solo se guarda el nombre (00000000000280_privacidad_de_los_grupos.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const GRUPO_PASEO = 'd0000000-0000-4000-8000-000000000001';
const JID_PASEO = '120363040123456789@g.us';
const JID_FAMILIA = '120363011111111111@g.us';
const JID_TRABAJO = '120363022222222222@g.us';

const miembros = [
  { id: '573009990001', phone: '573009990001', name: 'Tía Gloria' },
  { id: '573009990002', phone: '573009990002', name: 'Primo Juan' },
];

async function comoConnector(tx: Transaction) {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
}

/** El WhatsApp de Valeria, vinculado y conectado */
async function whatsappDeValeria(tx: Transaction) {
  await impersonate(tx, U.valeria);
  const { r } = await one<{ r: string }>(tx, 'select public.request_personal_whatsapp(null) as r');
  await comoConnector(tx);
  await tx.query(`select public.connector_set_status($1, 'connected', '573170000000@s.whatsapp.net', null, '573170000000')`, [r]);
  return r;
}

const grupo = async (tx: Transaction, conexion: string, jid: string, nombre: string) =>
  (await one<{ r: { group_id: string } }>(tx, 'select public.connector_upsert_group($1, $2, $3, 2) as r', [conexion, jid, nombre])).r.group_id;

const fijar = async (tx: Transaction, grupoId: string) =>
  (await one<{ r: { members: number; people_added: number; stored?: boolean } }>(tx, 'select public.connector_set_group_members($1, $2) as r', [
    grupoId,
    JSON.stringify(miembros),
  ])).r;

const guardados = async (tx: Transaction, grupoId: string) =>
  (await one<{ n: number }>(tx, 'select count(*)::int as n from public.whatsapp_group_members where group_id = $1', [grupoId])).n;

describe('grupos de un WhatsApp vinculado', () => {
  it('de un grupo sin cuenta se guarda el nombre, pero nadie de adentro', async () => {
    await as(db, U.valeria, async (tx) => {
      const mio = await whatsappDeValeria(tx);
      const familia = await grupo(tx, mio, JID_FAMILIA, 'Familia');
      expect(await fijar(tx, familia)).toEqual({ members: 0, people_added: 0, stored: false });
      expect(await guardados(tx, familia)).toBe(0);
      const { name } = await one<{ name: string }>(tx, 'select name from public.whatsapp_groups where id = $1', [familia]);
      expect(name).toBe('Familia');
    });
  });

  it('de un grupo con cuenta sí: sus integrantes son las personas de la cuenta', async () => {
    await as(db, U.valeria, async (tx) => {
      const mio = await whatsappDeValeria(tx);
      // El grupo del paseo ahora lo lee el WhatsApp de Valeria
      expect(await grupo(tx, mio, JID_PASEO, 'Paseo Santa Marta 2026')).toBe(GRUPO_PASEO);
      expect(await fijar(tx, GRUPO_PASEO)).toMatchObject({ members: 2, people_added: 2 });
    });
  });

  it('Mister Luks guarda quién está aunque el grupo todavía no tenga cuenta', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      const trabajo = await grupo(tx, CONTADOR, JID_TRABAJO, 'Almuerzos del trabajo');
      expect(await fijar(tx, trabajo)).toMatchObject({ members: 2, people_added: 0 });
      expect(await guardados(tx, trabajo)).toBe(2);
    });
  });

  it('al desconectar un grupo de un WhatsApp vinculado se olvidan sus integrantes; las personas se quedan', async () => {
    await as(db, U.valeria, async (tx) => {
      const mio = await whatsappDeValeria(tx);
      await grupo(tx, mio, JID_PASEO, 'Paseo Santa Marta 2026');
      await fijar(tx, GRUPO_PASEO);
      expect(await guardados(tx, GRUPO_PASEO)).toBeGreaterThan(0);
      const antes = (await one<{ n: number }>(tx, 'select count(*)::int as n from public.people where account_id = $1', [PASEO])).n;

      await impersonate(tx, U.valeria);
      await tx.query('delete from public.account_group_links where group_id = $1', [GRUPO_PASEO]);
      await comoConnector(tx);
      expect(await guardados(tx, GRUPO_PASEO)).toBe(0);
      const despues = (await one<{ n: number }>(tx, 'select count(*)::int as n from public.people where account_id = $1', [PASEO])).n;
      expect(despues).toBe(antes);
    });
  });

  it('si lo lee Mister Luks, desconectarlo no borra quién está', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      await fijar(tx, GRUPO_PASEO);
      await impersonate(tx, U.valeria);
      await tx.query('delete from public.account_group_links where group_id = $1', [GRUPO_PASEO]);
      await comoConnector(tx);
      expect(await guardados(tx, GRUPO_PASEO)).toBe(2);
    });
  });

  it('nadie fuera del connector usa la regla', async () => {
    await as(db, U.valeria, async (tx) => {
      await expect(tx.query(`select public.grupo_guarda_integrantes('${GRUPO_PASEO}')`)).rejects.toThrow(/permission denied/);
    });
  });
});
