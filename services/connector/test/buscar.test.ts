import { beforeEach, describe, expect, it } from 'vitest';
import { busquedaDe, respuestaBusqueda } from '../src/buscar.js';
import type { IncomingMessage } from '../src/connector.js';
import { Ingestor } from '../src/ingest.js';
import { RateLimiter } from '../src/replies.js';
import type { BusquedaGastos } from '../src/store.js';
import { esMensajeDeLuks } from '../src/text.js';
import { contador, FakeConnector, FakeStore, GRUPO, grupo, silentLog } from './fakes.js';

// «¿Cuándo fue la última vez que compré comida para el perro?» (migración 760)

describe('qué preguntan', () => {
  it('la última vez que compré comida para mi perro: dos grupos de palabras, con sus parecidas, y Mascotas', () => {
    const b = busquedaDe('¿Cuándo fue la última vez que compré comida para mi perro?');
    expect(b).toMatchObject({ modo: 'ultima', que: 'comida perro', categorias: ['Mascotas'], categoriaBasta: false });
    expect(b?.grupos[0]).toEqual(expect.arrayContaining(['comid', 'food', 'concentrad']));
    expect(b?.grupos[1]).toEqual(expect.arrayContaining(['perr', 'dog', 'chunky']));
  });

  it('por la categoría a secas, estar en ella basta', () => {
    expect(busquedaDe('qué días gasté en mascotas')).toMatchObject({ modo: 'dias', categorias: ['Mascotas'], categoriaBasta: true });
    expect(busquedaDe('¿Tengo registro de comida para perro?')).toMatchObject({ modo: 'dias', que: 'comida perro' });
    expect(busquedaDe('cuánto he gastado en taxis')).toMatchObject({ modo: 'cuanto', categorias: ['Transporte'] });
    expect(busquedaDe('When did I last buy dog food?')).toMatchObject({ modo: 'ultima', categorias: ['Mascotas'] });
  });

  it('lo demás no es una búsqueda', () => {
    expect(busquedaDe('cuánto llevamos')).toBeNull();
    expect(busquedaDe('quién le debe a quién')).toBeNull();
    expect(busquedaDe('pizza 80 lucas')).toBeNull();
    expect(busquedaDe('cuándo')).toBeNull();
    // El total de siempre, aunque diga «en…»
    expect(busquedaDe('¿cuánto hemos gastado en el paseo?')).toBeNull();
    expect(busquedaDe('cuánto he gastado en total')).toBeNull();
  });
});

const VACIO: BusquedaGastos = { ok: true, seguros: { n: 0, total: 0, gastos: [] }, quizas: { n: 0, gastos: [] } };
const g = (fecha: string, comercio: string, total: number, categoria: string | null = 'Mascotas', cuenta = 'Casa') => ({
  fecha,
  comercio,
  total,
  moneda: 'COP',
  categoria,
  cuenta,
  pago: 'Christian',
});

describe('lo que responde', () => {
  const comidaPerro = busquedaDe('¿Cuándo fue la última vez que compré comida para mi perro?')!;

  it('la última vez, lo de antes, cuánto suman y aparte lo que solo está en Mascotas', () => {
    const r: BusquedaGastos = {
      ok: true,
      seguros: { n: 2, total: 77_900, gastos: [g('2026-11-07', 'Homecenter', 32_900), g('2026-10-15', 'Tienda de Doña Rosa', 45_000, null)] },
      quizas: { n: 1, gastos: [g('2026-09-29', 'Homecenter', 116_100)] },
    };
    expect(respuestaBusqueda(comidaPerro, r, 'es')).toBe(
      [
        '🔎 La última vez de «comida perro» fue el *7 nov*: Homecenter, *$32.900*.',
        '',
        'Antes:',
        '• 15 oct: Tienda de Doña Rosa, *$45.000*',
        '',
        'En total, 2 veces: *$77.900*.',
        '',
        'Estos están en Mascotas, pero el recibo no dice qué fue:',
        '• 29 sep: Homecenter, *$116.100*',
        '',
        '📊 Más detalle en mrluks.com',
      ].join('\n'),
    );
    // Lleva la firma: nadie lo anota como un gasto
    expect(esMensajeDeLuks(respuestaBusqueda(comidaPerro, r, 'es'))).toBe(true);
  });

  it('si no hay nada, lo dice y ofrece anotarlo', () => {
    expect(respuestaBusqueda(comidaPerro, VACIO, 'es')).toBe('🔎 No tengo nada anotado de «comida perro».\nSi sí lo compraste, mándame el recibo y lo anoto.');
  });
});

describe('en el chat', () => {
  let store: FakeStore;
  let wa: FakeConnector;
  let ing: Ingestor;
  const PRIVADO = '573016667788@s.whatsapp.net';
  const m = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
    sessionId: 'contador',
    chatId: PRIVADO,
    chatKind: 'privado',
    chatName: null,
    messageId: `W${Math.random().toString(36).slice(2, 8)}`,
    sender: { id: '573016667788', phone: '573016667788', name: 'Christian' },
    sentAt: new Date('2026-11-08T15:00:00Z'),
    text: 'Hola',
    media: null,
    fromMe: false,
    ...over,
  });

  beforeEach(async () => {
    store = new FakeStore();
    wa = new FakeConnector(contador);
    const joins = new RateLimiter({ minIntervalMs: 0, maxPerHourPerGroup: 2, maxPerHourTotal: 4 }, () => 0);
    ing = new Ingestor(
      store,
      { maxDownloadBytes: 1, maxChatBytes: 1, maxUploadBytes: 1, maxSide: 1600, jpegQuality: 80 },
      { guiaUrl: 'https://mrluks.com/guia', joins },
      silentLog,
    );
    store.hallados = { ...VACIO, seguros: { n: 1, total: 32_900, gastos: [g('2026-11-07', 'Homecenter', 32_900)] } };
  });

  it('por privado responde ahí, buscando en sus cuentas', async () => {
    await ing.onMessage(contador, wa, m({ text: 'gracias' }));
    expect(await ing.onMessage(contador, wa, m({ text: '¿Cuándo fue la última vez que compré comida para mi perro?' }))).toBe('buscar:ultima');
    expect(store.busquedas.at(-1)).toMatchObject({ jid: PRIVADO, categorias: ['Mascotas'] });
    expect(store.outbox.at(-1)).toMatchObject({ chat_jid: PRIVADO, reason: 'answer' });
    expect(store.outbox.at(-1)?.body).toMatch(/^🔎 La última vez de «comida perro» fue el \*7 nov\*: Homecenter, \*\$32\.900\*\./);
  });

  it('en el grupo, si le hablan a Mister Luks, responde en el grupo', async () => {
    await ing.onGroupJoined(contador, wa, grupo());
    expect(
      await ing.onMessage(contador, wa, m({ chatId: GRUPO, chatKind: 'grupo', chatName: 'Paseo', text: 'Luks, ¿cuándo compramos comida para el perro?' })),
    ).toBe('buscar:ultima');
    expect(store.busquedas.at(-1)?.jid).toBe(GRUPO);
    expect(store.outbox.at(-1)?.chat_jid).toBe(GRUPO);
  });
});
