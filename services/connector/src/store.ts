import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GroupMember, SessionKind } from './connector.js';
import type { PendingReply } from './text.js';

/* Todo lo que el connector lee y escribe en Supabase, en un solo lugar.
   Son RPC de 00000000000080_whatsapp_connector.sql y las que le siguieron
   (la 290: presencia, chats privados y la bandeja de salida; la 310: «luks soy
   yo» y el link de verificación; la 330: grupos detectados y el link /g/),
   solo service role. */

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
  /** El idioma de la cuenta (migración 290) */
  language?: 'es' | 'en' | null;
  say_hello: boolean;
}

/** connector_group_hello: si toca saludar, con qué (quiénes del grupo ya usan Luks) */
export type HelloResult = { say_hello: false } | { say_hello: true; account_name: string | null; language: 'es' | 'en' | null; luks_users: string[] };

/** connector_group_detected (migración 330): el grupo con su gente y, la primera vez, con qué saludar */
export interface DetectedResult extends GroupResult {
  members: number;
  people_added: number;
  hello: HelloResult;
}

/** Un grupo conectado desde la web que todavía no tiene a su gente (connector_groups_pending_members) */
export interface PendingMembers {
  group_id: string;
  jid: string;
  connection_id: string;
}

/** Un mensaje para la bandeja de salida de Mister Luks (whatsapp_outbox) */
export interface OutboxItem {
  chat_jid: string;
  reason: 'welcome' | 'group_hello' | 'guide' | 'invite' | 'link' | 'verify' | 'soy_yo';
  body?: string | null;
  image_url?: string | null;
  document_url?: string | null;
  document_name?: string | null;
  /** Lo mismo no se manda dos veces */
  dedupe_key: string;
  /** De qué número es el link de verificación (reason 'verify'; migración 310) */
  identity_id?: string | null;
  /** De qué grupo es el link /g/ para crear su cuenta (migración 330; si no llega, la base lo saca del chat) */
  group_id?: string | null;
}

/** connector_soy_yo: si el número ya es de un usuario verificado (su primer nombre) y sus últimos 4 */
export interface SoyYoResult {
  identity_id: string;
  verified: boolean;
  name: string | null;
  last4: string;
}

export interface OutboxPending extends Omit<OutboxItem, 'dedupe_key'> {
  id: string;
  created_at: string;
}

export type LinkResult =
  | {
      ok: true;
      already: boolean;
      account_id: string;
      account_name: string;
      group_id: string;
      people_added?: number;
      members?: number;
      /** El idioma de la cuenta (migración 260) */
      language?: 'es' | 'en' | null;
    }
  | { ok: false; error: 'codigo_invalido' | 'otra_cuenta' | 'no_es_grupo' };

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
  /** Marca el saludo del grupo (una sola vez) y dice con qué saludar */
  groupHello(groupId: string): Promise<HelloResult>;
  /** Mister Luks está en un grupo: el grupo, su presencia, su gente y el saludo, en una sola transacción */
  groupDetected(sessionId: string, jid: string, name: string | null, participants: number | null, members: GroupMember[]): Promise<DetectedResult>;
  /** Al mandar el saludo o la guía de un grupo sin cuenta: crea el código del link /g/ (null si ya tiene cuenta) */
  groupLinkMint(outboxId: string): Promise<string | null>;
  /** Los grupos conectados desde la web que todavía no tienen a su gente, de estas sesiones */
  groupsPendingMembers(connectionIds: string[]): Promise<PendingMembers[]>;
  /** Esta sesión ya no está en el grupo (las demás siguen) */
  groupLeft(sessionId: string, jid: string): Promise<void>;
  /** Alguien le escribió por privado a Mister Luks */
  privateChat(sessionId: string, jid: string): Promise<string>;
  /** Encola mensajes de Mister Luks; devuelve las dedupe_key que quedaron nuevas */
  outboxEnqueue(items: OutboxItem[]): Promise<string[]>;
  outboxPending(limit: number): Promise<OutboxPending[]>;
  outboxResult(id: string, waMessageId: string | null, error?: string | null, drop?: boolean): Promise<void>;
  /** «luks soy yo»: deja abierto su chat privado (lo pidió) y dice si su número ya está verificado */
  soyYo(sessionId: string, privateJid: string, phone: string | null, lid: string | null, pushName: string | null): Promise<SoyYoResult>;
  /** Al mandar un mensaje de verificación: crea el código del link /v/ (solo se guarda su hash) */
  verifyMint(outboxId: string): Promise<string>;
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

  groupHello(groupId: string) {
    return this.#rpc<HelloResult>('connector_group_hello', { p_group_id: groupId });
  }

  groupDetected(sessionId: string, jid: string, name: string | null, participants: number | null, members: GroupMember[]) {
    return this.#rpc<DetectedResult>('connector_group_detected', {
      p_connection_id: sessionId,
      p_jid: jid,
      p_name: name,
      p_participants: participants,
      p_members: members,
    });
  }

  groupLinkMint(outboxId: string) {
    return this.#rpc<string | null>('connector_group_link_mint', { p_outbox_id: outboxId });
  }

  async groupsPendingMembers(connectionIds: string[]) {
    if (!connectionIds.length) return [];
    return (await this.#rpc<PendingMembers[] | null>('connector_groups_pending_members', { p_connection_ids: connectionIds })) ?? [];
  }

  async groupLeft(sessionId: string, jid: string) {
    await this.#rpc('connector_group_left', { p_jid: jid, p_connection_id: sessionId });
  }

  privateChat(sessionId: string, jid: string) {
    return this.#rpc<string>('connector_private_chat', { p_connection_id: sessionId, p_jid: jid });
  }

  async outboxEnqueue(items: OutboxItem[]) {
    if (!items.length) return [];
    return (await this.#rpc<string[] | null>('connector_outbox_enqueue', { p_items: items })) ?? [];
  }

  outboxPending(limit: number) {
    return this.#rpc<OutboxPending[]>('connector_outbox_pending', { p_limit: limit });
  }

  async outboxResult(id: string, waMessageId: string | null, error: string | null = null, drop = false) {
    await this.#rpc('connector_outbox_result', { p_id: id, p_wa_message_id: waMessageId, p_error: error, p_drop: drop });
  }

  soyYo(sessionId: string, privateJid: string, phone: string | null, lid: string | null, pushName: string | null) {
    return this.#rpc<SoyYoResult>('connector_soy_yo', {
      p_connection_id: sessionId,
      p_private_jid: privateJid,
      p_phone: phone,
      p_lid: lid,
      p_push_name: pushName,
    });
  }

  verifyMint(outboxId: string) {
    return this.#rpc<string>('connector_verify_mint', { p_outbox_id: outboxId });
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
