import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, one, P, PASEO, U } from './harness';

// ¿Quién pidió qué? por WhatsApp (00000000000440_quien_pidio_que.sql)

// El cálculo de la app, para comparar (se carga al correr la prueba)
const WEB = new URL('../../apps/web/lib/consumo.ts', import.meta.url).href;
const { dividirPorConsumo } = (await import(WEB)) as {
  dividirPorConsumo: (a: { total: number; personas: string[]; items: { total: number; people: string[]; units?: Record<string, number> }[] }) => {
    partes: Record<string, number>;
  };
};

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const GRUPO = '120363040123456789@g.us';
const GRUPO_ID = 'd0000000-0000-4000-8000-000000000001';
const { paseoValeria: VALE, paseoSanti: SANTI, caro: CARO, felipe: FELIPE } = P;
const SANTI_WA = '573128880365';
const CARO_WA = '573002224471';

async function servicio<T>(tx: Transaction, sql: string, params: unknown[] = []) {
  await tx.exec('set local role service_role');
  const { r } = await one<{ r: T }>(tx, sql, params);
  await tx.exec('reset role');
  return r;
}

/** La cuenta del restaurante llega por WhatsApp: $300.000 en ítems + $30.000 de servicio, igual entre cuatro */
async function llegaLaCuenta(
  tx: Transaction,
  items: [string, number, number][] = [
    ['Coca Cola', 3, 30_000],
    ['Pasta', 1, 150_000],
    ['Pizza', 1, 120_000],
  ],
) {
  await tx.exec('reset role');
  const { id: msg } = await one<{ id: string }>(
    tx,
    `insert into public.messages (account_id, group_id, wa_message_id, kind, text_body) values ($1, $2, $3, 'photo', null) returning id`,
    [PASEO, GRUPO_ID, `W${Math.random().toString(36).slice(2)}`],
  );
  const total = items.reduce((s, [, , t]) => s + t, 0) + 30_000;
  const { id } = await one<{ id: string }>(
    tx,
    `insert into public.expenses (account_id, merchant, total_cop, payer_person_id, status, source, message_id)
     values ($1, 'Le Due Torri', $2, $3, 'confirmed', 'whatsapp', $4) returning id`,
    [PASEO, total, FELIPE, msg],
  );
  for (const [k, [name, q, t]] of items.entries()) {
    await tx.query(
      `insert into public.expense_items (expense_id, name, quantity, unit_price_cop, total_cop, created_at) values ($1, $2, $3, $4, $5, now() + $6 * interval '1 millisecond')`,
      [id, name, q, Math.round(t / q), t, k],
    );
  }
  for (const [k, p] of [VALE, SANTI, CARO, FELIPE].entries()) {
    const parte = Math.floor(total / 4) + (k < total % 4 ? 1 : 0);
    await tx.query('insert into public.expense_splits (expense_id, person_id, amount_cop) values ($1, $2, $3)', [id, p, parte]);
  }
  return { id, total };
}

interface Pregunta {
  expense_id: string;
  group_jid: string;
  merchant: string;
  total: number;
  payer_name: string;
  account: { id: string };
  items: { id: string; name: string; quantity: number; total: number }[];
}

/** Lo que haría el connector: la lista a la bandeja de salida, y «mandada» con su id de WhatsApp */
async function preguntar(tx: Transaction, p: Pregunta, waId = 'WA-LISTA') {
  await tx.query(`insert into public.whatsapp_outbox (chat_jid, reason, body, dedupe_key) values ($1, 'answer', 'la lista', $2)`, [
    GRUPO,
    `items:${p.expense_id}`,
  ]);
  await servicio(tx, 'select public.connector_item_prompt_guardado($1, $2, $3, $4) as r', [
    p.expense_id,
    p.items.map((i) => i.id),
    GRUPO,
    `items:${p.expense_id}`,
  ]);
  await tx.query('update public.whatsapp_outbox set sent_at = now(), wa_message_id = $2 where dedupe_key = $1', [`items:${p.expense_id}`, waId]);
}

const responder = (tx: Transaction, wa: string, claims: { n: number; units?: number }[], quoted = 'WA-LISTA') =>
  servicio<Record<string, unknown>>(tx, 'select public.connector_items_respuesta($1, $2, $3, $3, null, null, $4) as r', [
    GRUPO,
    quoted,
    wa,
    JSON.stringify(claims),
  ]);

const partes = async (tx: Transaction, gasto: string) =>
  Object.fromEntries(
    (
      await tx.query<{ person_id: string; amount: number }>('select person_id, amount_cop::int as amount from public.expense_splits where expense_id = $1', [
        gasto,
      ])
    ).rows.map((r) => [r.person_id, r.amount]),
  );

