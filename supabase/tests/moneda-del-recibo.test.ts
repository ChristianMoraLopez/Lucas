import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, GASTO_ASADERO, impersonate, one, P, PASEO, U } from './harness';

// Recibos en otra moneda (00000000000360_recibos_en_otra_moneda.sql): una boleta
// de Chile en el Paseo, que está en pesos colombianos.

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const { paseoValeria: VALE, paseoSanti: SANTI, caro: CARO, felipe: FELIPE } = P;

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

async function comoWorker(tx: Transaction) {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
}

async function guardar(tx: Transaction, data: Record<string, unknown>) {
  await impersonate(tx, U.santi);
  const { id } = await one<{ id: string }>(tx, `select public.submit_upload($1, 'text', 'almuerzo 3.790 clp') as id`, [PASEO]);
  await comoWorker(tx);
  const { r } = await one<{ r: { expense_id: string } }>(tx, 'select public.worker_save_expense($1, $2) as r', [
    id,
    JSON.stringify({
      merchant: 'Supermercado Lider',
      expense_date: '2026-09-28',
      total_cop: 15_804,
      payer_person_id: SANTI,
      status: 'pending_review',
      items: [
        { name: 'Agua mineral', quantity: 1, unit_price_cop: 5_379, total_cop: 5_379 },
        { name: 'Empanada de pino', quantity: 1, unit_price_cop: 10_425, total_cop: 10_425 },
      ],
      ...data,
    }),
  ]);
  await tx.exec('reset role');
  return r.expense_id;
}

const original = (tx: Transaction, gasto: string) =>
  one(
    tx,
    'select total_cop::int as total, original_currency, original_total::int, fx_rate::text, fx_date::text, fx_source from public.expenses where id = $1',
    [gasto],
  );

const CAMBIAR = 'select public.set_expense_currency($1, $2, $3, $4, $5, $6, $7) as r';
const REVISAR = 'select public.review_expense($1, $2, $3, $4, $5, $6, $7, true)';

const items = async (tx: Transaction, gasto = GASTO_ASADERO) =>
  (
    await tx.query<{ name: string; unit: number; total: number }>(
      'select name, unit_price_cop::int as unit, total_cop::int as total from public.expense_items where expense_id = $1 order by created_at',
      [gasto],
    )
  ).rows;
const partes = async (tx: Transaction, gasto = GASTO_ASADERO) =>
  (
    await tx.query<{ person_id: string; amount: number; fixed: boolean }>(
      'select person_id, amount_cop::int as amount, fixed from public.expense_splits where expense_id = $1 order by amount_cop desc, person_id',
      [gasto],
    )
  ).rows;
const suma = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

describe('el worker guarda el recibo original', () => {
  it('moneda, monto, tasa y de dónde salió; el total queda en la moneda de la cuenta', async () => {
    await as(db, U.santi, async (tx) => {
      const gasto = await guardar(tx, {
        original_currency: 'clp',
        original_total: 3_790,
        fx_rate: '4.17',
        fx_date: '2026-09-28',
        fx_source: 'currency-api',
      });
      expect(await original(tx, gasto)).toEqual({
        total: 15_804,
        original_currency: 'CLP',
        original_total: 3_790,
        fx_rate: '4.17',
        fx_date: '2026-09-28',
        fx_source: 'currency-api',
      });
    });
  });

  it('sin tasa (no respondió): queda la moneda y el monto del recibo, para convertirlo en la app', async () => {
    await as(db, U.santi, async (tx) => {
      const gasto = await guardar(tx, { total_cop: 0, original_currency: 'CLP', original_total: 3_790, fx_rate: null, fx_date: '2026-09-28' });
      expect(await original(tx, gasto)).toMatchObject({ total: 0, original_currency: 'CLP', original_total: 3_790, fx_rate: null, fx_date: null });
      expect(await one(tx, 'select status from public.expenses where id = $1', [gasto])).toEqual({ status: 'pending_review' });
    });
  });

  it('lo que no cuadra se ignora y el gasto igual se guarda', async () => {
    await as(db, U.santi, async (tx) => {
      // Una moneda que no existe, o la misma de la cuenta: nada que guardar
      for (const moneda of ['XYZ', 'COP']) {
        const gasto = await guardar(tx, { original_currency: moneda, original_total: 3_790, fx_rate: '4.17' });
        expect(await original(tx, gasto)).toMatchObject({ original_currency: null, original_total: null, fx_rate: null });
      }
      const raro = await guardar(tx, { original_currency: 'CLP', original_total: -5, fx_rate: 'mucho' });
      expect(await original(tx, raro)).toMatchObject({ original_currency: 'CLP', original_total: null, fx_rate: null });
    });
  });
});

