import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GroupMember, SessionKind } from './connector.js';
import type { PendingReply } from './text.js';

/* Todo lo que el connector lee y escribe en Supabase, en un solo lugar.
   Son RPC de 00000000000080_whatsapp_connector.sql (solo service role). */

export interface SessionRow {
  id: string;
  kind: SessionKind;
  owner_id: string | null;
  status: 'connecting' | 'connected' | 'disconnected';
  label: string | null;
  has_creds: boolean;
  pairing_phone: string | null;
  stop_requested: boolean;
}

export interface KeyItem {
  t: string;
  i: string;
  /** base64 cifrado, o null para borrarla */
  v: string | null;
}

export interface GroupResult {
  group_id: string;
  account_id: string | null;
  account_name: string | null;
  say_hello: boolean;
}

export type LinkResult =
  | { ok: true; already: boolean; account_id: string; account_name: string; group_id: string; people_added?: number; members?: number }
  | { ok: false; error: 'codigo_invalido' | 'otra_cuenta' };

export interface IngestCheck {
  ingest: boolean;
  reason?: 'grupo_sin_enlazar' | 'cuenta_cerrada' | 'antes_del_enlace' | 'repetido' | 'vacio' | 'archivo_fuera_de_la_cuenta';
  account_id?: string;
  group_id?: string;
  message_id?: string;
  known_sender?: boolean;
}

export interface IngestInput {
  jid: string;
  waMessageId: string;
  senderWaId: string | null;
  senderName: string | null;
  kind: 'photo' | 'pdf' | 'text';
  text: string | null;
  mediaPath: string | null;
  fileName: string | null;
  mimeType: string | null;
  sentAt: Date;
}

export interface QueueHealth {
  queued: number;
  oldest_queued_s: number;
  running: number;
}

export interface Store {
  sessions(): Promise<SessionRow[]>;
  requestContador(phone: string | null): Promise<string>;
  getCreds(id: string): Promise<string | null>;
  saveCreds(id: string, ciphertext: string): Promise<void>;
  getKeys(id: string, type: string, ids: string[]): Promise<Record<string, string>>;
  setKeys(id: string, items: KeyItem[]): Promise<void>;
  setStatus(
    id: string,
    status: SessionRow['status'],
    extra?: { jid?: string | null; lid?: string | null; phone?: string | null; reason?: string | null },
  ): Promise<void>;
  setPairing(id: string, qr: string | null, code: string | null, expiresAt: Date | null): Promise<void>;
  heartbeat(ids: string[]): Promise<void>;
  clearSession(id: string, reason: string): Promise<void>;
  upsertGroup(sessionId: string, jid: string, name: string | null, participants: number | null): Promise<GroupResult>;
  /** La lista completa de integrantes; si el grupo está enlazado, cada uno queda como persona de la cuenta */
  setGroupMembers(groupId: string, members: GroupMember[]): Promise<{ members: number; people_added: number }>;
  markHello(groupId: string): Promise<void>;
  groupLeft(jid: string): Promise<void>;
  linkGroup(sessionId: string, jid: string, name: string | null, code: string, senderWaId: string | null): Promise<LinkResult>;
  shouldIngest(jid: string, waMessageId: string, sentAt: Date): Promise<IngestCheck>;
  ingest(input: IngestInput): Promise<IngestCheck>;
  uploadEvidence(path: string, body: Buffer, contentType: string): Promise<void>;
  pendingReplies(limit: number): Promise<PendingReply[]>;
  markReplied(messageIds: string[]): Promise<void>;
  queueHealth(): Promise<QueueHealth>;
}

export class StoreError extends Error {
  constructor(
    readonly operation: string,
    message: string,
  ) {
    super(`${operation}: ${message}`);
  }
}

export const EVIDENCE_BUCKET = 'evidencias';

