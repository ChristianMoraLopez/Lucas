import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, CASA, count, createDb, GASTO_ASADERO, impersonate, one, P, PASEO, U } from './harness';

// Fase 2: subidas, procesador simulado, revisión, memoria de comercios y resúmenes.

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const DENIED = /permission denied|row-level security/;

/** Sube (como el usuario actual) un objeto al bucket de evidencias. */
async function subirObjeto(tx: Transaction, cuenta: string, archivo = 'recibo.webp') {
  const name = `${cuenta}/${archivo}`;
  await tx.query(`insert into storage.objects (bucket_id, name, owner) values ('evidencias', $1, auth.uid())`, [name]);
  return name;
}

/** Procesa la cola como lo haría el cron (con permisos de sistema) y vuelve al usuario. */
async function procesar(tx: Transaction, volverA: string) {
  await tx.exec('reset role');
  const { rows } = await tx.query<{ n: number }>('select public.run_simulated_worker() as n');
  await impersonate(tx, volverA);
  return rows[0].n;
}

describe('parse_cop_amount: montos como los escribe la gente', () => {
  const casos: [string, number | null][] = [
    ['taxis al aeropuerto 100 lucas', 100_000],
    ['132,5 lucas', 132_500],
    ['me debes 40 lucas', 40_000],
    ['84 mil el mercado', 84_000],
    ['1,2 palos el hotel', 1_200_000],
    ['2 millones', 2_000_000],
    ['$84.300', 84_300],
    ['Empanadas y jugos en La Bahía 111.500', 111_500],
    ['TOTAL 1.014.500', 1_014_500],
    ['84.300,50', 84_300],
    ['84300', 84_300],
    ['pagué 38 el taxi', 38_000],
    ['50k de gasolina', 50_000],
    ['almuerzo del 26/09', null],
    ['sin plata', null],
  ];
  for (const [texto, esperado] of casos) {
    it(`«${texto}» → ${esperado}`, async () => {
      const r = await db.query<{ v: number | null }>('select public.parse_cop_amount($1) as v', [texto]);
      expect(r.rows[0].v === null ? null : Number(r.rows[0].v)).toBe(esperado);
    });
  }
});

describe('lectura de mensajes', () => {
  it('saca el comercio del texto', async () => {
    const { rows } = await db.query<{ m: string }>(
      `select public.merchant_from_text(t) as m from unnest(array[
         'taxis al aeropuerto 100 lucas',
         'La lancha a Playa Cristal la pagó Santi: 210.500',
         'pagué el almuerzo en El Sazón de Mamá 41.200',
         '100 lucas'
       ]) t`,
    );
    expect(rows.map((r) => r.m)).toEqual(['Taxis al aeropuerto', 'Lancha a Playa Cristal', 'Almuerzo en El Sazón de Mamá', 'Gasto sin nombre']);
  });

  it('adivina la categoría por palabras', async () => {
    const { rows } = await db.query<{ c: string }>(
      `select public.guess_category(t) as c from unnest(array['taxis al aeropuerto', 'cervezas y hielo', 'mercado en la tienda', 'factura del agua', 'algo raro']) t`,
    );
    expect(rows.map((r) => r.c)).toEqual(['Transporte', 'Licor', 'Mercado', 'Servicios', 'Otros']);
  });

  it('detecta quién pagó cuando el mensaje lo dice', async () => {
    const q = (t: string) => db.query<{ p: string | null }>('select public.detect_payer($1, $2) as p', [PASEO, t]).then((r) => r.rows[0].p);
    expect(await q('La lancha la pagó Santi: 210.500')).toBe(P.paseoSanti);
    expect(await q('Vale pagó el almuerzo, 80 lucas')).toBe(P.paseoValeria);
    expect(await q('pagué el taxi, 38 lucas')).toBeNull();
  });
});

