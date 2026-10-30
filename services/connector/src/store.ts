import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GroupMember, Sender, SessionKind } from './connector.js';
import type { GastoConItems } from './recibo.js';
import type { Idioma, Moneda, PendingReply } from './text.js';

/* Todo lo que el connector lee y escribe en Supabase, en un solo lugar.
   Son RPC de 00000000000080_whatsapp_connector.sql y las que le siguieron
   (la 290: presencia, chats privados y la bandeja de salida; la 310: «luks soy
   yo» y el link de verificación; la 330: grupos detectados y el link /g/;
   la 340: desde cuándo anotar y el chat exportado; la 350: las preguntas a
   Mister Luks y «no me cuentes»), solo service role. */

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

/** «¿Desde cuándo anoto?» (migración 340): desde ahora o todo el chat (que le manden el exportado) */
export type DesdeCuando = 'desde_ya' | 'todo';

/** connector_request_import(_private): el chat exportado quedó en la cola del worker (o por qué no) */
export type ImportResult =
  | { ok: true; already: boolean; import_id: string | null; group_name?: string; language?: 'es' | 'en' | null }
  | { ok: false; reason: 'grupo_sin_enlazar' | 'sin_grupo' | 'varios'; groups?: string[] };

/** connector_usuarios: quién es (como en los integrantes) y su usuario de WhatsApp */
export interface UsuarioDeWhatsapp {
  id: string;
  phone: string | null;
  lid: string | null;
  username: string;
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
  reason: 'welcome' | 'group_hello' | 'guide' | 'invite' | 'link' | 'verify' | 'soy_yo' | 'import' | 'answer';
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

/** Un aviso de cobro que toca mandar (connector_cobros, migración 410) */
export interface Cobro {
  transfer_id: string;
  settlement_id: string;
  /** Cuántos avisos ya se mandaron de esta transferencia (0: el primero) */
  avisos: number;
  /** Si alguno ya le llegó por privado (si no, el de privado es el primero aunque se le haya avisado en el grupo) */
  avisado_privado: boolean;
  account: { id: string; name: string; language: Idioma | null; currency: Moneda; type: 'hogar' | 'evento'; month: string | null };
  from: { id: string; name: string };
  /** pago: cómo le pagan (migración 570), si lo puso en su perfil */
  to: { id: string; name: string; pago?: Pago | null };
  amount: number;
  /**
   * Su chat privado con Mister Luks; si nunca le escribió, el del número con que está en el grupo
   * (solo el primer aviso, migración 600). Si no hay, va al grupo
   */
  private_jid: string | null;
  /** Nunca le ha escrito a Mister Luks: el aviso se presenta (migración 600) */
  primera_vez?: boolean;
  group_jid: string | null;
  /** El link público de la cuenta (/r/TOKEN) */
  token: string | null;
  /** Todo lo que paga quien debe en esta liquidación */
  transfers: { to: string; amount: number; pago?: Pago | null }[] | null;
  /** Los gastos en los que tuvo parte y que pagó otro, con los ítems */
  expenses: (GastoConItems & { merchant: string; payer_person_id: string; payer_name: string })[];
}

/** Una transferencia de una liquidación, como la lee el connector (migración 420) */
export interface Transferencia {
  id: string;
  settlement_id: string;
  account: { id: string; name: string; language: Idioma | null; currency: Moneda };
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  amount: number;
}

/** connector_pendientes: lo que le falta pagar a quien dice «ya pagué» */
export interface PendientesResult {
  identity_id: string | null;
  /** Si el chat es un grupo (si no, es su chat privado con Mister Luks) */
  grupo: boolean;
  contador_en_grupo: boolean;
  /** La cuenta del grupo (por privado no hay: son todas las suyas) */
  account: { id: string; name: string; language: Idioma | null; currency: Moneda; liquidada: boolean } | null;
  /** Si se sabe quién es (en la cuenta del grupo, o en alguna) */
  conocido: boolean;
  pendientes: Transferencia[];
}

/** connector_ya_pague: lo que quedó pagado (y a dónde avisarle a quien recibe) y lo que le sigue faltando */
export interface YaPagueResult {
  pagadas: (Transferencia & { to_private_jid: string | null; group_jid: string | null; todos_pagaron: boolean })[];
  quedan: Transferencia[];
}

/** Una cuenta recién llegada al grupo para preguntar quién pidió qué (migración 440) */
export interface ItemsPregunta {
  expense_id: string;
  group_jid: string;
  merchant: string;
  total: number;
  tip: number;
  payer_name: string | null;
  account: { id: string; name: string; language: Idioma | null; currency: Moneda };
  /** En el orden en que salen numerados */
  items: { id: string; name: string; quantity: number; total: number }[];
}

/** connector_items_respuesta: lo que quedó de quien respondió la lista (o por qué no) */
export type ItemsRespuesta =
  | {
      ok: true;
      language: Idioma | null;
      currency: Moneda;
      merchant: string;
      name: string;
      /** Lo que le toca de la cuenta, ya con la propina */
      parte: number;
      /** amount: lo suyo del ítem en plata (migración 500) */
      mios: { n: number; name: string; quantity: number; units: number; amount?: number }[];
      /** Cuántos ítems no ha dicho nadie */
      sin_nadie: number;
      /** Migración 500: para mandarle lo suyo por privado y que lo confirme */
      expense_id?: string;
      account_id?: string;
      account_name?: string;
      expense_date?: string;
      total?: number;
      /** Su chat privado con Mister Luks (solo si ya le escribió) */
      privado?: string | null;
    }
  | {
      ok: false;
      reason: 'no_es_pregunta' | 'liquidado' | 'no_te_conozco' | 'cambio' | 'fijos' | 'no_existe';
      language?: Idioma | null;
      merchant?: string;
      account_name?: string;
      total_items?: number;
    };

/** connector_items_cantidad (migración 500): «la 1 son 3» respondiendo la lista */
export type ItemsCantidad =
  | { ok: true; language: Idioma | null; currency: Moneda; merchant: string; n: number; item: string; quantity: number; total: number }
  | {
      ok: false;
      reason: 'no_es_pregunta' | 'liquidado' | 'no_te_conozco' | 'cambio' | 'no_existe' | 'cantidad';
      language?: Idioma | null;
      merchant?: string;
      account_name?: string;
      total_items?: number;
    };

/** connector_decidir_liquidada: respondieron si se reabre el paseo liquidado o va a una cuenta nueva (migración 450) */
export type DecisionLiquidada =
  | {
      ok: true;
      /** «pago» (la 590): los comprobantes que esperaban no se anotaron */
      modo: 'reabrir' | 'nueva' | 'pago';
      /** La cuenta donde quedó (para el link) */
      account_id: string;
      language: Idioma | null;
      currency: Moneda;
      name: string;
      /** La cuenta donde quedó (la misma reabierta o la nueva) y la liquidada */
      cuenta: string;
      anterior: string;
      gastos: { expense_id: string | null; duplicate_of: string | null; merchant: string; total: number; items: number }[];
    }
  | { ok: false; reason: 'no_es_pregunta' | 'no_te_conozco' | 'cerrada' | 'sin_comprobante'; language?: Idioma | null; account_name?: string };

/** connector_eliminar_gasto: «luks elimina este gasto» citando el mensaje del gasto (migración 520) */
export type EliminarGasto =
  | {
      ok: true;
      language: Idioma | null;
      currency: Moneda;
      account_id: string;
      account_name: string;
      name: string | null;
      gastos: { merchant: string; total: number }[];
    }
  | {
      ok: false;
      reason: 'sin_cita' | 'no_es_gasto' | 'procesando' | 'liquidado' | 'no_te_conozco' | 'no_puedes';
      language?: Idioma | null;
      account_name?: string;
      name?: string | null;
    };

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
      /** El grupo venía de otra cuenta (ya liquidada, o desconectada): no se pregunta desde cuándo (migración 370) */
      previous_account?: string | null;
    }
  | {
      ok: false;
      error: 'codigo_invalido' | 'otra_cuenta' | 'no_es_grupo';
      /** Con 'otra_cuenta': cuál es (sigue abierta) y su idioma */
      account_name?: string;
      language?: 'es' | 'en' | null;
    };

