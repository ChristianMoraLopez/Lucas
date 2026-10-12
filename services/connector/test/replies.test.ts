import { beforeEach, describe, expect, it } from 'vitest';
import { RateLimiter, ReplyLoop, type SenderLookup } from '../src/replies.js';
import type { PendingReply } from '../src/text.js';
import { contador, FakeConnector, FakeStore, GRUPO, silentLog } from './fakes.js';

describe('límite de frecuencia', () => {
  let t = 0;
  const lim = () => new RateLimiter({ minIntervalMs: 20_000, maxPerHourPerGroup: 3, maxPerHourTotal: 4 }, () => t);

  it('respeta el mínimo entre mensajes del mismo grupo', () => {
    t = 0;
    const l = lim();
    expect(l.allow('a')).toBe(true);
    l.record('a');
    t = 10_000;
    expect(l.allow('a')).toBe(false);
    expect(l.allow('b')).toBe(true);
    t = 20_000;
    expect(l.allow('a')).toBe(true);
  });

  it('y los topes por hora, por grupo y en total', () => {
    t = 0;
    const l = lim();
    for (let i = 0; i < 3; i++) {
      t += 30_000;
      l.record('a');
    }
    t += 30_000;
    expect(l.allow('a')).toBe(false);
    l.record('b');
    t += 30_000;
    expect(l.allow('c')).toBe(false); // 4 en la última hora
    t += 3_600_000;
    expect(l.allow('a')).toBe(true);
  });
});

const pendiente = (i: number, over: Partial<PendingReply> = {}): PendingReply => ({
  message_id: `m${i}`,
  group_jid: GRUPO,
  wa_message_id: `W${i}`,
  sender_wa_id: null,
  status: 'done',
  received_at: new Date(1_000_000 + i).toISOString(),
  expense: { merchant: `Gasto ${i}`, total_cop: 1000 * i, status: 'confirmed', payer: 'Mafe', split_count: 1 },
  duplicate_of: null,
  ...over,
});

describe('confirmaciones en el grupo', () => {
  let store: FakeStore;
  let wa: FakeConnector;
  let t: number;
  let quien: SenderLookup;
  const loop = (batchMax = 5) =>
    new ReplyLoop(
      store,
      new RateLimiter({ minIntervalMs: 20_000, maxPerHourPerGroup: 20, maxPerHourTotal: 60 }, () => t),
      (jid) => quien(jid),
      { batchMax, maxWaitMs: 30 * 60_000 },
      silentLog,
      () => t,
    );

  beforeEach(() => {
    store = new FakeStore();
    wa = new FakeConnector(contador);
    t = 1_000_000;
    quien = () => ({ connector: wa });
  });

  it('junta lo que llegó seguido en un mensaje y espera antes del siguiente', async () => {
    store.replies = [1, 2, 3, 4, 5, 6, 7].map((i) => pendiente(i));
    const l = loop(5);
    expect(await l.tick()).toEqual({ sent: 5, dropped: 0, outbox: 0 });
    expect(wa.sent).toHaveLength(1);
    expect(wa.sent[0].text).toMatch(/^✅ Anotados 5:/);
    expect(await l.tick()).toEqual({ sent: 0, dropped: 0, outbox: 0 }); // todavía no pasan 20 s
    t += 20_000;
    expect(await l.tick()).toEqual({ sent: 2, dropped: 0, outbox: 0 });
    expect(store.replied).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
  });

  it('si el contador no está en el grupo no confirma (y no lo deja pendiente)', async () => {
    quien = () => ({ connector: null, reason: 'no_esta_en_el_grupo' });
    store.replies = [pendiente(1)];
    expect(await loop().tick()).toEqual({ sent: 0, dropped: 1, outbox: 0 });
    expect(store.replied).toEqual(['m1']);
  });

  it('si el contador está caído espera un rato; después lo deja pasar', async () => {
    quien = () => ({ connector: null, reason: 'desconectado' });
    store.replies = [pendiente(1)];
    expect(await loop().tick()).toEqual({ sent: 0, dropped: 0, outbox: 0 });
    t += 31 * 60_000;
    expect(await loop().tick()).toEqual({ sent: 0, dropped: 1, outbox: 0 });
  });

  it('si WhatsApp falla al enviar, se intenta otra vez', async () => {
    store.replies = [pendiente(1)];
    wa.failSend = true;
    expect(await loop().tick()).toEqual({ sent: 0, dropped: 0, outbox: 0 });
    expect(store.replied).toEqual([]);
    wa.failSend = false;
    expect(await loop().tick()).toEqual({ sent: 1, dropped: 0, outbox: 0 });
  });
});

