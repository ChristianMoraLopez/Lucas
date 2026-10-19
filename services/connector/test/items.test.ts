import { describe, expect, it } from 'vitest';
import { contestar, contestarCantidad, leerCantidad, leerRespuesta, mensajeItems, preguntarItems } from '../src/items.js';
import type { ItemsPregunta } from '../src/store.js';
import { esMensajeDeLuks, looksLikeExpense } from '../src/text.js';
import { FakeStore, GRUPO, silentLog } from './fakes.js';

// ¿Quién pidió qué? por WhatsApp (migración 440)

const WEB = 'https://mrluks.com';
const CUENTA: ItemsPregunta = {
  expense_id: 'g1',
  group_jid: GRUPO,
  merchant: 'Le Due Torri',
  total: 330_000,
  tip: 0,
  payer_name: 'Daniel M Castelblanco',
  account: { id: 'dc', name: 'DaniChile', language: 'es', currency: 'COP' },
  items: [
    { id: 'i1', name: 'Coca Cola Zero', quantity: 3, total: 30_000 },
    { id: 'i2', name: 'Ravioli Napolitana', quantity: 1, total: 150_000 },
    { id: 'i3', name: 'Filete Grill', quantity: 1, total: 120_000 },
  ],
};

describe('la lista', () => {
  it('numerada, con cómo responderla y la firma', () => {
    expect(mensajeItems(CUENTA, WEB)).toBe(
      [
        '🧾 *Le Due Torri* · $330.000 (pagó Daniel)',
        '¿Quién pidió qué? Respondan *este mensaje* con los números de lo suyo:',
        '',
        '1. Coca Cola Zero ×3 · $30.000',
        '2. Ravioli Napolitana · $150.000',
        '3. Filete Grill · $120.000',
        '',
        'Cómo responder:',
        '• «2» → el ítem 2 entero (si otro también lo pide, se lo parten)',
        '• «1x2» o «1*2» → 2 de las 3 del ítem 1',
        '• «1, 3» → varios a la vez',
        '• «1 son 3» → si el ítem 1 eran 3 (el total no cambia)',
        'Lo que nadie diga se divide entre todos, y la propina y el servicio según lo que consumió cada uno. Si ya me escribiste por privado, allá te mando lo tuyo para que lo confirmes.',
        '',
        'Lo que no quede bien, terminen de revisarlo y repartirlo aquí: https://mrluks.com/c/dc/gastos/g1/dividir',
        '',
        '📊 Más detalle en mrluks.com',
      ].join('\n'),
    );
    expect(esMensajeDeLuks(mensajeItems(CUENTA, WEB))).toBe(true);
    const en = mensajeItems({ ...CUENTA, total: 300_000, account: { ...CUENTA.account, language: 'en' } }, WEB);
    expect(en).toContain('Who had what? Reply to *this message*');
    expect(en).toContain('• “1x2” or “1*2” → 2 of the 3 in item 1');
    expect(en).toContain('What nobody claims is split among everyone.');
    expect(en).toContain('If something isn’t right, finish reviewing and splitting it here: https://mrluks.com/c/dc/gastos/g1/dividir');
    // Si la base todavía no dice de qué cuenta es, sale sin el link
    const sinCuenta = mensajeItems({ ...CUENTA, account: { ...CUENTA.account, id: undefined as unknown as string } }, WEB);
    expect(sinCuenta).not.toContain('http');
    expect(sinCuenta).toContain('para que lo confirmes.\n\n📊 Más detalle en mrluks.com');
  });
});

