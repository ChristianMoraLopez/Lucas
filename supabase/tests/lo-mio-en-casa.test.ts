import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, createDb, impersonate, one, P, PASEO, U } from './harness';

// Lo que me tocó en el paseo también entra, por revisar, en mi casa (00000000000800_lo_mio_tambien_en_casa.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

async function gastoDelPaseo(tx: Transaction, total: number) {
  await tx.exec('reset role');
  const { id } = await one<{ id: string }>(
    tx,
    `insert into public.expenses (account_id, merchant, expense_date, total_cop, status, source, payer_person_id)
     values ($1, 'Codart', current_date, $2, 'pending_review', 'web', $3) returning id`,
    [PASEO, total, P.paseoSanti],
  );
  // Por partes iguales entre Valeria y Santi
  await tx.query('select public.replace_equal_split($1, $2)', [id, [P.paseoValeria, P.paseoSanti]]);
  return id;
}

const reflejo = (tx: Transaction, id: string) =>
  tx.query<{ total_cop: number; status: string; payer_person_id: string; description: string }>(
    'select total_cop, status, payer_person_id, description from public.expenses where reflejo_de = $1 and account_id = $2',
    [id, CASA],
  );

describe('lo mío de aquí también en mi casa', () => {
  it('al confirmarse, mi parte entra por revisar en la casa, pagada por mí; si cambia, se pone al día; si deja de ser mío, se va', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.query('select public.fijar_reflejo($1, $2)', [PASEO, CASA]);
      const id = await gastoDelPaseo(tx, 80_000);
      await tx.exec('set constraints all immediate');
      expect((await reflejo(tx, id)).rows).toEqual([]); // todavía por revisar en el paseo

      await tx.query(`update public.expenses set status = 'confirmed' where id = $1`, [id]);
      await tx.exec('set constraints all immediate');
      expect((await reflejo(tx, id)).rows).toEqual([
        { total_cop: 40_000, status: 'pending_review', payer_person_id: P.casaValeria, description: 'Tu parte en «Paseo Santa Marta»' },
      ]);

      // Ahora lo paga todo Valeria: su parte sube
      await tx.query('select public.replace_equal_split($1, $2)', [id, [P.paseoValeria]]);
      await tx.exec('set constraints all immediate');
      expect((await reflejo(tx, id)).rows[0].total_cop).toBe(80_000);

      // Ya no le toca nada: se quita de la casa
      await tx.query('select public.replace_equal_split($1, $2)', [id, [P.paseoSanti]]);
      await tx.exec('set constraints all immediate');
      expect((await reflejo(tx, id)).rows).toEqual([]);
    });
  });

  it('al elegir la casa, lo ya confirmado entra; quien no lo eligió no ve nada en la suya', async () => {
    await as(db, U.valeria, async (tx) => {
      const id = await gastoDelPaseo(tx, 60_000);
      await tx.query(`update public.expenses set status = 'confirmed' where id = $1`, [id]);
      await tx.exec('set constraints all immediate');
      await impersonate(tx, U.valeria);
      await tx.query('select public.fijar_reflejo($1, $2)', [PASEO, CASA]);
      await tx.exec('reset role');
      expect((await reflejo(tx, id)).rows.map((r) => Number(r.total_cop))).toEqual([30_000]);
      expect(await one(tx, 'select count(*)::int as n from public.expenses where reflejo_de = $1', [id])).toEqual({ n: 1 });
    });
  });

  it('solo hacia una cuenta mía y abierta', async () => {
    await as(db, U.santi, async (tx) => {
      await expect(tx.query('select public.fijar_reflejo($1, $2)', [PASEO, CASA])).rejects.toThrow(/Elige otra cuenta tuya/);
    });
  });
});
