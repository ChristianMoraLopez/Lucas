import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, one, PASEO, U } from './harness';

// Solo la cuenta del chat privado se llama «Cuenta con Mister Luks»: conectada a un grupo toma
// su nombre; y quien ya tiene cuentas elige dónde va lo que mandó (00000000000670_cuenta_del_privado.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';

async function como(tx: Transaction, rol: 'service_role' | null) {
  await tx.exec('reset role');
  if (rol) await tx.exec(`set local role ${rol}`);
}

async function rpc<T>(tx: Transaction, sql: string, params: unknown[] = []) {
  await como(tx, 'service_role');
  const { r } = await one<{ r: T }>(tx, `select ${sql} as r`, params);
  await como(tx, null);
  return r;
}

type PorAbrir = { ok: boolean; abierta: boolean; account_id: string; account_name: string; identity_id: string };
const abrir = (tx: Transaction, numero: string) =>
  rpc<PorAbrir>(tx, 'public.connector_abrir_cuenta_privada($1, $2, $2, null, $3)', [`${numero}@s.whatsapp.net`, numero, 'Santiago']);

async function chatPrivado(tx: Transaction, numero: string) {
  await como(tx, null);
  await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, `${numero}@s.whatsapp.net`]);
}

describe('la cuenta del chat privado conectada a un grupo', () => {
  it('toma el nombre del grupo, y el mensaje del grupo ya lo dice', async () => {
    await as(db, null, async (tx) => {
      const numero = '573150002222';
      await chatPrivado(tx, numero);
      const r = await abrir(tx, numero);
      await tx.query('update public.whatsapp_identities set user_id = $1, verified_at = now() where id = $2', [U.nuevo, r.identity_id]);
      expect(await one(tx, 'select name from public.accounts where id = $1', [r.account_id])).toEqual({ name: 'Cuenta con Mister Luks' });

      const { r: grupo } = await one<{ r: { group_id: string } }>(tx, 'select public.connector_upsert_group($1, $2, $3) as r', [
        CONTADOR,
        '120363000000000001@g.us',
        'Gastos Santi mes',
      ]);
      await tx.query('select public.conectar_grupo($1, $2, $3, null)', [grupo.group_id, r.account_id, U.nuevo]);
      expect(await one(tx, 'select name from public.accounts where id = $1', [r.account_id])).toEqual({ name: 'Gastos Santi mes' });
      const { body } = await one<{ body: string }>(tx, `select body from public.whatsapp_outbox where dedupe_key = $1`, [
        `link:${grupo.group_id}:${r.account_id}`,
      ]);
      expect(body).toMatch(/^🎉 ¡Listo! Este grupo quedó conectado a «Gastos Santi mes»/);
    });
  });

  it('si le cambiaron el nombre, o no es la del chat privado, se queda como está', async () => {
    await as(db, null, async (tx) => {
      const numero = '573150003333';
      await chatPrivado(tx, numero);
      const r = await abrir(tx, numero);
      await tx.query('update public.whatsapp_identities set user_id = $1, verified_at = now() where id = $2', [U.otro, r.identity_id]);
      await tx.query(`update public.accounts set name = 'Mi plata' where id = $1`, [r.account_id]);
      const g1 = await one<{ id: string }>(tx, `select (public.connector_upsert_group($1, '120363000000000002@g.us', 'Uno') ->> 'group_id') as id`, [CONTADOR]);
      await tx.query('insert into public.account_group_links (group_id, account_id) values ($1, $2)', [g1.id, r.account_id]);
      expect(await one(tx, 'select name from public.accounts where id = $1', [r.account_id])).toEqual({ name: 'Mi plata' });

      await tx.query(`update public.accounts set name = 'Cuenta con Mister Luks' where id = $1`, [PASEO]);
      const g2 = await one<{ id: string }>(tx, `select (public.connector_upsert_group($1, '120363000000000003@g.us', 'Dos') ->> 'group_id') as id`, [CONTADOR]);
      await tx.query('insert into public.account_group_links (group_id, account_id) values ($1, $2)', [g2.id, PASEO]);
      expect(await one(tx, 'select name from public.accounts where id = $1', [PASEO])).toEqual({ name: 'Cuenta con Mister Luks' });
    });
  });
});

