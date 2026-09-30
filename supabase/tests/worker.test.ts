import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, count, createDb, impersonate, one, P, PASEO, U } from './harness';

// Fase 4: lo que el worker de Python usa de la base (00000000000070_worker.sql).

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const DENIED = /permission denied|row-level security/;
const MERCADO_PASEO = '40000000-0000-4000-8000-000000000013';
const MERCADO_CASA = '40000000-0000-4000-8000-000000000003';
const CUFE = 'a1b2c3'.repeat(16); // 96 caracteres hex, como un SHA-384
const HASH = 'f0e1d2c3b4a59687'.repeat(4); // 256 bits

/** Sube un mensaje como `quien` (así lo haría la web) y sigue como service role, igual que el worker. */
async function mensaje(tx: Transaction, texto: string, quien: string = U.santi, cuenta: string = PASEO) {
  await impersonate(tx, quien);
  const { id } = await one<{ id: string }>(tx, `select public.submit_upload($1, 'text', $2) as id`, [cuenta, texto]);
  await comoWorker(tx);
  return id;
}

async function comoWorker(tx: Transaction) {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
}

async function tomar(tx: Transaction, limite = 5) {
  const { rows } = await tx.query<{ id: string; attempts: number; payload: { message_id: string } }>(
    `select id, attempts, payload from public.worker_claim_jobs('prueba', $1)`,
    [limite],
  );
  return rows;
}

async function guardar(tx: Transaction, messageId: string, data: Record<string, unknown>) {
  const { r } = await one<{ r: Record<string, string | boolean | null> }>(tx, 'select public.worker_save_expense($1, $2) as r', [
    messageId,
    JSON.stringify(data),
  ]);
  return r;
}

const base = {
  merchant: 'Tienda Doña Rosa',
  description: 'Groceries: water and snacks',
  expense_date: '2026-09-26',
  total_cop: 45_000,
  category_id: MERCADO_PASEO,
  payer_person_id: P.paseoSanti,
  status: 'pending_review',
  confidence: 0.82,
  field_confidence: { merchant: 0.9, date: 0.9, total: 0.95, category: 0.82, payer: 0.97 },
  ai_snapshot: { merchant: 'Tienda Doña Rosa', total_cop: 45_000 },
};

describe('cola del worker', () => {
  it('toma los trabajos en cola, marca el mensaje «leyendo» y no los repite', async () => {
    await as(db, U.santi, async (tx) => {
      const id = await mensaje(tx, 'hielo 12 lucas');
      const tomados = await tomar(tx);
      expect(tomados).toHaveLength(1);
      expect(tomados[0]).toMatchObject({ attempts: 1, payload: { message_id: id } });
      expect(await one(tx, 'select status from public.messages where id = $1', [id])).toEqual({ status: 'processing' });
      expect(await tomar(tx)).toHaveLength(0);
    });
  });

  it('un error reintentable vuelve a la cola con espera y queda registrado', async () => {
    await as(db, U.santi, async (tx) => {
      const id = await mensaje(tx, 'hielo 12 lucas');
      const [job] = await tomar(tx);
      const { s } = await one<{ s: string }>(tx, `select public.worker_fail_job($1, 'Ollama no respondió', 'Traceback…', true) as s`, [job.id]);
      expect(s).toBe('queued');
      const j = await one<{ status: string; espera: boolean; last_error: string }>(
        tx,
        `select status, run_at > now() + interval '20 seconds' as espera, last_error from public.jobs where id = $1`,
        [job.id],
      );
      expect(j).toEqual({ status: 'queued', espera: true, last_error: 'Ollama no respondió' });
      expect(await one(tx, 'select status from public.messages where id = $1', [id])).toEqual({ status: 'queued' });
      expect(await one(tx, 'select attempt, retryable, message_id from public.job_errors where job_id = $1', [job.id])).toEqual({
        attempt: 1,
        retryable: true,
        message_id: id,
      });
      // Todavía no le toca
      expect(await tomar(tx)).toHaveLength(0);
      await tx.query('update public.jobs set run_at = now() where id = $1', [job.id]);
      expect((await tomar(tx))[0].attempts).toBe(2);
    });
  });

  it('se rinde al llegar al máximo de intentos o con un error definitivo', async () => {
    await as(db, U.santi, async (tx) => {
      const id = await mensaje(tx, 'hielo 12 lucas');
      await tx.query(`update public.jobs set max_attempts = 1 where payload ->> 'message_id' = $1`, [id]);
      const [job] = await tomar(tx);
      expect((await one<{ s: string }>(tx, `select public.worker_fail_job($1, 'x') as s`, [job.id])).s).toBe('failed');
      expect(await one(tx, 'select status from public.messages where id = $1', [id])).toEqual({ status: 'failed' });

      const otro = await mensaje(tx, 'foto dañada');
      const [job2] = await tomar(tx);
      expect((await one<{ s: string }>(tx, `select public.worker_fail_job($1, 'PDF con clave', null, false) as s`, [job2.id])).s).toBe('failed');
      expect(await one(tx, 'select status from public.messages where id = $1', [otro])).toEqual({ status: 'failed' });
    });
  });

  it('rescata lo que un worker dejó a medias', async () => {
    await as(db, U.santi, async (tx) => {
      await mensaje(tx, 'hielo 12 lucas');
      const [job] = await tomar(tx);
      await tx.query(`update public.jobs set locked_at = now() - interval '1 hour' where id = $1`, [job.id]);
      const [otraVez] = await tomar(tx);
      expect(otraVez).toMatchObject({ id: job.id, attempts: 2 });
      expect(await count(tx, 'select 1 from public.job_errors where job_id = $1', [job.id])).toBe(1);
    });
  });

  it('completar deja el trabajo hecho', async () => {
    await as(db, U.santi, async (tx) => {
      await mensaje(tx, 'hielo 12 lucas');
      const [job] = await tomar(tx);
      await tx.query('select public.worker_complete_job($1)', [job.id]);
      expect(await one(tx, 'select status, locked_at from public.jobs where id = $1', [job.id])).toEqual({ status: 'done', locked_at: null });
    });
  });
});

