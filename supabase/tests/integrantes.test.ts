import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, createDb, impersonate, one, PASEO, U } from './harness';

// Las personas de la cuenta son las del grupo de WhatsApp (00000000000160_integrantes_del_grupo.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const GRUPO_PASEO = 'd0000000-0000-4000-8000-000000000001';
const JID_NUEVO = '120363099999999999@g.us';
const CODIGO_PASEO = 'PASEO-7K2Q';

// Los 8 del paseo (seed.sql), el número de Luks y dos que no estaban en la cuenta
const PASEO_WA = ['573001112233', '573014445566', '573016667788', '573017778899', '573105550142', '573128880365', '573002224471', '573157770918'];
const LUKS = '573150000000';

type Miembro = { id: string; phone?: string | null; lid?: string | null; name?: string | null; admin?: boolean };
const m = (id: string, name: string | null = null, extra: Partial<Miembro> = {}): Miembro => ({
  id,
  phone: id.startsWith('lid:') ? null : id,
  name,
  ...extra,
});

async function comoConnector(tx: Transaction) {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
}

const fijar = async (tx: Transaction, grupo: string, miembros: Miembro[]) =>
  (await one<{ r: { members: number; people_added: number } }>(tx, 'select public.connector_set_group_members($1, $2) as r', [grupo, JSON.stringify(miembros)]))
    .r;

const personas = async (tx: Transaction, cuenta: string) => {
  const { rows } = await tx.query<{ display_name: string; wa: string[] | null }>(
    `select p.display_name, array_agg(w.wa_id order by w.wa_id) filter (where w.wa_id is not null) as wa
     from public.people p left join public.person_whatsapp_ids w on w.person_id = p.id
     where p.account_id = $1 group by p.id, p.display_name order by p.display_name`,
    [cuenta],
  );
  return rows;
};

