import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, one, U } from './harness';

// Mister Luks abre una cuenta desde el chat privado y lee lo que ya le mandaron
// (00000000000640_cuenta_desde_el_privado.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';

async function como(tx: Transaction, rol: 'service_role' | null) {
  await tx.exec('reset role');
  if (rol) await tx.exec(`set local role ${rol}`);
}

async function abrir(tx: Transaction, numero: string, nombre: string) {
  await como(tx, 'service_role');
  const { r } = await one<{ r: { ok: boolean; abierta: boolean; account_id: string; account_name: string; identity_id: string } }>(
    tx,
    'select public.connector_abrir_cuenta_privada($1, $2, $2, null, $3) as r',
    [`${numero}@s.whatsapp.net`, numero, nombre],
  );
  await como(tx, null);
  return r;
}

describe('una cuenta abierta desde el chat privado', () => {
  it('sin usuario de Luks queda por abrir; al verificar su número se abre, entra lo que mandó y le avisa', async () => {
    await as(db, null, async (tx) => {
      await como(tx, null);
      const numero = '573150001111';
      await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, `${numero}@s.whatsapp.net`]);
      const r = await abrir(tx, numero, 'Santiago Echeverría');
      expect(r).toMatchObject({ ok: true, abierta: false, account_name: 'Cuenta con Mister Luks' });
      expect(await one(tx, 'select count(*)::int as n from public.accounts where id = $1', [r.account_id])).toEqual({ n: 0 });
      // Pedirla otra vez da la misma
      expect((await abrir(tx, numero, 'Santiago Echeverría')).account_id).toBe(r.account_id);

      await como(tx, 'service_role');
      const { n } = await one<{ n: number }>(tx, 'select public.connector_guardar_gastos_por_abrir($1, $2) as n', [
        r.account_id,
        JSON.stringify([
          { wa_message_id: 'P-ARR', sender_wa_id: numero, sender_name: 'Santiago', kind: 'text', text: 'arriendo 800 lucas', sent_at: '2026-10-30T01:54:00Z' },
          // Un archivo fuera de su carpeta no
          { wa_message_id: 'P-MAL', kind: 'photo', media_path: 'otra/cosa.jpg', sent_at: '2026-10-30T01:55:00Z' },
        ]),
      ]);
      expect(n).toBe(1);
      await como(tx, null);

      // Entra a Luks con el link: su número queda verificado con su usuario
      await tx.query('update public.whatsapp_identities set user_id = $1, verified_at = now() where id = $2', [U.nuevo, r.identity_id]);
      expect(await one(tx, 'select name, owner_id from public.accounts where id = $1', [r.account_id])).toEqual({ name: 'Cuenta con Mister Luks', owner_id: U.nuevo });
      expect(await one(tx, `select display_name, claimed_by from public.people where account_id = $1`, [r.account_id])).toEqual({
        display_name: 'Santiago',
        claimed_by: U.nuevo,
      });
      expect(await one(tx, `select role::text from public.account_members where account_id = $1 and user_id = $2`, [r.account_id, U.nuevo])).toEqual({ role: 'owner' });
      // Lo que mandó entró desde su chat privado, para el worker
      const m = await one<{ id: string; text_body: string; chat_kind: string }>(
        tx,
        `select m.id, m.text_body, g.chat_kind from public.messages m join public.whatsapp_groups g on g.id = m.group_id where m.account_id = $1`,
        [r.account_id],
      );
      expect(m).toMatchObject({ text_body: 'arriendo 800 lucas', chat_kind: 'privado' });
      expect(await one(tx, `select count(*)::int as n from public.jobs where payload ->> 'message_id' = $1`, [m.id])).toEqual({ n: 1 });
      const { body } = await one<{ body: string }>(tx, `select body from public.whatsapp_outbox where dedupe_key = $1`, [`cuenta-abierta:${r.account_id}`]);
      expect(body).toContain('abrí tu cuenta «Cuenta con Mister Luks» y estoy leyendo lo que me mandaste');
      expect(body).toContain('conéctala a un grupo de WhatsApp');

      // Ya la tiene para anotar por privado (primero la de su chat)
      await como(tx, 'service_role');
      const { c } = await one<{ c: { id: string; name: string }[] }>(tx, 'select public.connector_cuentas_para_anotar($1, $2, $2, null) as c', [
        `${numero}@s.whatsapp.net`,
        numero,
      ]);
      expect(c[0]).toMatchObject({ id: r.account_id, name: 'Cuenta con Mister Luks' });
      await como(tx, null);
    });
  });

  it('con su WhatsApp ya conectado a Luks se abre en el momento y se puede anotar ahí', async () => {
    await as(db, null, async (tx) => {
      await como(tx, null);
      const numero = '573150002222';
      await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, `${numero}@s.whatsapp.net`]);
      const { id } = await one<{ id: string }>(tx, `select public.wa_identidad($1, $1, null, 'Vale') as id`, [numero]);
      await tx.query('update public.whatsapp_identities set user_id = $1, verified_at = now() where id = $2', [U.otro, id]);
      const r = await abrir(tx, numero, 'Vale');
      expect(r).toMatchObject({ ok: true, abierta: true, account_name: 'Cuenta con Mister Luks' });
      expect(await one(tx, 'select owner_id from public.accounts where id = $1', [r.account_id])).toEqual({ owner_id: U.otro });
      await como(tx, 'service_role');
      const { i } = await one<{ i: { ingest: boolean } }>(
        tx,
        `select public.connector_ingest_privado($1, $2, 'P-1', $3, $3, null, 'Vale', 'text'::public.message_kind, 'mercado 50 lucas', null, null, null, now()) as i`,
        [`${numero}@s.whatsapp.net`, r.account_id, numero],
      );
      expect(i).toMatchObject({ ingest: true });
      await como(tx, null);
    });
  });

  it('solo el connector', async () => {
    await as(db, U.nuevo, async (tx) => {
      await expect(tx.query(`select public.connector_abrir_cuenta_privada('1@s.whatsapp.net', '1', '1', null, 'x')`)).rejects.toThrow(/permission denied/);
    });
  });
});