describe('contexto del mensaje', () => {
  it('trae la cuenta, sus personas, categorías, memoria y quién lo mandó', async () => {
    await as(db, U.santi, async (tx) => {
      const id = await mensaje(tx, 'Tienda Doña Rosa 45 lucas');
      const { c } = await one<{ c: Record<string, unknown[] | Record<string, unknown> | string> }>(tx, 'select public.worker_message_context($1) as c', [id]);
      expect(c.sender_person_id).toBe(P.paseoSanti);
      expect(c.account).toMatchObject({ id: PASEO, type: 'evento' });
      expect(c.people).toHaveLength(8);
      expect(c.categories).toHaveLength(8);
      expect(c.memory).toContainEqual(expect.objectContaining({ normalized: 'tienda dona rosa', category_id: MERCADO_PASEO }));
      expect(c.message).toMatchObject({ kind: 'text', text_body: 'Tienda Doña Rosa 45 lucas' });
    });
  });
});

describe('guardar el gasto', () => {
  it('crea el gasto con ítems, divide entre los que nombró el mensaje y suma a la memoria', async () => {
    await as(db, U.santi, async (tx) => {
      const id = await mensaje(tx, 'Tienda Doña Rosa 45 lucas entre Vale y Santi');
      const r = await guardar(tx, id, {
        ...base,
        items: [
          { name: 'Agua x6', quantity: 1, unit_price_cop: 15_000, total_cop: 15_000 },
          { name: 'Papas', quantity: 2, unit_price_cop: 15_000, total_cop: 30_000 },
        ],
        split_person_ids: [P.paseoValeria, P.paseoSanti],
        split_note: 'Leído del mensaje: «entre vale y santi»',
        memory_id: '90000000-0000-4000-8000-000000000013',
        extracted_text: 'Tienda Doña Rosa 45 lucas entre Vale y Santi',
      });
      expect(r.status).toBe('pending_review');
      const g = await one<Record<string, unknown>>(
        tx,
        `select e.merchant_normalized, e.total_cop::int as total, e.source, e.created_by,
                (select count(*)::int from public.expense_items i where i.expense_id = e.id) as items,
                (select array_agg(s.amount_cop::int) from public.expense_splits s where s.expense_id = e.id) as partes
         from public.expenses e where e.id = $1`,
        [r.expense_id],
      );
      expect(g).toEqual({ merchant_normalized: 'tienda dona rosa', total: 45_000, source: 'web', created_by: U.santi, items: 2, partes: [22_500, 22_500] });
      expect(await one(tx, 'select status, extracted_text from public.messages where id = $1', [id])).toEqual({
        status: 'done',
        extracted_text: 'Tienda Doña Rosa 45 lucas entre Vale y Santi',
      });
      expect(await one(tx, `select hits from public.merchant_memory where id = '90000000-0000-4000-8000-000000000013'`)).toEqual({ hits: 2 });
    });
  });

  it('sin personas nombradas divide entre todas; y no acepta categorías ni pagadores de otra cuenta', async () => {
    await as(db, U.santi, async (tx) => {
      const id = await mensaje(tx, 'hielo 12 lucas');
      const r = await guardar(tx, id, { ...base, total_cop: 12_000, category_id: MERCADO_CASA, payer_person_id: P.casaValeria, status: 'confirmed' });
      expect(r.status).toBe('pending_review'); // sin pagador válido no se confirma solo
      expect(
        await one(
          tx,
          `select category_id, payer_person_id, (select count(*)::int from public.expense_splits s where s.expense_id = e.id) as personas
           from public.expenses e where e.id = $1`,
          [r.expense_id],
        ),
      ).toEqual({ category_id: null, payer_person_id: null, personas: 8 });
    });
  });

  it('lo que la memoria conoce y se leyó seguro queda confirmado', async () => {
    await as(db, U.santi, async (tx) => {
      const id = await mensaje(tx, 'Tienda Doña Rosa 45 lucas');
      const r = await guardar(tx, id, { ...base, status: 'confirmed' });
      expect(r.status).toBe('confirmed');
    });
  });

  it('un mensaje ya procesado no se guarda dos veces', async () => {
    await as(db, U.santi, async (tx) => {
      const id = await mensaje(tx, 'Tienda Doña Rosa 45 lucas');
      await guardar(tx, id, base);
      expect(await guardar(tx, id, base)).toEqual({ skipped: true, status: 'done' });
      expect(await count(tx, 'select 1 from public.expenses where message_id = $1', [id])).toBe(1);
    });
  });

  it('«No es un gasto» desde el worker', async () => {
    await as(db, U.santi, async (tx) => {
      const id = await mensaje(tx, 'buenos días a todos');
      await tx.query(`select public.worker_mark_message($1, 'not_expense', null, 'buenos días a todos')`, [id]);
      expect(await one(tx, 'select status, processed_at is not null as procesado from public.messages where id = $1', [id])).toEqual({
        status: 'not_expense',
        procesado: true,
      });
      await expect(tx.query(`select public.worker_mark_message($1, 'done')`, [id])).rejects.toThrow('no permitido');
    });
  });
});

