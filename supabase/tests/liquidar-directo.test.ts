import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, U } from './harness';

// Liquidar directo: cada quien le paga a quien pagó por él (00000000000400_liquidar_directo.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

interface Vista {
  account: { status: string };
  direct: boolean;
  direct_transfers: { from: string; to: string; amount: number }[];
  people: { id: string; name: string; balance: number }[];
  expenses: {
    merchant: string;
    split_method: string;
    tip_cop: number;
    items: { name: string; quantity: number; total: number; extra: boolean; people: { id: string; units: number }[] }[] | null;
  }[];
}

const vista = async (tx: Transaction, cuenta: string) => (await one<{ r: Vista }>(tx, 'select public.settlement_overview($1, null) as r', [cuenta])).r;

/**
 * Como DaniChile: Daniel pagó el restaurante (Christian no estaba) y Santiago
 * pagó Bruna, entre los cuatro.
 */
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
  await impersonate(tx, U.valeria);
  return { cuenta, P, restaurante };
}

const pares = (ts: { from: string; to: string; amount: number }[]) => ts.map((t) => `${t.from}>${t.to}:${t.amount}`).sort();

describe('liquidar directo', () => {
  it('cada quien le paga a quien pagó por él: quien no estuvo en la factura de Daniel no le paga a Daniel', async () => {
    await as(db, U.valeria, async (tx) => {
      const { cuenta, P } = await paseo(tx);
      const v = await vista(tx, cuenta);
      expect(v.direct).toBe(true);
      // Santiago le debía 50.000 a Daniel y Daniel 30.000 a Santiago: queda la diferencia
      expect(pares(v.direct_transfers)).toEqual(
        pares([
          { from: P.mari, to: P.dan, amount: 150_000 },
          { from: P.mari, to: P.santi, amount: 30_000 },
          { from: P.yo, to: P.santi, amount: 30_000 },
          { from: P.santi, to: P.dan, amount: 20_000 },
        ]),
      );
      // Y dejan a todos en cero, como los saldos
      for (const p of v.people) {
        const neto = v.direct_transfers.reduce((s, t) => s + (t.to === p.id ? Number(t.amount) : 0) - (t.from === p.id ? Number(t.amount) : 0), 0);
        expect(neto).toBe(Number(p.balance));
      }

      // Se liquida con esas (cuatro, más de n − 1)
      await tx.query('select public.start_settlement($1, null, $2)', [cuenta, JSON.stringify(v.direct_transfers)]);
      expect((await vista(tx, cuenta)).account.status).toBe('settling');
    });
  });

  it('ya liquidada, cada transferencia pagada cuenta en los saldos de cada uno (la 580)', async () => {
    await as(db, U.valeria, async (tx) => {
      const { cuenta, P } = await paseo(tx);
      const { id } = await one<{ id: string }>(tx, 'select public.start_settlement($1, null, $2) as id', [
        cuenta,
        JSON.stringify((await vista(tx, cuenta)).direct_transfers),
      ]);
      const { id: t } = await one<{ id: string }>(
        tx,
        'select id from public.settlement_transfers where settlement_id = $1 and from_person_id = $2 and to_person_id = $3',
        [id, P.mari, P.dan],
      );
      await tx.query('select public.mark_transfer($1, true)', [t]);
      type Persona = { id: string; balance: number; sent: number; received: number };
      const gente = async () => (await vista(tx, cuenta)).people as unknown as Persona[];
      const de = (ps: Persona[], id: string) => ps.find((p) => p.id === id) as Persona;
      let ps = await gente();
      // Mari ya le pagó 150.000 a Daniel: le falta lo de Santiago; a Daniel le falta lo de Santiago
      expect(de(ps, P.mari)).toMatchObject({ balance: -30_000, sent: 150_000, received: 0 });
      expect(de(ps, P.dan)).toMatchObject({ balance: 20_000, sent: 0, received: 150_000 });
      expect(ps.reduce((s, p) => s + Number(p.balance), 0)).toBe(0);

      // Todo pagado: todos a paz y salvo
      const { rows } = await tx.query<{ id: string }>('select id from public.settlement_transfers where settlement_id = $1 and paid_at is null', [id]);
      for (const r of rows) await tx.query('select public.mark_transfer($1, true)', [r.id]);
      ps = await gente();
      for (const p of ps) expect(Number(p.balance)).toBe(0);

      // Al reabrir no se cuenta doble: lo pagado queda como pagos hechos
      await tx.query('select public.reopen_settlement($1)', [id]);
      ps = await gente();
      for (const p of ps) expect(Number(p.balance)).toBe(0);
      expect(de(ps, P.mari)).toMatchObject({ sent: 180_000 });
    });
  });

  it('lo que ya se pagó descuenta (una liquidación que se reabrió)', async () => {
    await as(db, U.valeria, async (tx) => {
      const { cuenta, P } = await paseo(tx);
      const { id } = await one<{ id: string }>(tx, 'select public.start_settlement($1, null, $2) as id', [
        cuenta,
        JSON.stringify((await vista(tx, cuenta)).direct_transfers),
      ]);
      const { id: t } = await one<{ id: string }>(
        tx,
        'select id from public.settlement_transfers where settlement_id = $1 and from_person_id = $2 and to_person_id = $3',
        [id, P.mari, P.dan],
      );
      await tx.query('select public.mark_transfer($1, true)', [t]);
      await tx.query('select public.reopen_settlement($1)', [id]);
      expect(pares((await vista(tx, cuenta)).direct_transfers)).toEqual(
        pares([
          { from: P.mari, to: P.santi, amount: 30_000 },
          { from: P.yo, to: P.santi, amount: 30_000 },
          { from: P.santi, to: P.dan, amount: 20_000 },
        ]),
      );
    });
  });

  it('cruzar las deudas es una opción de quien administra', async () => {
    await as(db, U.valeria, async (tx) => {
      const { cuenta } = await paseo(tx);
      await tx.query('select public.set_settle_mode($1, false)', [cuenta]);
      expect((await vista(tx, cuenta)).direct).toBe(false);
      await tx.query(`select public.add_people($1, array['Mafe'], false)`, [cuenta]);
      await tx.exec('reset role');
      const { id: mafe } = await one<{ id: string }>(tx, `select id from public.people where account_id = $1 and display_name = 'Mafe'`, [cuenta]);
      await tx.query(`insert into public.account_members (account_id, user_id, role, person_id) values ($1, $2, 'member', $3)`, [cuenta, U.mafe, mafe]);
      await impersonate(tx, U.mafe);
      await expect(tx.query('select public.set_settle_mode($1, true)', [cuenta])).rejects.toThrow('Solo quienes administran');
    });
  });

  it('los gastos divididos por consumo traen qué pidió cada uno', async () => {
    await as(db, U.valeria, async (tx) => {
      const { cuenta, P, restaurante } = await paseo(tx);
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
      const g = (await vista(tx, cuenta)).expenses.find((e) => e.merchant === 'Le Due Torri');
      expect(g).toMatchObject({ split_method: 'items', tip_cop: 15_000 });
      expect(g?.items?.map((i) => [i.name, Number(i.total), i.people.length])).toEqual([
        ['Coca Cola Zero', 30_000, 2],
        ['Ravioli', 270_000, 0],
      ]);
      expect(Number(g?.items?.[0].people.find((p) => p.id === P.mari)?.units)).toBe(2);
      // Los demás gastos no traen ítems
      expect((await vista(tx, cuenta)).expenses.find((e) => e.merchant === 'Bruna')?.items).toBeNull();
    });
  });

  it('Mister Luks responde con las mismas transferencias', async () => {
    await as(db, U.valeria, async (tx) => {
      const { cuenta } = await paseo(tx);
      await tx.exec('reset role');
      await tx.query(
        `insert into public.whatsapp_groups (connection_id, wa_group_jid, name, chat_kind) values ('c0000000-0000-4000-8000-000000000001', '120363000000000777@g.us', 'Chile', 'grupo')`,
      );
      await tx.query(
        `insert into public.account_group_links (group_id, account_id) select id, $1 from public.whatsapp_groups where wa_group_jid = '120363000000000777@g.us'`,
        [cuenta],
      );
      await tx.exec('set local role service_role');
      const { r } = await one<{ r: { direct: boolean; direct_transfers: { from: string; to: string; amount: number }[] } }>(
        tx,
        `select public.connector_question('120363000000000777@g.us', '573000000000') as r`,
      );
      expect(r.direct).toBe(true);
      // Y quién pagó algo de quién (Valeria solo tuvo parte en lo de Santiago)
      const pagaron = (r as unknown as { paid_for: { from_id: string; to_id: string }[] }).paid_for;
      expect(pagaron.length).toBe(5);
      expect(r.direct_transfers.map((t) => `${t.from}>${t.to}:${t.amount}`).sort()).toEqual(
        ['Mari>Daniel:150000', 'Mari>Santiago:30000', 'Santiago>Daniel:20000', 'Valeria Ríos>Santiago:30000'].sort(),
      );
    });
  });
});
