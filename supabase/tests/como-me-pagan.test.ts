import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, PASEO, U } from './harness';

// Cómo me pagan: llave Bre-B, Nequi y Daviplata en el perfil y en los cobros (00000000000570_como_me_pagan.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

type Pago = { llave?: string; nequi?: string; daviplata?: string } | null;

const poner = async (tx: Transaction, quien: string, llave: string | null, nequi: string | null, daviplata: string | null) => {
  await impersonate(tx, quien);
  const { r } = await one<{ r: Pago }>(tx, 'select public.set_como_me_pagan($1, $2, $3) as r', [llave, nequi, daviplata]);
  return r;
};

describe('cómo me pagan', () => {
  it('se pone en el perfil, limpio; vacío lo quita; lo que no sirve se explica', async () => {
    await as(db, U.valeria, async (tx) => {
      expect(await poner(tx, U.valeria, ' @vale.gomez ', '+57 300 123 4567', '')).toEqual({ llave: '@vale.gomez', nequi: '3001234567' });
      const { p } = await one<{ p: { pago: Pago } }>(tx, 'select public.my_profile() as p');
      expect(p.pago).toEqual({ llave: '@vale.gomez', nequi: '3001234567' });
      await expect(poner(tx, U.valeria, null, '12345', null)).rejects.toThrow(/Nequi es un celular de Colombia/);
    });
    await as(db, U.valeria, async (tx) => {
      await expect(poner(tx, U.valeria, 'mi llave con ñ', null, null)).rejects.toThrow(/Revisa la llave/);
    });
    await as(db, U.valeria, async (tx) => {
      await poner(tx, U.valeria, '@vale', '3001234567', null);
      expect(await poner(tx, U.valeria, '', '', '')).toBeNull();
    });
  });

  it('lo ven quienes comparten la cuenta; nadie más', async () => {
    await as(db, U.valeria, async (tx) => {
      await poner(tx, U.valeria, null, '3001234567', '3109876543');
      const valeria = (await one<{ id: string }>(tx, 'select id from public.people where account_id = $1 and claimed_by = $2', [PASEO, U.valeria])).id;
      await impersonate(tx, U.mafe);
      const { r } = await one<{ r: Record<string, Pago> }>(tx, 'select public.como_les_pagan($1) as r', [PASEO]);
      expect(r[valeria]).toEqual({ nequi: '3001234567', daviplata: '3109876543' });
      await impersonate(tx, U.otro);
      await expect(tx.query('select public.como_les_pagan($1)', [PASEO])).rejects.toThrow(/no existe/);
    });
  });

  it('Mister Luks lo tiene en los números de la cuenta («cuánto debo») y en los avisos de cobro', async () => {
    await as(db, U.valeria, async (tx) => {
      await poner(tx, U.valeria, '@vale', '3001234567', null);
      await tx.exec('reset role');
      const valeria = (await one<{ id: string }>(tx, 'select id from public.people where account_id = $1 and claimed_by = $2', [PASEO, U.valeria])).id;
      const { r } = await one<{ r: { pagos: Record<string, Pago>; account: { id: string } } }>(
        tx,
        'select public.numeros_para_luks($1, null, null) as r',
        [PASEO],
      );
      expect(r.account.id).toBe(PASEO);
      expect(r.pagos[valeria]).toEqual({ llave: '@vale', nequi: '3001234567' });

      // Liquidado y con los avisos prendidos: a quien le pagan a Valeria le llega cómo
      await impersonate(tx, U.laura);
      await tx.query('select public.set_auto_cobros($1, true)', [PASEO]);
      await tx.exec('reset role');
      await tx.query(`update public.expenses set status = 'confirmed' where account_id = $1 and status = 'pending_review'`, [PASEO]);
      await impersonate(tx, U.laura);
      const { r: o } = await one<{ r: { direct_transfers: unknown[] } }>(tx, 'select public.settlement_overview($1, null) as r', [PASEO]);
      await tx.query('select public.start_settlement($1, null, $2)', [PASEO, JSON.stringify(o.direct_transfers)]);
      await tx.exec('reset role');
      await tx.exec('set local role service_role');
      const { r: cobros } = await one<{ r: { to: { id: string; pago: Pago }; transfers: { to: string; pago: Pago }[] }[] }>(
        tx,
        'select public.connector_cobros() as r',
      );
      await tx.exec('reset role');
      const aValeria = cobros.filter((c) => c.to.id === valeria);
      expect(aValeria.length).toBeGreaterThan(0);
      for (const c of aValeria) expect(c.to.pago).toEqual({ llave: '@vale', nequi: '3001234567' });
      for (const c of cobros.filter((x) => x.to.id !== valeria)) expect(c.to.pago ?? null).toBeNull();
    });
  });
});