describe('evidencias en Storage', () => {
  it('cada quien sube a la carpeta de su cuenta, no a otra', async () => {
    await as(db, U.santi, async (tx) => {
      expect(await subirObjeto(tx, PASEO)).toBe(`${PASEO}/recibo.webp`);
    });
    await expect(as(db, U.santi, (tx) => subirObjeto(tx, CASA))).rejects.toThrow(DENIED);
    await expect(as(db, U.santi, (tx) => subirObjeto(tx, 'no-es-uuid'))).rejects.toThrow(DENIED);
  });

  it('solo los miembros ven las evidencias de la cuenta', async () => {
    await as(db, U.santi, async (tx) => {
      await subirObjeto(tx, PASEO);
      await impersonate(tx, U.nuevo);
      expect(await count(tx, 'select 1 from storage.objects')).toBe(0);
      await impersonate(tx, U.mafe);
      expect(await count(tx, 'select 1 from storage.objects')).toBe(1);
    });
  });

  it('un member no borra evidencias; un admin sí', async () => {
    await as(db, U.santi, async (tx) => {
      const name = await subirObjeto(tx, PASEO);
      expect(await count(tx, 'delete from storage.objects where name = $1 returning 1', [name])).toBe(0);
      await impersonate(tx, U.laura);
      expect(await count(tx, 'delete from storage.objects where name = $1 returning 1', [name])).toBe(1);
    });
  });
});

describe('submit_upload', () => {
  it('un mensaje de texto crea el mensaje y el trabajo en la cola', async () => {
    await as(db, U.santi, async (tx) => {
      const { id } = await one<{ id: string }>(tx, `select public.submit_upload($1, 'text', 'taxis al aeropuerto 100 lucas') as id`, [PASEO]);
      expect(await one(tx, 'select source, status, sender_person_id from public.messages where id = $1', [id])).toEqual({
        source: 'web',
        status: 'queued',
        sender_person_id: P.paseoSanti,
      });
      await tx.exec('reset role');
      expect(await count(tx, `select 1 from public.jobs where payload ->> 'message_id' = $1 and status = 'queued'`, [id])).toBe(1);
    });
  });

  it('una foto exige que el archivo ya esté subido y en la carpeta de la cuenta', async () => {
    await expect(as(db, U.santi, (tx) => tx.query(`select public.submit_upload($1, 'photo', null, $2)`, [PASEO, `${PASEO}/no-existe.webp`]))).rejects.toThrow(
      'No encontramos el archivo',
    );
    await expect(as(db, U.santi, (tx) => tx.query(`select public.submit_upload($1, 'photo', null, $2)`, [PASEO, `${CASA}/x.webp`]))).rejects.toThrow(
      'carpeta de esta cuenta',
    );
    await as(db, U.santi, async (tx) => {
      const ruta = await subirObjeto(tx, PASEO);
      const { id } = await one<{ id: string }>(tx, `select public.submit_upload($1, 'photo', null, $2, 'recibo.jpg', 'image/webp') as id`, [PASEO, ruta]);
      expect(await one(tx, 'select kind, media_path from public.messages where id = $1', [id])).toEqual({ kind: 'photo', media_path: ruta });
    });
  });

  it('nadie sube a una cuenta ajena ni a una cerrada', async () => {
    await expect(as(db, U.santi, (tx) => tx.query(`select public.submit_upload($1, 'text', 'hola 20 lucas')`, [CASA]))).rejects.toThrow('No eres miembro');
    await as(db, U.valeria, async (tx) => {
      await tx.query('select public.close_account($1)', [PASEO]);
      await expect(tx.query(`select public.submit_upload($1, 'text', 'hola 20 lucas')`, [PASEO])).rejects.toThrow('cerrada');
    });
  });

  it('los mensajes de la cuenta los ven sus miembros y nadie más', async () => {
    await as(db, U.santi, async (tx) => {
      await tx.query(`select public.submit_upload($1, 'text', 'hielo 12 lucas')`, [PASEO]);
      expect(await count(tx, `select 1 from public.messages where source = 'web'`)).toBe(1);
      await impersonate(tx, U.nuevo);
      expect(await count(tx, 'select 1 from public.messages')).toBe(0);
    });
  });

  it('el procesador no se puede llamar desde el API', async () => {
    await expect(as(db, U.valeria, (tx) => tx.query('select public.run_simulated_worker()'))).rejects.toThrow(DENIED);
    await expect(as(db, U.valeria, (tx) => tx.query('select public.simulate_process_message($1)', [GASTO_ASADERO]))).rejects.toThrow(DENIED);
  });
});

