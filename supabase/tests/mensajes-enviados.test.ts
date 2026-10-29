import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, one, U } from './harness';

// Lo que mandó Mister Luks, para reenviarlo («Esperando el mensaje») (00000000000560_mensajes_enviados.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

describe('mensajes enviados', () => {
  it('se guarda y se encuentra; lo malo no se guarda', async () => {
    await as(db, null, async (tx) => {
      await tx.exec('reset role');
      await tx.exec('set local role service_role');
      await tx.query(`select public.connector_guardar_enviado('3EB0ABC123', '120363@g.us', 'CgQKAmhv')`);
      await tx.query(`select public.connector_guardar_enviado('mal id!', '120363@g.us', 'CgQKAmhv')`);
      await tx.query(`select public.connector_guardar_enviado('3EB0VACIO1', '120363@g.us', '')`);
      expect(await one(tx, `select public.connector_mensaje_enviado('3EB0ABC123') as m`)).toEqual({ m: 'CgQKAmhv' });
      expect(await one(tx, `select public.connector_mensaje_enviado('NOESTA1234') as m`)).toEqual({ m: null });
      await tx.exec('reset role');
      expect(await one(tx, 'select count(*)::int as n from public.whatsapp_enviados')).toEqual({ n: 1 });
    });
  });

  it('es una rueda: al dar la vuelta, el nuevo ocupa el lugar del más viejo', async () => {
    await as(db, null, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`select setval('public.whatsapp_enviados_turno', 39999)`);
      await tx.exec('set local role service_role');
      await tx.query(`select public.connector_guardar_enviado('VIEJO00001', 'chat', 'AAAA')`); // lugar 0
      await tx.exec('reset role');
      await tx.query(`select setval('public.whatsapp_enviados_turno', 59999)`);
      await tx.exec('set local role service_role');
      await tx.query(`select public.connector_guardar_enviado('NUEVO00001', 'chat', 'BBBB')`); // lugar 0 otra vez
      expect(await one(tx, `select public.connector_mensaje_enviado('VIEJO00001') as m`)).toEqual({ m: null });
      expect(await one(tx, `select public.connector_mensaje_enviado('NUEVO00001') as m`)).toEqual({ m: 'BBBB' });
    });
  });

  it('solo el connector', async () => {
    await as(db, U.laura, async (tx) => {
      await expect(tx.query(`select public.connector_mensaje_enviado('3EB0ABC123')`)).rejects.toThrow(/permission denied/);
    });
    await as(db, U.laura, async (tx) => {
      await expect(tx.query('select * from public.whatsapp_enviados')).rejects.toThrow(/permission denied/);
    });
  });
});
