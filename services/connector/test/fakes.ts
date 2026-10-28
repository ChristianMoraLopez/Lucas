import pino from 'pino';
import type { ConnectorHandlers, GroupInfo, GroupMember, JoinResult, MessagingConnector, Outgoing, Sender, SessionInfo } from '../src/connector.js';
import type {
  Cobro,
  DecisionLiquidada,
  DesdeCuando,
  DetectedResult,
  EliminarGasto,
  GroupResult,
  HelloResult,
  ImportResult,
  IngestCheck,
  IngestInput,
  ItemsCantidad,
  ItemsPregunta,
  ItemsRespuesta,
  KeyItem,
  LinkResult,
  MisCuentas,
  NumerosDeCuenta,
  OutboxItem,
  OutboxPending,
  PendientesResult,
  PendingMembers,
  QuestionData,
  QueueHealth,
  SessionRow,
  SoyYoResult,
  Store,
  Transferencia,
  YaPagueResult,
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
  async groupDetected(sesion: string, jid: string, name: string | null, _participants: number | null, members: GroupMember[]): Promise<DetectedResult> {
    const g = await this.upsertGroup(sesion, jid, name);
    const r = members.length ? await this.setGroupMembers(g.group_id, members) : { members: this.members.get(g.group_id)?.length ?? 0, people_added: 0 };
    const hello: HelloResult = g.say_hello ? await this.groupHello(g.group_id) : { say_hello: false };
    return { ...g, ...r, hello };
  }
  /** Los códigos de los links /g/ que se crearon al mandar saludos y guías */
  codigosGrupo: string[] = [];
  async groupLinkMint(outboxId: string) {
    const o = this.outbox.find((x) => x.id === outboxId);
    if (!o?.group_id) throw new Error('Ese mensaje no lleva el link de un grupo');
    if ([...this.groups.values()].some((g) => g.group_id === o.group_id && g.account_id)) return null;
    const codigo = `Grp${this.codigosGrupo.length + 1}_xY-7`;
    this.codigosGrupo.push(codigo);
    return codigo;
  }
  /** Los grupos conectados desde la web que esperan a su gente */
  pendientes: PendingMembers[] = [];
  async groupsPendingMembers(ids: string[]) {
    return this.pendientes.filter((p) => ids.includes(p.connection_id) && !this.members.has(p.group_id));
  }
  /** «¿Desde cuándo anoto?» por grupo: 'pendiente' hasta que alguien responde */
  desdeCuando = new Map<string, { modo: DesdeCuando | 'pendiente'; quien: string | null }>();
  async historyAnswer(jid: string, mode: DesdeCuando, name: string | null, onlyPending: boolean) {
    const g = this.groups.get(jid);
    if (!g?.account_id) return { changed: false, reason: 'grupo_sin_enlazar' };
    const actual = this.desdeCuando.get(jid)?.modo ?? 'pendiente';
    if (onlyPending && actual !== 'pendiente') return { changed: false, reason: 'ya_respondida' };
    if (actual === mode) return { changed: false, reason: 'igual' };
    this.desdeCuando.set(jid, { modo: mode, quien: name });
    return { changed: true };
  }
  /** Lo que se subió al bucket de importaciones */
  importados = new Map<string, { body: Buffer; contentType: string }>();
  async uploadImport(path: string, body: Buffer, contentType: string) {
    this.importados.set(path, { body, contentType });
  }
  /** Los chats exportados que quedaron en la cola: «grupo|mensaje» */
  importaciones: { jid: string | null; path: string; fileName: string | null; chatName?: string | null }[] = [];
  async requestImport(jid: string, path: string, fileName: string | null, waMessageId: string): Promise<ImportResult> {
    const g = this.groups.get(jid);
    if (!g?.account_id) return { ok: false, reason: 'grupo_sin_enlazar' };
    const already = this.importaciones.some((i) => i.jid === jid && i.path === path);
    if (!already) this.importaciones.push({ jid, path, fileName });
    return { ok: true, already, import_id: already ? null : `imp-${waMessageId}`, language: 'es' };
  }
  /** Por privado: de qué grupo es (nombre del grupo → sí) */
  gruposDelPrivado: string[] = [];
  async requestImportPrivate(
    path: string,
    fileName: string | null,
    waMessageId: string,
    _p: string | null,
    _l: string | null,
    _n: string | null,
    chatName: string | null,
  ): Promise<ImportResult> {
    const grupo = this.gruposDelPrivado.find((x) => !chatName || x.toLowerCase() === chatName.toLowerCase());
    if (!grupo) return { ok: false, reason: 'sin_grupo', groups: [] };
    this.importaciones.push({ jid: null, path, fileName, chatName });
    return { ok: true, already: false, import_id: `imp-${waMessageId}`, group_name: grupo, language: 'es' };
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
      // Como la base: si no llega el grupo, el del chat
      const group_id = it.group_id ?? this.groups.get(it.chat_jid)?.group_id;
      this.outbox.push({ ...it, ...(group_id ? { group_id } : {}), id: `o-${this.outbox.length + 1}`, sent: false, dropped: false, error: null, waId: null });
      nuevas.push(it.dedupe_key);
    }
    return nuevas;
  }
  async outboxPending(): Promise<OutboxPending[]> {
    return this.outbox
      .filter((o) => !o.sent && !o.dropped)
      .map(({ dedupe_key: _k, sent: _s, dropped: _d, error: _e, waId: _w, ...o }) => ({ ...o, created_at: '2026-10-12T00:00:00Z' }));
  }
  /** Avisos de cobro que tocan (connector_cobros) y los que ya se avisaron */
  cobrosPendientes: Cobro[] = [];
  avisados: string[] = [];
  async cobros() {
    return this.cobrosPendientes.filter((c) => !this.avisados.includes(c.transfer_id));
  }
  avisadosPorPrivado: string[] = [];
  async cobrosAvisados(privados: string[], enGrupo: string[]) {
    this.avisados.push(...privados, ...enGrupo);
    this.avisadosPorPrivado.push(...privados);
  }
  /** La pregunta de un paseo liquidado: el id del mensaje con que salió (si salió), lo que se respondió y lo que contesta la base */
  preguntaReabrir: { waId: string | null; resuelta: boolean } | null = null;
  decisiones: { jid: string; quotedId: string | null; sender: string | null; modo: 'reabrir' | 'nueva' }[] = [];
  decision: DecisionLiquidada | null = null;
  async decidirLiquidada(jid: string, quotedId: string | null, sender: Sender, modo: 'reabrir' | 'nueva'): Promise<DecisionLiquidada> {
    const q = this.preguntaReabrir;
    if (!q || q.resuelta || (quotedId !== null && q.waId !== quotedId)) return { ok: false, reason: 'no_es_pregunta' };
    this.decisiones.push({ jid, quotedId, sender: sender.id, modo });
    q.resuelta = true;
    return this.decision ?? { ok: false, reason: 'no_te_conozco', language: 'es', account_name: 'Paseo' };
  }
  /** «luks elimina este gasto»: lo que se pidió y lo que contesta la base (la pone cada prueba) */
  eliminados: { jid: string; quotedId: string | null; sender: string | null }[] = [];
  eliminar: EliminarGasto = { ok: false, reason: 'no_es_gasto', language: 'es' };
  async eliminarGasto(jid: string, quotedId: string | null, sender: Sender): Promise<EliminarGasto> {
    this.eliminados.push({ jid, quotedId, sender: sender.id });
    return quotedId ? this.eliminar : { ok: false, reason: 'sin_cita' };
  }
  /** ¿Quién pidió qué?: las cuentas por preguntar, las listas que quedaron en la bandeja y lo que respondieron */
  porPreguntar: ItemsPregunta[] = [];
  listas = new Map<string, { items: string[]; chat: string; dedupe: string }>();
  respuestas: { jid: string; quotedId: string; sender: string | null; claims: { n: number; units?: number }[] }[] = [];
  /** Lo que responde la base a una respuesta de la lista (la pone cada prueba) */
  respuestaItems: ItemsRespuesta | null = null;
  async itemsPorPreguntar() {
    return this.porPreguntar.filter((p) => !this.listas.has(p.expense_id));
  }
  async itemPromptGuardado(expenseId: string, itemIds: string[], chatJid: string, dedupeKey: string) {
    if (!this.listas.has(expenseId)) this.listas.set(expenseId, { items: itemIds, chat: chatJid, dedupe: dedupeKey });
  }
  async itemsRespuesta(jid: string, quotedId: string, sender: Sender, claims: { n: number; units?: number }[]): Promise<ItemsRespuesta> {
    // Como la base: responde la lista si cita el mensaje que se mandó con ella
    const lista = [...this.listas.values()].find((l) => l.chat === jid && this.outbox.find((o) => o.dedupe_key === l.dedupe)?.waId === quotedId);
    if (!lista) return { ok: false, reason: 'no_es_pregunta' };
    this.respuestas.push({ jid, quotedId, sender: sender.id, claims });
    return this.respuestaItems ?? { ok: false, reason: 'no_te_conozco', language: 'es', account_name: 'Paseo' };
  }
  /** «la 1 son 3»: lo que se pidió y lo que responde la base (la pone cada prueba) */
  cantidades: { jid: string; quotedId: string; n: number; cantidad: number }[] = [];
  respuestaCantidad: ItemsCantidad | null = null;
  async itemsCantidad(jid: string, quotedId: string, _sender: Sender, n: number, cantidad: number): Promise<ItemsCantidad> {
    const lista = [...this.listas.values()].find((l) => l.chat === jid && this.outbox.find((o) => o.dedupe_key === l.dedupe)?.waId === quotedId);
    if (!lista) return { ok: false, reason: 'no_es_pregunta' };
    this.cantidades.push({ jid, quotedId, n, cantidad });
    return this.respuestaCantidad ?? { ok: false, reason: 'no_existe', language: 'es', total_items: lista.items.length };
  }
  /** Lo que debe cada quien de las liquidaciones (`wa`: su número) y lo que ya marcó «ya pagué» */
  deudas: (Transferencia & { wa: string; to_private_jid: string | null; group_jid: string | null })[] = [];
  pagadas: string[] = [];
  /** Si la cuenta del grupo ya se liquidó */
  liquidada = true;
  /** Números que están en la cuenta aunque no deban nada */
  conocidos = new Set<string>();
  async porPagar(jid: string, sender: Sender): Promise<PendientesResult> {
    const grupo = jid.endsWith('@g.us');
    const cuenta = grupo ? this.groups.get(jid)?.account_id : null;
    const suyas = this.deudas.filter((t) => t.wa === sender.id && (!grupo || t.account.id === cuenta));
    const limpia = ({ wa: _w, to_private_jid: _p, group_jid: _g, ...t }: (typeof this.deudas)[number]): Transferencia => t;
    return {
      identity_id: `i-${sender.id}`,
      grupo,
      contador_en_grupo: this.presentes.has(`${jid}|contador`),
      account: cuenta ? { id: cuenta, name: 'Paseo', language: 'es', currency: 'COP', liquidada: this.liquidada } : null,
      conocido: suyas.length > 0 || this.conocidos.has(sender.id ?? ''),
      pendientes: suyas.filter((t) => !this.pagadas.includes(t.id)).map(limpia),
    };
  }
  async yaPague(jid: string, sender: Sender, ids: string[]): Promise<YaPagueResult> {
    const antes = (await this.porPagar(jid, sender)).pendientes.map((t) => t.id);
    const marcadas = ids.filter((id) => antes.includes(id));
    this.pagadas.push(...marcadas);
    return {
      pagadas: this.deudas
        .filter((t) => marcadas.includes(t.id))
        .map(({ wa: _w, ...t }) => ({
          ...t,
          todos_pagaron: this.deudas.filter((x) => x.settlement_id === t.settlement_id).every((x) => this.pagadas.includes(x.id)),
        })),
      quedan: (await this.porPagar(jid, sender)).pendientes,
    };
  }
  /** Números verificados: número (o «lid:…») → primer nombre de su usuario */
  verificados = new Map<string, string>();
  async soyYo(sesion: string, privateJid: string, phone: string | null, lid: string | null): Promise<SoyYoResult> {
    await this.privateChat(sesion, privateJid);
    const numero = phone ?? `lid:${lid}`;
    const nombre = this.verificados.get(numero);
    return { identity_id: `i-${numero}`, verified: nombre !== undefined, name: nombre ?? null, last4: (phone ?? lid ?? '').slice(-4) };
  }
  /** Los códigos que se crearon al mandar links de verificación */
  codigos: string[] = [];
  async verifyMint(outboxId: string) {
    const o = this.outbox.find((x) => x.id === outboxId);
    if (o?.reason !== 'verify') throw new Error('Ese mensaje no lleva un link de verificación');
    const codigo = `Cod${this.codigos.length + 1}_aB-9`;
    this.codigos.push(codigo);
    return codigo;
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
  /** Cuentas ya liquidadas: no ocupan su grupo (migración 370) */
  liquidadas = new Set<string>();
  async linkGroup(sessionId: string, jid: string, name: string | null, code: string): Promise<LinkResult> {
    const cuenta = this.codes.get(code);
    if (!cuenta) return { ok: false, error: 'codigo_invalido' };
    const g = await this.upsertGroup(sessionId, jid, name);
    const actual = this.groups.get(jid);
    const nombreDe = (id: string | null | undefined) => [...this.codes.values()].find((c) => c.id === id)?.name;
    let previo: string | null = null;
    if (actual?.account_id && actual.account_id !== cuenta.id) {
      if (!this.liquidadas.has(actual.account_id)) return { ok: false, error: 'otra_cuenta', account_name: nombreDe(actual.account_id), language: 'es' };
      previo = nombreDe(actual.account_id) ?? null;
    }
    const already = actual?.account_id === cuenta.id;
    if (actual) actual.account_id = cuenta.id;
    return {
      ok: true,
      already,
      account_id: cuenta.id,
      account_name: cuenta.name,
      group_id: g.group_id,
      members: this.members.get(g.group_id)?.length,
      previous_account: previo,
    };
  }
  async shouldIngest(jid: string, id: string, _sentAt?: Date, sender: string | null = null): Promise<IngestCheck> {
    const g = this.groups.get(jid);
    if (!g?.account_id) return { ingest: false, reason: 'grupo_sin_enlazar' };
    if (this.messages.has(`${jid}|${id}`)) return { ingest: false, reason: 'repetido', account_id: g.account_id };
    if (sender && this.optouts.has(`${jid}|${sender}`)) return { ingest: false, reason: 'no_me_cuentes', account_id: g.account_id };
    return { ingest: true, account_id: g.account_id, group_id: g.group_id };
  }
  /** Los números de la cuenta que devuelve connector_question (los pone cada prueba) */
  numeros: Omit<Extract<QuestionData, { ok: true }>, 'identity_id' | 'pref' | 'contador_en_grupo'> | null = null;
  /** «privado» o «aquí» de cada quien (por su número) */
  prefs = new Map<string, 'privado' | 'aqui'>();
  /** La pregunta de cada quien que espera «privado» o «aquí» */
  esperando = new Map<string, { jid: string; intent: 'mi_saldo' | 'mis_gastos' }>();
  /** «grupo|número» de quienes dijeron «no me cuentes» */
  optouts = new Set<string>();
  /** Si Mister Luks existe (para responder por privado en un grupo que lee un WhatsApp vinculado) */
  hayMisterLuks = true;
  async question(jid: string, sender: Sender): Promise<QuestionData | null> {
    if (!jid.endsWith('@g.us')) return null;
    const base = { identity_id: `i-${sender.id}`, pref: this.prefs.get(sender.id ?? '') ?? null, contador_en_grupo: this.presentes.has(`${jid}|contador`) };
    if (!this.groups.get(jid)?.account_id || !this.numeros) return { ...base, ok: false, reason: 'sin_cuenta' };
    return { ...base, ...this.numeros, optout: this.optouts.has(`${jid}|${sender.id}`) };
  }
  /** Por privado, las cuentas de cada quien (por su número) */
  misCuentasDe = new Map<string, NumerosDeCuenta[]>();
  async misCuentas(_jid: string, sender: Sender): Promise<MisCuentas> {
    return { identity_id: `i-${sender.id}`, cuentas: this.misCuentasDe.get(sender.id ?? '') ?? [] };
  }
  async answerPref(jid: string, sender: Sender, mode: 'privado' | 'aqui', onlyPending: boolean) {
    const id = sender.id ?? '';
    const espera = this.esperando.get(id);
    if (onlyPending && espera?.jid !== jid) return { changed: false };
    this.prefs.set(id, mode);
    this.esperando.delete(id);
    return { changed: true, mode, pending_intent: espera?.jid === jid ? espera.intent : null };
  }
  async askAnswerPref(jid: string, identityId: string, intent: 'mi_saldo' | 'mis_gastos') {
    this.esperando.set(identityId.replace(/^i-/, ''), { jid, intent });
  }
  async optout(jid: string, sender: Sender, on: boolean) {
    const k = `${jid}|${sender.id}`;
    const antes = this.optouts.has(k);
    if (on) this.optouts.add(k);
    else this.optouts.delete(k);
    return { changed: antes !== on, account_name: this.numeros?.account.name, language: this.numeros?.account.language ?? null };
  }
  async openPrivateAnswer(jid: string) {
    if (!this.hayMisterLuks) return false;
    await this.privateChat('contador', jid);
    return true;
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
