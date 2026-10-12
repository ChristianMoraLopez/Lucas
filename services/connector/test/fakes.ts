import pino from 'pino';
import type { ConnectorHandlers, GroupInfo, GroupMember, JoinResult, MessagingConnector, Outgoing, SessionInfo } from '../src/connector.js';
import type {
  GroupResult,
  HelloResult,
  IngestCheck,
  IngestInput,
  KeyItem,
  LinkResult,
  OutboxItem,
  OutboxPending,
  QueueHealth,
  SessionRow,
  Store,
} from '../src/store.js';
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
  async upsertGroup(sesion: string, jid: string, name: string | null): Promise<GroupResult> {
    const g = this.groups.get(jid) ?? { group_id: `g-${this.groups.size + 1}`, name, account_id: null, hello: false };
    g.name = name ?? g.name;
    this.groups.set(jid, g);
    this.presentes.add(`${jid}|${sesion}`);
    const cuenta = [...this.codes.values()].find((c) => c.id === g.account_id);
    return { group_id: g.group_id, account_id: g.account_id, account_name: cuenta?.name ?? null, language: cuenta ? 'es' : null, say_hello: !g.hello };
  }
  /** «jid|sesión» de quién está en qué chat (whatsapp_group_sessions) */
  presentes = new Set<string>();
  /** Quiénes del grupo ya usan Luks, para el saludo */
  usuariosLuks: string[] = [];
  async groupHello(groupId: string): Promise<HelloResult> {
    const g = [...this.groups.values()].find((x) => x.group_id === groupId);
    if (!g || g.hello) return { say_hello: false };
    g.hello = true;
    const cuenta = [...this.codes.values()].find((c) => c.id === g.account_id);
    return { say_hello: true, account_name: cuenta?.name ?? null, language: cuenta ? 'es' : null, luks_users: this.usuariosLuks };
  }
  /** Chats privados con Mister Luks */
  privados = new Set<string>();
  async privateChat(sesion: string, jid: string) {
    this.privados.add(jid);
    this.presentes.add(`${jid}|${sesion}`);
    return `p-${jid}`;
  }
  /** La bandeja de salida (whatsapp_outbox), como la base: solo a chats donde está el contador, sin repetir */
  outbox: (OutboxItem & { id: string; sent: boolean; dropped: boolean; error: string | null; waId: string | null })[] = [];
  async outboxEnqueue(items: OutboxItem[]) {
    const nuevas: string[] = [];
    for (const it of items) {
      if (!this.presentes.has(`${it.chat_jid}|contador`) || this.outbox.some((o) => o.dedupe_key === it.dedupe_key)) continue;
      this.outbox.push({ ...it, id: `o-${this.outbox.length + 1}`, sent: false, dropped: false, error: null, waId: null });
      nuevas.push(it.dedupe_key);
    }
    return nuevas;
  }
  async outboxPending(): Promise<OutboxPending[]> {
    return this.outbox
      .filter((o) => !o.sent && !o.dropped)
      .map(({ dedupe_key: _k, sent: _s, dropped: _d, error: _e, waId: _w, ...o }) => ({ ...o, created_at: '2026-10-12T00:00:00Z' }));
  }
  async outboxResult(id: string, waId: string | null, error: string | null = null, drop = false) {
    const o = this.outbox.find((x) => x.id === id);
    if (!o) return;
    o.error = error;
    o.waId = waId;
    if (drop) o.dropped = true;
    else if (!error) o.sent = true;
  }
  /** grupo → integrantes que mandó el connector */
  members = new Map<string, GroupMember[]>();
  async setGroupMembers(groupId: string, members: GroupMember[]) {
    this.members.set(groupId, members);
    const enlazado = [...this.groups.values()].some((g) => g.group_id === groupId && g.account_id);
    return { members: members.length, people_added: enlazado ? members.length : 0 };
  }
  async groupLeft(sesion: string, jid: string) {
    this.left.push(jid);
    this.presentes.delete(`${jid}|${sesion}`);
  }
  async linkGroup(sessionId: string, jid: string, name: string | null, code: string): Promise<LinkResult> {
    const cuenta = this.codes.get(code);
    if (!cuenta) return { ok: false, error: 'codigo_invalido' };
    const g = await this.upsertGroup(sessionId, jid, name);
    const actual = this.groups.get(jid);
    if (actual?.account_id && actual.account_id !== cuenta.id) return { ok: false, error: 'otra_cuenta' };
    const already = actual?.account_id === cuenta.id;
    if (actual) actual.account_id = cuenta.id;
    return { ok: true, already, account_id: cuenta.id, account_name: cuenta.name, group_id: g.group_id, members: this.members.get(g.group_id)?.length };
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
  /** Los textos que mandó (los de solo texto) */
  sent: { chatId: string; text: string }[] = [];
  /** Todo lo que mandó, también imágenes y documentos */
  enviados: ({ chatId: string } & Outgoing)[] = [];
  /** Lo que responde WhatsApp al entrar con un link */
  alUnirse: JoinResult = { status: 'joined', chatId: '120363055555555555@g.us', name: 'Cumple de Caro' };
  unidos: string[] = [];
  started = 0;
  stopped = 0;
  loggedOut = 0;
  connected = true;
  inGroups = new Set<string>([GRUPO]);
  /** grupo → quiénes están (lo que devolvería WhatsApp) */
  integrantes = new Map<string, GroupMember[]>();
  /** Grupos de los que se pidió quiénes están */
  pedidos: string[] = [];
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
  async members(chatId: string) {
    this.pedidos.push(chatId);
    return this.integrantes.get(chatId) ?? [];
  }
  async send(chatId: string, m: Outgoing) {
    if (this.failSend) throw new Error('sin señal');
    this.enviados.push({ chatId, ...m });
    if ('text' in m) this.sent.push({ chatId, text: m.text });
    return `W-${this.enviados.length}`;
  }
  async joinGroup(code: string) {
    this.unidos.push(code);
    return this.alUnirse;
  }
}

export const contador: SessionInfo = { id: 'contador', kind: 'contador', ownerId: null, label: null, pairingPhone: null };
export const personal: SessionInfo = { id: 'personal', kind: 'personal', ownerId: 'u1', label: null, pairingPhone: null };

export const grupo = (over: Partial<GroupInfo> = {}): GroupInfo => ({ chatId: GRUPO, name: 'Paseo Santa Marta 2026', participants: 8, ...over });
