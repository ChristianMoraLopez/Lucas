import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, impersonate, one, U } from './harness';

// Chepito: cuentas de cobro, quién debe cuánto y por qué, y los avisos de Mister Luks
// (00000000000700_tipo_cobro.sql y 00000000000710_chepito.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';

async function como(tx: Transaction, rol: 'service_role' | null) {
  await tx.exec('reset role');
  if (rol) await tx.exec(`set local role ${rol}`);
}

async function rpc<T>(tx: Transaction, sql: string, params: unknown[] = []) {
  const { r } = await one<{ r: T }>(tx, `select ${sql} as r`, params);
  return r;
}

/** Corre algo que debe fallar sin dañar la transacción; devuelve el error */
async function falla(tx: Transaction, sql: string, params: unknown[] = []) {
  await tx.exec('savepoint antes');
  try {
    await tx.query(sql, params);
  } catch (e) {
    await tx.exec('rollback to savepoint antes');
    return (e as Error).message;
  }
  await tx.exec('release savepoint antes');
  return null;
}

/** Valeria abre una cuenta de cobro desde la app */
async function cuentaDeCobro(tx: Transaction) {
  await impersonate(tx, U.valeria);
  return rpc<string>(tx, `public.create_account('Préstamos', 'cobro', null, null, 'Valeria')`);
}

type Pendiente = { cobro_id: string; avisos: number; telefono: string; deudor: string; acreedor: string; monto: number; concepto: string };

describe('una cuenta de cobro desde la app', () => {
  it('el cobro pide a quién, su WhatsApp, cuánto y por qué; el celular de Colombia queda con su indicativo', async () => {
    await as(db, U.valeria, async (tx) => {
      const cuenta = await cuentaDeCobro(tx);
      const id = await rpc<string>(tx, 'public.crear_cobro($1, $2, $3, $4, $5)', [cuenta, 'Juan', '300 123 4567', 50000, 'la boleta del concierto']);
      await como(tx, null);
      expect(await one(tx, 'select telefono, monto::int, concepto, origen, avisos from public.cobros where id = $1', [id])).toEqual({
        telefono: '573001234567',
        monto: 50000,
        concepto: 'la boleta del concierto',
        origen: 'web',
        avisos: 0,
      });
      // Quien debe queda como una persona de la cuenta
      expect(await one(tx, 'select p.display_name from public.cobros c join public.people p on p.id = c.deudor_person_id where c.id = $1', [id])).toEqual({
        display_name: 'Juan',
      });

      await impersonate(tx, U.valeria);
      expect(await falla(tx, 'select public.crear_cobro($1, $2, $3, $4, $5)', [cuenta, 'Pedro', '3009998877', 20000, ''])).toBe('Escribe por qué te debe');
      expect(await falla(tx, 'select public.crear_cobro($1, $2, $3, $4, $5)', [cuenta, 'Pedro', '123', 20000, 'el taxi'])).toMatch(/^Revisa el WhatsApp/);
      expect(await falla(tx, 'select public.crear_cobro($1, $2, $3, $4, $5)', [cuenta, 'Pedro', '3009998877', 0, 'el taxi'])).toBe('Escribe cuánto te debe');
      expect(await falla(tx, 'select public.crear_cobro($1, $2, $3, $4, $5)', [cuenta, 'Juanchito', '+57 300 123 4567', 9000, 'otra cosa'])).toBe(
        'Ya le estás cobrando a ese número en esta cuenta',
      );
    });
  });

  it('en una cuenta que no es de cobro, o sin ser de la cuenta, no', async () => {
    await as(db, U.valeria, async (tx) => {
      const cuenta = await cuentaDeCobro(tx);
      expect(await falla(tx, 'select public.crear_cobro($1, $2, $3, $4, $5)', ['20000000-0000-4000-8000-000000000002', 'Juan', '3001234567', 1, 'x y'])).toBe(
        'Esa cuenta no es de cobro',
      );
      await impersonate(tx, U.santi);
      expect(await falla(tx, 'select public.crear_cobro($1, $2, $3, $4, $5)', [cuenta, 'Juan', '3001234567', 1000, 'la boleta'])).toBe(
        'Solo quienes administran la cuenta pueden cobrar',
      );
      // Ni lo ve
      expect(await one(tx, 'select count(*)::int as n from public.cobros where account_id = $1', [cuenta])).toEqual({ n: 0 });
    });
  });
});

