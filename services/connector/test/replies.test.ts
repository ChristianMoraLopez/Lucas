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
    expect(await l.tick()).toEqual({ sent: 5, dropped: 0 });
    expect(wa.sent).toHaveLength(1);
    expect(wa.sent[0].text).toMatch(/^Anotados 5:/);
    expect(await l.tick()).toEqual({ sent: 0, dropped: 0 }); // todavía no pasan 20 s
    t += 20_000;
    expect(await l.tick()).toEqual({ sent: 2, dropped: 0 });
    expect(store.replied).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
  });

  it('si el contador no está en el grupo no confirma (y no lo deja pendiente)', async () => {
    quien = () => ({ connector: null, reason: 'no_esta_en_el_grupo' });
    store.replies = [pendiente(1)];
    expect(await loop().tick()).toEqual({ sent: 0, dropped: 1 });
    expect(store.replied).toEqual(['m1']);
  });

  it('si el contador está caído espera un rato; después lo deja pasar', async () => {
    quien = () => ({ connector: null, reason: 'desconectado' });
    store.replies = [pendiente(1)];
    expect(await loop().tick()).toEqual({ sent: 0, dropped: 0 });
    t += 31 * 60_000;
    expect(await loop().tick()).toEqual({ sent: 0, dropped: 1 });
  });

  it('si WhatsApp falla al enviar, se intenta otra vez', async () => {
    store.replies = [pendiente(1)];
    wa.failSend = true;
    expect(await loop().tick()).toEqual({ sent: 0, dropped: 0 });
    expect(store.replied).toEqual([]);
    wa.failSend = false;
    expect(await loop().tick()).toEqual({ sent: 1, dropped: 0 });
  });
});
