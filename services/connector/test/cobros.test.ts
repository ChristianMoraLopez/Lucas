import { describe, expect, it } from 'vitest';
import { avisarCobros, mensajeCobro, mensajeGrupo, PRIMEROS_POR_VUELTA } from '../src/cobros.js';
import { reciboDe } from '../src/recibo.js';
import type { Cobro } from '../src/store.js';
import { esMensajeDeLuks, PISTA_AYUDA } from '../src/text.js';
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
  avisado_privado: false,
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
  it('por privado: cuánto, a quién y por qué, ítem por ítem, y que responda «ya pagué»', () => {
    expect(mensajeCobro(cobro(), WEB_URL)).toBe(
      [
        '💸 Hola Marimari 👋 Ya liquidamos «DaniChile»: debes *$195.000*.',
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
        '🔗 Todo el detalle: https://mrluks.com/r/TokenDeLaCuenta12345678?p=mari',
        '',
        'Cuando les pagues, respóndeme *ya le pagué a Daniel* (o *ya les pagué a todos*) y lo marco ✅',
        '',
        PISTA_AYUDA.es,
        '',
        '📊 Más detalle en mrluks.com',
      ].join('\n'),
    );
  });

  it('los recordatorios, en inglés y cuando se cruzaron las deudas', () => {
    const solo = { transfers: null, expenses: [restaurante] };
    expect(mensajeCobro(cobro({ ...solo, avisos: 1, avisado_privado: true }), WEB_URL).split('\n')[0]).toBe(
      '⏰ Hola Marimari, te recuerdo: de «DaniChile» le debes a Daniel *$165.000*.',
    );
    expect(mensajeCobro(cobro(solo), WEB_URL)).toContain('Cuando le pagues, respóndeme *ya pagué* y lo marco ✅');
    // Si solo se le había avisado en el grupo, el de privado es el primero
    expect(mensajeCobro(cobro({ ...solo, avisos: 1 }), WEB_URL).split('\n')[0]).toBe(
      '💸 Hola Marimari 👋 Ya liquidamos «DaniChile»: le debes a Daniel *$165.000*.',
    );
    const en = mensajeCobro(cobro({ account: { ...cobro().account, language: 'en' }, transfers: null }), WEB_URL);
    expect(en.split('\n')[0]).toBe('💸 Hi Marimari 👋 “DaniChile” was settled: you owe Daniel *$165,000*.');
    expect(en).toContain('• Coca Cola Zero (2 of 3): $20,000');
    expect(en).toContain('?p=mari&l=en');
    expect(en).toContain('When you pay, reply *paid* and I’ll mark it ✅');
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
    // Debajo de cada deuda, qué pidió en lo que pagó el otro y cuánto costó
    expect(m.split('\n').slice(0, 5)).toEqual([
      '💸 Ya liquidamos «DaniChile». Falta por pagar:',
      '• Marimari Gómez → Daniel: *$165.000*',
      '   ↳ Le Due Torri: Coca Cola Zero (2 de 3) $20.000 · Ravioli $90.000 · propina $55.000 = $165.000',
      '• Christian → Santiago: *$30.000*',
      '   ↳ Bruna (entre 6): $30.000',
    ]);
    expect(m).toContain('Cada uno ve lo suyo, ítem por ítem, aquí: https://mrluks.com/r/TokenDeLaCuenta12345678');
    expect(m).toContain('Cuando paguen, escríbanme «luks ya le pagué a Daniel» y lo marco ✅');
  });

  it('si quien cobra puso cómo le pagan, el mensaje dice a dónde mandarle la plata', () => {
    const pago = { nequi: '3001234567', llave: '@dani' };
    const uno = mensajeCobro(cobro({ to: { id: 'dan', name: 'Daniel', pago }, transfers: [{ to: 'Daniel', amount: 165_000, pago }] }), WEB_URL);
    expect(uno.split('\n').slice(0, 2)).toEqual([
      '💸 Hola Marimari 👋 Ya liquidamos «DaniChile»: le debes a Daniel *$165.000*.',
      '📲 Mándaselos a Daniel: Nequi *300 123 4567* · llave Bre-B *@dani*',
    ]);
    // A varios: a cada uno el suyo (quien no puso nada, no sale)
    const varios = mensajeCobro(
      cobro({
        transfers: [
          { to: 'Daniel', amount: 165_000, pago },
          { to: 'Santiago', amount: 30_000 },
        ],
      }),
      WEB_URL,
    );
    expect(varios.split('\n')[1]).toBe('📲 Mándaselos a Daniel: Nequi *300 123 4567* · llave Bre-B *@dani*');
    expect(varios).not.toContain('Mándaselos a Santiago');
    expect(
      mensajeCobro(
        cobro({
          account: { ...cobro().account, language: 'en' },
          to: { id: 'dan', name: 'Daniel', pago: { daviplata: '3109876543' } },
          transfers: [{ to: 'Daniel', amount: 1, pago: { daviplata: '3109876543' } }],
        }),
        WEB_URL,
      ),
    ).toContain('📲 Send it to Daniel: Daviplata *310 987 6543*');
    // Sin nada en el perfil, como antes
    expect(mensajeCobro(cobro(), WEB_URL)).not.toContain('📲');

    // En el grupo, una vez por cada quien que cobra
    const grupo = mensajeGrupo(
      [
        cobro({ to: { id: 'dan', name: 'Daniel', pago } }),
        cobro({ transfer_id: 't2', from: { id: 'chris', name: 'Christian' }, to: { id: 'dan', name: 'Daniel', pago }, amount: 9_000 }),
      ],
      WEB_URL,
    );
    expect(grupo).toContain('📲 Cómo pagarles:\n• Daniel: Nequi *300 123 4567* · llave Bre-B *@dani*\n');
    expect(grupo.match(/• Daniel: Nequi/g)).toHaveLength(1);
  });

  it('en el grupo, si se cruzaron las deudas, lo de cada uno va una sola vez', () => {
    // Marimari le paga a Santiago y a David, que no pagaron nada de lo suyo
    const m = mensajeGrupo(
      [cobro({ to: { id: 'david', name: 'David' }, amount: 100_000 }), cobro({ transfer_id: 't2', to: { id: 'chris', name: 'Christian' }, amount: 95_000 })],
      WEB_URL,
    );
    expect(m.split('\n').slice(1, 6)).toEqual([
      '• Marimari Gómez → David: *$100.000*',
      '   ↳ Le Due Torri: Coca Cola Zero (2 de 3) $20.000 · Ravioli $90.000 · propina $55.000 = $165.000',
      '   ↳ Bruna (entre 6): $30.000',
      '• Marimari Gómez → Christian: *$95.000*',
      '',
    ]);
    expect(esMensajeDeLuks(m)).toBe(true);
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
    expect(store.avisadosPorPrivado).toEqual(['t1']);
    expect(await avisarCobros(store, WEB_URL, silentLog)).toBe(0);
  });

  it('a quien nunca le ha escrito: se presenta, dice por qué le escribe y cómo pedir que no (la 600)', () => {
    const solo = { transfers: [{ to: 'Christian', amount: 9_800 }], to: { id: 'chris', name: 'Christian' }, amount: 9_800 };
    const m = mensajeCobro(
      cobro({ ...solo, primera_vez: true, account: { ...cobro().account, name: 'Nochita' }, from: { id: 'teffa', name: '@teffity_' } }),
      WEB_URL,
    );
    expect(m.split('\n').slice(0, 3)).toEqual([
      'Hola 👋 Soy *Mister Luks* 🤖, el bot que lleva las cuentas del grupo «Nochita» en Luks. Te escribo por aquí porque estás en ese grupo.',
      '',
      '💸 Ya liquidamos «Nochita»: le debes a Christian *$9.800*.',
    ]);
    expect(m).toContain('🙊 Si prefieres que no te escriba por aquí, respóndeme *no me escribas* y te aviso solo en el grupo.');
    expect(m).toContain('🔗 Todo el detalle: https://mrluks.com/r/');
    expect(esMensajeDeLuks(m)).toBe(true);
    // Con nombre, saluda; quien ya le había escrito no recibe la presentación
    expect(mensajeCobro(cobro({ ...solo, primera_vez: true }), WEB_URL).split('\n')[0]).toMatch(/^Hola Marimari 👋 Soy \*Mister Luks\*/);
    expect(mensajeCobro(cobro(solo), WEB_URL)).not.toContain('Soy *Mister Luks*');
    expect(mensajeCobro(cobro(solo), WEB_URL)).not.toContain('no me escribas');
    // Si no contestó, el recordatorio también va por privado (la 610), sin volver a presentarse entero
    const otra = mensajeCobro(
      cobro({ ...solo, primera_vez: true, avisos: 2, avisado_privado: true, account: { ...cobro().account, name: 'Nochita' } }),
      WEB_URL,
    );
    expect(otra.split('\n')[0]).toBe('⏰ Hola Marimari, soy *Mister Luks* 🤖, el bot de las cuentas de «Nochita». Te recuerdo: le debes a Christian *$9.800*.');
    expect(otra).toContain('*no me escribas*');
  });

  it('a quienes nunca le han escrito, pocos por vuelta: los demás, en la siguiente', async () => {
    const store = new FakeStore();
    const nuevos = ['31', '32', '33', '34', '35'].map((n, k) =>
      cobro({ transfer_id: `n${k}`, primera_vez: true, private_jid: `5730000000${n}@s.whatsapp.net`, from: { id: `p${k}`, name: `P${k}` } }),
    );
    store.cobrosPendientes = [cobro(), ...nuevos];
    for (const c of store.cobrosPendientes) store.presentes.add(`${c.private_jid}|contador`);
    expect(await avisarCobros(store, WEB_URL, silentLog)).toBe(1 + PRIMEROS_POR_VUELTA);
    expect(store.avisadosPorPrivado.sort()).toEqual(['n0', 'n1', 'n2', 't1']);
    expect(await avisarCobros(store, WEB_URL, silentLog)).toBe(2);
    expect(store.avisadosPorPrivado).toHaveLength(6);
  });

  it('si la base no deja el aviso en la bandeja (quien nunca le ha escrito), no queda como avisado', async () => {
    const store = new FakeStore();
    const nuevo = cobro({ transfer_id: 'n1', primera_vez: true, private_jid: '57300000031@s.whatsapp.net', from: { id: 'p1', name: 'P1' } });
    store.cobrosPendientes = [nuevo];
    expect(await avisarCobros(store, WEB_URL, silentLog)).toBe(0);
    expect(store.avisados).toEqual([]);
    // Cuando la base lo acepta, sale y queda avisado
    store.presentes.add('57300000031@s.whatsapp.net|contador');
    expect(await avisarCobros(store, WEB_URL, silentLog)).toBe(1);
    expect(store.avisadosPorPrivado).toEqual(['n1']);
  });

  it('a quien le paga a varios le llega un solo mensaje por privado', async () => {
    const store = new FakeStore();
    store.presentes.add(`${PRIVADO}|contador`);
    store.cobrosPendientes = [cobro(), cobro({ transfer_id: 't2', to: { id: 'santi', name: 'Santiago' }, amount: 30_000 })];
    expect(await avisarCobros(store, WEB_URL, silentLog)).toBe(1);
    expect(store.outbox[0].body).toContain('Le pagas $165.000 a Daniel y $30.000 a Santiago.');
    expect(store.avisadosPorPrivado).toEqual(['t1', 't2']);
  });

  it('lo de cada uno da lo mismo que en la app', () => {
    for (const persona of ['mari', 'dan', 'santi', 'chris', 'nadie']) {
      for (const e of [restaurante, bruna])
        expect(reciboDe(e, persona)).toEqual(deLaWeb({ ...e, items: e.items?.map((i) => ({ ...i, extra: false })) ?? null }, persona));
    }
  });
});
