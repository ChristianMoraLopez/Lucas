import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, U } from './harness';

// «Alguien del grupo 4372» queda con su nombre o su @usuario de WhatsApp (00000000000530_nombres_de_whatsapp.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const LID = '263951577264372';

async function cuenta(tx: Transaction) {
  await impersonate(tx, U.valeria);
  const { id } = await one<{ id: string }>(tx, `select public.create_account('Nochita', 'evento') as id`);
  await tx.exec('reset role');
  return id;
}

/** Alguien que entró por el grupo sin nombre, con su LID */
async function sinNombre(tx: Transaction, cuentaId: string, lid: string, nombre = `Alguien del grupo ${lid.slice(-4)}`) {
  const { id } = await one<{ id: string }>(
    tx,
    `insert into public.people (account_id, display_name, name_source) values ($1, $2, 'auto') returning id`,
    [cuentaId, nombre],
  );
  await tx.query('insert into public.person_whatsapp_ids (person_id, wa_id) values ($1, $2)', [id, `lid:${lid}`]);
  return id;
}

const nombre = async (tx: Transaction, id: string) =>
  one<{ display_name: string; name_source: string }>(tx, 'select display_name, name_source from public.people where id = $1', [id]);

const usuarios = async (tx: Transaction, lista: unknown[]) => {
  await tx.exec('set local role service_role');
  const { n } = await one<{ n: number }>(tx, 'select public.connector_usuarios($1) as n', [JSON.stringify(lista)]);
  await tx.exec('reset role');
  return n;
};

describe('nombres de WhatsApp', () => {
  it('con el @usuario mientras no se sabe el nombre, y con el nombre cuando llega', async () => {
    await as(db, null, async (tx) => {
      await tx.exec('reset role');
      const c = await cuenta(tx);
      const p = await sinNombre(tx, c, LID);
      expect(await nombre(tx, p)).toEqual({ display_name: 'Alguien del grupo 4372', name_source: 'auto' });

      expect(await usuarios(tx, [{ id: `lid:${LID}`, lid: LID, username: '@Juanes_99' }, { id: 'x', username: 'no' }])).toBe(1);
      expect(await nombre(tx, p)).toEqual({ display_name: '@juanes_99', name_source: 'whatsapp' });
      // Lo mismo otra vez no cambia nada
      expect(await usuarios(tx, [{ id: `lid:${LID}`, lid: LID, username: 'juanes_99' }])).toBe(0);

      // Escribe al grupo con el nombre que se puso
      await tx.query(`select public.wa_identidad($1, null, $2, 'Juan Esteban')`, [`lid:${LID}`, LID]);
      expect(await nombre(tx, p)).toEqual({ display_name: 'Juan Esteban', name_source: 'whatsapp' });
    });
  });

  it('al entrar ya con el nombre conocido (de otro grupo); si otro se llama igual, con los últimos cuatro', async () => {
    await as(db, null, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`select public.wa_identidad('lid:111111111114372', null, '111111111114372', 'Hh')`);
      await tx.query(`select public.wa_identidad('lid:222222222221850', null, '222222222221850', 'Hh')`);
      const c = await cuenta(tx);
      const a = await sinNombre(tx, c, '111111111114372');
      const b = await sinNombre(tx, c, '222222222221850');
      expect((await nombre(tx, a)).display_name).toBe('Hh');
      expect((await nombre(tx, b)).display_name).toBe('Hh 1850');
    });
  });

  it('lo que alguien escribió a mano no se toca, y sin nada que saber queda como estaba', async () => {
    await as(db, null, async (tx) => {
      await tx.exec('reset role');
      const c = await cuenta(tx);
      const p = await sinNombre(tx, c, '333333333330097', 'WhatsApp 0097');
      expect(await nombre(tx, p)).toEqual({ display_name: 'WhatsApp 0097', name_source: 'auto' });
      await tx.query(`update public.people set display_name = 'Tía Marta', name_source = 'manual' where id = $1`, [p]);
      await usuarios(tx, [{ id: 'lid:333333333330097', lid: '333333333330097', username: 'marta.r' }]);
      expect(await nombre(tx, p)).toEqual({ display_name: 'Tía Marta', name_source: 'manual' });
    });
  });

  it('solo el connector', async () => {
    await as(db, U.laura, async (tx) => {
      await expect(tx.query(`select public.connector_usuarios('[]')`)).rejects.toThrow(/permission denied/);
    });
  });
});