describe('al entrar a Luks con cuentas que ya tenía', () => {
  const numero = '573150004444';
  const chat = `${numero}@s.whatsapp.net`;

  async function porAbrirConRecibo(tx: Transaction) {
    await chatPrivado(tx, numero);
    const r = await abrir(tx, numero);
    await rpc(tx, 'public.connector_guardar_gastos_por_abrir($1, $2)', [
      r.account_id,
      JSON.stringify([
        { wa_message_id: 'P-1', sender_wa_id: numero, sender_name: 'Santiago', kind: 'text', text: 'arriendo 800 lucas', sent_at: new Date().toISOString() },
      ]),
    ]);
    // Entra con el link: su número queda con su usuario, que ya tiene cuentas
    await tx.query('update public.whatsapp_identities set user_id = $1, verified_at = now() where id = $2', [U.santi, r.identity_id]);
    await tx.query('select public.wa_asociar($1, $2)', [U.santi, numero]);
    return r;
  }

  type EnEspera = { account_id: string; opciones: { id: string; name: string }[]; items: { wa_message_id: string; kind: string; text: string }[] };

  it('no se abre otra cuenta: Mister Luks le pregunta en cuál anota lo que mandó', async () => {
    await as(db, null, async (tx) => {
      const r = await porAbrirConRecibo(tx);
      expect(await one(tx, 'select count(*)::int as n from public.accounts where id = $1', [r.account_id])).toEqual({ n: 0 });
      const { body } = await one<{ body: string }>(tx, 'select body from public.whatsapp_outbox where dedupe_key = $1', [`cuenta-elegir:${r.account_id}`]);
      expect(body).toMatch(/^🎉 Listo, ya entraste a Luks ✅\n\n🧾 Veo que ya tienes cuentas\. ¿En cuál anoto lo que me mandaste\?\n1\. /);
      expect(body).toContain('Paseo Santa Marta');
      expect(body).toMatch(/\n\d\. Una cuenta nueva solo para esto: «Cuenta con Mister Luks»\n\nRespóndeme con el número/);

      const e = await rpc<EnEspera>(tx, 'public.connector_por_abrir_en_espera($1)', [chat]);
      expect(e.account_id).toBe(r.account_id);
      expect(e.opciones.map((o) => o.id)).toContain(PASEO);
      expect(e.items).toEqual([expect.objectContaining({ wa_message_id: 'P-1', kind: 'text', text: 'arriendo 800 lucas' })]);
    });
  });

  it('si elige la nueva, se abre con lo que mandó', async () => {
    await as(db, null, async (tx) => {
      const r = await porAbrirConRecibo(tx);
      expect(await rpc(tx, 'public.connector_resolver_por_abrir($1, $2)', [r.account_id, 'nueva'])).toEqual({
        ok: true,
        account_id: r.account_id,
        account_name: 'Cuenta con Mister Luks',
        leyendo: 1,
      });
      expect(await one(tx, 'select owner_id from public.accounts where id = $1', [r.account_id])).toEqual({ owner_id: U.santi });
      expect(await one(tx, 'select count(*)::int as n from public.messages where account_id = $1', [r.account_id])).toEqual({ n: 1 });
      expect(await rpc(tx, 'public.connector_por_abrir_en_espera($1)', [chat])).toBeNull();
    });
  });

  it('si eligió una de sus cuentas, el connector lo anota ahí y la pregunta se cierra', async () => {
    await as(db, null, async (tx) => {
      const r = await porAbrirConRecibo(tx);
      const i = await rpc<{ ingest: boolean; account_id: string }>(
        tx,
        `public.connector_ingest_privado($1, $2, 'P-1', $3, $3, null, 'Santiago', 'text'::public.message_kind, 'arriendo 800 lucas', null, null, null, now())`,
        [chat, PASEO, numero],
      );
      expect(i).toMatchObject({ ingest: true, account_id: PASEO });
      expect(await rpc(tx, 'public.connector_resolver_por_abrir($1, $2)', [r.account_id, 'listo'])).toEqual({ ok: true });
      expect(await rpc(tx, 'public.connector_por_abrir_en_espera($1)', [chat])).toBeNull();
      expect(await one(tx, 'select count(*)::int as n from public.accounts where id = $1', [r.account_id])).toEqual({ n: 0 });
      // Ya respondida, no se vuelve a resolver
      expect(await rpc(tx, 'public.connector_resolver_por_abrir($1, $2)', [r.account_id, 'nueva'])).toEqual({ ok: false, reason: 'ya_no' });
    });
  });

  it('solo el connector', async () => {
    await as(db, U.santi, async (tx) => {
      await expect(tx.query(`select public.connector_por_abrir_en_espera('x@s.whatsapp.net')`)).rejects.toThrow(/permission denied/);
    });
  });
});