describe('Chepito va aparte de las cuentas', () => {
  it('cada quien tiene uno, se llama «Chepito» y no se le cambia el nombre', async () => {
    await as(db, U.valeria, async (tx) => {
      const uno = await rpc<string>(tx, 'public.mi_chepito()');
      expect(await rpc<string>(tx, 'public.mi_chepito()')).toBe(uno);
      await como(tx, null);
      await tx.query(`update public.accounts set name = 'Samuel' where id = $1`, [uno]);
      expect(await one(tx, 'select name from public.accounts where id = $1', [uno])).toEqual({ name: 'Chepito' });
    });
  });
});

describe('editar y borrar cobros', () => {
  it('mientras cobra se corrige a quién, cuánto y por qué; terminado, no', async () => {
    await as(db, U.valeria, async (tx) => {
      const cuenta = await cuentaDeCobro(tx);
      const id = await rpc<string>(tx, 'public.crear_cobro($1, $2, $3, $4, $5)', [cuenta, 'Juan', '300 123 4567', 50000, 'la boleta']);
      await tx.query('select public.editar_cobro($1, $2, $3, $4)', [id, 'Juan Pablo', 70000, 'las boletas']);
      await como(tx, null);
      expect(
        await one(
          tx,
          'select p.display_name, c.monto::int, c.concepto from public.cobros c join public.people p on p.id = c.deudor_person_id where c.id = $1',
          [id],
        ),
      ).toEqual({ display_name: 'Juan Pablo', monto: 70000, concepto: 'las boletas' });
      await impersonate(tx, U.valeria);
      await tx.query(`select public.marcar_cobro($1, 'pagado')`, [id]);
      expect(await falla(tx, 'select public.editar_cobro($1, $2, $3, $4)', [id, 'Juan', 1, 'otra'])).toMatch('ya terminó');
    });
  });

  it('se borra con quien debía, y el aviso que no había salido ya no sale', async () => {
    await as(db, U.valeria, async (tx) => {
      const cuenta = await cuentaDeCobro(tx);
      const id = await rpc<string>(tx, 'public.crear_cobro($1, $2, $3, $4, $5)', [cuenta, 'Juan', '300 123 4567', 50000, 'la boleta']);
      await como(tx, 'service_role');
      expect(await rpc(tx, 'public.connector_chepito_avisar($1, 0, $2)', [id, 'Hola Juan'])).toBe(true);
      await impersonate(tx, U.valeria);
      await tx.query('select public.borrar_cobro($1)', [id]);
      await como(tx, null);
      expect(await one(tx, 'select count(*)::int as n from public.cobros where id = $1', [id])).toEqual({ n: 0 });
      expect(await one(tx, `select count(*)::int as n from public.people where account_id = $1 and display_name = 'Juan'`, [cuenta])).toEqual({ n: 0 });
      expect(
        await one(tx, `select count(*)::int as n from public.whatsapp_outbox where dedupe_key like $1 and dropped_at is null`, [`chepito:${id}:%`]),
      ).toEqual({
        n: 0,
      });
    });
  });
});

