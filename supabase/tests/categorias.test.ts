import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, createDb, GASTO_CASA, impersonate, one, U } from './harness';

// Categorías propias (00000000000090_categorias_propias.sql)

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

async function crear(tx: Transaction, nombre: string, descripcion: string | null = null) {
  const { id } = await one<{ id: string }>(tx, 'select public.create_category($1, $2, $3) as id', [CASA, nombre, descripcion]);
  return id;
}

describe('categorías de siempre', () => {
  it('ya vienen con su descripción, también en cuentas nuevas', async () => {
    await as(db, U.nuevo, async (tx) => {
      const { id: cuenta } = await one<{ id: string }>(tx, `select public.create_account('Mi casa', 'hogar') as id`);
      const { rows } = await tx.query<{ name: string; description: string }>(
        'select c.name, c.description from public.categories c where c.account_id = $1 order by c.name',
        [cuenta],
      );
      expect(rows).toHaveLength(8);
      expect(rows.every((r) => r.description?.length > 10)).toBe(true);
      expect(rows.find((r) => r.name === 'Transporte')?.description).toContain('peajes');
    });
    await as(db, U.valeria, async (tx) => {
      const c = await one<{ description: string }>(tx, `select description from public.categories where account_id = $1 and name = 'Mercado'`, [CASA]);
      expect(c.description).toContain('supermercados');
    });
  });
});

describe('crear una categoría', () => {
  it('un admin crea «Salud» con su descripción, letra y el color menos usado', async () => {
    await as(db, U.andres, async (tx) => {
      const id = await crear(tx, '  Salud ', 'droguería, citas médicas, exámenes, EPS');
      const c = await one<{ name: string; letter: string; tone: string; description: string; is_default: boolean }>(
        tx,
        'select name, letter, tone, description, is_default from public.categories where id = $1',
        [id],
      );
      expect(c).toMatchObject({ name: 'Salud', letter: 'S', description: 'droguería, citas médicas, exámenes, EPS', is_default: false });
      // Las 8 de siempre usan los 8 tonos una vez: el siguiente es el primero de la lista
      expect(c.tone).toBe('morado');
    });
  });

  it('un miembro no; nombres repetidos ni muy cortos tampoco', async () => {
    await as(db, U.laura, async (tx) => {
      expect(await falla(tx, 'select public.create_category($1, $2)', [CASA, 'Salud'])).toMatch('Solo quienes administran');
    });
    await as(db, U.valeria, async (tx) => {
      expect(await falla(tx, 'select public.create_category($1, $2)', [CASA, 'mercado'])).toMatch('Ya hay una categoría');
      expect(await falla(tx, 'select public.create_category($1, $2)', [CASA, 'S'])).toMatch('de 2 a 30 letras');
    });
  });
});

describe('editar y borrar', () => {
  it('las propias se renombran; las de siempre solo cambian su descripción', async () => {
    await as(db, U.valeria, async (tx) => {
      const id = await crear(tx, 'Mascotas');
      await tx.query('select public.update_category($1, $2, $3)', [id, 'Perro', 'concentrado, veterinaria, guardería']);
      const c = await one<{ name: string; letter: string; description: string }>(tx, 'select name, letter, description from public.categories where id = $1', [
        id,
      ]);
      expect(c).toEqual({ name: 'Perro', letter: 'P', description: 'concentrado, veterinaria, guardería' });

      const mercado = await one<{ id: string }>(tx, `select id from public.categories where account_id = $1 and name = 'Mercado'`, [CASA]);
      expect(await falla(tx, 'select public.update_category($1, $2)', [mercado.id, 'Súper'])).toMatch('no se renombran');
      await tx.query('select public.update_category($1, null, $2)', [mercado.id, 'supermercados y plaza de mercado']);
      const m = await one<{ description: string }>(tx, 'select description from public.categories where id = $1', [mercado.id]);
      expect(m.description).toBe('supermercados y plaza de mercado');
    });
  });

  it('al borrar una propia, sus gastos pasan a «Otros»', async () => {
    await as(db, U.valeria, async (tx) => {
      const id = await crear(tx, 'Salud');
      await tx.exec('reset role');
      await tx.query('update public.expenses set category_id = $1 where id = $2', [id, GASTO_CASA]);
      await impersonate(tx, U.valeria);
      const { n } = await one<{ n: number }>(tx, 'select public.delete_category($1) as n', [id]);
      expect(n).toBe(1);
      const e = await one<{ name: string }>(tx, 'select c.name from public.expenses e join public.categories c on c.id = e.category_id where e.id = $1', [
        GASTO_CASA,
      ]);
      expect(e.name).toBe('Otros');

      const otros = await one<{ id: string }>(tx, `select id from public.categories where account_id = $1 and name = 'Otros'`, [CASA]);
      expect(await falla(tx, 'select public.delete_category($1)', [otros.id])).toMatch('no se borran');
    });
  });
});

describe('el worker las ve', () => {
  it('con su descripción al clasificar y en la exportación de entrenamiento', async () => {
    await as(db, U.valeria, async (tx) => {
      const id = await crear(tx, 'Salud', 'droguería, citas médicas');
      await tx.exec('reset role');
      const { mensaje } = await one<{ mensaje: string }>(tx, 'select message_id as mensaje from public.expenses where id = $1', [GASTO_CASA]);
      await tx.query(
        `insert into public.training_examples (account_id, expense_id, merchant_text, raw_text, category_id, source) values ($1, $2, 'Droguería Alemana', 'acetaminofén', $3, 'correction')`,
        [CASA, GASTO_CASA, id],
      );
      await tx.exec('set local role service_role');

      if (mensaje) {
        const { r } = await one<{ r: { categories: { name: string; description: string | null; is_default: boolean }[] } }>(
          tx,
          'select public.worker_message_context($1) as r',
          [mensaje],
        );
        expect(r.categories).toContainEqual({ id, name: 'Salud', description: 'droguería, citas médicas', is_default: false });
      }

      const { r: ejemplos } = await one<{ r: { category: string; account_categories: { name: string; description: string }[] }[] }>(
        tx,
        'select public.worker_training_export() as r',
      );
      const ej = ejemplos.find((e) => e.category === 'Salud');
      expect(ej?.account_categories).toEqual([{ name: 'Salud', description: 'droguería, citas médicas' }]);
    });
  });
});
