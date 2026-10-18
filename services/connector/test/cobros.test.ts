import { describe, expect, it } from 'vitest';
import { avisarCobros, mensajeCobro, mensajeGrupo } from '../src/cobros.js';
import { reciboDe } from '../src/recibo.js';
import type { Cobro } from '../src/store.js';
import { esMensajeDeLuks } from '../src/text.js';
import { FakeStore, GRUPO, silentLog } from './fakes.js';

// El de la web se carga al correr la prueba (tsc del connector no revisa archivos de la web)
const WEB = new URL('../../../apps/web/lib/recibo.ts', import.meta.url).href;
const { reciboDe: deLaWeb } = (await import(WEB)) as { reciboDe: typeof reciboDe };

const WEB_URL = 'https://mrluks.com';
const PRIVADO = '573016667788@s.whatsapp.net';

const restaurante = {
  merchant: 'Le Due Torri',
  payer_person_id: 'dan',
  payer_name: 'Daniel',
  shares: [
    { person_id: 'mari', amount_cop: 165_000 },
    { person_id: 'dan', amount_cop: 100_000 },
    { person_id: 'santi', amount_cop: 50_000 },
  ],
  items: [
    {
      name: 'Coca Cola Zero',
      quantity: 3,
      total: 30_000,
      people: [
        { id: 'mari', units: 2 },
        { id: 'dan', units: 1 },
      ],
    },
    { name: 'Ravioli', quantity: 1, total: 90_000, people: [{ id: 'mari', units: 1 }] },
  ],
};
const bruna = {
  merchant: 'Bruna',
  payer_person_id: 'santi',
  payer_name: 'Santiago',
  shares: ['mari', 'dan', 'santi', 'chris', 'david', 'diaz'].map((person_id) => ({ person_id, amount_cop: 30_000 })),
  items: null,
};

const cobro = (o: Partial<Cobro> = {}): Cobro => ({
  transfer_id: 't1',
  settlement_id: 's1',
  avisos: 0,
  account: { id: 'a1', name: 'DaniChile', language: 'es', currency: 'COP', type: 'evento', month: null },
  from: { id: 'mari', name: 'Marimari Gómez' },
  to: { id: 'dan', name: 'Daniel' },
  amount: 165_000,
  private_jid: PRIVADO,
  group_jid: GRUPO,
  token: 'TokenDeLaCuenta12345678',
  transfers: [
    { to: 'Daniel', amount: 165_000 },
    { to: 'Santiago', amount: 30_000 },
  ],
  expenses: [restaurante, bruna],
  ...o,
});

describe('avisos de cobro', () => {
  it('por privado: cuánto, a quién y por qué, ítem por ítem, con el link para marcarlo', () => {
    expect(mensajeCobro(cobro(), WEB_URL)).toBe(
      [
        '💸 Hola Marimari 👋 Ya liquidamos «DaniChile»: le debes a Daniel *$165.000*.',
        '',
        '🧾 *Lo tuyo, ítem por ítem:*',
        '',
        '*Le Due Torri* (pagó Daniel)',
        '• Coca Cola Zero (2 de 3): $20.000',
        '• Ravioli: $90.000',
        '• Propina y servicio: $55.000',
        'Total: *$165.000*',
        '',
        '*Bruna* (pagó Santiago)',
        '• Tu parte (entre 6): $30.000',
        '',
        'Le pagas $165.000 a Daniel y $30.000 a Santiago.',
        '',
        'Cuando le pagues, márcalo aquí: https://mrluks.com/r/TokenDeLaCuenta12345678?p=mari',
        '',
        '📊 Más detalle en mrluks.com',
      ].join('\n'),
    );
  });

  it('los recordatorios, en inglés y cuando se cruzaron las deudas', () => {
    expect(mensajeCobro(cobro({ avisos: 1 }), WEB_URL).split('\n')[0]).toBe('⏰ Hola Marimari, te recuerdo: de «DaniChile» le debes a Daniel *$165.000*.');
    const en = mensajeCobro(cobro({ account: { ...cobro().account, language: 'en' }, transfers: null }), WEB_URL);
    expect(en.split('\n')[0]).toBe('💸 Hi Marimari 👋 “DaniChile” was settled: you owe Daniel *$165,000*.');
    expect(en).toContain('• Coca Cola Zero (2 of 3): $20,000');
    expect(en).toContain('?p=mari&l=en');
    const cruzado = mensajeCobro(cobro({ to: { id: 'otro', name: 'Felipe' }, expenses: [bruna], amount: 30_000, transfers: null }), WEB_URL);
    expect(cruzado).toContain('Se cruzaron las deudas para hacer menos transferencias: por eso le pagas a Felipe.');
  });

  it('nada de lo que manda se anota como gasto', () => {
    expect(esMensajeDeLuks(mensajeCobro(cobro(), WEB_URL))).toBe(true);
    expect(esMensajeDeLuks(mensajeGrupo([cobro()], WEB_URL))).toBe(true);
  });

  it('en el grupo, un solo mensaje con lo que falta de quienes no le han escrito', () => {
    const m = mensajeGrupo(
      [cobro(), cobro({ transfer_id: 't2', from: { id: 'chris', name: 'Christian' }, to: { id: 'santi', name: 'Santiago' }, amount: 30_000 })],
      WEB_URL,
    );
    expect(m.split('\n').slice(0, 3)).toEqual([
      '💸 Ya liquidamos «DaniChile». Falta por pagar:',
      '• Marimari Gómez → Daniel: *$165.000*',
      '• Christian → Santiago: *$30.000*',
    ]);
    expect(m).toContain('Cada uno ve lo suyo, ítem por ítem, y lo marca pagado aquí: https://mrluks.com/r/TokenDeLaCuenta12345678');
  });

  it('una vuelta: por privado a quien ya le escribió, el resto en el grupo, y no se repite', async () => {
    const store = new FakeStore();
    store.presentes.add(`${PRIVADO}|contador`);
    store.presentes.add(`${GRUPO}|contador`);
    store.cobrosPendientes = [
      cobro(),
      cobro({ transfer_id: 't2', private_jid: null, from: { id: 'chris', name: 'Christian' }, to: { id: 'santi', name: 'Santiago' }, amount: 30_000 }),
      cobro({ transfer_id: 't3', private_jid: null, from: { id: 'david', name: 'David' }, to: { id: 'dan', name: 'Daniel' }, amount: 67_265 }),
    ];
    expect(await avisarCobros(store, WEB_URL, silentLog)).toBe(2);
    expect(store.outbox.map((o) => [o.chat_jid, o.dedupe_key])).toEqual([
      [PRIVADO, 'cobro:t1:0'],
      [GRUPO, 'cobro-grupo:s1:0'],
    ]);
    expect(store.outbox[1].body).toContain('• David → Daniel: *$67.265*');
    expect(store.avisados.sort()).toEqual(['t1', 't2', 't3']);
    expect(await avisarCobros(store, WEB_URL, silentLog)).toBe(0);
  });

  it('lo de cada uno da lo mismo que en la app', () => {
    for (const persona of ['mari', 'dan', 'santi', 'chris', 'nadie']) {
      for (const e of [restaurante, bruna])
        expect(reciboDe(e, persona)).toEqual(deLaWeb({ ...e, items: e.items?.map((i) => ({ ...i, extra: false })) ?? null }, persona));
    }
  });
});
