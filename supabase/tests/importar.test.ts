import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, count, createDb, impersonate, one, P, PASEO, U } from './harness';

// ¿Desde cuándo anoto? e importar el chat exportado (00000000000340_desde_cuando_e_importar.sql)

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const CONTADOR = 'c0000000-0000-4000-8000-000000000001';
const GRUPO_PASEO = 'd0000000-0000-4000-8000-000000000001';
const JID_PASEO = '120363040123456789@g.us';
const JID_NUEVO = '120363888000111222@g.us';

async function comoConnector(tx: Transaction) {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
}

/** Mister Luks enlaza un grupo nuevo al Paseo con «luks PASEO-7K2Q»: la pregunta queda abierta */
async function enlazarNuevo(tx: Transaction) {
  await comoConnector(tx);
  const { r } = await one<{ r: { group_id: string } }>(tx, `select public.connector_link_group($1, $2, 'Paseo 2', 'PASEO-7K2Q') as r`, [CONTADOR, JID_NUEVO]);
  return r.group_id;
}

const bandeja = async (tx: Transaction, reason: string) => {
  await tx.exec('reset role');
  const { rows } = await tx.query<{ body: string }>('select body from public.whatsapp_outbox where reason = $1 order by created_at', [reason]);
  return rows.map((r) => r.body);
};

describe('desde cuándo anota', () => {
  it('un grupo recién enlazado anota desde ese momento y queda con la pregunta abierta', async () => {
    await as(db, null, async (tx) => {
      const grupo = await enlazarNuevo(tx);
      await tx.exec('reset role');
      expect(await one(tx, 'select history, ingest_from = created_at as desde_el_enlace from public.account_group_links where group_id = $1', [grupo])).toEqual(
        { history: 'pendiente', desde_el_enlace: true },
      );
    });
  });

  it('ingest_from reemplaza la fecha del enlace', async () => {
    await as(db, null, async (tx) => {
      await enlazarNuevo(tx);
      const ayer = new Date(Date.now() - 86_400_000).toISOString();
      const ingerir = () =>
        one<{ r: { reason?: string; ingest: boolean } }>(tx, `select public.connector_should_ingest($1, 'WA-X', $2) as r`, [JID_NUEVO, ayer]);
      expect((await ingerir()).r).toMatchObject({ ingest: false, reason: 'antes_del_enlace' });
      await tx.exec('reset role');
      await tx.query(
        `update public.account_group_links set ingest_from = now() - interval '2 days' where group_id = (select id from public.whatsapp_groups where wa_group_jid = $1)`,
        [JID_NUEVO],
      );
      await comoConnector(tx);
      expect((await ingerir()).r.ingest).toBe(true);
    });
  });

  it('un «2» responde la pregunta; otro «1» suelto ya no la cambia, pero «luks desde ya» sí. Mister Luks dice quién decidió', async () => {
    await as(db, null, async (tx) => {
      const grupo = await enlazarNuevo(tx);
      await tx.exec('reset role');
      expect(await one(tx, 'select history from public.account_group_links where group_id = $1', [grupo])).toEqual({ history: 'pendiente' });

      await comoConnector(tx);
      const responder = (modo: string, nombre: string, soloPendiente: boolean) =>
        one<{ r: { changed: boolean } }>(tx, 'select public.connector_history_answer($1, $2, $3, $4) as r', [JID_NUEVO, modo, nombre, soloPendiente]);
      expect((await responder('todo', 'Vale 🌻', true)).r.changed).toBe(true);
      await comoConnector(tx);
      expect((await responder('desde_ya', 'Santi', true)).r.changed).toBe(false);
      expect((await bandeja(tx, 'history'))[0]).toContain('Vale 🌻 dijo que lea *todo el chat*');

      await comoConnector(tx);
      expect((await responder('desde_ya', 'Santi', false)).r.changed).toBe(true);
      const avisos = await bandeja(tx, 'history');
      expect(avisos).toHaveLength(2);
      expect(avisos[1]).toMatch(/^👍 Listo: Santi dijo que anote \*desde ahora\*\. Lo de antes del \d{1,2} [a-z]{3} no lo toco\.$/);
    });
  });

  it('en la web lo cambia solo quien administra', async () => {
    await expect(as(db, U.santi, (tx) => tx.query(`select public.set_group_history($1, 'todo')`, [GRUPO_PASEO]))).rejects.toThrow('Solo quienes administran');
    await as(db, U.valeria, async (tx) => {
      await tx.query(`select public.set_group_history($1, 'todo')`, [GRUPO_PASEO]);
      await tx.exec('reset role');
      expect(await one(tx, 'select history, history_by from public.account_group_links where group_id = $1', [GRUPO_PASEO])).toEqual({
        history: 'todo',
        history_by: 'Valeria',
      });
    });
  });
});

