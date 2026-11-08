import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, createDb, one, P, U } from './harness';

// Lo que compró queda guardado y enseña (00000000000780_memoria_de_productos.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

async function categoria(tx: Transaction, nombre: string) {
  await tx.exec('reset role');
  await tx.query(
    `insert into public.categories (account_id, name, letter, tone, is_default)
     select $1, $2, left($2, 1), 'naranja', false where not exists (select 1 from public.categories where account_id = $1 and name = $2)`,
    [CASA, nombre],
  );
  return (await one<{ id: string }>(tx, 'select id from public.categories where account_id = $1 and name = $2', [CASA, nombre])).id;
}

async function homecenter(tx: Transaction, productos: string[], status: 'pending_review' | 'confirmed', cat: string | null) {
  const { id } = await one<{ id: string }>(
    tx,
    `insert into public.expenses (account_id, merchant, expense_date, total_cop, status, source, payer_person_id, category_id, ai_snapshot)
     values ($1, 'Homecenter', current_date, 34400, $2, 'whatsapp', $3, $4, jsonb_build_object('productos', $5::jsonb)) returning id`,
    [CASA, status, P.casaValeria, cat, JSON.stringify(productos)],
  );
  return id;
}

const memoria = async (tx: Transaction) => {
  await tx.exec('set local role service_role');
  const { r } = await one<{ r: { normalized: string; category_id: string; hits: number }[] }>(tx, 'select public.worker_product_memory($1) as r', [CASA]);
  await tx.exec('reset role');
  return r;
};

describe('la memoria de productos', () => {
  it('al confirmar se aprende cada producto en su categoría (sin «bolsa» ni totales); si lo corrigen, se aprende la corrección', async () => {
    await as(db, null, async (tx) => {
      const mascotas = await categoria(tx, 'Mascotas');
      const hogar = await categoria(tx, 'Hogar');
      const id = await homecenter(tx, ['Chunky Adultos 4kg', 'Bolsa reutilizable', 'TOTAL'], 'pending_review', hogar);
      expect(await memoria(tx)).toEqual([]);

      await tx.query(`update public.expenses set status = 'confirmed' where id = $1`, [id]);
      expect(await memoria(tx)).toEqual([{ normalized: 'chunky adultos 4kg', category_id: hogar, hits: 1 }]);

      // Alguien lo corrige a Mascotas: se aprende eso
      await tx.query('update public.expenses set category_id = $2 where id = $1', [id, mascotas]);
      expect(await memoria(tx)).toEqual([{ normalized: 'chunky adultos 4kg', category_id: mascotas, hits: 1 }]);

      // Otra compra confirmada de lo mismo suma
      await homecenter(tx, ['CHUNKY ADULTOS 4KG'], 'confirmed', mascotas);
      expect(await memoria(tx)).toEqual([{ normalized: 'chunky adultos 4kg', category_id: mascotas, hits: 2 }]);
    });
  });

  it('buscar gastos también busca en los productos', async () => {
    await as(db, null, async (tx) => {
      const mascotas = await categoria(tx, 'Mascotas');
      await homecenter(tx, ['Chunky Adultos 4kg'], 'confirmed', mascotas);
      await tx.exec('set local role service_role');
      const { r } = await one<{ r: { seguros: { n: number } } }>(
        tx,
        `select public.connector_buscar_gastos('573001112233@s.whatsapp.net', '573001112233', '573001112233', null, '[["chunky"]]'::jsonb) as r`,
      );
      expect(r.seguros.n).toBe(1);
    });
  });

  it('solo el worker la lee', async () => {
    await as(db, U.valeria, async (tx) => {
      await expect(tx.query('select * from public.product_memory')).rejects.toThrow(/permission denied/);
    });
    await as(db, U.valeria, async (tx) => {
      await expect(tx.query('select public.worker_product_memory($1)', [CASA])).rejects.toThrow(/permission denied/);
    });
  });
});