describe('«la 1 son 3»: cuántas trae un ítem', () => {
  it.each([
    ['la 1 son 3', { n: 1, cantidad: 3 }],
    ['El 2 eran 2', { n: 2, cantidad: 2 }],
    ['3 = 4', { n: 3, cantidad: 4 }],
    ['1 son 3 limonadas', { n: 1, cantidad: 3 }],
    ['item 1 are 3', { n: 1, cantidad: 3 }],
  ])('«%s»', (t, c) => expect(leerCantidad(t)).toEqual(c));

  it('lo demás no (y «1, 3» son números de lo suyo)', () => {
    for (const t of ['1, 3', '1x2', 'son 3', 'la 1 son', 'la 1 son 0', 'las limonadas eran 3']) expect(leerCantidad(t)).toBeNull();
  });

  it('lo que contesta: cuántas, el total que no cambia y lo de cada una', () => {
    const r = {
      ok: true as const,
      language: 'es' as const,
      currency: 'CLP' as const,
      merchant: 'Místico',
      n: 1,
      item: 'Limonada Gen/ment',
      quantity: 3,
      total: 17_100,
    };
    expect(contestarCantidad(r)).toBe(
      '✅ Anotado: «Limonada Gen/ment» son 3 · $17.100 en total ($5.700 c/u). Ahora cada quien dice «1x1» si fue una de las 3.',
    );
    expect(esMensajeDeLuks(contestarCantidad(r))).toBe(true);
    expect(contestarCantidad({ ok: false, reason: 'cantidad', language: 'es' })).toBe('🤔 Tiene que ser entre 1 y 99.');
  });
});

describe('lo que responden', () => {
  it.each([
    ['1, 5', [{ n: 1 }, { n: 5 }]],
    ['yo la 1 y la 5', [{ n: 1 }, { n: 5 }]],
    ['1x2', [{ n: 1, units: 2 }]],
    ['1 x 2, 3', [{ n: 1, units: 2 }, { n: 3 }]],
    ['yo 2 de la 1', [{ n: 1, units: 2 }]],
    ['1 (2) y 4', [{ n: 1, units: 2 }, { n: 4 }]],
    ['3', [{ n: 3 }]],
    ['Yo: 1×1,5', [{ n: 1, units: 1.5 }]],
  ])('«%s»', (texto, claims) => expect(leerRespuesta(texto)).toEqual({ claims }));

  it('sin números o preguntando, no es una respuesta', () => {
    expect(leerRespuesta('jajaja')).toBeNull();
    expect(leerRespuesta('cuánto es la 3?')).toBeNull();
    expect(leerRespuesta('')).toBeNull();
    expect(leerRespuesta('0')).toBeNull();
  });

  it('y nunca parecen un gasto', () => {
    for (const t of ['1, 5', '1x2', '2 de la 1', '1 (2) y 4']) expect(looksLikeExpense(t)).toBe(false);
  });

  it('la confirmación: lo suyo y lo que le toca, en una línea que no se anota como gasto', () => {
    const r = {
      ok: true as const,
      language: 'es' as const,
      currency: 'COP' as const,
      merchant: 'Le Due Torri',
      name: 'Santiago Ricaurte',
      parte: 154_000,
      mios: [
        { n: 1, name: 'Coca Cola Zero', quantity: 3, units: 2 },
        { n: 3, name: 'Filete Grill', quantity: 1, units: 1 },
      ],
      sin_nadie: 1,
    };
    expect(contestar(r)).toBe('✅ Anotado: Santiago → Coca Cola Zero (2 de 3), Filete Grill · $154.000 en «Le Due Torri»\nFalta 1 por decir de quién es.');
    expect(esMensajeDeLuks(contestar(r))).toBe(true);
    expect(contestar({ ...r, sin_nadie: 0, language: 'en' })).toBe('✅ Logged: Santiago → Coca Cola Zero (2 of 3), Filete Grill · $154,000 in “Le Due Torri”');
    expect(contestar({ ok: false, reason: 'no_existe', language: 'es', total_items: 3 })).toBe('🤔 La lista va del 1 al 3.');
    expect(contestar({ ok: false, reason: 'liquidado', language: 'es', merchant: 'Le Due Torri' })).toContain('ya está liquidada');
  });
});

describe('preguntar', () => {
  it('una lista por cuenta al grupo, y no se repite', async () => {
    const store = new FakeStore();
    store.presentes.add(`${GRUPO}|contador`);
    store.porPreguntar = [CUENTA];
    expect(await preguntarItems(store, WEB, silentLog)).toBe(1);
    expect(store.outbox).toEqual([expect.objectContaining({ chat_jid: GRUPO, reason: 'answer', dedupe_key: 'items:g1', body: mensajeItems(CUENTA, WEB) })]);
    expect(store.listas.get('g1')).toEqual({ items: ['i1', 'i2', 'i3'], chat: GRUPO, dedupe: 'items:g1' });
    expect(await preguntarItems(store, WEB, silentLog)).toBe(0);
  });
});