/** Lo de quien pregunta: sus saldos salen de «people»; esto es lo que pagó en el período */
export interface QuestionMe {
  id: string;
  name: string;
  paid_total: number;
  paid_count: number;
  /** Los últimos 5 que pagó */
  expenses: { merchant: string; total: number; date: string }[];
  /** Los gastos donde tuvo parte, con los ítems: por qué debe (migración 470; sin ella no viene) */
  consumo?: (GastoConItems & { merchant: string; payer_person_id: string | null; payer_name: string | null })[];
  /** Lo que pagó, con lo de cada uno: de qué le pagan (migración 490; sin ella no viene) */
  pagados?: (GastoConItems & { merchant: string; payer_person_id: string | null })[];
}

/**
 * connector_question (migración 350): lo que hace falta para responder una
 * pregunta. Los números salen de aquí (del período que muestra la app: el mes
 * en un hogar, todo en un evento), nunca de Qwen.
 */
export type QuestionData = {
  identity_id: string;
  /** Cómo quiere recibir lo suyo; null si nunca lo dijo */
  pref: 'privado' | 'aqui' | null;
  /** Si Mister Luks está en el grupo (si no, lo lee solo un WhatsApp vinculado) */
  contador_en_grupo: boolean;
} & ({ ok: false; reason: 'sin_cuenta' } | ({ ok: true } & NumerosDeCuenta));

