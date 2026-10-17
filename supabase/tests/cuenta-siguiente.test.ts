import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, createDb, impersonate, one, PASEO, U } from './harness';

// Un grupo sigue después de liquidar (00000000000370_cuenta_siguiente.sql): el
// Paseo ya se liquidó y al grupo llega un gasto nuevo, o le conectan otra cuenta.

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const GRUPO = 'd0000000-0000-4000-8000-000000000001';
const JID = '120363040123456789@g.us';
const MAFE_WA = '573016667788';
const TOKEN = 'PruebaSiguienteToken1234';

async function como(tx: Transaction, rol: 'service_role' | null) {
  await tx.exec('reset role');
  if (rol) await tx.exec(`set local role ${rol}`);
}

async function falla(tx: Transaction, sql: string, params: unknown[] = []) {
  await tx.exec('savepoint antes');
  try {
    await tx.query(sql, params);
  } catch (e) {
    await tx.exec('rollback to savepoint antes');
    return (e as Error).message;
  }
  await tx.exec('release savepoint antes');
  return null;
}

/** El Paseo se liquidó (sus gastos quedan congelados) */
async function liquidar(tx: Transaction, estado: 'settling' | 'closed' = 'settling') {
  await como(tx, null);
  await tx.query(`update public.accounts set status = $2 where id = $1`, [PASEO, estado]);
}

async function revisar(tx: Transaction, envio: string, quien: string | null = MAFE_WA) {
  await como(tx, 'service_role');
  const { r } = await one<{ r: { ingest: boolean; reason?: string; account_id?: string; new_account?: string } }>(
    tx,
    `select public.connector_should_ingest_sender($1, $2, now(), $3) as r`,
    [JID, envio, quien],
  );
  await como(tx, null);
  return r;
}

const enlace = (tx: Transaction) =>
  one<{ account_id: string; history: string }>(tx, 'select account_id, history from public.account_group_links where group_id = $1', [GRUPO]);
const gastosDelPaseo = (tx: Transaction) => one<{ n: number }>(tx, 'select count(*)::int as n from public.expenses where account_id = $1', [PASEO]);

describe('«luks CÓDIGO» en un grupo cuya cuenta ya se liquidó', () => {
  it('pasa el grupo a la cuenta nueva sin desconectarlo, y sin la pregunta de desde cuándo', async () => {
    await as(db, U.valeria, async (tx) => {
      const { id: nueva } = await one<{ id: string }>(tx, `select public.create_account('DaniChile', 'evento') as id`);
      await como(tx, null);
      await tx.query(`insert into public.invitations (account_id, code, role, created_by) values ($1, 'DANI-7K2Q', 'member', $2)`, [nueva, U.valeria]);
      const antes = await gastosDelPaseo(tx);
      await liquidar(tx);

      await como(tx, 'service_role');
      const { r } = await one<{ r: Record<string, unknown> }>(tx, `select public.connector_link_group($1, $2, 'Paseo Santa Marta 2026', 'DANI-7K2Q', $3) as r`, [
        CONTADOR,
        JID,
        MAFE_WA,
      ]);
      expect(r).toMatchObject({ ok: true, already: false, account_id: nueva, account_name: 'DaniChile', previous_account: 'Paseo Santa Marta' });
      await como(tx, null);
      expect(await enlace(tx)).toEqual({ account_id: nueva, history: 'desde_ya' });
      // Lo del Paseo se queda allá
      expect(await gastosDelPaseo(tx)).toEqual(antes);
    });
  });

  it('si la cuenta del grupo sigue abierta, no se suelta y dice cuál es', async () => {
    await as(db, U.valeria, async (tx) => {
      const { id: nueva } = await one<{ id: string }>(tx, `select public.create_account('DaniChile', 'evento') as id`);
      await como(tx, null);
      await tx.query(`insert into public.invitations (account_id, code, role, created_by) values ($1, 'DANI-7K2Q', 'member', $2)`, [nueva, U.valeria]);
      await como(tx, 'service_role');
      const { r } = await one<{ r: unknown }>(tx, `select public.connector_link_group($1, $2, 'Paseo', 'DANI-7K2Q', $3) as r`, [CONTADOR, JID, MAFE_WA]);
      expect(r).toEqual({ ok: false, error: 'otra_cuenta', account_name: 'Paseo Santa Marta', language: 'es' });
    });
  });
});

