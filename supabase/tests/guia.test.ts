import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, U } from './harness';

// La guía paso a paso: cuáles ya vio cada quien (00000000000220_guia.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

describe('guía', () => {
  it('quien llega no ha visto ninguna; marcarla la agrega una sola vez', async () => {
    await as(db, U.nuevo, async (tx) => {
      expect((await one<{ guias_vistas: string[] }>(tx, 'select guias_vistas from public.profiles where id = $1', [U.nuevo])).guias_vistas).toEqual([]);
      expect((await one<{ r: string[] }>(tx, `select public.marcar_guia('inicio') as r`)).r).toEqual(['inicio']);
      expect((await one<{ r: string[] }>(tx, `select public.marcar_guia('inicio') as r`)).r).toEqual(['inicio']);
      expect((await one<{ r: string[] }>(tx, `select public.marcar_guia('cuenta') as r`)).r).toEqual(['cuenta', 'inicio']);
    });
  });

  it('solo las guías que existen, y solo las propias', async () => {
    await as(db, U.otro, async (tx) => {
      await tx.exec('savepoint a');
      await expect(tx.query(`select public.marcar_guia('otra')`)).rejects.toThrow('Esa guía no existe');
      await tx.exec('rollback to savepoint a');
      await impersonate(tx, U.otro);
      // Directo por la API no se cambia (solo con marcar_guia)
      await expect(tx.query(`update public.profiles set guias_vistas = '{inicio}' where id = $1`, [U.otro])).rejects.toThrow(/permission denied/);
    });
  });

  it('«Ver las guías otra vez» las vuelve a mostrar, solo a quien lo pide', async () => {
    await as(db, U.mafe, async (tx) => {
      await tx.query(`select public.marcar_guia('inicio')`);
      await tx.query(`select public.marcar_guia('cuenta')`);
      await impersonate(tx, U.santi);
      await tx.query(`select public.marcar_guia('inicio')`);
      await impersonate(tx, U.mafe);
      await tx.query('select public.reiniciar_guias()');
      const vistas = async (u: string) => (await one<{ g: string[] }>(tx, 'select guias_vistas as g from public.profiles where id = $1', [u])).g;
      expect(await vistas(U.mafe)).toEqual([]);
      expect(await vistas(U.santi)).toEqual(['inicio']);
    });
  });
});