describe('importar el chat exportado', () => {
  /** Valeria (admin del Paseo) sube un chat en la web */
  async function subir(tx: Transaction) {
    await impersonate(tx, U.valeria);
    const { id } = await one<{ id: string }>(tx, `select public.request_chat_import($1, null, $2, 'Chat de WhatsApp con Paseo.zip') as id`, [
      PASEO,
      `${PASEO}/chat.zip`,
    ]);
    return id;
  }

  /** Como el worker: toma la importación y manda los mensajes que leyó */
  async function leer(tx: Transaction, id: string) {
    await comoConnector(tx);
    const { c } = await one<{ c: { import: { before: string } } }>(tx, 'select public.worker_import_context($1) as c', [id]);
    const antes = new Date(Date.parse(c.import.before) - 3 * 86_400_000).toISOString();
    const despues = new Date(Date.parse(c.import.before) + 3_600_000).toISOString();
    const items = [
      { key: 'a1', sender: 'Santi', kind: 'text', text: 'Mercado en el Éxito 230 lucas', sent_at: antes },
      {
        key: 'a2',
        sender: '+57 301 666 7788',
        kind: 'photo',
        text: null,
        media_path: `${PASEO}/import/${id}/1.jpg`,
        file_name: 'IMG-1.jpg',
        mime_type: 'image/jpeg',
        sent_at: antes,
      },
      // De después: ya entró en vivo
      { key: 'a3', sender: 'Santi', kind: 'text', text: 'hielo 12 lucas', sent_at: despues },
      // Lo que escribió Luks no es un gasto
      { key: 'a4', sender: 'Mister Luks', kind: 'text', text: '✅ Anotado: Hielo · $12.000', sent_at: antes },
      // Un archivo que no es de la cuenta no entra
      { key: 'a5', sender: 'Santi', kind: 'photo', media_path: 'otra/cuenta.jpg', sent_at: antes },
      // Nadie se llama así
      { key: 'a6', sender: 'Tía Gloria', kind: 'text', text: 'gasolina 80 mil', sent_at: antes },
    ];
    return (await one<{ r: Record<string, number> }>(tx, 'select public.worker_import_messages($1, $2) as r', [id, JSON.stringify(items)])).r;
  }

  it('desde la web: solo quien administra, con un archivo de la cuenta; queda en la cola y la pregunta como «todo el chat»', async () => {
    await expect(as(db, U.santi, (tx) => tx.query(`select public.request_chat_import($1, null, $2, 'x.zip')`, [PASEO, `${PASEO}/x.zip`]))).rejects.toThrow(
      'Solo quienes administran',
    );
    await expect(as(db, U.valeria, (tx) => tx.query(`select public.request_chat_import($1, null, 'otra/x.zip', 'x.zip')`, [PASEO]))).rejects.toThrow(
      'no es de esta cuenta',
    );
    await as(db, U.valeria, async (tx) => {
      const id = await subir(tx);
      await tx.exec('reset role');
      expect(await one(tx, `select status, source, requested_name from public.chat_imports where id = $1`, [id])).toEqual({
        status: 'queued',
        source: 'web',
        requested_name: 'Valeria',
      });
      expect(await count(tx, `select 1 from public.jobs where type = 'import_chat' and payload ->> 'import_id' = $1`, [id])).toBe(1);
    });
  });

  it('el worker manda lo de antes: reconoce a quien escribió (por nombre o número) y deja lo demás', async () => {
    await as(db, U.valeria, async (tx) => {
      const id = await subir(tx);
      const r = await leer(tx, id);
      expect(r).toEqual({ inserted: 3, known_sender: 2, after: 1, luks: 1 });
      await tx.exec('reset role');
      const { rows } = await tx.query<{ wa_message_id: string; sender_person_id: string | null; source: string }>(
        'select wa_message_id, sender_person_id, source from public.messages where import_id = $1 order by wa_message_id',
        [id],
      );
      expect(rows).toEqual([
        { wa_message_id: 'import:a1', sender_person_id: P.paseoSanti, source: 'import' },
        // Por el número: «+57 301 666 7788» es Mafe
        { wa_message_id: 'import:a2', sender_person_id: '30000000-0000-4000-8000-000000000005', source: 'import' },
        { wa_message_id: 'import:a6', sender_person_id: null, source: 'import' },
      ]);
      // Cada uno en la cola, detrás de lo que llega en vivo
      expect(await one(tx, `select count(*)::int as n, max(priority) as p from public.jobs where type = 'process_message' and priority < 0`)).toEqual({
        n: 3,
        p: -1,
      });

      // Leer el mismo chat otra vez no repite nada
      await comoConnector(tx);
      await tx.query(`update public.chat_imports set status = 'processing' where id = $1`, [id]);
      expect((await leer(tx, id)).inserted).toBe(0);
    });
  });

  it('lo que llega en vivo pasa primero que lo importado', async () => {
    await as(db, U.valeria, async (tx) => {
      const id = await subir(tx);
      await leer(tx, id);
      await comoConnector(tx);
      // Un mensaje en vivo, creado después
      await tx.query(`insert into public.jobs (type, payload) values ('process_message', '{"message_id": null}')`);
      const { rows } = await tx.query<{ priority: number }>(`select priority from public.worker_claim_jobs('w', 50)`);
      const prioridades = rows.map((r) => r.priority);
      expect(prioridades).toContain(-1);
      expect(prioridades).toEqual([...prioridades].sort((a, b) => b - a));
    });
  });

  it('por WhatsApp: en el grupo, una sola vez por mensaje; al terminar, Mister Luks lo cuenta', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      const pedir = () =>
        one<{ r: { ok: boolean; already: boolean; import_id: string } }>(
          tx,
          `select public.connector_request_import($1, 'whatsapp/chat.zip', 'Chat de WhatsApp con Paseo.zip', 'WA-ZIP', 'Mafe') as r`,
          [JID_PASEO],
        );
      const { r } = await pedir();
      expect(r).toMatchObject({ ok: true, already: false });
      await comoConnector(tx);
      expect((await pedir()).r).toMatchObject({ ok: true, already: true });

      await comoConnector(tx);
      await tx.query('select public.worker_import_context($1)', [r.import_id]);
      await tx.query(`select public.worker_finish_import($1, '{"inserted": 7}')`, [r.import_id]);
      expect((await bandeja(tx, 'import'))[0]).toMatch(/^📥 Leí el chat exportado: encontré 7 gastos de antes del /);

      // Un grupo sin cuenta no importa nada
      await comoConnector(tx);
      expect((await one<{ r: unknown }>(tx, `select public.connector_request_import('120363000000000999@g.us', 'x', 'x', 'W', 'X') as r`)).r).toEqual({
        ok: false,
        reason: 'grupo_sin_enlazar',
      });
    });
  });

  it('por privado: si se sabe de qué grupo es (está en él y el nombre coincide)', async () => {
    await as(db, null, async (tx) => {
      await comoConnector(tx);
      await tx.query('select public.connector_set_group_members($1, $2)', [
        GRUPO_PASEO,
        JSON.stringify([{ id: '573016667788', phone: '573016667788', name: 'Mafe' }]),
      ]);
      const pedir = (chat: string | null, telefono = '573016667788') =>
        one<{ r: Record<string, unknown> }>(tx, `select public.connector_request_import_private('whatsapp/p.zip', 'x.zip', $1, $2, null, 'Mafe', $3) as r`, [
          `P-${Math.random()}`,
          telefono,
          chat,
        ]);
      expect((await pedir('paseo santa marta 2026')).r).toMatchObject({ ok: true, group_name: 'Paseo Santa Marta 2026' });
      await comoConnector(tx);
      expect((await pedir('Otro grupo')).r).toEqual({ ok: false, reason: 'sin_grupo', groups: [] });
      await comoConnector(tx);
      expect((await pedir(null, '573009990000')).r).toEqual({ ok: false, reason: 'sin_grupo', groups: [] });
    });
  });

  it('deshacer: se van sus gastos y sus mensajes; solo quien administra y no si ya está liquidado', async () => {
    await as(db, U.valeria, async (tx) => {
      const id = await subir(tx);
      await leer(tx, id);
      await tx.exec('reset role');
      // El worker ya convirtió uno en gasto
      await tx.query(
        `insert into public.expenses (account_id, merchant, total_cop, expense_date, source, message_id)
         select account_id, 'Éxito', 230000, received_at::date, 'import', id from public.messages where import_id = $1 and wa_message_id = 'import:a1'`,
        [id],
      );
      await tx.query(`update public.chat_imports set status = 'done' where id = $1`, [id]);

      await impersonate(tx, U.santi);
      await tx.exec('savepoint a');
      await expect(tx.query('select public.undo_chat_import($1)', [id])).rejects.toThrow('Solo quienes administran');
      await tx.exec('rollback to savepoint a');

      await impersonate(tx, U.valeria);
      expect((await one<{ r: unknown }>(tx, 'select public.undo_chat_import($1) as r', [id])).r).toEqual({ expenses: 1, messages: 3 });
      await tx.exec('reset role');
      expect(await one(tx, 'select status from public.chat_imports where id = $1', [id])).toEqual({ status: 'undone' });
      expect(await count(tx, `select 1 from public.expenses where merchant = 'Éxito' and total_cop = 230000`)).toBe(0);
      // Lo que quedaba en la cola ya no se procesa
      expect(await count(tx, `select 1 from public.jobs where type = 'process_message' and priority < 0 and status = 'queued'`)).toBe(0);
    });

    await as(db, U.valeria, async (tx) => {
      const id = await subir(tx);
      await leer(tx, id);
      await tx.exec('reset role');
      await tx.query(
        `insert into public.expenses (account_id, merchant, total_cop, expense_date, source, message_id)
         select account_id, 'Éxito', 230000, received_at::date, 'import', id from public.messages where import_id = $1 and wa_message_id = 'import:a1'`,
        [id],
      );
      await tx.query(`update public.chat_imports set status = 'done' where id = $1`, [id]);
      await tx.query('insert into public.settlements (account_id) values ($1)', [PASEO]);
      await impersonate(tx, U.valeria);
      await expect(tx.query('select public.undo_chat_import($1)', [id])).rejects.toThrow('liquidación');
    });
  });

  it('la web ve cada grupo y sus importaciones', async () => {
    await as(db, U.valeria, async (tx) => {
      const id = await subir(tx);
      const { h } = await one<{ h: { is_admin: boolean; groups: { name: string; history: string }[]; imports: { id: string; status: string }[] } }>(
        tx,
        'select public.account_history($1) as h',
        [PASEO],
      );
      expect(h.is_admin).toBe(true);
      expect(h.groups.map((g) => g.name)).toEqual(['Paseo Santa Marta 2026']);
      expect(h.imports[0]).toMatchObject({ id, status: 'queued' });
    });
    await expect(as(db, U.nuevo, (tx) => tx.query('select public.account_history($1)', [PASEO]))).rejects.toThrow('No eres miembro');
  });
});