describe('duplicados', () => {
  it('la misma factura (CUFE) no se registra dos veces en la cuenta', async () => {
    await as(db, U.santi, async (tx) => {
      const primero = await mensaje(tx, 'factura 1');
      const r1 = await guardar(tx, primero, { ...base, cufe: CUFE.toUpperCase() });
      const segundo = await mensaje(tx, 'factura 1 otra vez');
      const r2 = await guardar(tx, segundo, { ...base, cufe: CUFE });
      expect(r2).toEqual({ duplicate_of: r1.expense_id });
      expect(await one(tx, 'select status, duplicate_of from public.messages where id = $1', [segundo])).toEqual({
        status: 'duplicate',
        duplicate_of: r1.expense_id,
      });
      // En otra cuenta la misma factura sí puede estar
      const casa = await mensaje(tx, 'factura 1', U.valeria, CASA);
      const r3 = await guardar(tx, casa, { ...base, category_id: MERCADO_CASA, payer_person_id: P.casaValeria, cufe: CUFE });
      expect(r3.expense_id).toBeTruthy();
    });
  });

  it('una foto casi igual (huella a pocos bits) es la misma; una distinta no', async () => {
    await as(db, U.santi, async (tx) => {
      const primero = await mensaje(tx, 'foto');
      const r1 = await guardar(tx, primero, { ...base, image_hash: HASH });
      // 4 bits distintos: la misma foto recomprimida
      const casi = `${HASH.slice(0, -1)}${(Number.parseInt(HASH.slice(-1), 16) ^ 0xf).toString(16)}`;
      const segundo = await mensaje(tx, 'foto otra vez');
      expect(await guardar(tx, segundo, { ...base, image_hash: casi, merchant: 'Otro nombre leído' })).toEqual({ duplicate_of: r1.expense_id });
      // Muy distinta
      const tercero = await mensaje(tx, 'otra foto');
      const r3 = await guardar(tx, tercero, { ...base, image_hash: '0'.repeat(64), merchant: 'Pescadería El Muelle', total_cop: 99_000 });
      expect(r3.expense_id).toBeTruthy();
    });
  });

  it('distancia de Hamming entre huellas', async () => {
    const { rows } = await db.query<{ d: number | null }>(
      `select public.image_hash_distance(a, b) as d from (values ('ff00ff00ff00ff00', 'ff00ff00ff00ff00'), ('ff00ff00ff00ff00', 'ff00ff00ff00ff0f'),
         ('ff00ff00ff00ff00', 'ff00'), ('no es hex!!!!!!!', 'ff00ff00ff00ff00')) v (a, b)`,
    );
    expect(rows.map((r) => r.d)).toEqual([0, 4, null, null]);
  });

  it('mismo comercio, día y valor: va a revisión marcado como posible repetido', async () => {
    await as(db, U.santi, async (tx) => {
      const primero = await mensaje(tx, 'compra');
      const r1 = await guardar(tx, primero, base);
      const segundo = await mensaje(tx, 'compra de nuevo');
      const r2 = await guardar(tx, segundo, { ...base, status: 'confirmed' });
      expect(r2).toMatchObject({ status: 'pending_review', possible_duplicate_of: r1.expense_id });
      expect(await one(tx, `select ai_snapshot ->> 'possible_duplicate_of' as p from public.expenses where id = $1`, [r2.expense_id])).toEqual({
        p: r1.expense_id,
      });
    });
  });
});

