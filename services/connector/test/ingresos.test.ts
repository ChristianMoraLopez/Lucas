import { beforeEach, describe, expect, it } from 'vitest';
import type { IncomingMessage } from '../src/connector.js';
import { Ingestor } from '../src/ingest.js';
import { leerIngreso, montoIngreso, respuestaIngreso } from '../src/ingresos.js';
import { RateLimiter } from '../src/replies.js';
import { esMensajeDeLuks } from '../src/text.js';
import { contador, FakeConnector, FakeStore, GRUPO, grupo, silentLog } from './fakes.js';

// Lo que entra por WhatsApp: «hoy entraron 200 lucas» (migración 810)

describe('cómo se lee un ingreso', () => {
  it('los montos como se dicen', () => {
    expect(montoIngreso('entraron 200 lucas')).toBe(200_000);
    expect(montoIngreso('gané 150 lukas')).toBe(150_000);
    expect(montoIngreso('me pagaron 1.600.000')).toBe(1_600_000);
    expect(montoIngreso('me pagaron $1,600,000')).toBe(1_600_000);
    expect(montoIngreso('gané 3 palos')).toBe(3_000_000);
    expect(montoIngreso('nos llegó la prima 1,5 millones')).toBe(1_500_000);
    expect(montoIngreso('recibí 15k')).toBe(15_000);
    expect(montoIngreso('got paid $85.50')).toBe(85.5);
    expect(montoIngreso('hoy entró plata')).toBeNull();
  });

  it('plata que entra, con lo que dice qué fue', () => {
    expect(leerIngreso('Hoy entraron 200 lucas')).toEqual({ monto: 200_000, concepto: null });
    expect(leerIngreso('me pagaron la quincena 1.600.000')).toEqual({ monto: 1_600_000, concepto: 'Quincena' });
    expect(leerIngreso('gané 3 palos con el proyecto')).toEqual({ monto: 3_000_000, concepto: 'Honorarios' });
    expect(leerIngreso('hoy hice 150 lukas')).toEqual({ monto: 150_000, concepto: null });
    expect(leerIngreso('Nos llegó el sueldo, 3.200.000')).toEqual({ monto: 3_200_000, concepto: 'Sueldo' });
    expect(leerIngreso('ingreso 500 mil por ventas')).toEqual({ monto: 500_000, concepto: 'Ventas' });
  });

  it('lo que sale no es un ingreso', () => {
    expect(leerIngreso('taxi 45 lucas')).toBeNull();
    expect(leerIngreso('hice mercado 200 lucas')).toBeNull();
    expect(leerIngreso('pagué el arriendo 800 mil')).toBeNull();
    expect(leerIngreso('me llegó la factura de la luz 120 mil')).toBeNull();
    expect(leerIngreso('les pago 50 mil mañana')).toBeNull();
    expect(leerIngreso('le pagaron a Juan 50 mil')).toBeNull();
    expect(leerIngreso('gané')).toBeNull();
  });

  it('la respuesta no se vuelve a leer como gasto', () => {
    const texto = respuestaIngreso(
      {
        ok: true,
        nuevo: true,
        monto: 1_600_000,
        account: { id: 'x', name: 'Casa', language: 'es', currency: 'COP' },
        entro_mes: 1_600_000,
        salio_mes: 420_000,
      },
      { monto: 1_600_000, concepto: 'Quincena' },
      'es',
    );
    expect(texto).toBe('💰 Anotado como entrada: Quincena · $1.600.000\nEste mes: entró $1.600.000 y salió $420.000.\nMás detalle en mrluks.com');
    expect(esMensajeDeLuks(texto)).toBe(true);
    expect(leerIngreso(texto)).not.toBeNull(); // por eso ingest descarta antes lo que es de Luks
  });
});

describe('en el grupo', () => {
  const LIMITS = { maxDownloadBytes: 25 * 1024 * 1024, maxChatBytes: 50 * 1024 * 1024, maxUploadBytes: 6 * 1024 * 1024, maxSide: 1600, jpegQuality: 80 };
  let store: FakeStore;
  let wa: FakeConnector;
  let ing: Ingestor;

  const m = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
    sessionId: 'contador',
    chatId: GRUPO,
    chatKind: 'grupo',
    chatName: 'Casa',
    messageId: `W${Math.random().toString(36).slice(2, 8)}`,
    sender: { id: '573016667788', phone: '573016667788', name: 'Mafe' },
    sentAt: new Date('2026-11-15T15:00:00Z'),
    text: 'hoy entraron 200 lucas',
    media: null,
    fromMe: false,
    ...over,
  });

  beforeEach(async () => {
    store = new FakeStore();
    wa = new FakeConnector(contador);
    const joins = new RateLimiter({ minIntervalMs: 0, maxPerHourPerGroup: 2, maxPerHourTotal: 4 }, () => 1_000_000);
    ing = new Ingestor(store, LIMITS, { guiaUrl: 'https://mrluks.com/guia', joins }, silentLog);
    await ing.onGroupJoined(contador, wa, grupo());
    await ing.onMessage(contador, wa, m({ text: 'lucas PASEO-7K2Q' }));
    store.outbox = [];
  });

  it('se anota como entrada, no como gasto, y Mister Luks lo confirma una vez', async () => {
    const msg = m({ text: 'me pagaron la quincena 1.600.000' });
    await ing.onMessage(contador, wa, msg);
    await ing.onMessage(contador, wa, msg);
    expect(store.ingresos).toEqual([{ jid: GRUPO, msg: msg.messageId, sender: '573016667788', monto: 1_600_000, concepto: 'Quincena' }]);
    expect(store.messages.has(msg.messageId)).toBe(false);
    const respuestas = store.outbox.filter((o) => o.dedupe_key?.startsWith('ingreso:'));
    expect(respuestas.map((o) => (o.body ?? '').split('\n')[0])).toContain('💰 Anotado como entrada: Quincena · $1.600.000');
  });

  it('un gasto sigue siendo un gasto', async () => {
    await ing.onMessage(contador, wa, m({ text: 'mercado 120 lukas' }));
    expect(store.ingresos).toEqual([]);
    expect(store.messages.size).toBe(1);
  });
});
