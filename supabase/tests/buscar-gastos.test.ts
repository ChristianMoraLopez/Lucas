import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, createDb, one, P, PASEO, U } from './harness';

// «¿Cuándo fue la última vez que compré comida para el perro?» (00000000000760_buscar_gastos.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const VALERIA_WA = '573001112233';
const GRUPO_CASA = '120363040987654321@g.us';

type Gasto = { fecha: string; comercio: string; total: number; categoria: string | null; cuenta: string };
type Busqueda = {
  ok: boolean;
  seguros: { n: number; total: number; gastos: Gasto[] };
  quizas: { n: number; gastos: Gasto[] };
};

const PERRO = ['perr', 'dog', 'canin', 'concentrad', 'chunky', 'pedigree', 'purina'];
const COMIDA = ['comid', 'food', 'aliment', 'concentrad', 'cuido'];

async function gasto(tx: Transaction, cuenta: string, comercio: string, fecha: string, total: number, categoria: string | null, descripcion: string | null) {
  const { id } = await one<{ id: string }>(
    tx,
    `insert into public.expenses (account_id, merchant, description, expense_date, total_cop, status, source, payer_person_id, category_id)
     values ($1, $2, $3, $4, $5, 'confirmed', 'web', $6,
             (select id from public.categories where account_id = $1 and name = $7))
     returning id`,
    [cuenta, comercio, descripcion, fecha, total, cuenta === CASA ? P.casaValeria : P.paseoValeria, categoria],
  );
  return id;
}

async function buscar(tx: Transaction, jid: string, grupos: string[][], categorias: string[] = [], basta = false) {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
  const { r } = await one<{ r: Busqueda }>(tx, 'select public.connector_buscar_gastos($1, $2, $2, null, $3, $4, $5) as r', [
    jid,
    VALERIA_WA,
    JSON.stringify(grupos),
    categorias,
    basta,
  ]);
  await tx.exec('reset role');
  return r;
}

async function conMascotas(tx: Transaction) {
  await tx.exec('reset role');
  await tx.query(
    `insert into public.categories (account_id, name, letter, tone, is_default)
     select $1, 'Mascotas', 'M', 'naranja', true where not exists (select 1 from public.categories where account_id = $1 and name = 'Mascotas')`,
    [CASA],
  );
  await gasto(tx, CASA, 'Homecenter', '2026-09-29', 116_100, 'Mascotas', 'Purchase at Homecenter');
  await gasto(tx, CASA, 'Homecenter', '2026-11-07', 32_900, 'Mascotas', 'Purchase of dry food Chunky');
  await gasto(tx, CASA, 'Tienda de Doña Rosa', '2026-10-15', 45_000, null, 'Comida para el perro y arroz');
  await gasto(tx, PASEO, 'Asadero', '2026-09-25', 80_000, null, 'Comida del paseo');
}

describe('buscar gastos por privado', () => {
  it('comida para perro: los que lo dicen, el más reciente primero; el Homecenter en Mascotas que no dice qué fue, aparte', async () => {
    await as(db, null, async (tx) => {
      await conMascotas(tx);
      const r = await buscar(tx, `${VALERIA_WA}@s.whatsapp.net`, [COMIDA, PERRO], ['Mascotas']);
      expect(r.ok).toBe(true);
      expect(r.seguros.gastos.map((g) => [g.fecha, g.comercio, g.total])).toEqual([
        ['2026-11-07', 'Homecenter', 32_900],
        ['2026-10-15', 'Tienda de Doña Rosa', 45_000],
      ]);
      expect(r.seguros).toMatchObject({ n: 2, total: 77_900 });
      expect(r.quizas.gastos.map((g) => [g.fecha, g.comercio, g.categoria])).toEqual([['2026-09-29', 'Homecenter', 'Mascotas']]);
    });
  });

  it('«¿qué días gasté en mascotas?»: estar en la categoría basta', async () => {
    await as(db, null, async (tx) => {
      await conMascotas(tx);
      const r = await buscar(tx, `${VALERIA_WA}@s.whatsapp.net`, [['mascot', ...PERRO]], ['Mascotas'], true);
      expect(r.seguros.gastos.map((g) => g.fecha)).toEqual(['2026-11-07', '2026-10-15', '2026-09-29']);
      expect(r.quizas.n).toBe(0);
    });
  });

  it('busca en todas sus cuentas (el paseo también), y nada de cuentas ajenas', async () => {
    await as(db, null, async (tx) => {
      await conMascotas(tx);
      const r = await buscar(tx, `${VALERIA_WA}@s.whatsapp.net`, [COMIDA]);
      expect(r.seguros.gastos.map((g) => g.cuenta)).toContain('Paseo Santa Marta');
      // Alguien que no está en ninguna cuenta no encuentra nada
      await tx.exec('set local role service_role');
      const { r: otro } = await one<{ r: Busqueda }>(
        tx,
        `select public.connector_buscar_gastos('573159990000@s.whatsapp.net', '573159990000', '573159990000', null, $1) as r`,
        [JSON.stringify([COMIDA])],
      );
      expect(otro.seguros.n).toBe(0);
    });
  });
});

describe('buscar gastos en un grupo', () => {
  it('solo en la cuenta del grupo', async () => {
    await as(db, null, async (tx) => {
      await conMascotas(tx);
      const r = await buscar(tx, GRUPO_CASA, [COMIDA]);
      expect(r.seguros.gastos.map((g) => g.cuenta)).not.toContain('Paseo Santa Marta');
      expect(r.seguros.gastos.map((g) => g.comercio)).toContain('Homecenter');
    });
  });

  it('solo el connector', async () => {
    await as(db, U.valeria, async (tx) => {
      await expect(tx.query(`select public.connector_buscar_gastos('x', 'x', null, null, '[]'::jsonb)`)).rejects.toThrow(/permission denied/);
    });
  });
});
