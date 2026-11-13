import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, count, createDb, impersonate, one, PASEO, U } from './harness';

// Lo que entra: ingresos en la app y por WhatsApp (00000000000810_ingresos.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const GRUPO_PASEO = '120363040123456789@g.us';

interface Registro {
  ok: boolean;
  reason?: string;
  nuevo?: boolean;
  id?: string;
  account?: { id: string; name: string; currency: string };
  entro_mes?: number;
  salio_mes?: number;
}

async function registrar(tx: Transaction, jid: string, msg: string, wa: string | null, monto: number, descripcion: string | null = null) {
  await tx.exec('set local role service_role');
  const { r } = await one<{ r: Registro }>(tx, 'select public.connector_registrar_ingreso($1, $2, $3, $3, null, $4, $5, null) as r', [
    jid,
    msg,
    wa,
    monto,
    descripcion,
  ]);
  await tx.exec('reset role');
  return r;
}

/** Alguien del Paseo con su número de WhatsApp */
const alguien = async (tx: Transaction) => {
  await tx.exec('reset role');
  return one<{ person_id: string; wa_id: string }>(
    tx,
    `select w.person_id, w.wa_id from public.person_whatsapp_ids w join public.people p on p.id = w.person_id
     where p.account_id = $1 and w.wa_id ~ '^[0-9]+$' order by w.wa_id limit 1`,
    [PASEO],
  );
};

describe('ingresos', () => {
  it('«entraron 200 lucas» en el grupo queda en la cuenta, de quien lo escribió, una sola vez', async () => {
    await as(db, null, async (tx) => {
      const { person_id, wa_id } = await alguien(tx);
      const r = await registrar(tx, GRUPO_PASEO, 'WAMSG-1', wa_id, 200_000, 'quincena');
      expect(r).toMatchObject({ ok: true, nuevo: true, account: { id: PASEO } });
      expect(r.entro_mes).toBe(200_000);
      const fila = await one<{ person_id: string; amount_cop: string; source: string; description: string }>(
        tx,
        'select person_id, amount_cop, source, description from public.incomes where id = $1',
        [r.id],
      );
      expect(fila).toMatchObject({ person_id, source: 'whatsapp', description: 'quincena' });
      expect(Number(fila.amount_cop)).toBe(200_000);

      // El mismo mensaje otra vez (WhatsApp lo reenvía): no se anota dos veces
      const otra = await registrar(tx, GRUPO_PASEO, 'WAMSG-1', wa_id, 200_000, 'quincena');
      expect(otra).toMatchObject({ ok: true, nuevo: false, id: r.id });
      expect(await count(tx, 'select 1 from public.incomes where account_id = $1', [PASEO])).toBe(1);
    });
  });

  it('sin grupo conectado o sin monto no anota nada', async () => {
    await as(db, null, async (tx) => {
      expect(await registrar(tx, '120363099999999999@g.us', 'WAMSG-2', '573001234567', 50_000)).toMatchObject({ ok: false, reason: 'sin_cuenta' });
      expect(await registrar(tx, GRUPO_PASEO, 'WAMSG-3', '573001234567', 0)).toMatchObject({ ok: false, reason: 'monto' });
    });
  });

  it('en la app: lo anota y lo ve cualquiera de la cuenta; nadie de afuera', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.query(`insert into public.incomes (account_id, amount_cop, description, created_by) values ($1, 1600000, 'sueldo', $2)`, [PASEO, U.laura]);
      expect(await count(tx, 'select 1 from public.incomes where account_id = $1', [PASEO])).toBe(1);
      // No se hace pasar por WhatsApp ni por otra persona
      await expect(
        tx.query(`insert into public.incomes (account_id, amount_cop, source, created_by) values ($1, 1000, 'whatsapp', $2)`, [PASEO, U.laura]),
      ).rejects.toThrow();
    });
    await as(db, U.otro, async (tx) => {
      expect(await count(tx, 'select 1 from public.incomes where account_id = $1', [PASEO])).toBe(0);
      await expect(tx.query(`insert into public.incomes (account_id, amount_cop, created_by) values ($1, 1000, $2)`, [PASEO, U.otro])).rejects.toThrow();
    });
  });

  it('lo borra quien lo anotó', async () => {
    await as(db, U.laura, async (tx) => {
      const { id } = await one<{ id: string }>(tx, `insert into public.incomes (account_id, amount_cop, created_by) values ($1, 5000, $2) returning id`, [
        PASEO,
        U.laura,
      ]);
      await tx.query('delete from public.incomes where id = $1', [id]);
      await impersonate(tx, U.laura);
      expect(await count(tx, 'select 1 from public.incomes where id = $1', [id])).toBe(0);
    });
  });
});