describe('integrantes del grupo → personas de la cuenta', () => {
  it('quien ya es de la cuenta no se repite; los nuevos entran con su nombre de WhatsApp; Luks no', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      const r = await fijar(tx, GRUPO_PASEO, [...PASEO_WA.map((w) => m(w)), m(LUKS, 'Luks'), m('573009990001', 'Pipe'), m('573009990002', null)]);
      expect(r).toEqual({ members: 10, people_added: 2 });

      const ps = await personas(tx, PASEO);
      expect(ps).toHaveLength(10);
      expect(ps.find((p) => p.display_name === 'Pipe')?.wa).toEqual(['573009990001']);
      // Sin nombre: «WhatsApp» y los últimos cuatro números
      expect(ps.find((p) => p.display_name === 'WhatsApp 0002')?.wa).toEqual(['573009990002']);
      expect(ps.some((p) => p.display_name === 'Luks')).toBe(false);

      // Volver a mandar la misma lista no cambia nada
      expect((await fijar(tx, GRUPO_PASEO, [...PASEO_WA.map((w) => m(w)), m('573009990001', 'Pipe'), m('573009990002')])).people_added).toBe(0);
      expect(await personas(tx, PASEO)).toHaveLength(10);
    });
  });

  it('quien sale del grupo no se borra; quien entra después, sí aparece', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      await fijar(
        tx,
        GRUPO_PASEO,
        PASEO_WA.map((w) => m(w)),
      );
      const sinCaro = PASEO_WA.filter((w) => w !== '573002224471');
      const r = await fijar(tx, GRUPO_PASEO, [...sinCaro.map((w) => m(w)), m('573009990003', 'Toño')]);
      expect(r).toEqual({ members: 8, people_added: 1 });
      const ps = await personas(tx, PASEO);
      expect(ps.map((p) => p.display_name)).toContain('Caro');
      expect(ps.map((p) => p.display_name)).toContain('Toño');
      const { rows } = await tx.query<{ left_at: string | null }>('select left_at from public.whatsapp_group_members where group_id = $1 and wa_id = $2', [
        GRUPO_PASEO,
        '573002224471',
      ]);
      expect(rows[0].left_at).not.toBeNull();
      // Una lista vacía (WhatsApp no mandó los integrantes) no saca a nadie
      expect((await fijar(tx, GRUPO_PASEO, [])).members).toBe(8);
    });
  });

  it('alguien agregado a mano con el mismo nombre recibe el número; un nombre repetido lleva los últimos números', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.query(`select public.add_people($1, array['Pipe', 'Ana'])`, [PASEO]);
      await comoConnector(tx);
      await fijar(tx, GRUPO_PASEO, [...PASEO_WA.map((w) => m(w)), m('573009990001', 'pipe'), m('573009990004', 'Mafe')]);
      const ps = await personas(tx, PASEO);
      // «pipe» es el Pipe que ya estaba (sin WhatsApp): no se duplica
      expect(ps.filter((p) => p.display_name.toLowerCase() === 'pipe')).toHaveLength(1);
      expect(ps.find((p) => p.display_name === 'Pipe')?.wa).toEqual(['573009990001']);
      // Ya hay una Mafe con otro número: la nueva queda «Mafe 0004»
      expect(ps.find((p) => p.display_name === 'Mafe 0004')?.wa).toEqual(['573009990004']);
    });
  });

  it('el LID con que alguien escribió antes es la misma persona cuando aparece su número', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      // Valeria ya identificó a «lid:5550001» como Caro
      await tx.query(`insert into public.person_whatsapp_ids (person_id, wa_id) values ('30000000-0000-4000-8000-000000000009', 'lid:5550001')`);
      const r = await fijar(tx, GRUPO_PASEO, [...PASEO_WA.filter((w) => w !== '573002224471').map((w) => m(w)), m('573002229999', 'Caro', { lid: '5550001' })]);
      expect(r.people_added).toBe(0);
      const caro = (await personas(tx, PASEO)).find((p) => p.display_name === 'Caro');
      expect(caro?.wa).toEqual(['573002224471', '573002229999', 'lid:5550001']);
    });
  });

  it('el WhatsApp vinculado de alguien de la cuenta es esa persona, no una nueva', async () => {
    await as(db, U.valeria, async (tx) => {
      const { r: conexion } = await one<{ r: string }>(tx, 'select public.request_personal_whatsapp(null) as r');
      await comoConnector(tx);
      await tx.query(`select public.connector_set_status($1, 'connected', '573170000000@s.whatsapp.net', '88888888:3@lid', '573170000000')`, [conexion]);
      const r = await fijar(tx, GRUPO_PASEO, [...PASEO_WA.map((w) => m(w)), m('lid:88888888', 'Vale')]);
      expect(r.people_added).toBe(0);
      const vale = (await personas(tx, PASEO)).find((p) => p.display_name === 'Valeria');
      expect(vale?.wa).toContain('lid:88888888');
    });
  });

  it('al enlazar un grupo nuevo con el código, sus integrantes entran a la cuenta y lo que mandaron queda a su nombre', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      const { r: g } = await one<{ r: { group_id: string } }>(tx, 'select public.connector_upsert_group($1, $2, $3) as r', [CONTADOR, JID_NUEVO, 'Despedida']);
      await fijar(tx, g.group_id, [m(LUKS), m('573001112233'), m('573009990005', 'Juli')]);
      // Antes de enlazar no se crea nadie
      expect((await personas(tx, PASEO)).some((p) => p.display_name === 'Juli')).toBe(false);

      const { r: link } = await one<{ r: { ok: boolean; people_added: number; members: number } }>(
        tx,
        'select public.connector_link_group($1, $2, $3, $4, $5) as r',
        [CONTADOR, JID_NUEVO, 'Despedida', CODIGO_PASEO, '573001112233'],
      );
      // Con el idioma de la cuenta, para que Luks conteste en ese idioma (migración 260)
      expect(link).toMatchObject({ ok: true, people_added: 1, members: 2, language: 'es' });
      const juli = (await personas(tx, PASEO)).find((p) => p.display_name === 'Juli');
      expect(juli?.wa).toEqual(['573009990005']);
    });
  });

  it('la pantalla de WhatsApp muestra integrantes del grupo y personas de la cuenta', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      await fijar(tx, GRUPO_PASEO, [...PASEO_WA.map((w) => m(w)), m(LUKS), m('573009990001', 'Pipe')]);
      await impersonate(tx, U.valeria);
      const { r } = await one<{ r: { people_count: number; groups: { name: string; members: number }[] } }>(tx, 'select public.whatsapp_overview($1) as r', [
        PASEO,
      ]);
      expect(r.people_count).toBe(9);
      expect(r.groups.find((x) => x.name === 'Paseo Santa Marta 2026')?.members).toBe(9);
    });
  });

  it('una cuenta cerrada no recibe gente; nadie fuera del connector toca los integrantes', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update public.accounts set status = 'closed' where id = $1`, [CASA]);
      await comoConnector(tx);
      const { rows } = await tx.query<{ group_id: string }>('select group_id from public.account_group_links where account_id = $1', [CASA]);
      expect((await fijar(tx, rows[0].group_id, [m('573009990006', 'Roomie')])).people_added).toBe(0);
      await impersonate(tx, U.valeria);
      await tx.exec('savepoint antes');
      await expect(tx.query(`select public.connector_set_group_members('${GRUPO_PASEO}', '[]')`)).rejects.toThrow(/permission denied/);
      await tx.exec('rollback to savepoint antes');
      await expect(tx.query('select * from public.whatsapp_group_members')).rejects.toThrow(/permission denied/);
    });
  });
});
