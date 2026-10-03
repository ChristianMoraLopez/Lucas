import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, one, PASEO, U } from './harness';

// Lo que hace Luks no es un gasto (00000000000180_mensajes_de_luks.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const GRUPO_PASEO = '120363040123456789@g.us';
const LUKS_WA = '573150000000'; // el número contador de la semilla

// Lo que se manda desde Liquidar (apps/web/lib/share.ts)
const CUENTAS = `🧾 *Paseo Santa Marta*
Gastamos *$4.816.000* (4,8 palos) entre 8: *$602.000* cada uno.

💸 *Quién le paga a quién*
• Santi → Valeria: *$280.000*
• ~Andrés → Laura: $168.000~ ✅

👀 Cuánto puso cada uno y en qué se fue la plata:
https://mrluks.com/r/76B5n5hlRzSyAs39_Yl50w

_Esto se hizo en mrluks.com_`;
const COBRO = 'Hola Mafe 👋 De «Noche de bolos» me debes $45.000 (45 lucas).\n\n_Esto se hizo en mrluks.com_';

const esDeLuks = async (tx: Transaction, t: string) => (await one<{ r: boolean }>(tx, 'select public.es_mensaje_de_luks($1) as r', [t])).r;

describe('lo que hace Luks no es un gasto', () => {
  it('reconoce las cuentas, los cobros, el link y las respuestas de Luks; lo demás no', async () => {
    await as(db, U.valeria, async (tx) => {
      for (const t of [
        CUENTAS,
        COBRO,
        'Las cuentas de «Paseo»: gastamos $480.000 entre 4.\nCada uno ve aquí: https://mrluks.com/r/abc\n\nHecho con Luks · mrluks.com',
        'Hola Santi 👋 me debes $45.000\n\nCuentas hechas con Luks · mrluks.com',
        'miren 50 lucas https://lucas-tau-black.vercel.app/r/76B5n5hlRzSyAs39_Yl50w',
        'Anotado: Asadero El Rodadero · $272.500 · pagó Felipe.',
        'Recibido: Taxi · $45.000. Queda por revisar en Luks.',
        'Anotados 2:\n• Hielo · $8.000\n• Ron · $116.000\nUno queda por revisar en Luks.',
        'Ya estaba anotado: Hostal · $840.000 (25 sep)',
      ]) {
        expect(await esDeLuks(tx, t), t).toBe(true);
      }
      for (const t of [
        'taxi al aeropuerto 45 lucas',
        'Recibido el pago de 50.000, gracias',
        'pagué 120.000 · el hotel',
        'almuerzo 25.000, lo anoto en mrluks.com',
        'https://www.reddit.com/r/Colombia 20 mil',
      ]) {
        expect(await esDeLuks(tx, t), t).toBe(false);
      }
    });
  });

  it('el connector no guarda las cuentas que mandan al grupo ni lo que escribe el número de Luks', async () => {
    await as(db, null, async (tx) => {
      await tx.exec('reset role');
      await tx.exec('set local role service_role');
      const ingerir = (id: string, text: string, from = '573016667788') =>
        tx
          .query<{ r: { ingest: boolean; reason?: string } }>(
            `select public.connector_ingest_message($1, $2, $3, 'Mafe', 'text', $4, null, null, null, now()) as r`,
            [GRUPO_PASEO, id, from, text],
          )
          .then((x) => x.rows[0].r);

      expect(await ingerir('A1', CUENTAS)).toMatchObject({ ingest: false, reason: 'mensaje_de_luks' });
      expect(await ingerir('A2', 'Anotado: Hielo · $8.000 · pagó Mafe.', LUKS_WA)).toMatchObject({ ingest: false });
      expect(await ingerir('A3', 'quedó en 30 lucas el hielo', LUKS_WA)).toMatchObject({ ingest: false, reason: 'numero_de_luks' });
      expect(await ingerir('A4', 'hielo 30 lucas')).toMatchObject({ ingest: true });

      const { rows } = await tx.query<{ n: number }>('select count(*)::int as n from public.messages where wa_message_id in ($1, $2, $3)', ['A1', 'A2', 'A3']);
      expect(rows[0].n).toBe(0);
    });
  });

  it('desde la web tampoco se sube como gasto', async () => {
    await as(db, U.santi, async (tx) => {
      await expect(tx.query(`select public.submit_upload($1, 'text', $2)`, [PASEO, COBRO])).rejects.toThrow('Ese mensaje lo hizo Luks');
    });
  });
});