export class SupabaseStore implements Store {
  readonly #db: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.#db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-client-info': 'lucas-connector' } },
    });
  }

  async #rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.#db.rpc(fn, args);
    if (error) throw new StoreError(fn, error.message);
    return data as T;
  }

  sessions() {
    return this.#rpc<SessionRow[]>('connector_sessions');
  }

  requestContador(phone: string | null) {
    return this.#rpc<string>('connector_request_contador', { p_phone: phone });
  }

  getCreds(id: string) {
    return this.#rpc<string | null>('connector_get_creds', { p_connection_id: id });
  }

  async saveCreds(id: string, ciphertext: string) {
    await this.#rpc('connector_save_creds', { p_connection_id: id, p_ciphertext: ciphertext });
  }

  async getKeys(id: string, type: string, ids: string[]) {
    if (!ids.length) return {};
    const rows = await this.#rpc<{ key_id: string; ciphertext: string }[]>('connector_get_keys', { p_connection_id: id, p_type: type, p_ids: ids });
    return Object.fromEntries(rows.map((r) => [r.key_id, r.ciphertext]));
  }

  async setKeys(id: string, items: KeyItem[]) {
    // En tandas: una sesión nueva sube cientos de pre-keys de una vez
    for (let i = 0; i < items.length; i += 200) {
      await this.#rpc('connector_set_keys', { p_connection_id: id, p_items: items.slice(i, i + 200) });
    }
  }

  async setStatus(
    id: string,
    status: SessionRow['status'],
    extra: { jid?: string | null; lid?: string | null; phone?: string | null; reason?: string | null } = {},
  ) {
    await this.#rpc('connector_set_status', {
      p_connection_id: id,
      p_status: status,
      p_wa_jid: extra.jid ?? null,
      p_wa_lid: extra.lid ?? null,
      p_phone: extra.phone ?? null,
      p_reason: extra.reason ?? null,
    });
  }

  async setPairing(id: string, qr: string | null, code: string | null, expiresAt: Date | null) {
    await this.#rpc('connector_set_pairing', { p_connection_id: id, p_qr: qr, p_code: code, p_expires_at: expiresAt?.toISOString() ?? null });
  }

  async heartbeat(ids: string[]) {
    if (ids.length) await this.#rpc('connector_heartbeat', { p_connection_ids: ids });
  }

  async clearSession(id: string, reason: string) {
    await this.#rpc('connector_clear_session', { p_connection_id: id, p_reason: reason });
  }

  upsertGroup(sessionId: string, jid: string, name: string | null, participants: number | null) {
    return this.#rpc<GroupResult>('connector_upsert_group', { p_connection_id: sessionId, p_jid: jid, p_name: name, p_participants: participants });
  }

  setGroupMembers(groupId: string, members: GroupMember[]) {
    return this.#rpc<{ members: number; people_added: number }>('connector_set_group_members', { p_group_id: groupId, p_members: members });
  }

  async markHello(groupId: string) {
    await this.#rpc('connector_mark_hello', { p_group_id: groupId });
  }

  async groupLeft(jid: string) {
    await this.#rpc('connector_group_left', { p_jid: jid });
  }

  linkGroup(sessionId: string, jid: string, name: string | null, code: string, senderWaId: string | null) {
    return this.#rpc<LinkResult>('connector_link_group', { p_connection_id: sessionId, p_jid: jid, p_name: name, p_code: code, p_sender_wa_id: senderWaId });
  }

  shouldIngest(jid: string, waMessageId: string, sentAt: Date) {
    return this.#rpc<IngestCheck>('connector_should_ingest', { p_jid: jid, p_wa_message_id: waMessageId, p_sent_at: sentAt.toISOString() });
  }

  ingest(m: IngestInput) {
    return this.#rpc<IngestCheck>('connector_ingest_message', {
      p_jid: m.jid,
      p_wa_message_id: m.waMessageId,
      p_sender_wa_id: m.senderWaId,
      p_sender_name: m.senderName,
      p_kind: m.kind,
      p_text: m.text,
      p_media_path: m.mediaPath,
      p_file_name: m.fileName,
      p_mime_type: m.mimeType,
      p_sent_at: m.sentAt.toISOString(),
    });
  }

  async uploadEvidence(path: string, body: Buffer, contentType: string) {
    const { error } = await this.#db.storage.from(EVIDENCE_BUCKET).upload(path, body, { contentType, upsert: true });
    if (error) throw new StoreError('storage.upload', error.message);
  }

  pendingReplies(limit: number) {
    return this.#rpc<PendingReply[]>('connector_pending_replies', { p_limit: limit });
  }

  async markReplied(messageIds: string[]) {
    if (messageIds.length) await this.#rpc('connector_mark_replied', { p_message_ids: messageIds });
  }

  queueHealth() {
    return this.#rpc<QueueHealth>('connector_queue_health');
  }
}