describe('la bandeja de salida de Mister Luks', () => {
  let store: FakeStore;
  let wa: FakeConnector;
  let t: number;
  let quien: SenderLookup;
  const PRIVADO = '573016667788@s.whatsapp.net';
  const GUIA = 'https://mrluks.com/guia';
  const loop = (confirmations = true) =>
    new ReplyLoop(
      store,
      new RateLimiter({ minIntervalMs: 20_000, maxPerHourPerGroup: 20, maxPerHourTotal: 60 }, () => t),
      (jid) => quien(jid),
      { batchMax: 5, maxWaitMs: 30 * 60_000, confirmations },
      silentLog,
      () => t,
    );

  beforeEach(async () => {
    store = new FakeStore();
    wa = new FakeConnector(contador);
    t = 1_000_000;
    quien = () => ({ connector: wa });
    await store.privateChat('contador', PRIVADO);
    await store.upsertGroup('contador', GRUPO, 'Paseo');
  });

  it('la bienvenida: la imagen con el texto de pie y el PDF, y queda marcada como enviada', async () => {
    await store.outboxEnqueue([
      {
        chat_jid: PRIVADO,
        reason: 'welcome',
        body: 'Hola 👋',
        image_url: `${GUIA}/luks-guia-es.png`,
        document_url: `${GUIA}/luks-guia-es.pdf`,
        document_name: 'Guía de Mister Luks.pdf',
        dedupe_key: 'welcome:x',
      },
    ]);
    expect(await loop().tick()).toEqual({ sent: 0, dropped: 0, outbox: 1 });
    expect(wa.enviados).toEqual([
      { chatId: PRIVADO, imageUrl: `${GUIA}/luks-guia-es.png`, caption: 'Hola 👋' },
      { chatId: PRIVADO, documentUrl: `${GUIA}/luks-guia-es.pdf`, fileName: 'Guía de Mister Luks.pdf', mimeType: 'application/pdf' },
    ]);
    expect(store.outbox[0]).toMatchObject({ sent: true, waId: 'W-1' });
  });

  it('respeta el límite: lo segundo para el mismo chat espera; otro chat, no', async () => {
    await store.outboxEnqueue([
      { chat_jid: PRIVADO, reason: 'welcome', body: 'Hola', dedupe_key: 'a' },
      { chat_jid: PRIVADO, reason: 'invite', body: 'Listo, entré', dedupe_key: 'b' },
      { chat_jid: GRUPO, reason: 'group_hello', body: '¡Hola, parche!', dedupe_key: 'c' },
    ]);
    const l = loop();
    expect((await l.tick()).outbox).toBe(2);
    expect(wa.sent.map((s) => s.text)).toEqual(['Hola', '¡Hola, parche!']);
    expect((await l.tick()).outbox).toBe(0); // todavía no pasan 20 s
    t += 20_000;
    expect((await l.tick()).outbox).toBe(1);
    expect(wa.sent.at(-1)?.text).toBe('Listo, entré');
  });

  it('va aunque las confirmaciones estén apagadas', async () => {
    store.replies = [pendiente(1)];
    await store.outboxEnqueue([{ chat_jid: PRIVADO, reason: 'guide', body: 'La guía', dedupe_key: 'g' }]);
    expect(await loop(false).tick()).toEqual({ sent: 0, dropped: 0, outbox: 1 });
    expect(store.replied).toEqual([]);
  });

  it('si Mister Luks ya no está en el grupo se deja; si está caído, espera; si falla, se reintenta', async () => {
    await store.outboxEnqueue([{ chat_jid: GRUPO, reason: 'group_hello', body: 'Hola', dedupe_key: 'h' }]);
    quien = () => ({ connector: null, reason: 'desconectado' });
    await loop().tick();
    expect(store.outbox[0]).toMatchObject({ sent: false, dropped: false });

    quien = () => ({ connector: wa });
    wa.failSend = true;
    await loop().tick();
    expect(store.outbox[0]).toMatchObject({ sent: false, dropped: false, error: 'sin señal' });

    quien = () => ({ connector: null, reason: 'no_esta_en_el_grupo' });
    await loop().tick();
    expect(store.outbox[0]).toMatchObject({ dropped: true });
  });
});
