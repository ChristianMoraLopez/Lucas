import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, U } from './harness';

// «Cuánto debo» dice por qué: lo que consumió quien pregunta (00000000000470_lo_que_consumio.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const JID = '120363000000000888@g.us';
const MARI_WA = '573000000088';
const DAN_WA = '573000000077';

interface Consumo {
  merchant: string;
  payer_person_id: string;
  payer_name: string;
  shares: { person_id: string; amount_cop: number }[];
  items: { name: string; quantity: number; total: number; people: { id: string; units: number }[] }[] | null;
}

/** Como DaniChile: Daniel pagó el restaurante (dividido por consumo) y Santiago pagó Bruna, entre todos */
async function paseo(tx: Transaction) {
  await impersonate(tx, U.valeria);
  const { id: cuenta } = await one<{ id: string }>(tx, `select public.create_account('Chile', 'evento') as id`);
  await tx.query(`select public.add_people($1, array['Daniel', 'Santiago', 'Mari'], false)`, [cuenta]);
  await tx.exec('reset role');
  const gente = Object.fromEntries(
    (await tx.query<{ id: string; display_name: string }>('select id, display_name from public.people where account_id = $1', [cuenta])).rows.map((p) => [
      p.display_name,
      p.id,
    ]),
  );
  const yo = (await one<{ id: string }>(tx, 'select id from public.people where account_id = $1 and claimed_by = $2', [cuenta, U.valeria])).id;
  const P = { yo, dan: gente.Daniel, santi: gente.Santiago, mari: gente.Mari };
  const gasto = async (comercio: string, pagador: string, partes: [string, number][]) => {
    const total = partes.reduce((s, [, v]) => s + v, 0);
    const { id } = await one<{ id: string }>(
      tx,
      `insert into public.expenses (account_id, merchant, total_cop, payer_person_id, status) values ($1, $2, $3, $4, 'confirmed') returning id`,
      [cuenta, comercio, total, pagador],
    );
    for (const [p, v] of partes) await tx.query('insert into public.expense_splits (expense_id, person_id, amount_cop) values ($1, $2, $3)', [id, p, v]);
    return id;
  };
  const restaurante = await gasto('Le Due Torri', P.dan, [
    [P.mari, 150_000],
    [P.dan, 100_000],
    [P.santi, 50_000],
  ]);
  await gasto('Bruna', P.santi, [
    [P.yo, 30_000],
    [P.dan, 30_000],
    [P.santi, 30_000],
    [P.mari, 30_000],
  ]);
  await gasto('Taxi', P.dan, [
    [P.dan, 20_000],
    [P.santi, 20_000],
  ]);
  await impersonate(tx, U.valeria);
  await tx.query('select public.split_by_consumption($1, $2, $3, $4, $5, $6)', [
    restaurante,
    P.dan,
    JSON.stringify([
      { name: 'Coca Cola Zero', quantity: 3, total_cop: 30_000, people: [P.mari, P.dan], units: { [P.mari]: 2 } },
      { name: 'Ravioli', total_cop: 270_000, people: [] },
    ]),
    JSON.stringify([
      { person_id: P.mari, amount_cop: 165_000 },
      { person_id: P.dan, amount_cop: 100_000 },
      { person_id: P.santi, amount_cop: 50_000 },
    ]),
    5,
    15_000,
  ]);

  // El grupo, y Mari con su WhatsApp
  await tx.exec('reset role');
  await tx.query(
    `insert into public.whatsapp_groups (connection_id, wa_group_jid, name, chat_kind) values ('c0000000-0000-4000-8000-000000000001', $1, 'Chile', 'grupo')`,
    [JID],
  );
  await tx.query(`insert into public.account_group_links (group_id, account_id) select id, $2 from public.whatsapp_groups where wa_group_jid = $1`, [
    JID,
    cuenta,
  ]);
  await tx.query('insert into public.person_whatsapp_ids (person_id, wa_id) values ($1, $2), ($3, $4)', [P.mari, MARI_WA, P.dan, DAN_WA]);
  return { cuenta, P };
}

describe('lo que consumió', () => {
  it('«cuánto debo» trae los gastos donde tuvo parte, con los ítems y quién pagó', async () => {
    await as(db, U.valeria, async (tx) => {
      const { P } = await paseo(tx);
      await tx.exec('set local role service_role');
      const { r } = await one<{ r: { me: { id: string; consumo: Consumo[] } } }>(tx, 'select public.connector_question($1, $2) as r', [JID, MARI_WA]);
      expect(r.me.id).toBe(P.mari);
      // Solo donde tuvo parte (no el taxi), en el orden de la app
      expect(r.me.consumo.map((e) => [e.merchant, e.payer_name]).sort()).toEqual([
        ['Bruna', 'Santiago'],
        ['Le Due Torri', 'Daniel'],
      ]);
      const torri = r.me.consumo.find((e) => e.merchant === 'Le Due Torri') as Consumo;
      expect(torri.payer_person_id).toBe(P.dan);
      expect(torri.items?.map((i) => [i.name, Number(i.total), i.people.length])).toEqual([
        ['Coca Cola Zero', 30_000, 2],
        ['Ravioli', 270_000, 0],
      ]);
      expect(Number(torri.shares.find((s) => s.person_id === P.mari)?.amount_cop)).toBe(165_000);
      expect(r.me.consumo.find((e) => e.merchant === 'Bruna')?.items).toBeNull();
    });
  });

  it('a quien pagó, lo que pagó con lo de cada uno (la 490): para decirle de qué le pagan', async () => {
    await as(db, U.valeria, async (tx) => {
      const { P } = await paseo(tx);
      await tx.exec('set local role service_role');
      const { r } = await one<{ r: { me: { id: string; pagados: Consumo[] } } }>(tx, 'select public.connector_question($1, $2) as r', [JID, DAN_WA]);
      expect(r.me.id).toBe(P.dan);
      expect(r.me.pagados.map((e) => e.merchant).sort()).toEqual(['Le Due Torri', 'Taxi']);
      const torri = r.me.pagados.find((e) => e.merchant === 'Le Due Torri') as Consumo;
      expect(Number(torri.shares.find((s) => s.person_id === P.mari)?.amount_cop)).toBe(165_000);
      expect(torri.items?.find((i) => i.name === 'Coca Cola Zero')?.people.find((x) => x.id === P.mari)).toMatchObject({ units: 2 });
    });
  });

  it('sin persona en la cuenta, no hay «me»', async () => {
    await as(db, U.valeria, async (tx) => {
      await paseo(tx);
      await tx.exec('set local role service_role');
      const { r } = await one<{ r: { me: unknown } }>(tx, 'select public.connector_question($1, $2) as r', [JID, '573009990000']);
      expect(r.me).toBeNull();
    });
  });
});
