import pino from 'pino';
import type { ConnectorHandlers, GroupInfo, MessagingConnector, SessionInfo } from '../src/connector.js';
import type { GroupResult, IngestCheck, IngestInput, KeyItem, LinkResult, QueueHealth, SessionRow, Store } from '../src/store.js';
import type { PendingReply } from '../src/text.js';

export const silentLog = pino({ level: 'silent' });

export const PASEO = '20000000-0000-4000-8000-000000000002';
export const GRUPO = '120363040123456789@g.us';

/** Una base en memoria con lo justo para probar el connector */
export class FakeStore implements Store {
  rows: SessionRow[] = [];
  creds = new Map<string, string>();
  keys = new Map<string, string>();
  statuses: { id: string; status: string; extra?: unknown }[] = [];
  pairings: { id: string; qr: string | null; code: string | null }[] = [];
  cleared: { id: string; reason: string }[] = [];
  heartbeats: string[][] = [];
  groups = new Map<string, { group_id: string; name: string | null; account_id: string | null; hello: boolean }>();
  /** código → cuenta */
  codes = new Map<string, { id: string; name: string }>([['PASEO-7K2Q', { id: PASEO, name: 'Paseo Santa Marta' }]]);
  messages = new Map<string, IngestInput>();
  uploads = new Map<string, { body: Buffer; contentType: string }>();
  replies: PendingReply[] = [];
  replied: string[] = [];
  left: string[] = [];

  async sessions() {
    return this.rows;
  }
  async requestContador() {
    return 'contador';
  }
  async getCreds(id: string) {
    return this.creds.get(id) ?? null;
  }
  async saveCreds(id: string, c: string) {
    this.creds.set(id, c);
  }
  async getKeys(id: string, type: string, ids: string[]) {
    const out: Record<string, string> = {};
    for (const i of ids) {
      const v = this.keys.get(`${id}|${type}|${i}`);
      if (v) out[i] = v;
    }
    return out;
  }
  async setKeys(id: string, items: KeyItem[]) {
    for (const it of items) {
      const k = `${id}|${it.t}|${it.i}`;
      if (it.v === null) this.keys.delete(k);
      else this.keys.set(k, it.v);
    }
  }
  async setStatus(id: string, status: SessionRow['status'], extra?: unknown) {
    this.statuses.push({ id, status, extra });
  }
  async setPairing(id: string, qr: string | null, code: string | null) {
    this.pairings.push({ id, qr, code });
  }
  async heartbeat(ids: string[]) {
    this.heartbeats.push(ids);
  }
  async clearSession(id: string, reason: string) {
    this.cleared.push({ id, reason });
    this.rows = this.rows.filter((r) => r.id !== id);
  }
  async upsertGroup(_s: string, jid: string, name: string | null): Promise<GroupResult> {
    const g = this.groups.get(jid) ?? { group_id: `g-${this.groups.size + 1}`, name, account_id: null, hello: false };
    g.name = name ?? g.name;
    this.groups.set(jid, g);
    return { group_id: g.group_id, account_id: g.account_id, account_name: null, say_hello: !g.account_id && !g.hello };
  }
  async markHello(groupId: string) {
    for (const g of this.groups.values()) if (g.group_id === groupId) g.hello = true;
  }
  async groupLeft(jid: string) {
    this.left.push(jid);
  }
  async linkGroup(sessionId: string, jid: string, name: string | null, code: string): Promise<LinkResult> {
    const cuenta = this.codes.get(code);
    if (!cuenta) return { ok: false, error: 'codigo_invalido' };
    const g = await this.upsertGroup(sessionId, jid, name);
    const actual = this.groups.get(jid);
    if (actual?.account_id && actual.account_id !== cuenta.id) return { ok: false, error: 'otra_cuenta' };
    const already = actual?.account_id === cuenta.id;
    if (actual) actual.account_id = cuenta.id;
    return { ok: true, already, account_id: cuenta.id, account_name: cuenta.name, group_id: g.group_id };
  }
  async shouldIngest(jid: string, id: string): Promise<IngestCheck> {
    const g = this.groups.get(jid);
    if (!g?.account_id) return { ingest: false, reason: 'grupo_sin_enlazar' };
    if (this.messages.has(`${jid}|${id}`)) return { ingest: false, reason: 'repetido', account_id: g.account_id };
    return { ingest: true, account_id: g.account_id, group_id: g.group_id };
  }
  async ingest(m: IngestInput): Promise<IngestCheck> {
    const check = await this.shouldIngest(m.jid, m.waMessageId);
    if (!check.ingest) return check;
    this.messages.set(`${m.jid}|${m.waMessageId}`, m);
    return { ingest: true, message_id: `m-${this.messages.size}`, account_id: check.account_id, known_sender: false };
  }
  async uploadEvidence(path: string, body: Buffer, contentType: string) {
    this.uploads.set(path, { body, contentType });
  }
  async pendingReplies() {
    return this.replies.filter((r) => !this.replied.includes(r.message_id));
  }
  async markReplied(ids: string[]) {
    this.replied.push(...ids);
  }
  async queueHealth(): Promise<QueueHealth> {
    return { queued: 0, oldest_queued_s: 0, running: 0 };
  }
}

/** Un WhatsApp de mentiras: guarda lo que se le pide enviar */
export class FakeConnector implements MessagingConnector {
  sent: { chatId: string; text: string }[] = [];
  started = 0;
  stopped = 0;
  loggedOut = 0;
  connected = true;
  inGroups = new Set<string>([GRUPO]);
  failSend = false;

  constructor(
    readonly session: SessionInfo,
    readonly handlers?: ConnectorHandlers,
  ) {}

  async start() {
    this.started += 1;
  }
  async stop() {
    this.stopped += 1;
  }
  async logout() {
    this.loggedOut += 1;
  }
  isConnected() {
    return this.connected;
  }
  groups() {
    return this.inGroups;
  }
  async sendText(chatId: string, text: string) {
    if (this.failSend) throw new Error('sin señal');
    this.sent.push({ chatId, text });
  }
}

export const contador: SessionInfo = { id: 'contador', kind: 'contador', ownerId: null, label: null, pairingPhone: null };
export const personal: SessionInfo = { id: 'personal', kind: 'personal', ownerId: 'u1', label: null, pairingPhone: null };

export const grupo = (over: Partial<GroupInfo> = {}): GroupInfo => ({ chatId: GRUPO, name: 'Paseo Santa Marta 2026', participants: 8, ...over });