describe('los avisos de Mister Luks', () => {
  it('el primero sale por la bandeja de salida una vez; el siguiente, 2 días después; como mucho 4', async () => {
    await as(db, U.valeria, async (tx) => {
      const cuenta = await cuentaDeCobro(tx);
      const id = await rpc<string>(tx, 'public.crear_cobro($1, $2, $3, $4, $5)', [cuenta, 'Juan', '3001234567', 50000, 'la boleta']);
      await como(tx, 'service_role');
      const pend = (await rpc<Pendiente[]>(tx, 'public.connector_chepito_pendientes()')).filter((p) => p.cobro_id === id);
      expect(pend).toEqual([
        expect.objectContaining({ avisos: 0, telefono: '573001234567', deudor: 'Juan', acreedor: 'Valeria', monto: 50000, concepto: 'la boleta' }),
      ]);
      expect(await rpc(tx, 'public.connector_chepito_avisar($1, 0, $2)', [id, 'Hola Juan'])).toBe(true);
      // Dos veces el mismo aviso no
      expect(await rpc(tx, 'public.connector_chepito_avisar($1, 0, $2)', [id, 'Hola Juan'])).toBe(false);
      expect(await one(tx, 'select chat_jid, reason, body from public.whatsapp_outbox where dedupe_key = $1', [`chepito:${id}:1`])).toEqual({
        chat_jid: '573001234567@s.whatsapp.net',
        reason: 'answer',
        body: 'Hola Juan',
      });
      // Hasta dentro de 2 días no toca
      expect((await rpc<Pendiente[]>(tx, 'public.connector_chepito_pendientes()')).some((p) => p.cobro_id === id)).toBe(false);
      expect(await rpc(tx, 'public.connector_chepito_avisar($1, 1, $2)', [id, 'Otra vez'])).toBe(false);

      for (const n of [1, 2, 3]) {
        await tx.query(`update public.cobros set avisado_at = now() - interval '2 days' where id = $1`, [id]);
        expect((await rpc<Pendiente[]>(tx, 'public.connector_chepito_pendientes()')).find((p) => p.cobro_id === id)?.avisos).toBe(n);
        expect(await rpc(tx, 'public.connector_chepito_avisar($1, $2, $3)', [id, n, `Aviso ${n + 1}`])).toBe(true);
      }
      await tx.query(`update public.cobros set avisado_at = now() - interval '2 days' where id = $1`, [id]);
      expect((await rpc<Pendiente[]>(tx, 'public.connector_chepito_pendientes()')).some((p) => p.cobro_id === id)).toBe(false);
      expect(await one(tx, 'select avisos from public.cobros where id = $1', [id])).toEqual({ avisos: 4 });
    });
  });

  it('«ya pagué» lo deja pagado; «no le debo» y «no me escribas» lo detienen (y a ese número no se le cobra más)', async () => {
    await as(db, U.valeria, async (tx) => {
      const cuenta = await cuentaDeCobro(tx);
      const a = await rpc<string>(tx, 'public.crear_cobro($1, $2, $3, $4, $5)', [cuenta, 'Juan', '3001234567', 50000, 'la boleta']);
      const b = await rpc<string>(tx, 'public.crear_cobro($1, $2, $3, $4, $5)', [cuenta, 'Pedro', '3009998877', 20000, 'el taxi']);
      await como(tx, 'service_role');
      // Sin avisos todavía, «ya pagué» no es de esto
      expect(await rpc(tx, `public.connector_chepito_respuesta('573001234567', '573001234567', null, 'pagado')`)).toEqual([]);
      await rpc(tx, 'public.connector_chepito_avisar($1, 0, $2)', [a, 'Hola Juan']);
      await rpc(tx, 'public.connector_chepito_avisar($1, 0, $2)', [b, 'Hola Pedro']);

      const pagado = await rpc<{ cobro_id: string; deudor: string; acreedor: string; monto: number }[]>(
        tx,
        `public.connector_chepito_respuesta('573001234567', '573001234567', null, 'pagado')`,
      );
      expect(pagado).toEqual([expect.objectContaining({ cobro_id: a, deudor: 'Juan', acreedor: 'Valeria', monto: 50000 })]);
      expect(await one(tx, 'select pagado_por from public.cobros where id = $1', [a])).toEqual({ pagado_por: 'deudor' });

      await rpc(tx, `public.connector_chepito_respuesta('573009998877', '573009998877', null, 'no_escribas')`);
      expect(await one(tx, 'select detenido_por from public.cobros where id = $1', [b])).toEqual({ detenido_por: 'no_me_escribas' });
      await impersonate(tx, U.valeria);
      expect(await falla(tx, 'select public.crear_cobro($1, $2, $3, $4, $5)', [cuenta, 'Pedro', '3009998877', 1000, 'otra'])).toBe(
        'Esa persona le pidió a Mister Luks que no le escriba más',
      );
    });
  });

  it('quien cobra lo marca pagado o deja de cobrar desde la app', async () => {
    await as(db, U.valeria, async (tx) => {
      const cuenta = await cuentaDeCobro(tx);
      const a = await rpc<string>(tx, 'public.crear_cobro($1, $2, $3, $4, $5)', [cuenta, 'Juan', '3001112233', 50000, 'la boleta']);
      await tx.query(`select public.marcar_cobro($1, 'detener')`, [a]);
      await como(tx, 'service_role');
      expect((await rpc<Pendiente[]>(tx, 'public.connector_chepito_pendientes()')).some((p) => p.cobro_id === a)).toBe(false);
    });
  });
});

