import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, PASEO, U } from './harness';

// Nombres de WhatsApp en vez de números, y alias para quien no tiene usuario (00000000000200_nombres_del_grupo.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const GRUPO_PASEO = 'd0000000-0000-4000-8000-000000000001';
const JID_PASEO = '120363040123456789@g.us';
const PASEO_WA = ['573001112233', '573014445566', '573016667788', '573017778899', '573105550142', '573128880365', '573002224471', '573157770918'];
const SANTI = '30000000-0000-4000-8000-000000000008';

type Miembro = { id: string; phone: string; name: string | null };
const m = (id: string, name: string | null = null): Miembro => ({ id, phone: id, name });

async function comoConnector(tx: Transaction) {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
}

const fijar = (tx: Transaction, miembros: Miembro[]) =>
  tx.query('select public.connector_set_group_members($1, $2)', [GRUPO_PASEO, JSON.stringify([...PASEO_WA.map((w) => m(w)), ...miembros])]);

const ingerir = (tx: Transaction, id: string, from: string, nombre: string) =>
  tx.query(`select public.connector_ingest_message($1, $2, $3, $4, 'text', 'hielo 30 lucas', null, null, null, now())`, [JID_PASEO, id, from, nombre]);

/** Nombre y origen de la persona que tiene ese número */
const quien = async (tx: Transaction, wa: string) =>
  one<{ display_name: string; name_source: string; id: string }>(
    tx,
    `select p.id, p.display_name, p.name_source from public.people p
     join public.person_whatsapp_ids w on w.person_id = p.id
     where p.account_id = $1 and w.wa_id = $2`,
    [PASEO, wa],
  );

const renombrar = (tx: Transaction, persona: string, nombre: string) =>
  one<{ r: string }>(tx, 'select public.rename_person($1, $2) as r', [persona, nombre]).then((x) => x.r);

describe('nombres de WhatsApp', () => {
  it('sin nombre entra como «WhatsApp 0002»; cuando se sabe su nombre de WhatsApp, se le pone', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      await fijar(tx, [m('573009990002')]);
      expect(await quien(tx, '573009990002')).toMatchObject({ display_name: 'WhatsApp 0002', name_source: 'auto' });

      // El connector vuelve a mandar el grupo cuando sabe el nombre
      await fijar(tx, [m('573009990002', '  Pipe   Gómez ')]);
      expect(await quien(tx, '573009990002')).toMatchObject({ display_name: 'Pipe Gómez', name_source: 'whatsapp' });

      // Un nombre que es solo un número no sirve
      await fijar(tx, [m('573009990003', '+57 300 999 0003')]);
      expect(await quien(tx, '573009990003')).toMatchObject({ display_name: 'WhatsApp 0003', name_source: 'auto' });
    });
  });

  it('lo que escribe al grupo trae el nombre de su perfil (aunque ya tuviera el de contacto)', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      await fijar(tx, [m('573009990004'), m('573009990005', 'Toño del trabajo')]);
      await ingerir(tx, 'N1', '573009990004', 'Juli 🌸');
      expect(await quien(tx, '573009990004')).toMatchObject({ display_name: 'Juli 🌸', name_source: 'whatsapp' });

      // El de la lista del grupo (puede ser como lo guardó alguien) no reemplaza uno de WhatsApp...
      await fijar(tx, [m('573009990004', 'Juliana prima'), m('573009990005')]);
      expect((await quien(tx, '573009990004')).display_name).toBe('Juli 🌸');
      // ...el de su perfil sí
      await ingerir(tx, 'N2', '573009990005', 'Antonio');
      expect((await quien(tx, '573009990005')).display_name).toBe('Antonio');
    });
  });

  it('si ya hay alguien que se llama igual, lleva los últimos cuatro números', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      await fijar(tx, [m('573009990006')]);
      await ingerir(tx, 'N3', '573009990006', 'Caro');
      expect((await quien(tx, '573009990006')).display_name).toBe('Caro 0006');
      // Llega otra vez el mismo nombre: se queda igual
      await ingerir(tx, 'N4', '573009990006', 'Caro');
      expect((await quien(tx, '573009990006')).display_name).toBe('Caro 0006');
    });
  });
});

describe('alias', () => {
  it('quien administra le pone un alias a quien no tiene usuario, y WhatsApp ya no lo cambia', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoConnector(tx);
      await fijar(tx, [m('573009990007', 'Andrés Felipe')]);
      const persona = (await quien(tx, '573009990007')).id;

      await impersonate(tx, U.valeria);
      expect(await renombrar(tx, persona, '  Pipe   el del carro ')).toBe('Pipe el del carro');
      await comoConnector(tx);
      await fijar(tx, [m('573009990007', 'Andrés F.')]);
      await ingerir(tx, 'N5', '573009990007', 'AF');
      expect(await quien(tx, '573009990007')).toMatchObject({ display_name: 'Pipe el del carro', name_source: 'manual' });
    });
  });

  it('a quien tiene usuario no le cambia el nombre nadie más; él sí', async () => {
    await as(db, U.valeria, async (tx) => {
      await tx.exec('savepoint a');
      await expect(renombrar(tx, SANTI, 'Santiago')).rejects.toThrow('«Santi» tiene cuenta en Luks');
      await tx.exec('rollback to savepoint a');
      await impersonate(tx, U.valeria);
      // Tampoco directo por la API
      await expect(tx.query(`update public.people set display_name = 'Santiago' where id = $1`, [SANTI])).rejects.toThrow('tiene cuenta en Luks');
      await tx.exec('rollback to savepoint a');

      await impersonate(tx, U.santi);
      expect(await renombrar(tx, SANTI, 'Santiago')).toBe('Santiago');
      const { rows } = await tx.query<{ display_name: string; name_source: string }>('select display_name, name_source from public.people where id = $1', [
        SANTI,
      ]);
      expect(rows[0]).toEqual({ display_name: 'Santiago', name_source: 'user' });
    });
  });

  it('un miembro no le cambia el nombre a los demás; no se repiten nombres', async () => {
    await as(db, U.andres, async (tx) => {
      const felipe = '30000000-0000-4000-8000-00000000000a';
      await tx.exec('savepoint a');
      await expect(renombrar(tx, felipe, 'Pipe')).rejects.toThrow('Solo quien administra');
      await tx.exec('rollback to savepoint a');

      await impersonate(tx, U.valeria);
      await expect(renombrar(tx, felipe, 'caro')).rejects.toThrow('Ya hay alguien que se llama «caro»');
      await tx.exec('rollback to savepoint a');
      await impersonate(tx, U.valeria);
      await expect(renombrar(tx, felipe, '   ')).rejects.toThrow('de 1 a 40 letras');
      await tx.exec('rollback to savepoint a');

      // Cambiarlo directo por la API también cuenta como alias
      await impersonate(tx, U.valeria);
      await tx.query(`update public.people set display_name = 'Pipe' where id = $1`, [felipe]);
      const { rows } = await tx.query<{ name_source: string }>('select name_source from public.people where id = $1', [felipe]);
      expect(rows[0].name_source).toBe('manual');
    });
  });
});