describe('un gasto en un grupo cuya cuenta ya se liquidó', () => {
  it('abre la cuenta siguiente con la misma gente, categorías y memoria, y le pasa el grupo', async () => {
    await as(db, null, async (tx) => {
      await como(tx, null);
      const antes = await gastosDelPaseo(tx);
      await liquidar(tx);
      const r = await revisar(tx, 'WA-SIG-1');
      expect(r).toMatchObject({ ingest: true });
      const nueva = r.account_id as string;
      expect(r.new_account).toBe(nueva);
      expect(nueva).not.toBe(PASEO);

      expect(
        await one(tx, 'select name, type, status, currency, language, previous_account_id, starts_on is not null as con_inicio from public.accounts where id = $1', [nueva]),
      ).toEqual({
        name: 'Paseo Santa Marta 2',
        type: 'evento',
        status: 'active',
        currency: 'COP',
        language: 'es',
        previous_account_id: PASEO,
        con_inicio: true,
      });
      // Quienes usan Luks, con su rol y su persona (y sus números)
      const miembros = (q: string) =>
        tx.query<{ user_id: string; role: string; nombre: string; numeros: number }>(
          `select am.user_id, am.role::text, p.display_name as nombre, (select count(*)::int from public.person_whatsapp_ids w where w.person_id = p.id) as numeros
           from public.account_members am join public.people p on p.id = am.person_id where am.account_id = $1 order by am.user_id`,
          [q],
        );
      expect((await miembros(nueva)).rows).toEqual((await miembros(PASEO)).rows);
      // Sus categorías y lo que aprendió de los comercios
      const cats = (q: string) => tx.query<{ name: string }>('select name from public.categories where account_id = $1 order by name', [q]);
      expect((await cats(nueva)).rows).toEqual((await cats(PASEO)).rows);
      const memoria = (q: string) =>
        tx.query(
          'select mm.normalized, c.name, mm.hits from public.merchant_memory mm join public.categories c on c.id = mm.category_id where mm.account_id = $1 order by 1',
          [q],
        );
      expect((await memoria(nueva)).rows).toEqual((await memoria(PASEO)).rows);
      // El grupo quedó en la nueva, desde ahora; lo del Paseo se queda allá
      expect(await enlace(tx)).toEqual({ account_id: nueva, history: 'desde_ya' });
      expect(await gastosDelPaseo(tx)).toEqual(antes);

      // El siguiente gasto va a la misma (no abre otra)
      const otro = await revisar(tx, 'WA-SIG-2');
      expect(otro).toMatchObject({ ingest: true, account_id: nueva });
      expect(otro.new_account).toBeUndefined();
      expect(await one(tx, `select count(*)::int as n from public.accounts where previous_account_id = $1`, [PASEO])).toEqual({ n: 1 });
    });
  });

  it('también si la cuenta ya está cerrada', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx, 'closed');
      const r = await revisar(tx, 'WA-SIG-3');
      expect(r).toMatchObject({ ingest: true });
      expect(r.account_id).not.toBe(PASEO);
    });
  });

  it('si «Paseo Santa Marta 2» ya existe, abre «Paseo Santa Marta 3»', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.query(`select public.create_account('Paseo Santa Marta 2', 'evento')`);
      await liquidar(tx);
      const r = await revisar(tx, 'WA-SIG-4');
      expect(await one(tx, 'select name from public.accounts where id = $1', [r.account_id])).toEqual({ name: 'Paseo Santa Marta 3' });
    });
  });

  it('el chat exportado (sin remitente) y quien dijo «no me cuentes» no abren nada', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      expect(await revisar(tx, 'WA-SIG-5', null)).toMatchObject({ ingest: false, reason: 'cuenta_liquidada', account_id: PASEO });
      const { id } = await one<{ id: string }>(tx, `select id from public.whatsapp_identities where phone = $1`, [MAFE_WA]);
      await tx.query('insert into public.account_optouts (account_id, identity_id) values ($1, $2)', [PASEO, id]);
      expect(await revisar(tx, 'WA-SIG-6')).toMatchObject({ ingest: false, reason: 'cuenta_liquidada' });
      expect(await one(tx, `select count(*)::int as n from public.accounts where previous_account_id = $1`, [PASEO])).toEqual({ n: 0 });
      expect((await enlace(tx)).account_id).toBe(PASEO);
    });
  });

  it('Mister Luks lo cuenta en el grupo con el primer gasto (una vez)', async () => {
    await as(db, null, async (tx) => {
      await liquidar(tx);
      const r = await revisar(tx, 'WA-SIG-7');
      await como(tx, 'service_role');
      const guardar = async (envio: string, texto: string) => {
        const { m } = await one<{ m: { message_id: string } }>(
          tx,
          `select public.connector_ingest_message($1, $2, $3, 'Mafe', 'text'::public.message_kind, $4, null, null, null, now()) as m`,
          [JID, envio, MAFE_WA, texto],
        );
        await tx.query(`select public.worker_save_expense($1, $2)`, [
          m.message_id,
          JSON.stringify({ merchant: 'Empanadas', total_cop: 24_000, expense_date: '2026-10-17', status: 'pending_review' }),
        ]);
      };
      await guardar('WA-SIG-7', 'empanadas 24 lucas');
      await guardar('WA-SIG-8', 'helado 12 lucas');
      await como(tx, null);
      const { rows } = await tx.query<{ body: string; reason: string }>(
        `select body, reason from public.whatsapp_outbox where dedupe_key like 'siguiente:%' order by created_at`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].reason).toBe('link');
      expect(rows[0].body).toBe(
        '🧾 «Paseo Santa Marta» ya estaba liquidada, así que abrí una cuenta nueva para lo que sigue: «Paseo Santa Marta 2». Ahí anoté este gasto 😉 Si quieren, cámbienle el nombre en mrluks.com.',
      );
      // No es un gasto (si lo reenvían o viene en un chat exportado)
      expect(await one(tx, 'select public.es_mensaje_de_luks($1) as luks', [rows[0].body])).toEqual({ luks: true });
      expect(await one(tx, 'select continuation_announced_at is not null as dicho from public.accounts where id = $1', [r.account_id])).toEqual({ dicho: true });
    });
  });
});

