import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, one, PASEO } from './harness';

// Nadie del grupo queda por fuera de la cuenta (00000000000790_nadie_del_grupo_por_fuera.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const GRUPO_PASEO = 'd0000000-0000-4000-8000-000000000001';

describe('integrantes del grupo', () => {
  it('quien entra al grupo conectado, aunque no tenga nombre en WhatsApp, queda en la cuenta', async () => {
    await as(db, null, async (tx) => {
      await tx.exec('reset role');
      const antes = await one<{ n: number }>(tx, 'select count(*)::int as n from public.people where account_id = $1', [PASEO]);
      await tx.query(
        `insert into public.whatsapp_group_members (group_id, wa_id, phone, lid, name, is_admin)
         values ($1, '573134284913', '573134284913', '34626127044725', null, false)`,
        [GRUPO_PASEO],
      );
      // El seguro corre al confirmar la transacción: aquí se adelanta
      await tx.exec('set constraints all immediate');
      expect(await one(tx, 'select count(*)::int as n from public.people where account_id = $1', [PASEO])).toEqual({ n: antes.n + 1 });
      expect(await one(tx, `select display_name from public.people where account_id = $1 order by created_at desc limit 1`, [PASEO])).toEqual({
        display_name: 'WhatsApp 4913',
      });
    });
  });
});
