import { randomBytes } from 'node:crypto';
import { initAuthCreds } from 'baileys';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConnectorHandlers, SessionInfo } from '../src/connector.js';
import { SessionCipher } from '../src/crypto.js';
import { Ingestor } from '../src/ingest.js';
import { SessionManager } from '../src/manager.js';
import { RateLimiter } from '../src/replies.js';
import type { SessionRow } from '../src/store.js';
import { useDbAuthState } from '../src/whatsapp/auth-state.js';
import { FakeConnector, FakeStore, GRUPO, silentLog } from './fakes.js';

describe('credenciales en la base', () => {
  it('las llaves se guardan cifradas y vuelven igual (también los Buffer)', async () => {
    const store = new FakeStore();
    const cipher = new SessionCipher(randomBytes(32));
    const { state } = await useDbAuthState(store, cipher, 's1');
    const llave = { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5, 6]) };
    await state.keys.set({ 'pre-key': { '7': llave, '8': llave }, session: { 'a@s.whatsapp.net': Buffer.from('sesion') } });

    const enLaBase = [...store.keys.values()].join('');
    expect(enLaBase).not.toContain(Buffer.from([1, 2, 3]).toString('base64'));
    const leidas = await state.keys.get('pre-key', ['7', '9']);
    expect(Object.keys(leidas)).toEqual(['7']);
    expect(Buffer.from(leidas['7'].public).equals(llave.public)).toBe(true);

    await state.keys.set({ 'pre-key': { '7': null } });
    expect(await state.keys.get('pre-key', ['7'])).toEqual({});
  });

  it('las creds sobreviven a un reinicio; con otra llave no se leen', async () => {
    const store = new FakeStore();
    const key = randomBytes(32);
    const a = await useDbAuthState(store, new SessionCipher(key), 's1');
    await a.saveCreds();
    const b = await useDbAuthState(store, new SessionCipher(key), 's1');
    expect(b.state.creds.advSecretKey).toBe(a.state.creds.advSecretKey);
    expect(b.state.creds.noiseKey.public).toEqual(a.state.creds.noiseKey.public);
    await expect(useDbAuthState(store, new SessionCipher(randomBytes(32)), 's1')).rejects.toThrow();
    // Una sesión sin creds arranca de cero
    const nueva = await useDbAuthState(store, new SessionCipher(key), 's2');
    expect(nueva.state.creds.registered).toBe(initAuthCreds().registered);
  });
});

describe('gestor de sesiones', () => {
  let store: FakeStore;
  let creados: Map<string, FakeConnector & { handlers: ConnectorHandlers }>;
  let alertas: string[];
  let manager: SessionManager;

  const fila = (over: Partial<SessionRow>): SessionRow => ({
    id: 'contador',
    kind: 'contador',
    owner_id: null,
    status: 'connecting',
    label: null,
    has_creds: false,
    pairing_phone: null,
    stop_requested: false,
    ...over,
  });

  beforeEach(() => {
    store = new FakeStore();
    creados = new Map();
    alertas = [];
    const ing = new Ingestor(
      store,
      { maxDownloadBytes: 1, maxUploadBytes: 1, maxSide: 1, jpegQuality: 80 },
      new RateLimiter({ minIntervalMs: 0, maxPerHourPerGroup: 99, maxPerHourTotal: 99 }),
      silentLog,
    );
    manager = new SessionManager(
      store,
      (s: SessionInfo, h: ConnectorHandlers) => {
        const c = new FakeConnector(s, h) as FakeConnector & { handlers: ConnectorHandlers };
        creados.set(s.id, c);
        return c;
      },
      ing,
      silentLog,
      (msg) => alertas.push(msg),
    );
  });

  it('arranca las sesiones pedidas una sola vez y marca el latido de las conectadas', async () => {
    store.rows = [fila({}), fila({ id: 'p1', kind: 'personal', owner_id: 'u1', pairing_phone: '573001234567' })];
    await manager.sync();
    await manager.sync();
    expect([...creados.keys()]).toEqual(['contador', 'p1']);
    expect(creados.get('contador')?.started).toBe(1);
    expect(creados.get('p1')?.session.pairingPhone).toBe('573001234567');

    await creados.get('contador')?.handlers.onState({ status: 'connected', jid: 'x', lid: null, phone: '573150000000' });
    await manager.sync();
    expect(store.heartbeats.at(-1)).toEqual(['contador']);
    expect(store.statuses).toContainEqual({ id: 'contador', status: 'connected', extra: { jid: 'x', lid: null, phone: '573150000000' } });
  });

  it('el QR o el código van a la base para la web y la terminal', async () => {
    store.rows = [fila({})];
    await manager.sync();
    await creados.get('contador')?.handlers.onState({ status: 'pairing', qr: '2@abc', code: null, expiresAt: new Date() });
    expect(store.pairings).toEqual([{ id: 'contador', qr: '2@abc', code: null }]);
  });

  it('si la cierran desde el teléfono, borra las credenciales y avisa', async () => {
    store.rows = [fila({ has_creds: true })];
    await manager.sync();
    await creados.get('contador')?.handlers.onState({ status: 'closed', loggedOut: true, reason: 'Se cerró la sesión desde el teléfono' });
    expect(store.cleared).toEqual([{ id: 'contador', reason: 'Se cerró la sesión desde el teléfono' }]);
    expect(alertas).toEqual(['Se cerró la sesión del número contador']);
    expect(manager.snapshot()).toEqual([]);
  });

  it('una caída normal no borra nada: queda reconectando', async () => {
    store.rows = [fila({ has_creds: true })];
    await manager.sync();
    await creados.get('contador')?.handlers.onState({ status: 'closed', loggedOut: false, reason: 'Se cayó la conexión (408)' });
    expect(store.cleared).toEqual([]);
    expect(store.statuses.at(-1)).toMatchObject({ id: 'contador', status: 'connecting' });
    expect(alertas).toEqual([]);
  });

  it('desvincular desde la web cierra la sesión en WhatsApp', async () => {
    store.rows = [fila({ id: 'p1', kind: 'personal', owner_id: 'u1' })];
    await manager.sync();
    store.rows = [fila({ id: 'p1', kind: 'personal', owner_id: 'u1', stop_requested: true })];
    await manager.sync();
    expect(creados.get('p1')?.loggedOut).toBe(1);
    expect(store.cleared.map((c) => c.id)).toEqual(['p1']);
  });

  it('solo el contador conectado y en el grupo puede confirmar', async () => {
    expect(manager.senderFor(GRUPO)).toEqual({ connector: null, reason: 'desconectado' });
    store.rows = [fila({})];
    await manager.sync();
    const c = creados.get('contador');
    await c?.handlers.onState({ status: 'connected', jid: null, lid: null, phone: null });
    expect(manager.senderFor(GRUPO)).toEqual({ connector: c });
    expect(manager.senderFor('otro@g.us')).toEqual({ connector: null, reason: 'no_esta_en_el_grupo' });
  });
});
