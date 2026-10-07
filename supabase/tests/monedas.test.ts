import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, createDb, one, PASEO, U } from './harness';

// Migración 250: la moneda y el idioma de cada cuenta.

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

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

const ajustes = (tx: Transaction, cuenta: string, moneda: string | null, idioma: string | null = null) =>
  tx.query('select public.set_account_settings($1, $2, $3)', [cuenta, moneda, idioma]);

describe('moneda e idioma de la cuenta', () => {
  it('las de siempre quedan en pesos colombianos y en español', async () => {
    await as(db, U.valeria, async (tx) => {
      expect(await one(tx, 'select currency, language from public.accounts where id = $1', [CASA])).toEqual({ currency: 'COP', language: 'es' });
    });
  });

  it('una cuenta nueva elige su moneda y su idioma antes del primer gasto', async () => {
    await as(db, U.valeria, async (tx) => {
      const { id } = await one<{ id: string }>(tx, `select public.create_account('Viaje a Miami', 'evento') as id`);
      await ajustes(tx, id, 'USD', 'en');
      expect(await one(tx, 'select currency, language from public.accounts where id = $1', [id])).toEqual({ currency: 'USD', language: 'en' });
      // Solo el idioma: la moneda queda igual
      await ajustes(tx, id, null, 'es');
      expect(await one(tx, 'select currency, language from public.accounts where id = $1', [id])).toEqual({ currency: 'USD', language: 'es' });
      expect(await falla(tx, 'select public.set_account_settings($1, $2)', [id, 'EUR'])).toMatch('Esa moneda no está disponible');
      expect(await falla(tx, 'select public.set_account_settings($1, null, $2)', [id, 'fr'])).toMatch('Ese idioma no está disponible');
    });
  });

  it('con gastos la moneda ya no cambia (los montos están en otra unidad), el idioma sí', async () => {
    await as(db, U.valeria, async (tx) => {
      expect(await falla(tx, 'select public.set_account_settings($1, $2)', [PASEO, 'CLP'])).toMatch('La moneda se elige antes del primer gasto');
      await ajustes(tx, PASEO, 'COP', 'en');
      expect(await one(tx, 'select language from public.accounts where id = $1', [PASEO])).toEqual({ language: 'en' });
    });
  });

  it('solo quienes administran la cuenta', async () => {
    await as(db, U.mafe, async (tx) => {
      expect(await falla(tx, 'select public.set_account_settings($1, null, $2)', [PASEO, 'en'])).toMatch('Solo quienes administran la cuenta cambian esto');
    });
    await as(db, null, async (tx) => {
      expect(await falla(tx, 'select public.set_account_settings($1, null, $2)', [PASEO, 'en'])).toMatch(/permission denied|Debes iniciar sesión/);
    });
  });

  it('el link público y el worker saben la moneda', async () => {
    await as(db, U.valeria, async (tx) => {
      const { token } = await one<{ token: string }>(tx, 'select public.create_share_link($1) as token', [PASEO]);
      const { r } = await one<{ r: { currency: string; language: string; total: number } }>(tx, 'select public.shared_overview($1) as r', [token]);
      expect(r.currency).toBe('COP');
      expect(r.language).toBe('es');
      await tx.exec('reset role');
      await tx.exec('set local role service_role');
      const { id } = await one<{ id: string }>(tx, `select id from public.messages where account_id = $1 limit 1`, [PASEO]);
      const { c } = await one<{ c: { account: { currency: string; language: string } } }>(tx, 'select public.worker_message_context($1) as c', [id]);
      expect(c.account).toMatchObject({ currency: 'COP', language: 'es' });
    });
  });
});