describe('desde la app', () => {
  async function conLink(tx: Transaction) {
    await como(tx, null);
    await tx.query(`insert into public.group_links (group_id, token_hash) values ($1, public.hash_codigo($2))`, [GRUPO, TOKEN]);
  }

  it('el link /g/ ofrece crear la siguiente y dice cuál se liquidó', async () => {
    await as(db, U.valeria, async (tx) => {
      await conLink(tx);
      await liquidar(tx);
      await impersonate(tx, U.valeria);
      const { r } = await one<{ r: { status: string; linked: unknown; previous: string } }>(tx, 'select public.preview_group($1) as r', [TOKEN]);
      expect(r).toMatchObject({ status: 'ok', linked: null, previous: 'Paseo Santa Marta' });
    });
  });

  it('conectar el grupo a otra cuenta mía: se mueve y el saludo no pregunta desde cuándo', async () => {
    await as(db, U.valeria, async (tx) => {
      await conLink(tx);
      await liquidar(tx);
      await impersonate(tx, U.valeria);
      await tx.query('select public.link_group_to_account(null, $1, $2)', [TOKEN, CASA]);
      await como(tx, null);
      expect(await enlace(tx)).toEqual({ account_id: CASA, history: 'desde_ya' });
      const { body } = await one<{ body: string }>(tx, `select body from public.whatsapp_outbox where reason = 'link' and group_id = $1 order by created_at desc limit 1`, [GRUPO]);
      expect(body).toContain('Este grupo quedó conectado a «Casa»');
      expect(body).toContain('Lo de «Paseo Santa Marta» se queda allá');
      expect(body).not.toContain('¿Desde cuándo anoto?');
    });
  });

  it('crear la cuenta desde el link: se crea la siguiente (no se entra a la liquidada)', async () => {
    await as(db, U.valeria, async (tx) => {
      await conLink(tx);
      await liquidar(tx);
      await impersonate(tx, U.valeria);
      const { id } = await one<{ id: string }>(tx, `select public.create_account_from_group(null, $1, 'Santa Marta otra vez', 'evento') as id`, [TOKEN]);
      expect(id).not.toBe(PASEO);
      await como(tx, null);
      expect(await enlace(tx)).toEqual({ account_id: id, history: 'desde_ya' });
    });
  });

  it('con la cuenta del grupo abierta, sigue sin dejar conectarlo a otra', async () => {
    await as(db, U.valeria, async (tx) => {
      await conLink(tx);
      await impersonate(tx, U.valeria);
      expect(await falla(tx, 'select public.link_group_to_account(null, $1, $2)', [TOKEN, CASA])).toMatch('Este grupo ya está conectado a otra cuenta de Luks');
    });
  });
});
