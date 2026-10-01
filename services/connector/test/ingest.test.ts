import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import type { IncomingMessage } from '../src/connector.js';
import { Ingestor } from '../src/ingest.js';
import { RateLimiter } from '../src/replies.js';
import { MSG } from '../src/text.js';
import { contador, FakeConnector, FakeStore, GRUPO, grupo, PASEO, personal, silentLog } from './fakes.js';

const LIMITS = { maxDownloadBytes: 25 * 1024 * 1024, maxUploadBytes: 6 * 1024 * 1024, maxSide: 1600, jpegQuality: 80 };

let store: FakeStore;
let wa: FakeConnector;
let ing: Ingestor;
let reloj: number;

beforeEach(() => {
  store = new FakeStore();
  wa = new FakeConnector(contador);
  reloj = 1_000_000;
  ing = new Ingestor(store, LIMITS, new RateLimiter({ minIntervalMs: 20_000, maxPerHourPerGroup: 20, maxPerHourTotal: 60 }, () => reloj), silentLog);
});

const m = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  sessionId: 'contador',
  chatId: GRUPO,
  chatName: 'Paseo Santa Marta 2026',
  messageId: `W${Math.random().toString(36).slice(2, 8)}`,
  sender: { id: '573016667788', phone: '573016667788', name: 'Mafe' },
  sentAt: new Date('2026-10-01T15:00:00Z'),
  text: 'taxi al aeropuerto 45 lucas',
  media: null,
  fromMe: false,
  ...over,
});

async function enlazado() {
  await ing.onMessage(contador, wa, m({ text: 'lucas PASEO-7K2Q' }));
  wa.sent = [];
  reloj += 60_000;
}

describe('cuando agregan a Luks a un grupo', () => {
  it('saluda una sola vez y explica cómo enlazarlo', async () => {
    await ing.onGroupJoined(contador, wa, grupo());
    await ing.onGroupJoined(contador, wa, grupo());
    expect(wa.sent).toEqual([{ chatId: GRUPO, text: MSG.hello }]);
  });

  it('una sesión personal no escribe en el grupo', async () => {
    const mio = new FakeConnector(personal);
    await ing.onGroupJoined(personal, mio, grupo());
    expect(mio.sent).toEqual([]);
  });
});

describe('«lucas CÓDIGO»', () => {
  it('enlaza el grupo y lo confirma', async () => {
    expect(await ing.onMessage(contador, wa, m({ text: 'Luks paseo-7k2q' }))).toBe('enlazado');
    expect(store.groups.get(GRUPO)?.account_id).toBe(PASEO);
    expect(wa.sent[0].text).toBe(MSG.linked('Paseo Santa Marta'));
  });

  it('un código malo se explica, pero sin llenar el grupo si insisten', async () => {
    expect(await ing.onMessage(contador, wa, m({ text: 'lucas NADA-0000' }))).toBe('codigo_invalido');
    expect(await ing.onMessage(contador, wa, m({ text: 'lucas NADA-0001' }))).toBe('codigo_invalido');
    expect(wa.sent).toEqual([{ chatId: GRUPO, text: MSG.badCode }]);
  });

  it('desde una sesión personal también enlaza, en silencio', async () => {
    const mio = new FakeConnector(personal);
    expect(await ing.onMessage(personal, mio, m({ text: 'lucas PASEO-7K2Q', fromMe: true }))).toBe('enlazado');
    expect(mio.sent).toEqual([]);
  });
});

describe('ingesta', () => {
  it('la charla del grupo no sale de WhatsApp', async () => {
    await enlazado();
    expect(await ing.onMessage(contador, wa, m({ text: 'llego en 10 min' }))).toBe('charla');
    expect(store.messages.size).toBe(0);
  });

  it('un gasto escrito entra a la cola con quién lo mandó', async () => {
    await enlazado();
    const msg = m({ messageId: 'W-TAXI' });
    expect(await ing.onMessage(contador, wa, msg)).toBe('guardado');
    expect(store.messages.get(`${GRUPO}|W-TAXI`)).toMatchObject({
      kind: 'text',
      text: 'taxi al aeropuerto 45 lucas',
      senderWaId: '573016667788',
      senderName: 'Mafe',
      mediaPath: null,
    });
    expect(await ing.onMessage(contador, wa, msg)).toBe('ignorado:repetido');
  });

  it('solo grupos enlazados', async () => {
    expect(await ing.onMessage(contador, wa, m())).toBe('ignorado:grupo_sin_enlazar');
  });

  it('las fotos se comprimen a JPEG y se suben a la carpeta de la cuenta', async () => {
    await enlazado();
    const png = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#FFC53D' } })
      .png()
      .toBuffer();
    const r = await ing.onMessage(
      contador,
      wa,
      m({ messageId: 'W-FOTO', text: null, media: { kind: 'photo', mimeType: 'image/png', fileName: null, sizeBytes: png.length, download: async () => png } }),
    );
    expect(r).toBe('guardado');
    const [[path, up]] = [...store.uploads];
    expect(path).toBe(`${PASEO}/whatsapp/2026-10/W-FOTO.jpg`);
    expect(up.contentType).toBe('image/jpeg');
    const meta = await sharp(up.body).metadata();
    expect([meta.format, Math.max(meta.width ?? 0, meta.height ?? 0)]).toEqual(['jpeg', 1600]);
    expect(store.messages.get(`${GRUPO}|W-FOTO`)).toMatchObject({ kind: 'photo', mediaPath: path, mimeType: 'image/jpeg' });
  });

  it('un «PDF» que no es PDF, o un archivo enorme, no se guarda', async () => {
    await enlazado();
    const falso = { kind: 'pdf' as const, mimeType: 'application/pdf', fileName: 'x.pdf', sizeBytes: 10, download: async () => Buffer.from('<html>') };
    expect(await ing.onMessage(contador, wa, m({ media: falso }))).toBe('archivo_rechazado');
    const enorme = { ...falso, sizeBytes: 90 * 1024 * 1024, download: async () => Buffer.alloc(0) };
    expect(await ing.onMessage(contador, wa, m({ media: enorme }))).toBe('archivo_muy_pesado');
    expect(store.messages.size).toBe(0);
  });

  it('el contador no se lee a sí mismo; en una sesión personal lo propio sí cuenta', async () => {
    await enlazado();
    expect(await ing.onMessage(contador, wa, m({ fromMe: true }))).toBe('propio');
    expect(await ing.onMessage(personal, new FakeConnector(personal), m({ fromMe: true, messageId: 'W-MIO' }))).toBe('guardado');
  });
});