describe('set_expense_currency', () => {
  it('el asadero era en pesos chilenos: el total, los ítems y las partes se convierten juntos', async () => {
    await as(db, U.laura, async (tx) => {
      const antes = await partes(tx);
      // $272.500 CLP × 4,17 = $1.136.325 COP
      const { r } = await one<{ r: unknown }>(tx, CAMBIAR, [GASTO_ASADERO, 'CLP', 272_500, 4.17, '2026-09-28', 1_136_325, 'currency-api']);
      expect(r).toEqual({ total_cop: 1_136_325, currency: 'CLP' });
      expect(await original(tx, GASTO_ASADERO)).toEqual({
        total: 1_136_325,
        original_currency: 'CLP',
        original_total: 272_500,
        fx_rate: '4.17',
        fx_date: '2026-09-28',
        fx_source: 'currency-api',
      });
      expect(await items(tx)).toEqual([
        { name: 'Picada para 8', unit: 750_600, total: 750_600 },
        { name: 'Limonada de coco', unit: 39_615, total: 198_075 },
        { name: 'Patacones', unit: 62_550, total: 187_650 },
      ]);
      // Las mismas personas, y suman justo el total
      const despues = await partes(tx);
      expect(despues.map((x) => x.person_id).sort()).toEqual(antes.map((x) => x.person_id).sort());
      expect(suma(despues)).toBe(1_136_325);
      // Cada parte, la de antes × 4,17 (±1 por el redondeo)
      for (const x of despues) {
        const previa = antes.find((a) => a.person_id === x.person_id)?.amount ?? 0;
        expect(Math.abs(x.amount - previa * 4.17)).toBeLessThanOrEqual(1);
      }
      // Queda como corrección de quien lo cambió
      expect(await one(tx, `select corrected_by = $2 as yo from public.expenses where id = $1`, [GASTO_ASADERO, U.laura])).toEqual({ yo: true });
    });
  });

  it('dividido por consumo: las partes (también lo fijo) siguen sumando y se confirma sin volver a dividir', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.query('select public.split_by_items($1, $2, $3, $4)', [
        GASTO_ASADERO,
        null,
        JSON.stringify([
          { name: 'Picada para 8', total_cop: 180_000, people: [] },
          { name: 'Limonada de coco', quantity: 5, total_cop: 47_500, people: [VALE, CARO] },
          { name: 'Patacones', quantity: 3, total_cop: 45_000, people: [SANTI] },
        ]),
        JSON.stringify([
          { person_id: FELIPE, amount_cop: 100_000, fixed: true },
          { person_id: VALE, amount_cop: 54_500 },
          { person_id: CARO, amount_cop: 54_500 },
          { person_id: SANTI, amount_cop: 63_500 },
        ]),
      ]);
      await tx.query(CAMBIAR, [GASTO_ASADERO, 'CLP', 272_500, 4.17, '2026-09-28', 1_136_325, null]);
      expect(await partes(tx)).toEqual([
        { person_id: FELIPE, amount: 417_000, fixed: true },
        { person_id: SANTI, amount: 264_795, fixed: false },
        { person_id: VALE, amount: 227_265, fixed: false },
        { person_id: CARO, amount: 227_265, fixed: false },
      ]);
      // review_expense con la división por consumo (null) ya no dice «el total cambió»
      await tx.query(REVISAR, [GASTO_ASADERO, 'Asadero El Rodadero', '2026-09-28', 1_136_325, null, FELIPE, null]);
      expect(await one(tx, 'select status, total_cop::int as total, fx_source from public.expenses where id = $1', [GASTO_ASADERO])).toEqual({
        status: 'confirmed',
        total: 1_136_325,
        fx_source: 'manual',
      });
    });
  });

  it('lo que de verdad cobró el banco manda sobre la conversión', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.query(CAMBIAR, [GASTO_ASADERO, 'CLP', 272_500, 4.17, '2026-09-28', 1_150_000, 'currency-api']);
      expect(await original(tx, GASTO_ASADERO)).toMatchObject({ total: 1_150_000, original_total: 272_500, fx_rate: '4.17' });
      expect(suma(await partes(tx))).toBe(1_150_000);
    });
  });

  it('si en realidad era de la cuenta, vuelve y se borra lo del recibo original', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.query(CAMBIAR, [GASTO_ASADERO, 'CLP', 272_500, 4.17, '2026-09-28', 1_136_325, null]);
      // «COP» o null: la moneda de la cuenta
      await tx.query(CAMBIAR, [GASTO_ASADERO, 'COP', null, null, null, 272_500, null]);
      expect(await original(tx, GASTO_ASADERO)).toEqual({
        total: 272_500,
        original_currency: null,
        original_total: null,
        fx_rate: null,
        fx_date: null,
        fx_source: null,
      });
      expect((await items(tx)).map((i) => i.total)).toEqual([180_000, 47_500, 45_000]);
      expect(suma(await partes(tx))).toBe(272_500);
    });
  });

  it('solo quien administra, con datos que tengan sentido y con la cuenta abierta', async () => {
    const args = [GASTO_ASADERO, 'CLP', 272_500, 4.17, '2026-09-28', 1_136_325, null];
    await as(db, U.santi, async (tx) => {
      expect(await falla(tx, CAMBIAR, args)).toMatch('Solo quienes administran la cuenta corrigen gastos');
    });
    await as(db, U.nuevo, async (tx) => {
      expect(await falla(tx, CAMBIAR, args)).toMatch('El gasto no existe');
    });
    await as(db, null, async (tx) => {
      expect(await falla(tx, CAMBIAR, args)).toMatch(/permission denied/);
    });
    await as(db, U.laura, async (tx) => {
      expect(await falla(tx, CAMBIAR, [GASTO_ASADERO, 'XYZ', 272_500, 4.17, '2026-09-28', 1_136_325, null])).toMatch('Esa moneda no está disponible');
      expect(await falla(tx, CAMBIAR, [GASTO_ASADERO, 'CLP', null, 4.17, '2026-09-28', 1_136_325, null])).toMatch('Escribe cuánto dice el recibo');
      expect(await falla(tx, CAMBIAR, [GASTO_ASADERO, 'CLP', 272_500, null, '2026-09-28', 1_136_325, null])).toMatch('Falta la tasa de cambio');
      expect(await falla(tx, CAMBIAR, [GASTO_ASADERO, 'CLP', 272_500, 4.17, '2999-01-01', 1_136_325, null])).toMatch('Revisa la fecha de la tasa');
      expect(await falla(tx, CAMBIAR, [GASTO_ASADERO, 'CLP', 272_500, 4.17, '2026-09-28', 0, null])).toMatch('El total tiene que ser mayor que cero');
      await tx.exec('reset role');
      await tx.query(`update public.accounts set status = 'closed' where id = $1`, [PASEO]);
      await impersonate(tx, U.laura);
      expect(await falla(tx, CAMBIAR, args)).toMatch('La cuenta está cerrada');
    });
  });
});