describe('procesador simulado', () => {
  it('un mensaje se vuelve un gasto pendiente, dividido entre todos', async () => {
    await as(db, U.santi, async (tx) => {
      const { id } = await one<{ id: string }>(tx, `select public.submit_upload($1, 'text', 'taxis al aeropuerto 100 lucas') as id`, [PASEO]);
      expect(await procesar(tx, U.santi)).toBe(1);

      const gasto = await one<Record<string, unknown>>(
        tx,
        `select e.merchant, e.total_cop::int as total, e.status, e.payer_person_id, e.source, c.name as categoria,
                (select sum(s.amount_cop)::int from public.expense_splits s where s.expense_id = e.id) as dividido,
                (select count(*)::int from public.expense_splits s where s.expense_id = e.id) as personas,
                e.ai_snapshot ->> 'merchant' as leido, (e.field_confidence ->> 'merchant')::numeric as conf_comercio
         from public.expenses e left join public.categories c on c.id = e.category_id
         where e.message_id = $1`,
        [id],
      );
      expect(gasto).toMatchObject({
        merchant: 'Taxis al aeropuerto',
        total: 100_000,
        status: 'pending_review',
        payer_person_id: P.paseoSanti,
        source: 'web',
        categoria: 'Transporte',
        dividido: 100_000,
        personas: 8,
        leido: 'Taxis al aeropuerto',
      });
      expect(Number(gasto.conf_comercio)).toBeLessThan(0.75);
      expect(await one(tx, 'select status from public.messages where id = $1', [id])).toEqual({ status: 'done' });
    });
  });

  it('si el mensaje dice quién pagó, el pagador es esa persona', async () => {
    await as(db, U.mafe, async (tx) => {
      const { id } = await one<{ id: string }>(tx, `select public.submit_upload($1, 'text', 'La lancha la pagó Santi: 210.500') as id`, [PASEO]);
      await procesar(tx, U.mafe);
      expect(await one(tx, 'select payer_person_id from public.expenses where message_id = $1', [id])).toEqual({ payer_person_id: P.paseoSanti });
    });
  });

  it('una foto da un comercio del catálogo con monto redondo y confianza por campo', async () => {
    await as(db, U.santi, async (tx) => {
      const ruta = await subirObjeto(tx, PASEO);
      const { id } = await one<{ id: string }>(tx, `select public.submit_upload($1, 'photo', null, $2) as id`, [PASEO, ruta]);
      await procesar(tx, U.santi);
      const g = await one<{ total: number; evidence_path: string; confs: number }>(
        tx,
        `select total_cop::int as total, evidence_path, (select count(*)::int from jsonb_object_keys(field_confidence)) as confs
         from public.expenses where message_id = $1`,
        [id],
      );
      expect(g.total % 100).toBe(0);
      expect(g.total).toBeGreaterThan(0);
      expect(g.evidence_path).toBe(ruta);
      expect(g.confs).toBe(5);
    });
  });

  it('la memoria de comercios clasifica lo que ya conoce', async () => {
    await as(db, U.valeria, async (tx) => {
      // «Tienda Doña Rosa» está en la memoria del paseo como Mercado
      const { id } = await one<{ id: string }>(tx, `select public.submit_upload($1, 'text', 'Tienda Doña Rosa 45 lucas') as id`, [PASEO]);
      await procesar(tx, U.valeria);
      expect(
        await one(
          tx,
          `select c.name, (e.field_confidence ->> 'category')::numeric::text as conf
           from public.expenses e join public.categories c on c.id = e.category_id where e.message_id = $1`,
          [id],
        ),
      ).toEqual({ name: 'Mercado', conf: '0.96' });
    });
  });
});

