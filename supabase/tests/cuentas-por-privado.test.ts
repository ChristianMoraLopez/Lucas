import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, U } from './harness';

// Por privado, Mister Luks cuenta lo de cada quien en todas sus cuentas (00000000000480_cuentas_por_privado.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const MARI_WA = '573000000099';
const PRIVADO = `${MARI_WA}@s.whatsapp.net`;

interface Cuenta {
  account: { id: string; name: string; type: string; status: string };
  people: { id: string; name: string; balance: number }[];
  settlement: { from_id: string; to_id: string; amount: number; paid: boolean }[] | null;
  me: { id: string; name: string; consumo: { merchant: string }[] } | null;
}

/** Una cuenta de Valeria con Daniel y Mari (Mari con su WhatsApp); `gastos`: comercio y quién pagó, entre los tres */
async function cuenta(tx: Transaction, nombre: string, gastos: [string, 'dan' | 'mari'][]) {
  await impersonate(tx, U.valeria);
  const { id } = await one<{ id: string }>(tx, `select public.create_account($1, 'evento') as id`, [nombre]);
  await tx.query(`select public.add_people($1, array['Daniel', 'Mari'], false)`, [id]);
  await tx.exec('reset role');
  const gente = Object.fromEntries(
    (await tx.query<{ id: string; display_name: string }>('select id, display_name from public.people where account_id = $1', [id])).rows.map((p) => [
      p.display_name,
      p.id,
    ]),
  );
  const yo = (await one<{ id: string }>(tx, 'select id from public.people where account_id = $1 and claimed_by = $2', [id, U.valeria])).id;
  const P = { yo, dan: gente.Daniel, mari: gente.Mari };
  await tx.query('insert into public.person_whatsapp_ids (person_id, wa_id) values ($1, $2)', [P.mari, MARI_WA]);
  for (const [comercio, quien] of gastos) {
    const { id: gasto } = await one<{ id: string }>(
      tx,
      `insert into public.expenses (account_id, merchant, total_cop, payer_person_id, status) values ($1, $2, 90000, $3, 'confirmed') returning id`,
      [id, comercio, P[quien]],
    );
    for (const p of [P.yo, P.dan, P.mari])
      await tx.query('insert into public.expense_splits (expense_id, person_id, amount_cop) values ($1, $2, 30000)', [gasto, p]);
  }
  return { id, P };
}

async function liquidar(tx: Transaction, id: string) {
  await impersonate(tx, U.valeria);
  const { r } = await one<{ r: { direct_transfers: unknown[] } }>(tx, 'select public.settlement_overview($1, null) as r', [id]);
  await tx.query('select public.start_settlement($1, null, $2)', [id, JSON.stringify(r.direct_transfers)]);
  await tx.exec('reset role');
}

const misCuentas = async (tx: Transaction, jid: string, wa: string) => {
  await tx.exec('set local role service_role');
  const { r } = await one<{ r: { identity_id: string; cuentas: Cuenta[] } }>(tx, 'select public.connector_mis_cuentas($1, $2) as r', [jid, wa]);
  await tx.exec('reset role');
  return r;
};

describe('mis cuentas, por privado', () => {
  it('las cuentas donde tiene algo, primero donde le falta pagar, con lo mismo que en el grupo', async () => {
    await as(db, U.valeria, async (tx) => {
      const chile = await cuenta(tx, 'Chile', [['Le Due Torri', 'dan']]);
      const playa = await cuenta(tx, 'Playa', [['Lancha', 'dan']]);
      await cuenta(tx, 'Sin nada', []);
      await liquidar(tx, playa.id);
      // La de Chile tiene un gasto más reciente, pero en la Playa le falta pagar
      await tx.query(`update public.expenses set created_at = now() + interval '1 minute' where account_id = $1`, [chile.id]);

      const r = await misCuentas(tx, PRIVADO, MARI_WA);
      expect(r.identity_id).toBeTruthy();
      expect(r.cuentas.map((c) => c.account.name)).toEqual(['Playa', 'Chile']);
      const [p, c] = r.cuentas;
      expect(p.account).toMatchObject({ id: playa.id, type: 'evento', status: 'settling' });
      expect(p.me?.id).toBe(playa.P.mari);
      expect(p.settlement?.find((t) => t.from_id === playa.P.mari)).toMatchObject({ to_id: playa.P.dan, amount: 30000, paid: false });
      expect(c.settlement).toBeNull();
      expect(c.me?.id).toBe(chile.P.mari);
      expect(c.me?.consumo.map((e) => e.merchant)).toEqual(['Le Due Torri']);
      expect(Number(c.people.find((x) => x.id === chile.P.mari)?.balance)).toBe(-30000);
    });
  });

  it('una cuenta cerrada o archivada no sale, y a quien no está en ninguna no le sale nada', async () => {
    await as(db, U.valeria, async (tx) => {
      const vieja = await cuenta(tx, 'Vieja', [['Taxi', 'mari']]);
      await tx.query(`update public.accounts set status = 'closed' where id = $1`, [vieja.id]);
      expect((await misCuentas(tx, PRIVADO, MARI_WA)).cuentas).toEqual([]);
      expect((await misCuentas(tx, '573009990000@s.whatsapp.net', '573009990000')).cuentas).toEqual([]);
    });
  });

  it('solo el connector', async () => {
    await as(db, U.laura, async (tx) => {
      await expect(tx.query(`select public.connector_mis_cuentas('a', 'b')`)).rejects.toThrow(/permission denied/);
    });
    await as(db, U.laura, async (tx) => {
      await expect(tx.query(`select public.numeros_para_luks(gen_random_uuid(), null, 'b')`)).rejects.toThrow(/permission denied/);
    });
  });
});