describe('desde WhatsApp', () => {
  const numero = '573150009999';
  const chat = `${numero}@s.whatsapp.net`;
  const crear = (tx: Transaction) =>
    rpc<{ ok: boolean; reason?: string; account_name?: string; nueva_cuenta?: boolean; telefono?: string; pago?: unknown }>(
      tx,
      `public.connector_chepito_crear($1, $2, $2, null, 'Juan', '3001234567', 50000, 'la boleta', 0)`,
      [chat, numero],
    );

  it('sin sesión en Luks no; con sesión, va a su Chepito (que se abre la primera vez)', async () => {
    await as(db, null, async (tx) => {
      await como(tx, null);
      await tx.query('select public.connector_private_chat($1, $2)', [CONTADOR, chat]);
      await como(tx, 'service_role');
      expect(await crear(tx)).toMatchObject({ ok: false, reason: 'sin_sesion' });
      await como(tx, null);
      await tx.query(`update public.whatsapp_identities set user_id = $1, verified_at = now() where phone = $2`, [U.nuevo, numero]);
      await como(tx, 'service_role');
      expect(await crear(tx)).toMatchObject({ ok: true, account_name: 'Chepito', nueva_cuenta: true, telefono: '573001234567' });
      // La segunda vez, la misma cuenta (y a Juan ya le está cobrando)
      expect(await crear(tx)).toMatchObject({ ok: false, reason: 'ya_le_cobras', nueva_cuenta: false });

      // Cómo le pagan, desde WhatsApp: se suma a lo que tenía
      expect(await rpc(tx, `public.connector_chepito_como_me_pagan($1, $1, null, null, '300 111 2233', null)`, [numero])).toEqual({
        ok: true,
        pago: { nequi: '3001112233' },
      });
      expect(await rpc(tx, `public.connector_chepito_como_me_pagan($1, $1, null, '@nuevo', null, null)`, [numero])).toEqual({
        ok: true,
        pago: { nequi: '3001112233', llave: '@nuevo' },
      });
    });
  });

  it('las cuentas de cobro no salen en lo demás que Mister Luks hace por privado', async () => {
    await as(db, U.valeria, async (tx) => {
      const cuenta = await cuentaDeCobro(tx);
      await como(tx, null);
      const yo = await one<{ id: string }>(tx, 'select id from public.people where account_id = $1 and claimed_by = $2', [cuenta, U.valeria]);
      await tx.query(`insert into public.person_whatsapp_ids (person_id, wa_id) values ($1, '573001110000')`, [yo.id]);
      expect(await one(tx, `select count(*)::int as n from public.personas_de_wa(null, '573001110000', null, null) where account_id = $1`, [cuenta])).toEqual({
        n: 0,
      });
    });
  });
});