describe('revisión', () => {
  const REVISAR = 'select public.review_expense($1, $2, $3, $4, $5, $6, $7, true)';
  const LICOR = '40000000-0000-4000-8000-000000000012';
  const RESTAURANTE = '40000000-0000-4000-8000-000000000016';
  const FELIPE = P.felipe;
  const CUATRO = [P.paseoValeria, P.paseoSanti, P.caro, P.felipe];

  it('admin confirma con correcciones: queda quién corrigió, la división y la memoria', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.query(REVISAR, [GASTO_ASADERO, 'Asadero El Rodadero', '2026-09-28', 280_000, RESTAURANTE, FELIPE, `{${CUATRO.join(',')}}`]);
      const g = await one<Record<string, unknown>>(
        tx,
        `select status, total_cop::int as total, corrected_by,
                (select array_agg(amount_cop::int order by amount_cop) from public.expense_splits where expense_id = $1) as partes
         from public.expenses where id = $1`,
        [GASTO_ASADERO],
      );
      expect(g).toEqual({ status: 'confirmed', total: 280_000, corrected_by: U.laura, partes: [70_000, 70_000, 70_000, 70_000] });
      expect(await one(tx, `select category_id from public.merchant_memory where account_id = $1 and normalized = 'asadero el rodadero'`, [PASEO])).toEqual({
        category_id: RESTAURANTE,
      });
    });
  });

  it('la división reparte los pesos que no dan exacto', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.query(REVISAR, [GASTO_ASADERO, 'Asadero El Rodadero', '2026-09-28', 100_001, RESTAURANTE, FELIPE, `{${CUATRO.slice(0, 3).join(',')}}`]);
      const { rows } = await tx.query<{ a: number }>('select amount_cop::int as a from public.expense_splits where expense_id = $1 order by a desc', [
        GASTO_ASADERO,
      ]);
      expect(rows.map((r) => r.a)).toEqual([33_334, 33_334, 33_333]);
    });
  });

  it('cambiar la categoría deja un ejemplo para reentrenar a Laya', async () => {
    await as(db, U.laura, async (tx) => {
      await tx.query(REVISAR, [GASTO_ASADERO, 'Asadero El Rodadero', '2026-09-28', 272_500, LICOR, FELIPE, `{${CUATRO.join(',')}}`]);
      expect(
        await count(tx, `select 1 from public.training_examples where expense_id = $1 and source = 'correction' and category_id = $2`, [GASTO_ASADERO, LICOR]),
      ).toBe(1);
    });
  });

  it('confirmar sin cambiar nada no marca corrección', async () => {
    await as(db, U.laura, async (tx) => {
      const e = await one<Record<string, unknown>>(
        tx,
        'select merchant, expense_date::text as d, total_cop::int as t, category_id, payer_person_id from public.expenses where id = $1',
        [GASTO_ASADERO],
      );
      await tx.query(REVISAR, [GASTO_ASADERO, e.merchant, e.d, e.t, e.category_id, e.payer_person_id, `{${CUATRO.join(',')}}`]);
      expect(await one(tx, 'select corrected_by, status from public.expenses where id = $1', [GASTO_ASADERO])).toEqual({
        corrected_by: null,
        status: 'confirmed',
      });
    });
  });

  it('un member no confirma; y nada de personas de otra cuenta ni totales en cero', async () => {
    await expect(as(db, U.santi, (tx) => tx.query(REVISAR, [GASTO_ASADERO, 'X', '2026-09-28', 1000, null, FELIPE, `{${FELIPE}}`]))).rejects.toThrow(
      'Solo quienes administran',
    );
    await expect(as(db, U.laura, (tx) => tx.query(REVISAR, [GASTO_ASADERO, 'X', '2026-09-28', 1000, null, P.casaValeria, `{${FELIPE}}`]))).rejects.toThrow(
      'Elige quién pagó',
    );
    await expect(as(db, U.laura, (tx) => tx.query(REVISAR, [GASTO_ASADERO, 'X', '2026-09-28', 0, null, FELIPE, `{${FELIPE}}`]))).rejects.toThrow(
      'mayor que cero',
    );
    await expect(as(db, U.laura, (tx) => tx.query(REVISAR, [GASTO_ASADERO, 'X', '2026-09-28', 1000, null, FELIPE, `{${P.casaValeria}}`]))).rejects.toThrow(
      'no es de esta cuenta',
    );
  });

  it('«No es un gasto»: admin lo descarta y el mensaje queda marcado; member no', async () => {
    await expect(as(db, U.santi, (tx) => tx.query('select public.discard_expense($1)', [GASTO_ASADERO]))).rejects.toThrow('Solo quienes administran');
    await as(db, U.laura, async (tx) => {
      await tx.query('select public.discard_expense($1)', [GASTO_ASADERO]);
      expect(await count(tx, 'select 1 from public.expenses where id = $1', [GASTO_ASADERO])).toBe(0);
      expect(await one(tx, `select status from public.messages where id = 'e0000000-0000-4000-8000-000000000017'`)).toEqual({ status: 'not_expense' });
    });
  });
});