describe('¿quién pidió qué?', () => {
  it('la cuenta recién llegada se pregunta una vez, con los ítems en orden', async () => {
    await as(db, null, async (tx) => {
      const { id, total } = await llegaLaCuenta(tx);
      const r = await servicio<Pregunta[]>(tx, 'select public.connector_items_por_preguntar() as r');
      const p = r.find((x) => x.expense_id === id) as Pregunta;
      expect(p).toMatchObject({ group_jid: GRUPO, merchant: 'Le Due Torri', total, account: { id: PASEO } });
      expect(p.items.map((i) => i.name)).toEqual(['Coca Cola', 'Pasta', 'Pizza']);
      await preguntar(tx, p);
      expect((await servicio<Pregunta[]>(tx, 'select public.connector_items_por_preguntar() as r')).some((x) => x.expense_id === id)).toBe(false);
    });
  });

  it('cada uno responde con lo suyo y queda dividida por consumo (el servicio, según lo que consumió cada uno)', async () => {
    await as(db, null, async (tx) => {
      const { id } = await llegaLaCuenta(tx);
      const p = (await servicio<Pregunta[]>(tx, 'select public.connector_items_por_preguntar() as r')).find((x) => x.expense_id === id) as Pregunta;
      await preguntar(tx, p);

      // Santi: 2 de las 3 Coca Colas y la pizza; Caro: la otra Coca Cola y la pasta
      const santi = await responder(tx, SANTI_WA, [{ n: 1, units: 2 }, { n: 3 }]);
      expect(santi).toMatchObject({ ok: true, name: 'Santi', merchant: 'Le Due Torri', sin_nadie: 1 });
      // Con lo suyo de cada ítem en plata (la 500): por ahora es el único que pidió de los dos
      expect(santi.mios).toEqual([
        { n: 1, name: 'Coca Cola', quantity: 3, units: 2, amount: 30_000 },
        { n: 3, name: 'Pizza', quantity: 1, units: 1, amount: 120_000 },
      ]);
      const caro = await responder(tx, CARO_WA, [{ n: 1, units: 1 }, { n: 2 }]);
      expect(caro).toMatchObject({ ok: true, sin_nadie: 0 });

      // Santi consumió 140.000 y Caro 160.000 de 300.000: con el servicio, 154.000 y 176.000
      expect(await partes(tx, id)).toEqual({ [SANTI]: 154_000, [CARO]: 176_000, [VALE]: 0, [FELIPE]: 0 });
      expect(await one(tx, 'select split_method::text as m from public.expenses where id = $1', [id])).toEqual({ m: 'items' });

      // Responder otra vez cambia las unidades
      await responder(tx, SANTI_WA, [{ n: 1, units: 1 }]);
      const ahora = await partes(tx, id);
      expect(Object.values(ahora).reduce((s, v) => s + v, 0)).toBe(330_000);
      expect(ahora[SANTI]).toBe(148_500);
    });
  });

  it('la respuesta trae lo de cada ítem en plata, la fecha y su chat privado si ya le escribió (la 500)', async () => {
    await as(db, null, async (tx) => {
      const { id } = await llegaLaCuenta(tx);
      const p = (await servicio<Pregunta[]>(tx, 'select public.connector_items_por_preguntar() as r')).find((x) => x.expense_id === id) as Pregunta;
      await preguntar(tx, p);
      const santi = await responder(tx, SANTI_WA, [{ n: 1, units: 2 }, { n: 3 }]);
      expect(santi).toMatchObject({ ok: true, expense_id: id, account_id: PASEO, account_name: 'Paseo Santa Marta', total: 330_000, privado: null });
      expect((santi.mios as { name: string; amount: number }[]).map((i) => [i.name, Number(i.amount)])).toEqual([
        ['Coca Cola', 30_000],
        ['Pizza', 120_000],
      ]);
      // Con su chat privado abierto con Mister Luks, se lo dice
      await tx.exec('reset role');
      const { conn } = await one<{ conn: string }>(tx, `select id as conn from public.whatsapp_connections where kind = 'contador' limit 1`);
      await servicio(tx, 'select public.connector_private_chat($1, $2) as r', [conn, `${SANTI_WA}@s.whatsapp.net`]);
      const otra = await responder(tx, SANTI_WA, [{ n: 1, units: 2 }]);
      expect(otra.privado).toBe(`${SANTI_WA}@s.whatsapp.net`);
    });
  });

  it('«la 1 son 3»: cambia la cantidad del ítem, no el total', async () => {
    await as(db, null, async (tx) => {
      const { id } = await llegaLaCuenta(tx, [
        ['Limonada', 1, 17_100],
        ['Pasta', 1, 150_000],
      ]);
      const p = (await servicio<Pregunta[]>(tx, 'select public.connector_items_por_preguntar() as r')).find((x) => x.expense_id === id) as Pregunta;
      await preguntar(tx, p);
      const r = await servicio<Record<string, unknown>>(tx, 'select public.connector_items_cantidad($1, $2, $3, $3, null, null, 1, 3) as r', [
        GRUPO,
        'WA-LISTA',
        SANTI_WA,
      ]);
      expect(r).toMatchObject({ ok: true, n: 1, item: 'Limonada', total: 17_100 });
      expect(Number(r.quantity)).toBe(3);
      expect(
        await one(
          tx,
          `select quantity::int as q, unit_price_cop::int as u, total_cop::int as t from public.expense_items where expense_id = $1 and name = 'Limonada'`,
          [id],
        ),
      ).toEqual({
        q: 3,
        u: 5_700,
        t: 17_100,
      });
      expect(await servicio(tx, 'select public.connector_items_cantidad($1, $2, $3, $3, null, null, 9, 3) as r', [GRUPO, 'WA-LISTA', SANTI_WA])).toMatchObject({
        ok: false,
        reason: 'no_existe',
      });
      expect(await servicio(tx, 'select public.connector_items_cantidad($1, $2, $3, $3, null, null, 1, 3) as r', [GRUPO, 'OTRA', SANTI_WA])).toEqual({
        ok: false,
        reason: 'no_es_pregunta',
      });
    });
  });

  it('el worker sabe la moneda de los recibos de estos días del viaje (la 500)', async () => {
    await as(db, null, async (tx) => {
      const { id } = await llegaLaCuenta(tx);
      await tx.query(`update public.expenses set original_currency = 'CLP', original_total = 100000, fx_rate = 3.24 where id = $1`, [id]);
      const { message_id } = await one<{ message_id: string }>(tx, 'select message_id from public.expenses where id = $1', [id]);
      const ctx = await servicio<{ account: { moneda_del_viaje: string | null } }>(tx, 'select public.worker_message_context($1) as r', [message_id]);
      expect(ctx.account.moneda_del_viaje).toBe('CLP');
    });
  });

  it('lo que no es la lista, un número fuera de la lista o alguien que no está en la cuenta', async () => {
    await as(db, null, async (tx) => {
      const { id } = await llegaLaCuenta(tx);
      const p = (await servicio<Pregunta[]>(tx, 'select public.connector_items_por_preguntar() as r')).find((x) => x.expense_id === id) as Pregunta;
      await preguntar(tx, p);
      expect(await responder(tx, SANTI_WA, [{ n: 1 }], 'OTRO-MENSAJE')).toEqual({ ok: false, reason: 'no_es_pregunta' });
      expect(await responder(tx, SANTI_WA, [{ n: 9 }])).toMatchObject({ ok: false, reason: 'no_existe', total_items: 3 });
      expect(await responder(tx, '573009990000', [{ n: 1 }])).toMatchObject({ ok: false, reason: 'no_te_conozco' });
    });
  });

  it('da lo mismo que Dividir en la app', async () => {
    await as(db, null, async (tx) => {
      await tx.exec('reset role');
      const gente = [VALE, SANTI, CARO, FELIPE];
      const orden = (await tx.query<{ id: string }>('select id from public.people where id = any($1) order by created_at, id', [gente])).rows.map((r) => r.id);
      for (let semilla = 1; semilla <= 12; semilla++) {
        let x = semilla;
        const azar = () => {
          x = (x * 1_103_515_245 + 12_345) % 2 ** 31;
          return x / 2 ** 31;
        };
        const items = Array.from(
          { length: 2 + (semilla % 5) },
          (_, k) => [`Ítem ${k}`, 1 + Math.floor(azar() * 3), 1_000 + Math.round(azar() * 90_000)] as [string, number, number],
        );
        const { id, total } = await llegaLaCuenta(tx, items);
        const ids = (await tx.query<{ id: string }>('select id from public.expense_items where expense_id = $1 order by created_at, id', [id])).rows.map(
          (r) => r.id,
        );
        const marcas = ids.map(() => orden.filter(() => azar() > 0.6).map((p) => ({ p, u: 1 + Math.floor(azar() * 3) })));
        for (const [k, item] of ids.entries()) {
          for (const { p, u } of marcas[k])
            await tx.query('insert into public.expense_item_people (item_id, person_id, units) values ($1, $2, $3)', [item, p, u]);
        }
        await tx.query('select public.repartir_por_consumo($1)', [id]);
        const web = dividirPorConsumo({
          total,
          personas: orden,
          items: items.map(([, , t], k) => ({ total: t, people: marcas[k].map((m) => m.p), units: Object.fromEntries(marcas[k].map((m) => [m.p, m.u])) })),
        });
        expect(await partes(tx, id)).toEqual(web.partes);
      }
    });
  });

  it('solo el connector', async () => {
    await as(db, U.laura, async (tx) => {
      await expect(tx.query('select public.connector_items_por_preguntar()')).rejects.toThrow(/permission denied/);
    });
    await as(db, U.laura, async (tx) => {
      await expect(tx.query(`select public.connector_items_respuesta('a', 'b', 'c', null, null, null, '[]')`)).rejects.toThrow(/permission denied/);
    });
    await as(db, U.laura, async (tx) => {
      await expect(tx.query(`select public.repartir_por_consumo('${PASEO}')`)).rejects.toThrow(/permission denied/);
    });
  });
});