/** Los números de una cuenta para responder (numeros_para_luks, migración 480; antes, dentro de connector_question) */
export interface NumerosDeCuenta {
  /** id: desde la 480 */
  account: { id?: string; name: string; type: 'hogar' | 'evento'; status: string; currency: Moneda; language: Idioma | null; month: string | null };
  optout: boolean;
  total: number;
  count: number;
  pending: number;
  /** Sin quién pagó o mal divididos: no entran en los saldos */
  incomplete: number;
  people: { id: string; name: string; paid: number; share: number; balance: number }[];
  /** Si el período ya se liquidó, sus transferencias */
  settlement: { from: string; to: string; from_id: string; to_id: string; amount: number; paid: boolean }[] | null;
  /** Migración 400: si se liquida «a quien pagó por cada uno», cómo quedarían hoy (null si se cruzan las deudas) */
  direct?: boolean;
  direct_transfers?: { from: string; to: string; from_id: string; to_id: string; amount: number }[] | null;
  me: QuestionMe | null;
  /** Migración 570: cómo le pagan a quien tiene cuenta en Luks y lo puso en su perfil (person_id → …) */
  pagos?: Record<string, Pago>;
}

/** Cómo le pagan a alguien (migración 570): su llave Bre-B, su Nequi, su Daviplata */
export interface Pago {
  llave?: string;
  nequi?: string;
  daviplata?: string;
}

/** connector_mis_cuentas (migración 480): por privado, las cuentas de quien escribe, primero donde le falta pagar */
export interface MisCuentas {
  identity_id: string;
  cuentas: NumerosDeCuenta[];
}

