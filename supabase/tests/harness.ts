import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const ROOT = join(import.meta.dirname, '..');

/** Ids deterministas de seed.sql */
export const U = {
  valeria: '10000000-0000-4000-8000-000000000001',
  juanCamilo: '10000000-0000-4000-8000-000000000002',
  mafe: '10000000-0000-4000-8000-000000000003',
  andres: '10000000-0000-4000-8000-000000000004',
  laura: '10000000-0000-4000-8000-000000000005',
  santi: '10000000-0000-4000-8000-000000000006',
  /** Usuarios sin cuentas que crea createDb (entraron con enlace mágico: sin nombre) */
  nuevo: '10000000-0000-4000-8000-0000000000f1',
  otro: '10000000-0000-4000-8000-0000000000f2',
} as const;

export const CASA = '20000000-0000-4000-8000-000000000001';
export const PASEO = '20000000-0000-4000-8000-000000000002';

export const P = {
  casaValeria: '30000000-0000-4000-8000-000000000001',
  paseoValeria: '30000000-0000-4000-8000-000000000003',
  paseoSanti: '30000000-0000-4000-8000-000000000008',
  caro: '30000000-0000-4000-8000-000000000009',
  felipe: '30000000-0000-4000-8000-00000000000a',
} as const;

export const GASTO_HOSTAL = '60000000-0000-4000-8000-000000000011';
export const GASTO_ASADERO = '60000000-0000-4000-8000-000000000017'; // pendiente
export const GASTO_CASA = '60000000-0000-4000-8000-000000000106';

/**
 * Postgres real (PGlite) con lo mínimo de Supabase, las migraciones en orden
 * y seed.sql. Tarda unos segundos: créalo una vez por archivo de pruebas.
 */
export async function createDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(readFileSync(join(ROOT, 'tests', 'supabase-shim.sql'), 'utf8'));

  const dir = join(ROOT, 'migrations');
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
  }
  await db.exec(readFileSync(join(ROOT, 'seed.sql'), 'utf8'));

  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, 'nuevo@example.com', '{}'), ($2, 'otro@example.com', '{}')`,
    [U.nuevo, U.otro],
  );
  return db;
}

/** Cambia de usuario dentro de una transacción, como hace PostgREST con el JWT. */
export async function impersonate(tx: Transaction, userId: string | null) {
  if (userId === null) {
    await tx.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    await tx.exec('set local role anon');
    return;
  }
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
  await tx.exec('set local role authenticated');
}

/**
 * Corre `fn` como `userId` (null = anónimo) dentro de una transacción que
 * siempre se deshace: cada prueba arranca desde la semilla intacta.
 */
export async function as<T>(db: PGlite, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  let result: T | undefined;
  let failure: unknown;
  let failed = false;
  try {
    await db.transaction(async (tx) => {
      await impersonate(tx, userId);
      try {
        result = await fn(tx);
      } catch (e) {
        failed = true;
        failure = e;
      }
      await tx.rollback();
    });
  } catch (e) {
    if (!failed) throw e;
  }
  if (failed) throw failure;
  return result as T;
}

/** Filas afectadas visibles con RETURNING (0 = RLS la escondió). */
export async function count(tx: Transaction, sql: string, params: unknown[] = []) {
  return (await tx.query(sql, params)).rows.length;
}

export async function one<T = Record<string, unknown>>(tx: Transaction, sql: string, params: unknown[] = []) {
  const { rows } = await tx.query<T>(sql, params);
  return rows[0];
}
