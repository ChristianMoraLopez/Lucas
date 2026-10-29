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
      await tx.query(`select public.wa_identidad('lid:111111111114372', null, '111111111114372', 'Pipe')`);
      await tx.query(`select public.wa_identidad('lid:222222222221850', null, '222222222221850', 'Pipe')`);
      const c = await cuenta(tx);
      const a = await sinNombre(tx, c, '111111111114372');
      const b = await sinNombre(tx, c, '222222222221850');
      expect((await nombre(tx, a)).display_name).toBe('Pipe');
      expect((await nombre(tx, b)).display_name).toBe('Pipe 1850');
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

// Para reconocer a quién es quién en Personas (00000000000540_pistas_de_whatsapp.sql)
describe('pistas de WhatsApp en Personas', () => {
  const GRUPO_PASEO = 'd0000000-0000-4000-8000-000000000001';
  const PASEO = '20000000-0000-4000-8000-000000000002';
  const PASEO_WA = ['573001112233', '573014445566', '573016667788', '573017778899', '573105550142', '573128880365', '573002224471', '573157770918'];
  type Pista = { person_id: string; usuario: string | null; nombre_whatsapp: string | null; telefono: string | null; en_el_grupo: boolean | null };
  const pistas = async (tx: Transaction, quien: string) => {
    await impersonate(tx, quien);
    const { rows } = await tx.query<Pista>('select * from public.whatsapp_de_personas($1)', [PASEO]);
    await tx.exec('reset role');
    return rows;
  };

  it('el usuario y si sigue en el grupo; el teléfono solo para quien administra', async () => {
    await as(db, null, async (tx) => {
      await tx.exec('reset role');
      await tx.exec('set local role service_role');
      const miembros = [
        ...PASEO_WA.map((w) => ({ id: w, phone: w, name: null })),
        { id: 'lid:191980759965929', phone: null, lid: '191980759965929', name: null },
        { id: '573057610097', phone: '573057610097', name: null },
      ];
      await tx.query('select public.connector_usuarios($1)', [JSON.stringify([{ id: 'lid:191980759965929', lid: '191980759965929', username: 'teffity_' }])]);
      await tx.query('select public.connector_set_group_members($1, $2)', [GRUPO_PASEO, JSON.stringify(miembros)]);
      // El de 0097 se sale del grupo
      await tx.query('select public.connector_set_group_members($1, $2)', [GRUPO_PASEO, JSON.stringify(miembros.slice(0, -1))]);
      await tx.exec('reset role');

      const persona = async (wa: string) =>
        (await one<{ id: string }>(tx, 'select w.person_id as id from public.person_whatsapp_ids w join public.people p on p.id = w.person_id where p.account_id = $1 and w.wa_id = $2', [PASEO, wa])).id;
      const teffi = await persona('lid:191980759965929');
      const sale = await persona('573057610097');

      const deValeria = await pistas(tx, U.valeria);
      expect(deValeria.find((p) => p.person_id === teffi)).toMatchObject({ usuario: 'teffity_', telefono: null, en_el_grupo: true });
      expect(deValeria.find((p) => p.person_id === sale)).toMatchObject({ usuario: null, telefono: '573057610097', en_el_grupo: false });
      expect(await one(tx, 'select display_name from public.people where id = $1', [teffi])).toEqual({ display_name: '@teffity_' });

      // Un miembro ve el usuario, no el teléfono
      const deMafe = await pistas(tx, U.mafe);
      expect(deMafe.find((p) => p.person_id === sale)?.telefono).toBeNull();
      expect(deMafe.find((p) => p.person_id === teffi)?.usuario).toBe('teffity_');

      // Quien no es de la cuenta no ve nada
      await impersonate(tx, U.otro);
      await expect(tx.query('select * from public.whatsapp_de_personas($1)', [PASEO])).rejects.toThrow(/no existe/);
    });
  });
});

// «Hh» no es un nombre: gana el @usuario (00000000000550_nombres_que_no_dicen_nada.sql)
describe('nombres que no dicen nada', () => {
  it('«Hh» no cuenta como nombre: queda con su @usuario; un nombre de verdad sí gana', async () => {
    await as(db, null, async (tx) => {
      await tx.exec('reset role');
      const { r } = await one<{ r: (string | null)[] }>(
        tx,
        `select array[public.nombre_de_whatsapp('Hh'), public.nombre_de_whatsapp('Jjj'), public.nombre_de_whatsapp('X'),
                      public.nombre_de_whatsapp('Jo'), public.nombre_de_whatsapp('Ana 🌸'), public.nombre_de_whatsapp('🦋')] as r`,
      );
      expect(r).toEqual([null, null, null, 'Jo', 'Ana 🌸', '🦋']);

      await tx.query(`select public.wa_identidad('lid:444444444444372', null, '444444444444372', 'Hh')`);
      const c = await cuenta(tx);
      const p = await sinNombre(tx, c, '444444444444372');
      // Sin usuario todavía: sigue sin nombre (no «Hh»)
      expect(await nombre(tx, p)).toEqual({ display_name: 'Alguien del grupo 4372', name_source: 'auto' });
      await usuarios(tx, [{ id: 'lid:444444444444372', lid: '444444444444372', username: 'tiago.film' }]);
      expect(await nombre(tx, p)).toEqual({ display_name: '@tiago.film', name_source: 'whatsapp' });

      // Cuando escribe al grupo con «Hh», no se lo cambia
      await tx.exec('set local role service_role');
      await tx.query(`select public.aprender_nombre($1, 'lid:444444444444372', 'Hh', true)`, [c]);
      await tx.exec('reset role');
      expect((await nombre(tx, p)).display_name).toBe('@tiago.film');

      // Si se pone un nombre de verdad, ese gana
      await tx.query(`select public.wa_identidad('lid:444444444444372', null, '444444444444372', 'Santiago')`);
      expect(await nombre(tx, p)).toEqual({ display_name: 'Santiago', name_source: 'whatsapp' });
    });
  });
});