export interface IngestCheck {
  ingest: boolean;
  reason?:
    | 'grupo_sin_enlazar'
    | 'cuenta_cerrada'
    | 'cuenta_liquidada'
    | 'antes_del_enlace'
    | 'repetido'
    | 'vacio'
    | 'archivo_fuera_de_la_cuenta'
    | 'no_me_cuentes';
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

/** Un gasto que llegó por privado, para la cuenta que eligió quien lo mandó (migración 630) */
export interface IngestPrivadoInput {
  chatJid: string;
  accountId: string;
  waMessageId: string;
  sender: Sender;
  kind: 'photo' | 'pdf' | 'text';
  text: string | null;
  mediaPath: string | null;
  fileName: string | null;
  mimeType: string | null;
  sentAt: Date;
}

export interface IngestPrivadoResult {
  ingest: boolean;
  reason?:
    | 'sin_chat'
    | 'cuenta_cerrada'
    | 'cuenta_liquidada'
    | 'no_es_de_la_cuenta'
    | 'no_me_cuentes'
    | 'vacio'
    | 'archivo_fuera_de_la_cuenta'
    | 'mensaje_de_luks'
    | 'repetido';
  message_id?: string;
  account_id?: string;
  account_name?: string;
}

/** «Sí, ábreme una cuenta» por privado (migración 640): abierta ya, o por abrir hasta que entre a Luks */
export interface AbrirCuentaPrivadaResult {
  ok: boolean;
  reason?: 'sin_chat';
  abierta?: boolean;
  account_id?: string;
  account_name?: string;
  identity_id?: string;
}

/** Lo que mandó, guardado para la cuenta por abrir (migración 640) */
export interface GastoPorAbrir {
  wa_message_id: string;
  sender_wa_id: string | null;
  sender_name: string | null;
  kind: 'photo' | 'pdf' | 'text';
  text: string | null;
  media_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  sent_at: string;
}

/**
 * Entró a Luks con cuentas que ya tenía (migración 670): la base no abrió otra y le preguntó en
 * cuál anota lo que mandó. Las opciones son sus cuentas y, después, la nueva («Cuenta con Mister Luks»)
 */
export interface PorAbrirEnEspera {
  account_id: string;
  account_name: string;
  language: Idioma;
  opciones: { id: string; name: string }[];
  items: {
    wa_message_id: string;
    kind: 'photo' | 'pdf' | 'text';
    text: string | null;
    media_path: string | null;
    file_name: string | null;
    mime_type: string | null;
    sent_at: string;
  }[];
}

export interface ResolverPorAbrirResult {
  ok: boolean;
  reason?: 'ya_no' | 'sin_usuario';
  account_id?: string;
  account_name?: string;
  leyendo?: number;
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
  /** El usuario de WhatsApp de cada quien (migración 530): con él se nombra a quien no tenía nombre. Cuántos cambiaron */
  usuarios(lista: UsuarioDeWhatsapp[]): Promise<number>;
  /** Marca el saludo del grupo (una sola vez) y dice con qué saludar */
  groupHello(groupId: string): Promise<HelloResult>;
  /** Mister Luks está en un grupo: el grupo, su presencia, su gente y el saludo, en una sola transacción */
  groupDetected(sessionId: string, jid: string, name: string | null, participants: number | null, members: GroupMember[]): Promise<DetectedResult>;
  /** Al mandar el saludo o la guía de un grupo sin cuenta: crea el código del link /g/ (null si ya tiene cuenta) */
  groupLinkMint(outboxId: string): Promise<string | null>;
  /** Los grupos conectados desde la web que todavía no tienen a su gente, de estas sesiones */
  groupsPendingMembers(connectionIds: string[]): Promise<PendingMembers[]>;
  /** Alguien del grupo dijo desde cuándo anotar; Mister Luks anuncia quién (lo encola la base) */
  historyAnswer(jid: string, mode: DesdeCuando, name: string | null, onlyPending: boolean): Promise<{ changed: boolean; reason?: string }>;
  /** El chat exportado, al bucket «importaciones» */
  uploadImport(path: string, body: Buffer, contentType: string): Promise<void>;
  /** Lo mandaron en un grupo enlazado: queda en la cola del worker (una vez por mensaje) */
  requestImport(jid: string, path: string, fileName: string | null, waMessageId: string, senderName: string | null): Promise<ImportResult>;
  /** Lo mandaron por privado: de cuál de sus grupos es (por quién lo manda y el nombre del archivo) */
  requestImportPrivate(
    path: string,
    fileName: string | null,
    waMessageId: string,
    phone: string | null,
    lid: string | null,
    senderName: string | null,
    chatName: string | null,
  ): Promise<ImportResult>;
  /** Esta sesión ya no está en el grupo (las demás siguen) */
  groupLeft(sessionId: string, jid: string): Promise<void>;
  /** Alguien le escribió por privado a Mister Luks */
  privateChat(sessionId: string, jid: string): Promise<string>;
  /** Encola mensajes de Mister Luks; devuelve las dedupe_key que quedaron nuevas */
  outboxEnqueue(items: OutboxItem[]): Promise<string[]>;
  outboxPending(limit: number): Promise<OutboxPending[]>;
  outboxResult(id: string, waMessageId: string | null, error?: string | null, drop?: boolean): Promise<void>;
  /** Lo que mandó una sesión, en base64, para reenviarlo si no lo pudieron descifrar (migración 560) */
  guardarEnviado(waMessageId: string, chatJid: string, mensaje: string): Promise<void>;
  mensajeEnviado(waMessageId: string): Promise<string | null>;
  /** «luks soy yo»: deja abierto su chat privado (lo pidió) y dice si su número ya está verificado */
  soyYo(sessionId: string, privateJid: string, phone: string | null, lid: string | null, pushName: string | null): Promise<SoyYoResult>;
  /** Al mandar un mensaje de verificación: crea el código del link /v/ (solo se guarda su hash) */
  verifyMint(outboxId: string): Promise<string>;
  linkGroup(sessionId: string, jid: string, name: string | null, code: string, senderWaId: string | null): Promise<LinkResult>;
  /** ¿Se guarda? Con quién lo mandó, para respetar «no me cuentes» antes de bajar nada */
  shouldIngest(jid: string, waMessageId: string, sentAt: Date, senderWaId?: string | null): Promise<IngestCheck>;
  /** Una pregunta a Mister Luks: los números de la cuenta del grupo y lo de quien pregunta (null si no es un grupo) */
  question(jid: string, sender: Sender): Promise<QuestionData | null>;
  /** Por privado: las cuentas de quien escribe, con sus números (migración 480) */
  misCuentas(jid: string, sender: Sender): Promise<MisCuentas>;
  /** «privado» o «aquí»; con onlyPending, solo si había una pregunta suya esperando en ese grupo */
  answerPref(
    jid: string,
    sender: Sender,
    mode: 'privado' | 'aqui',
    onlyPending: boolean,
  ): Promise<{ changed: boolean; mode?: 'privado' | 'aqui'; pending_intent?: 'mi_saldo' | 'mis_gastos' | null }>;
  /** Preguntó algo suyo sin decir cómo lo quiere: queda esperando «privado» o «aquí» */
  askAnswerPref(jid: string, identityId: string, intent: 'mi_saldo' | 'mis_gastos'): Promise<void>;
  /** «no me cuentes» (on) o «cuéntame» en la cuenta del grupo */
  optout(jid: string, sender: Sender, on: boolean): Promise<{ changed: boolean; reason?: 'sin_cuenta'; account_name?: string; language?: Idioma | null }>;
  /** Un grupo que lee solo un WhatsApp vinculado: Mister Luks abre el chat privado de quien preguntó (false si no hay Mister Luks) */
  openPrivateAnswer(privateJid: string): Promise<boolean>;
  /** Los avisos de cobro que tocan ahora (migración 410) */
  cobros(limit: number): Promise<Cobro[]>;
  /** Ya se avisó de esas transferencias: por privado unas, en el grupo otras */
  cobrosAvisados(privados: string[], enGrupo: string[]): Promise<void>;
  /** Lo que le falta pagar a quien escribe (migración 420) */
  porPagar(jid: string, sender: Sender): Promise<PendientesResult>;
  /** «Ya pagué»: las marca pagadas (solo las que paga quien escribe) */
  yaPague(jid: string, sender: Sender, transferIds: string[]): Promise<YaPagueResult>;
  /** Las cuentas recién llegadas para preguntar quién pidió qué (migración 440) */
  itemsPorPreguntar(limit: number): Promise<ItemsPregunta[]>;
  /** La lista quedó en la bandeja de salida con esa clave */
  itemPromptGuardado(expenseId: string, itemIds: string[], chatJid: string, dedupeKey: string): Promise<void>;
  /** Respondieron la pregunta de un paseo liquidado: reabrirlo o anotar en una cuenta nueva (citándola o no) */
  decidirLiquidada(jid: string, quotedId: string | null, sender: Sender, modo: 'reabrir' | 'nueva' | 'pago'): Promise<DecisionLiquidada>;
  /** «luks elimina este gasto» citando su mensaje: lo elimina si quien lo pide puede (migración 520) */
  eliminarGasto(jid: string, quotedId: string | null, sender: Sender): Promise<EliminarGasto>;
  /** Alguien respondió la lista (citándola) con los números de lo suyo */
  itemsRespuesta(jid: string, quotedId: string, sender: Sender, claims: { n: number; units?: number }[]): Promise<ItemsRespuesta>;
  /** «la 1 son 3»: cuántas unidades trae un ítem de la lista, sin cambiar el total (migración 500) */
  itemsCantidad(jid: string, quotedId: string, sender: Sender, n: number, cantidad: number): Promise<ItemsCantidad>;
  ingest(input: IngestInput): Promise<IngestCheck>;
  /** Un gasto que llegó por privado, en la cuenta que eligió (migración 630) */
  ingestPrivado(input: IngestPrivadoInput): Promise<IngestPrivadoResult>;
  /** Sus cuentas abiertas donde puede anotar lo que manda por privado (migración 640) */
  cuentasParaAnotar(jid: string, sender: Sender): Promise<{ id: string; name: string; type: 'hogar' | 'evento' }[]>;
  /** «Sí, ábreme una cuenta» por privado (migración 640) */
  abrirCuentaPrivada(jid: string, sender: Sender): Promise<AbrirCuentaPrivadaResult>;
  /** Lo que mandó, para la cuenta que se abre cuando entre a Luks (migración 640) */
  guardarGastosPorAbrir(accountId: string, gastos: GastoPorAbrir[]): Promise<number>;
  /** La pregunta «¿en cuál anoto lo que me mandaste?» de ese chat, si espera respuesta (migración 670) */
  porAbrirEnEspera(jid: string): Promise<PorAbrirEnEspera | null>;
  /** 'nueva' la abre con lo que mandó; 'listo' (ya se anotó en otra) o 'no' cierran la pregunta */
  resolverPorAbrir(accountId: string, que: 'nueva' | 'listo' | 'no'): Promise<ResolverPorAbrirResult>;
  uploadEvidence(path: string, body: Buffer, contentType: string): Promise<void>;
  /** Mueve un archivo de una cuenta a otra (lo que mandó para la cuenta por abrir, a la que eligió) */
  moverEvidencia(from: string, to: string): Promise<void>;
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
export const IMPORT_BUCKET = 'importaciones';

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