describe('account_dashboard', () => {
  type Tablero = {
    total: number;
    budget: number;
    pending_count: number;
    categories: { name: string; total: number; budget: number | null }[];
    trend: { total: number }[];
    people: { name: string; paid: number; balance: number }[];
    recent: { merchant: string }[];
  };
  const tablero = (usuario: string, cuenta: string) =>
    as(db, usuario, async (tx) => (await one<{ d: Tablero }>(tx, 'select public.account_dashboard($1) as d', [cuenta])).d);

  it('Casa: el mes, las categorías con presupuesto y la tendencia de 6 meses del kit', async () => {
    const d = await tablero(U.valeria, CASA);
    expect(d.total).toBe(2_395_200);
    expect(d.budget).toBe(2_600_000);
    expect(d.pending_count).toBe(1);
    expect(d.categories.map((c) => [c.name, c.total, c.budget])).toEqual([
      ['Mercado', 1_184_300, 1_300_000],
      ['Servicios', 486_900, 450_000],
      ['Restaurante', 312_000, 350_000],
      ['Transporte', 231_700, 300_000],
      ['Licor', 96_000, 120_000],
      ['Café', 84_300, 80_000],
    ]);
    expect(d.trend.map((t) => t.total)).toEqual([2_180_400, 2_412_900, 2_265_000, 2_598_300, 2_341_700, 2_395_200]);
    expect(d.recent).toHaveLength(6);
  });

  it('Paseo: lo que cada quien pagó contra lo que le toca, como en la captura 4', async () => {
    const d = await tablero(U.santi, PASEO);
    expect(d.total).toBe(4_816_000);
    expect(d.people.map((p) => [p.name, p.balance])).toEqual([
      ['Valeria', 412_500],
      ['Laura', 268_000],
      ['Mafe', 151_500],
      ['Caro', -100_000],
      ['Juan Camilo', -132_500],
      ['Felipe', -151_500],
      ['Andrés', -168_000],
      ['Santi', -280_000],
    ]);
    expect(d.categories.map((c) => c.name)).toEqual(['Hospedaje', 'Restaurante', 'Transporte', 'Licor', 'Mercado']);
  });

  it('una cuenta ajena no devuelve nada', async () => {
    expect(await tablero(U.santi, CASA)).toBeNull();
  });
});