describe('ejemplos para reentrenar a Laya', () => {
  it('exporta las correcciones con su contexto y las marca como exportadas', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoWorker(tx);
      const { x } = await one<{ x: { id: string; training_id: string; category: string; merchant: string; items: string[] }[] }>(
        tx,
        'select public.worker_training_export() as x',
      );
      expect(x.map((e) => [e.category, e.merchant])).toEqual([
        ['Mercado', 'Tienda Doña Rosa'],
        ['Café', 'CAFE DE LA ESQUINA'],
      ]);
      const { n } = await one<{ n: number }>(tx, 'select public.worker_mark_exported($1) as n', [x.map((e) => e.training_id)]);
      expect(n).toBe(2);
      expect((await one<{ x: unknown[] }>(tx, 'select public.worker_training_export() as x')).x).toHaveLength(0);
      expect((await one<{ x: unknown[] }>(tx, 'select public.worker_training_export(null, false, false) as x')).x).toHaveLength(2);
    });
  });

  it('con los confirmados también salen los gastos que revisó alguien', async () => {
    await as(db, U.valeria, async (tx) => {
      await comoWorker(tx);
      const { x } = await one<{ x: { source: string; category: string }[] }>(tx, 'select public.worker_training_export(null, true) as x');
      expect(x.filter((e) => e.source === 'confirmed').length).toBeGreaterThan(10);
      expect(x.every((e) => e.category)).toBe(true);
    });
  });
});

describe('permisos', () => {
  it('nadie llama las funciones del worker desde el API', async () => {
    for (const sql of [
      `select public.worker_claim_jobs('yo')`,
      `select public.worker_message_context('e0000000-0000-4000-8000-000000000017')`,
      `select public.worker_save_expense('e0000000-0000-4000-8000-000000000017', '{}')`,
      `select public.worker_fail_job('e0000000-0000-4000-8000-000000000017', 'x')`,
      `select public.worker_training_export()`,
      `select public.worker_find_duplicate('${PASEO}', null, null)`,
    ]) {
      await expect(as(db, U.valeria, (tx) => tx.query(sql))).rejects.toThrow(DENIED);
      await expect(as(db, null, (tx) => tx.query(sql))).rejects.toThrow(DENIED);
    }
  });

  it('el registro de errores no se ve desde el API', async () => {
    await expect(as(db, U.valeria, (tx) => tx.query('select * from public.job_errors'))).rejects.toThrow(DENIED);
  });
});