  async usuarios(lista: UsuarioDeWhatsapp[]) {
    return (await this.#rpc<number | null>('connector_usuarios', { p_usuarios: lista })) ?? 0;
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

  historyAnswer(jid: string, mode: DesdeCuando, name: string | null, onlyPending: boolean) {
    return this.#rpc<{ changed: boolean; reason?: string }>('connector_history_answer', {
      p_jid: jid,
      p_mode: mode,
      p_name: name,
      p_only_pending: onlyPending,
    });
  }

  async uploadImport(path: string, body: Buffer, contentType: string) {
    const { error } = await this.#db.storage.from(IMPORT_BUCKET).upload(path, body, { contentType, upsert: true });
    if (error) throw new StoreError('storage.upload', error.message);
  }

  requestImport(jid: string, path: string, fileName: string | null, waMessageId: string, senderName: string | null) {
    return this.#rpc<ImportResult>('connector_request_import', {
      p_jid: jid,
      p_path: path,
      p_file_name: fileName,
      p_wa_message_id: waMessageId,
      p_sender_name: senderName,
    });
  }

  requestImportPrivate(
    path: string,
    fileName: string | null,
    waMessageId: string,
    phone: string | null,
    lid: string | null,
    senderName: string | null,
    chatName: string | null,
  ) {
    return this.#rpc<ImportResult>('connector_request_import_private', {
      p_path: path,
      p_file_name: fileName,
      p_wa_message_id: waMessageId,
      p_sender_phone: phone,
      p_sender_lid: lid,
      p_sender_name: senderName,
      p_chat_name: chatName,
    });
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

  async guardarEnviado(waMessageId: string, chatJid: string, mensaje: string) {
    await this.#rpc('connector_guardar_enviado', { p_wa_message_id: waMessageId, p_chat_jid: chatJid, p_mensaje: mensaje });
  }

  async mensajeEnviado(waMessageId: string) {
    return (await this.#rpc<string | null>('connector_mensaje_enviado', { p_wa_message_id: waMessageId })) ?? null;
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

  shouldIngest(jid: string, waMessageId: string, sentAt: Date, senderWaId: string | null = null) {
    return this.#rpc<IngestCheck>('connector_should_ingest_sender', {
      p_jid: jid,
      p_wa_message_id: waMessageId,
      p_sent_at: sentAt.toISOString(),
      p_sender_wa_id: senderWaId,
    });
  }

  async question(jid: string, sender: Sender) {
    const r = await this.#rpc<QuestionData | { ok: false; reason: 'sin_grupo' }>('connector_question', {
      p_jid: jid,
      p_wa_id: sender.id,
      p_phone: sender.phone,
      p_lid: sender.lid ?? null,
      p_name: sender.name,
    });
    return 'identity_id' in r ? r : null;
  }

  misCuentas(jid: string, sender: Sender) {
    return this.#rpc<MisCuentas>('connector_mis_cuentas', {
      p_jid: jid,
      p_wa_id: sender.id,
      p_phone: sender.phone,
      p_lid: sender.lid ?? null,
      p_name: sender.name,
    });
  }

  answerPref(jid: string, sender: Sender, mode: 'privado' | 'aqui', onlyPending: boolean) {
    return this.#rpc<{ changed: boolean; mode?: 'privado' | 'aqui'; pending_intent?: 'mi_saldo' | 'mis_gastos' | null }>('connector_answer_pref', {
      p_jid: jid,
      p_wa_id: sender.id,
      p_phone: sender.phone,
      p_lid: sender.lid ?? null,
      p_name: sender.name,
      p_mode: mode,
      p_only_pending: onlyPending,
    });
  }

  async askAnswerPref(jid: string, identityId: string, intent: 'mi_saldo' | 'mis_gastos') {
    await this.#rpc('connector_ask_answer_pref', { p_jid: jid, p_identity_id: identityId, p_intent: intent });
  }

  optout(jid: string, sender: Sender, on: boolean) {
    return this.#rpc<{ changed: boolean; reason?: 'sin_cuenta'; account_name?: string; language?: Idioma | null }>('connector_optout', {
      p_jid: jid,
      p_wa_id: sender.id,
      p_phone: sender.phone,
      p_lid: sender.lid ?? null,
      p_name: sender.name,
      p_on: on,
    });
  }

  openPrivateAnswer(privateJid: string) {
    return this.#rpc<boolean>('connector_open_private_answer', { p_jid: privateJid });
  }

  cobros(limit: number) {
    return this.#rpc<Cobro[]>('connector_avisos_de_cobro', { p_limit: limit });
  }

  async cobrosAvisados(privados: string[], enGrupo: string[]) {
    if (privados.length || enGrupo.length) await this.#rpc('connector_cobros_enviados', { p_privados: privados, p_en_grupo: enGrupo });
  }

  porPagar(jid: string, sender: Sender) {
    return this.#rpc<PendientesResult>('connector_pendientes', {
      p_jid: jid,
      p_wa_id: sender.id,
      p_phone: sender.phone,
      p_lid: sender.lid ?? null,
      p_name: sender.name,
    });
  }

  yaPague(jid: string, sender: Sender, transferIds: string[]) {
    return this.#rpc<YaPagueResult>('connector_ya_pague', {
      p_jid: jid,
      p_wa_id: sender.id,
      p_phone: sender.phone,
      p_lid: sender.lid ?? null,
      p_transfer_ids: transferIds,
    });
  }
  decidirLiquidada(jid: string, quotedId: string | null, sender: Sender, modo: 'reabrir' | 'nueva' | 'pago') {
    return this.#rpc<DecisionLiquidada>('connector_decidir_liquidada', {
      p_jid: jid,
      p_quoted_wa_id: quotedId,
      p_wa_id: sender.id,
      p_phone: sender.phone,
      p_lid: sender.lid ?? null,
      p_name: sender.name,
      p_modo: modo,
    });
  }

  eliminarGasto(jid: string, quotedId: string | null, sender: Sender) {
    return this.#rpc<EliminarGasto>('connector_eliminar_gasto', {
      p_jid: jid,
      p_quoted_wa_id: quotedId,
      p_wa_id: sender.id,
      p_phone: sender.phone,
      p_lid: sender.lid ?? null,
      p_name: sender.name,
    });
  }

  itemsCantidad(jid: string, quotedId: string, sender: Sender, n: number, cantidad: number) {
    return this.#rpc<ItemsCantidad>('connector_items_cantidad', {
      p_jid: jid,
      p_quoted_wa_id: quotedId,
      p_wa_id: sender.id,
      p_phone: sender.phone,
      p_lid: sender.lid ?? null,
      p_name: sender.name,
      p_n: n,
      p_cantidad: cantidad,
    });
  }

  itemsPorPreguntar(limit: number) {
    return this.#rpc<ItemsPregunta[]>('connector_items_por_preguntar', { p_limit: limit });
  }

  async itemPromptGuardado(expenseId: string, itemIds: string[], chatJid: string, dedupeKey: string) {
    await this.#rpc('connector_item_prompt_guardado', { p_expense_id: expenseId, p_items: itemIds, p_chat_jid: chatJid, p_dedupe_key: dedupeKey });
  }

  itemsRespuesta(jid: string, quotedId: string, sender: Sender, claims: { n: number; units?: number }[]) {
    return this.#rpc<ItemsRespuesta>('connector_items_respuesta', {
      p_jid: jid,
      p_quoted_wa_id: quotedId,
      p_wa_id: sender.id,
      p_phone: sender.phone,
      p_lid: sender.lid ?? null,
      p_name: sender.name,
      p_claims: claims,
    });
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

  cuentasParaAnotar(jid: string, sender: Sender) {
    return this.#rpc<{ id: string; name: string; type: 'hogar' | 'evento' }[]>('connector_cuentas_para_anotar', {
      p_jid: jid,
      p_wa_id: sender.id,
      p_phone: sender.phone,
      p_lid: sender.lid ?? null,
    });
  }

  abrirCuentaPrivada(jid: string, sender: Sender) {
    return this.#rpc<AbrirCuentaPrivadaResult>('connector_abrir_cuenta_privada', {
      p_chat_jid: jid,
      p_wa_id: sender.id,
      p_phone: sender.phone,
      p_lid: sender.lid ?? null,
      p_name: sender.name,
    });
  }

  guardarGastosPorAbrir(accountId: string, gastos: GastoPorAbrir[]) {
    return this.#rpc<number>('connector_guardar_gastos_por_abrir', { p_account_id: accountId, p_items: gastos });
  }

  porAbrirEnEspera(jid: string) {
    return this.#rpc<PorAbrirEnEspera | null>('connector_por_abrir_en_espera', { p_chat_jid: jid });
  }

  resolverPorAbrir(accountId: string, que: 'nueva' | 'listo' | 'no') {
    return this.#rpc<ResolverPorAbrirResult>('connector_resolver_por_abrir', { p_account_id: accountId, p_que: que });
  }

  async moverEvidencia(from: string, to: string) {
    const { error } = await this.#db.storage.from(EVIDENCE_BUCKET).move(from, to);
    if (error) throw new StoreError('storage.move', error.message);
  }

  ingestPrivado(i: IngestPrivadoInput) {
    return this.#rpc<IngestPrivadoResult>('connector_ingest_privado', {
      p_chat_jid: i.chatJid,
      p_account_id: i.accountId,
      p_wa_message_id: i.waMessageId,
      p_sender_wa_id: i.sender.id,
      p_sender_phone: i.sender.phone,
      p_sender_lid: i.sender.lid ?? null,
      p_sender_name: i.sender.name,
      p_kind: i.kind,
      p_text: i.text,
      p_media_path: i.mediaPath,
      p_file_name: i.fileName,
      p_mime_type: i.mimeType,
      p_sent_at: i.sentAt.toISOString(),
    });
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
