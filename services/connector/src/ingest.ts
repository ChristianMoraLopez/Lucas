import {
  avisoAlAcreedor,
  type BorradorCobro,
  CHEPITO,
  CHEPITO_ESPERA_MIN,
  CHEPITO_MS,
  conceptoLimpio,
  esNoLeDebo,
  esPedidoDeCobro,
  faltaDe,
  leerCobro,
  leerComoMePagan,
  montoDe,
  nombreLimpio,
  puedeCobrar,
  type QueResponde,
  respuestaAlDeudor,
  telefonoDe,
} from './chepito.js';
import { mediosDePago } from './cobros.js';
import type { GroupInfo, GroupMember, IncomingMessage, MessagingConnector, SessionInfo } from './connector.js';
import { contestarEliminar, esEliminar } from './eliminar.js';
import {
  CUENTA_CON_MISTER_LUKS,
  esAgradecimiento,
  GASTO_PRIVADO,
  leerEleccion,
  nombreParaElegir,
  type Opcion,
  pareceEleccion,
  type QueMando,
} from './gasto-privado.js';
import { confirmacionPrivada, contestar, contestarCantidad, leerCantidad, leerRespuesta, linkDividir, respuestaConfirmacion, siONo } from './items.js';
import { type Logger, maskWaId } from './log.js';
import { type MediaLimits, MediaRejected, prepareMedia } from './media.js';
import { elegirPagos, PAGOS } from './pagos.js';
import { antesDeLaFirma, type Numeros, PREGUNTAS, PRIVADAS, PRIVADO, primerNombre, RESPUESTA } from './preguntas.js';
import type { Clasificador } from './qwen.js';
import { contestarDecision, leerDecision } from './reabrir.js';
import type { RateLimiter } from './replies.js';
import type { ChepitoRespuesta, GastoPorAbrir, OutboxItem, PorAbrirEnEspera, Store } from './store.js';
import {
  aMisterLuks,
  canalDe,
  esMensajeDeLuks,
  esMenu,
  esNoMeEscribas,
  esPedidoDeAyuda,
  esSoyYo,
  guia,
  type Idioma,
  type Intencion,
  idiomaDeNumero,
  intencionDe,
  looksLikeExpense,
  MISTER,
  MSG,
  nombreDelChat,
  PISTA_AYUDA,
  pareceUnaPregunta,
  parseHistoria,
  parseInviteLink,
  parseLinkCommand,
  plano,
  respuestaNumerada,
} from './text.js';

/** Qué pasó con un mensaje (va a los logs; sirve para las pruebas) */
export type Outcome =
  | 'propio'
  | 'de_luks'
  | 'charla'
  | 'ayuda'
  | 'soy_yo'
  | 'enlazado'
  | 'codigo_invalido'
  | 'otra_cuenta'
  | 'no_es_grupo'
  | 'guardado'
  | 'archivo_muy_pesado'
  | 'archivo_rechazado'
  | 'privado'
  | 'bienvenida'
  | 'no_me_escribas'
  | 'desde_cuando'
  | 'chat_importado'
  | 'chat_muy_pesado'
  | `pregunta:${string}`
  | `suyo:${string}`
  | `pago:${string}`
  | `items:${string}`
  | `reabrir:${string}`
  | `eliminar:${string}`
  | `link_grupo:${string}`
  | `gasto_privado:${string}`
  | `chepito:${string}`
  | `privado:${string}`
  | `ignorado:${string}`;

export interface IngestLimits extends MediaLimits {
  maxDownloadBytes: number;
  /** El chat exportado (.zip o .txt): hasta el límite del bucket «importaciones» */
  maxChatBytes: number;
}

export interface MisterLuksOptions {
  /** Dónde están la imagen y el PDF de la guía (https://mrluks.com/guia) */
  guiaUrl: string;
  /** La web, para los links a la app (https://mrluks.com) */
  webUrl?: string;
  /** Cuántos grupos acepta Mister Luks con links de invitación (por quien manda el link y en total, por hora) */
  joins: RateLimiter;
  /** Qwen, para las preguntas que las reglas no entienden (sin Ollama, no hay) */
  clasificar?: Clasificador | null;
}

const mes = (d: Date) => d.toISOString().slice(0, 7);
const nombreSeguro = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
/** El tramo de tiempo del mensaje: lo mismo dentro del tramo no se responde dos veces */
const tramo = (d: Date, minutos: number) => Math.floor(d.getTime() / (minutos * 60_000));
/** La lista de cuentas que se le mandó por privado sirve para responder con el número durante este tiempo */
const LISTA_MS = 30 * 60_000;
/** Lo suyo de una lista de ítems se puede confirmar o corregir por privado durante este tiempo */
const CONFIRMAR_MS = 12 * 60 * 60_000;
/** Lo que mandó por privado espera la respuesta a «¿dónde lo anoto?» durante este tiempo (migración 630) */
const GASTO_MS = 30 * 60_000;
/** Cuántas cosas guarda esperando esa respuesta (la foto, el PDF o el texto) */
const GASTOS_MAX = 5;

/** Lo que mandó por privado, guardado mientras responde dónde anotarlo (con el archivo ya revisado) */
interface GastoGuardado {
  messageId: string;
  kind: 'photo' | 'pdf' | 'text';
  text: string | null;
  fileName: string | null;
  sentAt: Date;
  archivo: { body: Buffer; ext: string; contentType: string } | null;
}

interface GastosEnEspera {
  gastos: GastoGuardado[];
  opciones: Opcion[];
  hasta: number;
}

/** Chepito por privado (migración 710): el cobro que está pidiendo, y qué le falta */
interface CobroEnEspera {
  b: BorradorCobro;
  paso: 'nombre' | 'telefono' | 'monto' | 'concepto' | 'confirmar' | 'pago';
  hasta: number;
}
/** Por privado, la línea de «ayuda» (todo lo que sabe hacer) sale como mucho una vez en este tiempo */
const PISTA_MS = 24 * 60 * 60_000;

/** El chat privado de quien escribe (con su número, o su LID si WhatsApp no deja ver el número) */
const privadoDe = (m: IncomingMessage) =>
  m.chatKind === 'privado' ? m.chatId : m.sender.phone ? `${m.sender.phone}@s.whatsapp.net` : m.sender.lid ? `${m.sender.lid}@lid` : null;

/** El idioma de un grupo sin cuenta: inglés si la mayoría tiene número de +1 */
function idiomaDelGrupo(members: GroupMember[]): Idioma {
  const conNumero = members.filter((m) => m.phone);
  return conNumero.length && conNumero.filter((m) => m.phone?.startsWith('1')).length * 2 > conNumero.length ? 'en' : 'es';
}

/**
 * Lo que entra de los grupos y, para Mister Luks (el contador), de los chats
 * privados. Solo los grupos enlazados a una cuenta activa llegan a la base, y
 * de ellos solo fotos, PDFs y mensajes con montos. Lo que Mister Luks contesta
 * no sale de aquí: va a la bandeja de salida (whatsapp_outbox) y lo manda el
 * ReplyLoop con el límite de frecuencia. Una sesión personal nunca escribe.
 */
export class Ingestor {
  /** El número de Mister Luks (y su LID): lo que escribe no es un gasto aunque lo lea otra sesión */
  #misterLuks = new Set<string>();
  get #web() {
    return this.mister.webUrl ?? 'https://mrluks.com';
  }
  /** Por privado: la lista de cuentas que se le mandó a cada chat, para responder con el número */
  #listas = new Map<string, { ids: string[]; intencion: Intencion; hasta: number }>();
  /** Por privado: lo suyo de una lista de ítems, esperando «sí», «no» o los números para corregir */
  #confirmaciones = new Map<string, { jid: string; lista: string; idioma: Idioma; nombre: string; comercio: string; link: string | null; hasta: number }>();
  /** Número o «lid:…» → el @usuario que ya se mandó a la base (para no mandarlo en cada mensaje) */
  #usuariosVistos = new Map<string, string>();
  /** Por privado: hasta cuándo no se repite la línea de «ayuda» en cada chat */
  #pistas = new Map<string, number>();
  /** Por privado: lo que mandó esperando «¿dónde lo anoto?» (migración 630) */
  #gastosPrivados = new Map<string, GastosEnEspera>();
  /** Por privado: el cobro de Chepito que está pidiendo (migración 710) */
  #cobros = new Map<string, CobroEnEspera>();

  constructor(
    private readonly store: Store,
    private readonly limits: IngestLimits,
    private readonly mister: MisterLuksOptions,
    private readonly log: Logger,
  ) {}

  setMisterLuks(ids: (string | null)[]) {
    this.#misterLuks = new Set(ids.filter((x): x is string => Boolean(x)));
  }

  /** Luks quedó en un grupo (lo agregaron, o ya estaba al conectar) */
  async onGroupJoined(session: SessionInfo, connector: MessagingConnector, group: GroupInfo): Promise<void> {
    if (session.kind === 'contador') return this.#detectado(connector, session, group);
    const g = await this.store.upsertGroup(session.id, group.chatId, group.name, group.participants);
    // De un WhatsApp vinculado, quiénes están solo si el grupo es de una cuenta (cada uno queda
    // como persona de ella); de los demás grupos se guarda solo el nombre
    if (g.account_id) await this.#members(connector, group.chatId, g.group_id);
  }

  /**
   * Mister Luks está en un grupo: lo guarda con su gente en una sola llamada y,
   * la primera vez, saluda. Sin cuenta, el saludo lleva el link /g/ para
   * crearla (se crea al mandarlo) y nombra a quienes ya usan Luks.
   */
  async #detectado(connector: MessagingConnector, session: SessionInfo, group: GroupInfo) {
    const lista = await connector.members(group.chatId);
    await this.#usuarios(lista);
    const r = await this.store.groupDetected(session.id, group.chatId, group.name, group.participants, lista);
    if (r.people_added) this.log.info({ group: r.group_id, members: r.members, added: r.people_added }, 'Personas nuevas desde el grupo');
    const hola = r.hello;
    if (!hola.say_hello) return;
    const idioma = hola.language ?? (hola.account_name ? 'es' : idiomaDelGrupo(lista));
    await this.#encolar([
      {
        chat_jid: group.chatId,
        reason: 'group_hello',
        body: MISTER.saludoGrupo(idioma, hola.account_name, hola.luks_users),
        image_url: guia(this.mister.guiaUrl, idioma).imagen,
        group_id: r.group_id,
        dedupe_key: `group_hello:${r.group_id}`,
      },
    ]);
  }

  async onGroupLeft(session: SessionInfo, chatId: string): Promise<void> {
    await this.store.groupLeft(session.id, chatId);
  }

  /** Manda quiénes están en el grupo; devuelve la lista y cuántos son sin contar a Mister Luks */
  async #members(connector: MessagingConnector, chatId: string, groupId: string) {
    const lista = await connector.members(chatId);
    if (!lista.length) return { lista, cuantos: null };
    // Antes que los integrantes: así quien entra sin nombre ya queda con su @usuario
    await this.#usuarios(lista);
    const r = await this.store.setGroupMembers(groupId, lista);
    if (r.people_added) this.log.info({ group: groupId, members: r.members, added: r.people_added }, 'Personas nuevas desde el grupo');
    return { lista, cuantos: r.members };
  }

  /**
   * El usuario de WhatsApp («@juanes») de los integrantes o de quien escribe
   * (migración 530): con él se nombra a quien entró sin nombre. Solo lo nuevo;
   * si falla, sigue (es un nombre, no un gasto).
   */
  async #usuarios(gente: { id: string | null; phone: string | null; lid?: string | null; username?: string | null }[]) {
    const nuevos = gente.flatMap((g) =>
      g.id && g.username && this.#usuariosVistos.get(g.id) !== g.username ? [{ id: g.id, phone: g.phone, lid: g.lid ?? null, username: g.username }] : [],
    );
    if (!nuevos.length) return;
    try {
      await this.store.usuarios(nuevos);
      for (const u of nuevos) this.#usuariosVistos.set(u.id, u.username);
    } catch (e) {
      this.log.warn({ err: (e as Error).message, n: nuevos.length }, 'No se pudo guardar el usuario de WhatsApp');
    }
  }

  async #encolar(items: OutboxItem[]) {
    try {
      return await this.store.outboxEnqueue(items);
    } catch (e) {
      this.log.warn({ err: (e as Error).message, reasons: items.map((i) => i.reason) }, 'No se pudo encolar lo que iba a escribir Mister Luks');
      return [];
    }
  }

  async onMessage(session: SessionInfo, connector: MessagingConnector, m: IncomingMessage): Promise<Outcome> {
    // El contador no se lee a sí mismo; en una sesión personal lo propio sí cuenta (es quien paga)
    if (m.fromMe && session.kind === 'contador') return 'propio';
    // Lo que escribe Mister Luks en un grupo que también lee un WhatsApp vinculado
    if (session.kind === 'personal' && m.sender.id && this.#misterLuks.has(m.sender.id)) return 'de_luks';

    // Su @usuario de WhatsApp, si lo trae y es nuevo
    if (m.sender.username) await this.#usuarios([m.sender]);

    if (m.chatKind === 'privado') return session.kind === 'contador' ? this.#privado(session, connector, m) : 'ignorado:privado';

    const code = parseLinkCommand(m.text);
    if (code) return this.#link(session, connector, m, code);

    // «luks soy yo» en el grupo: solo lo atiende Mister Luks
    if (session.kind === 'contador' && !m.media && esSoyYo(m.text)) return this.#soyYo(session, m);

    // Responden (citando) un mensaje de Mister Luks: la lista de «¿quién pidió qué?» o la pregunta de un paseo
    // liquidado («1» reabrir, «2» cuenta nueva). Antes que el «1»/«2» de desde cuándo anoto
    if (session.kind === 'contador' && !m.media && m.quotedId && this.#esDeLuks(m.quotedFrom)) {
      const items = await this.#items(m);
      if (items) return items;
      const decision = await this.#decision(m, m.quotedId);
      if (decision) return decision;
    }

    // El chat exportado: se importa (lo de antes de que Luks empezara a anotar)
    if (m.media?.kind === 'chat') return this.#chatExportado(session, m);

    // «¿Desde cuándo anoto?»: «1»/«2» si la pregunta sigue abierta, o «luks desde ya» / «luks lee todo» cuando sea
    if (session.kind === 'contador' && !m.media) {
      const orden = parseHistoria(m.text, this.#misterLuks);
      const modo = orden ?? respuestaNumerada(m.text);
      if (modo) {
        const r = await this.store.historyAnswer(m.chatId, modo, m.sender.name, !orden);
        this.log.info({ group: m.chatId, mode: modo, changed: r.changed, reason: r.reason }, '¿Desde cuándo anoto?');
        if (r.changed) return 'desde_cuando';
        // Un «1» o «2» a secas también puede responder la pregunta de un paseo liquidado
        if (!orden) {
          const decision = await this.#decision(m, null);
          if (decision) return decision;
        }
        return 'ignorado:desde_cuando';
      }
    }

    // «ayuda» en el grupo: la guía (y el link /g/ si no tiene cuenta), como mucho una vez por hora
    if (session.kind === 'contador' && !m.media && esPedidoDeAyuda(m.text)) {
      const idioma = idiomaDeNumero(m.sender.phone);
      await this.#encolar([
        {
          chat_jid: m.chatId,
          reason: 'guide',
          // Con el link para crear la cuenta, si el grupo todavía no la tiene
          body: MISTER.guiaGrupo(idioma),
          image_url: guia(this.mister.guiaUrl, idioma).imagen,
          dedupe_key: `guide:${m.chatId}:${tramo(m.sentAt, 60)}`,
        },
      ]);
      // Y todo lo que entiende, en un mensaje aparte (después de la guía)
      await this.#encolar([{ chat_jid: m.chatId, reason: 'guide', body: MISTER.comandos(idioma), dedupe_key: `comandos:${m.chatId}:${tramo(m.sentAt, 60)}` }]);
      return 'ayuda';
    }

    // Le preguntan algo a Mister Luks (antes del filtro de la charla), o responden «privado» / «aquí»
    if (!m.media) {
      const pregunta = aMisterLuks(m, this.#misterLuks);
      // «luks elimina este gasto», citando el mensaje del gasto
      if (pregunta && session.kind === 'contador' && esEliminar(pregunta.texto)) return this.#eliminar(m);
      // «luks reabre» / «luks cuenta nueva»: la pregunta de un paseo liquidado
      if (pregunta && session.kind === 'contador' && leerDecision(pregunta.texto)) {
        const decision = await this.#decision(m, null, pregunta.texto);
        if (decision) return decision;
      }
      const respuesta = pregunta
        ? await this.#pregunta(session, m, pregunta.texto, pregunta.explicito)
        : session.kind === 'contador' && canalDe(m.text)
          ? await this.#canal(session, m, canalDe(m.text) as 'privado' | 'aqui', true)
          : null;
      if (respuesta) return respuesta;
      // «Ya pagué» sin hablarle a Mister Luks (Santiago en Nochita): con la cuenta liquidada se
      // atiende igual; marca lo que le faltaba o le dice que ya está todo pago
      if (!pregunta && session.kind === 'contador' && intencionDe(m.text) === 'ya_pague') {
        const pago = await this.#yaPague(session, m, m.text ?? '', true);
        if (pago) return pago;
      }
    }

    // Las cuentas o un cobro que mandaron desde Luks, o una respuesta de Luks: no es un gasto
    if (esMensajeDeLuks(m.text)) return 'de_luks';
    if (!m.media && !looksLikeExpense(m.text)) return 'charla';

    // Con quién lo mandó: de quien dijo «no me cuentes» ya no se baja ni se guarda nada
    const check = await this.store.shouldIngest(m.chatId, m.messageId, m.sentAt, m.sender.id);
    if (!check.ingest || !check.account_id) return `ignorado:${check.reason ?? 'sin_cuenta'}`;

    let mediaPath: string | null = null;
    let mimeType: string | null = null;
    if (m.media) {
      if (m.media.sizeBytes && m.media.sizeBytes > this.limits.maxDownloadBytes) {
        this.log.info({ msg_id: m.messageId, bytes: m.media.sizeBytes }, 'Archivo demasiado pesado: no se baja');
        return 'archivo_muy_pesado';
      }
      try {
        const listo = await prepareMedia(m.media.kind, await m.media.download(), this.limits);
        mediaPath = `${check.account_id}/whatsapp/${mes(m.sentAt)}/${nombreSeguro(m.messageId)}.${listo.ext}`;
        mimeType = listo.contentType;
        await this.store.uploadEvidence(mediaPath, listo.body, listo.contentType);
      } catch (e) {
        if (e instanceof MediaRejected) {
          this.log.info({ msg_id: m.messageId, reason: e.message }, 'Archivo descartado');
          return 'archivo_rechazado';
        }
        throw e;
      }
    }

    const r = await this.store.ingest({
      jid: m.chatId,
      waMessageId: m.messageId,
      senderWaId: m.sender.id,
      senderName: m.sender.name,
      kind: m.media?.kind ?? 'text',
      text: m.text,
      mediaPath,
      fileName: m.media?.fileName ?? null,
      mimeType,
      sentAt: m.sentAt,
    });
    if (!r.ingest) return `ignorado:${r.reason ?? 'desconocido'}`;
    this.log.info(
      { msg_id: m.messageId, message_id: r.message_id, kind: m.media?.kind ?? 'text', sender: maskWaId(m.sender.id), known_sender: r.known_sender },
      'Mensaje en la cola',
    );
    return 'guardado';
  }

  async #link(session: SessionInfo, connector: MessagingConnector, m: IncomingMessage, code: string): Promise<Outcome> {
    const r = await this.store.linkGroup(session.id, m.chatId, m.chatName, code, m.sender.id);
    this.log.info({ group: m.chatId, ok: r.ok, error: r.ok ? undefined : r.error, sender: maskWaId(m.sender.id) }, 'Pidieron enlazar el grupo');
    // Recién enlazado: ahora sí se guardan quiénes están (de un WhatsApp vinculado no se tenían)
    const gente = r.ok && !r.already ? await this.#members(connector, m.chatId, r.group_id) : null;
    // Solo Mister Luks responde; un código malo se explica como mucho una vez por hora
    if (session.kind === 'contador') {
      const idioma = r.language ?? 'es';
      const body = r.ok
        ? r.already
          ? MSG.alreadyLinked(r.account_name, idioma)
          : r.previous_account
            ? MSG.moved(r.account_name, r.previous_account, gente?.cuantos ?? r.members, idioma)
            : MSG.linked(r.account_name, gente?.cuantos ?? r.members, idioma)
        : r.error === 'otra_cuenta'
          ? MSG.otherAccount(r.account_name, idioma)
          : MSG.badCode;
      // Cada error se explica como mucho una vez por hora (otro error distinto sí se responde)
      const dedupe = r.ok ? `link:${m.chatId}:${m.messageId}` : `link:${m.chatId}:error:${r.error}:${tramo(m.sentAt, 60)}`;
      await this.#encolar([{ chat_jid: m.chatId, reason: 'link', body, dedupe_key: dedupe }]);
    }
    return r.ok ? 'enlazado' : r.error;
  }

  /**
   * Un chat privado con Mister Luks. La primera vez, la bienvenida con la guía
   * (imagen y PDF); un link de grupo, entra (con tope por hora); «ayuda», la
   * guía otra vez; «luks soy yo», el link para verificar su número (antes que
   * la bienvenida: es lo que vino a hacer). Lo demás no se guarda ni se contesta.
   */
  async #privado(session: SessionInfo, connector: MessagingConnector, m: IncomingMessage): Promise<Outcome> {
    await this.store.privateChat(session.id, m.chatId);
    const soyYo = !m.media && esSoyYo(m.text) ? await this.#soyYo(session, m) : null;
    const idioma = idiomaDeNumero(m.sender.phone);
    const g = guia(this.mister.guiaUrl, idioma);
    const conGuia = { image_url: g.imagen, document_url: g.pdf, document_name: g.nombrePdf };

    // «No me escribas» (le llegó el aviso de cobro sin haberle escrito nunca): solo en el grupo,
    // y sin la bienvenida (migración 600)
    if (!m.media && esNoMeEscribas(m.text)) {
      await this.store.answerPref(m.chatId, m.sender, 'aqui', false);
      // Si le estaba cobrando Chepito, no se le cobra más (de nadie) y se le avisa a quien cobraba
      const cobro = await this.#chepitoResponde(m, 'no_escribas', idioma);
      if (cobro) return cobro;
      await this.#encolar([{ chat_jid: m.chatId, reason: 'answer', body: MISTER.noTeEscribo(idioma), dedupe_key: `answer:${m.chatId}:${m.messageId}` }]);
      this.log.info({ chat: maskWaId(m.chatId) }, 'No me escribas por privado');
      return 'no_me_escribas';
    }

    // Le está cobrando Chepito: «ya pagué» o «no le debo» (antes de la bienvenida: no vino a eso)
    if (!m.media && m.text) {
      const dice = aMisterLuks(m, this.#misterLuks)?.texto ?? m.text;
      const que = intencionDe(dice) === 'ya_pague' ? 'pagado' : esNoLeDebo(dice) ? 'no_debe' : null;
      const cobro = que ? await this.#chepitoResponde(m, que, idioma) : null;
      if (cobro) return cobro;
    }

    const nuevas = await this.#encolar([
      { chat_jid: m.chatId, reason: 'welcome', body: MISTER.bienvenida(idioma), ...conGuia, dedupe_key: `welcome:${m.chatId}` },
    ]);
    const primeraVez = nuevas.length > 0;
    if (soyYo) return soyYo;

    if (m.media?.kind === 'chat') return this.#chatPrivado(m, idioma);

    const invitacion = parseInviteLink(m.text);
    if (invitacion) return this.#unirse(connector, m, invitacion, idioma);

    // El código para conectar un grupo («luks PASEO-7K2Q») va en el grupo, no aquí
    if (!m.media && parseLinkCommand(m.text)) {
      await this.#encolar([{ chat_jid: m.chatId, reason: 'answer', body: MISTER.codigoPorPrivado(idioma), dedupe_key: `answer:${m.chatId}:${m.messageId}` }]);
      return 'privado:codigo';
    }

    // «ya pagué» (respondiendo el aviso de cobro, por ejemplo): queda marcado
    const texto = aMisterLuks(m, this.#misterLuks)?.texto ?? m.text ?? '';
    if (!m.media && intencionDe(texto) === 'ya_pague') {
      const pago = await this.#yaPague(session, m, texto);
      if (pago) return pago;
    }

    if (esPedidoDeAyuda(m.text) && !primeraVez) {
      await this.#encolar([
        { chat_jid: m.chatId, reason: 'guide', body: MISTER.guia(idioma), ...conGuia, dedupe_key: `guide:${m.chatId}:${tramo(m.sentAt, 10)}` },
      ]);
      await this.#encolar([{ chat_jid: m.chatId, reason: 'guide', body: MISTER.comandos(idioma), dedupe_key: `comandos:${m.chatId}:${tramo(m.sentAt, 10)}` }]);
      return 'ayuda';
    }

    // Chepito: «Juan me debe 50 mil por la boleta», su contacto, o lo que falta de ese cobro (migración 710)
    if (!m.media) {
      const cobro = await this.#chepito(session, m, texto, idioma);
      if (cobro) return cobro;
    }

    // Lo que mandó esperando «¿dónde lo anoto?»: el número, «sí» o «no» (migración 630)
    if (!m.media) {
      const eleccion = await this.#eleccionGasto(session, m, texto, idioma);
      if (eleccion) return eleccion;
    }

    // Lo suyo de una lista de ítems: «sí», «no» o los números para corregir
    if (!m.media) {
      const confirmacion = await this.#confirmacion(m, texto);
      if (confirmacion) return confirmacion;
    }

    // Lo suyo: «qué debo», «de qué», «mis cuentas», «mis gastos», o el número de la lista
    if (!m.media) {
      const suyo = await this.#loSuyo(m, texto, primeraVez);
      if (suyo) return suyo;
    }

    // Un gasto (la foto, el PDF o «arriendo 800 lucas»): ¿dónde lo anoto? (migración 630)
    if (m.media || looksLikeExpense(m.text)) return this.#gastoPorPrivado(session, m, idioma);

    // Nada queda sin respuesta (la primera vez ya salió la bienvenida)
    if (primeraVez) return 'bienvenida';
    const gracias = esAgradecimiento(m.text);
    await this.#encolar([
      {
        chat_jid: m.chatId,
        reason: 'answer',
        body: gracias ? GASTO_PRIVADO.conGusto(idioma) : PRIVADO.noEntendi(idioma),
        dedupe_key: gracias ? `answer:${m.chatId}:gracias:${tramo(m.sentAt, 10)}` : `answer:${m.chatId}:no_entendi:${tramo(m.sentAt, 10)}`,
      },
    ]);
    return gracias ? 'privado:gracias' : 'suyo:no_entendi';
  }

  /**
   * Por privado llegó un gasto (migración 630): lo guarda un rato y pregunta
   * dónde lo anota (sus cuentas abiertas y, si es una foto o un PDF, su pago
   * de lo que debe). Si no tiene dónde, le dice qué puede hacer.
   */
  async #gastoPorPrivado(session: SessionInfo, m: IncomingMessage, idioma: Idioma): Promise<Outcome> {
    const ahora = Date.now();
    const que: QueMando = m.media?.kind === 'pdf' ? 'pdf' : m.media ? 'foto' : 'texto';
    let archivo: GastoGuardado['archivo'] = null;
    if (m.media) {
      if (m.media.sizeBytes && m.media.sizeBytes > this.limits.maxDownloadBytes) {
        await this.#encolar([
          { chat_jid: m.chatId, reason: 'answer', body: GASTO_PRIVADO.noPude(idioma, 'Luks', undefined), dedupe_key: `answer:${m.chatId}:${m.messageId}` },
        ]);
        return 'archivo_muy_pesado';
      }
      try {
        const listo = await prepareMedia(m.media.kind, await m.media.download(), this.limits);
        archivo = { body: listo.body, ext: listo.ext, contentType: listo.contentType };
      } catch (e) {
        if (!(e instanceof MediaRejected)) throw e;
        this.log.info({ msg_id: m.messageId, reason: e.message }, 'Archivo descartado (por privado)');
        await this.#encolar([
          { chat_jid: m.chatId, reason: 'answer', body: GASTO_PRIVADO.noPude(idioma, 'Luks', undefined), dedupe_key: `answer:${m.chatId}:${m.messageId}` },
        ]);
        return 'archivo_rechazado';
      }
    }
    const gasto: GastoGuardado = {
      messageId: m.messageId,
      kind: m.media?.kind === 'pdf' ? 'pdf' : m.media ? 'photo' : 'text',
      text: m.text,
      fileName: m.media?.fileName ?? null,
      sentAt: m.sentAt,
      archivo,
    };

    // Ya esperaba otros (mandó varias fotos seguidas): van con la misma pregunta
    const antes = this.#gastosPrivados.get(m.chatId);
    const sigue = antes && antes.hasta >= ahora ? antes : null;
    const gastos = [...(sigue?.gastos ?? []), gasto].slice(-GASTOS_MAX);

    let opciones: Opcion[] = sigue?.opciones ?? [];
    if (!sigue) {
      const [cuentas, deudas] = await Promise.all([
        this.#cuentasAbiertas(m),
        m.media ? this.store.porPagar(m.chatId, m.sender).catch(() => null) : Promise.resolve(null),
      ]);
      const pagos: Opcion[] = (deudas?.pendientes ?? []).slice(0, 3).map((t) => ({
        tipo: 'pago',
        transferId: t.id,
        a: primerNombre(t.to_name),
        cuenta: t.account.name,
        monto: Number(t.amount),
        moneda: t.account.currency,
      }));
      const abiertas: Opcion[] = cuentas.slice(0, 6).map((c) => ({ tipo: 'cuenta', id: c.id, nombre: c.name }));
      opciones = [...pagos, ...abiertas];
      // Y si todavía no tiene la suya del chat privado, crearla para esto
      const yaLaTiene = cuentas.some((c) => Object.values(CUENTA_CON_MISTER_LUKS).includes(c.name));
      if (opciones.length && !yaLaTiene) opciones.push({ tipo: 'nueva', nombre: CUENTA_CON_MISTER_LUKS[idioma] });
    }
    // Sin dónde anotarlo: su «Cuenta con Mister Luks» (ya, o apenas entre a Luks con el link)
    if (!opciones.length) return this.#abrirCuentaPrivada(session, m, gastos, que, idioma);
    this.#gastosPrivados.set(m.chatId, { gastos, opciones, hasta: ahora + GASTO_MS });

    const nombre = primerNombre(m.sender.name).startsWith('@') ? '' : primerNombre(m.sender.name);
    const body = GASTO_PRIVADO.pregunta(idioma, nombre, que, opciones, gastos.length);
    // Varias fotos seguidas: una sola pregunta cada 2 minutos (por tanda: si ya respondió, la
    // siguiente foto es otra pregunta aunque llegue en los mismos 2 minutos)
    await this.#encolar([{ chat_jid: m.chatId, reason: 'answer', body, dedupe_key: `gasto-privado:${m.chatId}:${gastos[0].messageId}:${tramo(m.sentAt, 2)}` }]);
    this.log.info(
      { chat: maskWaId(m.chatId), kind: gasto.kind, opciones: opciones.length, esperando: gastos.length },
      'Un gasto por privado: ¿dónde lo anoto?',
    );
    return 'gasto_privado:pregunta';
  }

  /** Sus cuentas abiertas para anotar por privado (sin la 640 en la base, las de la 480 que siguen abiertas) */
  async #cuentasAbiertas(m: IncomingMessage): Promise<{ id: string; name: string }[]> {
    try {
      return await this.store.cuentasParaAnotar(m.chatId, m.sender);
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, 'No se pudieron leer las cuentas para anotar por privado');
      const d = await this.store.misCuentas(m.chatId, m.sender).catch(() => null);
      return (d?.cuentas ?? [])
        .filter((c) => c.account.id && c.account.status === 'active' && !c.optout && c.me)
        .map((c) => ({ id: c.account.id as string, name: c.account.name }));
    }
  }

  /** El archivo de lo que mandó por privado, a la carpeta de esa cuenta (sin archivo, null) */
  async #subirGasto(accountId: string, g: GastoGuardado): Promise<string | null> {
    if (!g.archivo) return null;
    const ruta = `${accountId}/whatsapp/${mes(g.sentAt)}/${nombreSeguro(g.messageId)}.${g.archivo.ext}`;
    await this.store.uploadEvidence(ruta, g.archivo.body, g.archivo.contentType);
    return ruta;
  }

  /**
   * Mandó un gasto y no tiene dónde anotarlo (migraciones 640 y 650): si su
   * WhatsApp ya tiene usuario de Luks, le abre «Cuenta con Mister Luks» y lo
   * que mandó entra; si no, lo deja guardado para esa cuenta y le manda el link
   * para entrar: al verificar su número, la base la abre sola, lo lee y le avisa.
   */
  async #abrirCuentaPrivada(
    session: SessionInfo,
    m: IncomingMessage,
    gastos: GastoGuardado[],
    que: QueMando,
    idioma: Idioma,
    pedida = false,
  ): Promise<Outcome> {
    // Varias fotos seguidas: un solo aviso cada 2 minutos (la cuenta y el link son los mismos);
    // si la pidió respondiendo la pregunta, la respuesta es a ese mensaje
    const clave = pedida ? `answer:${m.chatId}:${m.messageId}` : `gasto-privado:${m.chatId}:${gastos[0]?.messageId}:${tramo(m.sentAt, 2)}`;
    const responder = (body: string) => this.#encolar([{ chat_jid: m.chatId, reason: 'answer', body, dedupe_key: clave }]);
    const r = await this.store.abrirCuentaPrivada(m.chatId, m.sender);
    if (!r.ok || !r.account_id || !r.account_name) {
      await responder(GASTO_PRIVADO.noPude(idioma, 'Luks', undefined));
      return 'gasto_privado:no_pude';
    }
    const cuenta = r.account_id;
    if (r.abierta) {
      let leyendo = 0;
      for (const g of gastos) {
        const i = await this.store.ingestPrivado({
          chatJid: m.chatId,
          accountId: cuenta,
          waMessageId: g.messageId,
          sender: m.sender,
          kind: g.kind,
          text: g.text,
          mediaPath: await this.#subirGasto(cuenta, g),
          fileName: g.fileName,
          mimeType: g.archivo?.contentType ?? null,
          sentAt: g.sentAt,
        });
        if (i.ingest || i.reason === 'repetido') leyendo += 1;
      }
      await responder(GASTO_PRIVADO.cuentaAbierta(idioma, r.account_name, `${this.#web}/c/${cuenta}`, leyendo > 0, pedida));
      this.log.info({ chat: maskWaId(m.chatId), leyendo }, 'Cuenta abierta por privado');
      return 'gasto_privado:cuenta_abierta';
    }

    // Por abrir: lo que mandó queda guardado y le llega el link para entrar a Luks
    const guardados: GastoPorAbrir[] = [];
    for (const g of gastos) {
      guardados.push({
        wa_message_id: g.messageId,
        sender_wa_id: m.sender.id,
        sender_name: m.sender.name,
        kind: g.kind,
        text: g.text,
        media_path: await this.#subirGasto(cuenta, g),
        file_name: g.fileName,
        mime_type: g.archivo?.contentType ?? null,
        sent_at: g.sentAt.toISOString(),
      });
    }
    await this.store.guardarGastosPorAbrir(cuenta, guardados);
    const nombre = primerNombre(m.sender.name).startsWith('@') ? '' : primerNombre(m.sender.name);
    await responder(GASTO_PRIVADO.sinSesion(idioma, nombre, que, r.account_name));
    const privado = privadoDe(m) ?? m.chatId;
    const v = await this.store.soyYo(session.id, privado, m.sender.phone, m.sender.lid ?? null, m.sender.name);
    await this.#encolar([
      {
        chat_jid: privado,
        reason: 'verify',
        body: MISTER.soyYo.link(idioma, v.last4),
        identity_id: v.identity_id,
        dedupe_key: `verify:${privado}:${tramo(m.sentAt, 10)}`,
      },
    ]);
    this.log.info({ chat: maskWaId(m.chatId), guardados: guardados.length }, 'Cuenta por abrir (entra a Luks con el link)');
    return 'gasto_privado:cuenta_por_abrir';
  }

  /**
   * Chepito por privado (migración 710): «Juan me debe 50 mil por la boleta» o
   * su contacto. Pregunta lo que falte (a quién, su WhatsApp, cuánto, por qué),
   * confirma y crea el cobro; si no tiene en el perfil cómo le pagan, se lo
   * pregunta (el primer aviso sale unos minutos después). null si no era esto.
   */
  async #chepito(session: SessionInfo, m: IncomingMessage, texto: string, idioma: Idioma): Promise<Outcome | null> {
    const ahora = Date.now();
    let espera = this.#cobros.get(m.chatId);
    if (espera && espera.hasta < ahora) {
      this.#cobros.delete(m.chatId);
      espera = undefined;
    }
    const responder = (body: string) => this.#encolar([{ chat_jid: m.chatId, reason: 'answer', body, dedupe_key: `answer:${m.chatId}:${m.messageId}` }]);

    if (!espera) {
      if (!m.contacto && !esPedidoDeCobro(texto)) return null;
      const b: BorradorCobro = m.contacto
        ? { nombre: nombreLimpio(m.contacto.nombre), telefono: telefonoDe(m.contacto.telefono) ?? undefined }
        : leerCobro(texto);
      espera = { b, paso: 'nombre', hasta: ahora + CHEPITO_MS };
      this.#cobros.set(m.chatId, espera);
      // Solo el contacto: ¿quiere cobrarle algo?
      if (m.contacto) {
        espera.paso = 'monto';
        await responder(CHEPITO.contacto(b, idioma));
        return 'chepito:contacto';
      }
      return this.#chepitoSiguiente(espera, idioma, responder);
    }

    const b = espera.b;
    espera.hasta = ahora + CHEPITO_MS;
    if (espera.paso !== 'pago' && /^(?:no|nop|cancela(?:r|lo)?|olvidalo|dejalo|no gracias|nada|cancel)$/.test(plano(texto))) {
      this.#cobros.delete(m.chatId);
      await responder(CHEPITO.cancelado(idioma));
      return 'chepito:cancelado';
    }
    switch (espera.paso) {
      case 'nombre':
      case 'telefono': {
        // Su contacto, o el nombre y el número escritos
        if (m.contacto) {
          b.nombre ??= nombreLimpio(m.contacto.nombre);
          b.telefono = telefonoDe(m.contacto.telefono) ?? b.telefono;
        } else {
          b.telefono ??= telefonoDe(texto) ?? undefined;
          if (espera.paso === 'nombre') b.nombre ??= nombreLimpio(texto);
        }
        break;
      }
      case 'monto':
        b.monto = montoDe(texto) ?? b.monto;
        b.concepto ??= leerCobro(texto).concepto;
        break;
      case 'concepto':
        b.concepto = conceptoLimpio(texto) ?? b.concepto;
        break;
      case 'confirmar': {
        const e = leerEleccion(texto, 1);
        if (e !== 1) {
          await responder(CHEPITO.confirmar(b as Required<BorradorCobro>, idioma));
          return 'chepito:confirmar';
        }
        return this.#chepitoCrear(session, m, espera, idioma, responder);
      }
      case 'pago': {
        // Cómo le pagan: queda en su perfil y sale en los avisos
        const pago = leerComoMePagan(texto);
        if (pago === null) {
          await responder(CHEPITO.pagoNoValido(idioma));
          return 'chepito:pago';
        }
        this.#cobros.delete(m.chatId);
        if (pago === 'no') {
          await responder(CHEPITO.sinPago(b.nombre ?? '', idioma));
          return 'chepito:sin_pago';
        }
        const r = await this.store.chepitoComoMePagan(m.sender, pago);
        const medios = r.ok ? mediosDePago(r.pago, idioma) : null;
        if (!medios) {
          this.#cobros.set(m.chatId, espera);
          await responder(CHEPITO.pagoNoValido(idioma));
          return 'chepito:pago';
        }
        await responder(CHEPITO.pagoGuardado(medios, b.nombre ?? '', idioma));
        return 'chepito:pago_guardado';
      }
    }
    return this.#chepitoSiguiente(espera, idioma, responder);
  }

  /** Lo que falta, o la confirmación */
  async #chepitoSiguiente(espera: CobroEnEspera, idioma: Idioma, responder: (body: string) => Promise<unknown>): Promise<Outcome> {
    const falta = faltaDe(espera.b);
    espera.paso = falta ?? 'confirmar';
    await responder(falta ? CHEPITO.pregunta(falta, espera.b, idioma) : CHEPITO.confirmar(espera.b as Required<BorradorCobro>, idioma));
    return `chepito:${espera.paso}`;
  }

  /** «Sí»: el cobro queda (o, sin sesión en Luks, el link para entrar y después «sí» otra vez) */
  async #chepitoCrear(
    session: SessionInfo,
    m: IncomingMessage,
    espera: CobroEnEspera,
    idioma: Idioma,
    responder: (body: string) => Promise<unknown>,
  ): Promise<Outcome> {
    const b = espera.b as Required<BorradorCobro>;
    // Unos minutos antes del primer aviso: para que alcance a decir cómo le pagan
    const r = await this.store.chepitoCrear(m.chatId, m.sender, b, CHEPITO_ESPERA_MIN);
    if (!r.ok && r.reason === 'sin_sesion') {
      await responder(CHEPITO.sinSesion(idioma));
      const privado = privadoDe(m) ?? m.chatId;
      const v = await this.store.soyYo(session.id, privado, m.sender.phone, m.sender.lid ?? null, m.sender.name);
      await this.#encolar([
        {
          chat_jid: privado,
          reason: 'verify',
          body: MISTER.soyYo.link(idioma, v.last4),
          identity_id: v.identity_id,
          dedupe_key: `verify:${privado}:${tramo(m.sentAt, 10)}`,
        },
      ]);
      return 'chepito:sin_sesion';
    }
    if (!r.ok) {
      this.#cobros.delete(m.chatId);
      await responder(CHEPITO.noPude(r.reason, b, idioma));
      return `chepito:${r.reason ?? 'no_pude'}`;
    }
    const link = `${this.#web}/c/${r.account_id}/cobros`;
    const ya = puedeCobrar(new Date(Date.now() + CHEPITO_ESPERA_MIN * 60_000));
    const listo = CHEPITO.listo(b, link, ya, idioma);
    this.log.info({ chat: maskWaId(m.chatId), nueva_cuenta: r.nueva_cuenta }, 'Un cobro de Chepito por privado');
    if (r.pago) {
      this.#cobros.delete(m.chatId);
      await responder(listo);
      return 'chepito:creado';
    }
    // Sin cómo le pagan en el perfil: se lo pregunta (lo que diga queda guardado)
    espera.paso = 'pago';
    await responder(`${listo}\n\n${CHEPITO.pago(idioma)}`);
    return 'chepito:creado';
  }

  /** Lo que responde quien debe (ya pagué, no le debo, no me escribas): a él y a quien cobra. null si no le cobraban */
  async #chepitoResponde(m: IncomingMessage, que: QueResponde, idioma: Idioma): Promise<Outcome | null> {
    let cobros: ChepitoRespuesta[];
    try {
      cobros = await this.store.chepitoRespuesta(m.sender, que);
    } catch (e) {
      // Sin la migración 710 todavía: sigue como siempre
      this.log.warn({ err: (e as Error).message }, 'No se pudo leer si le cobra Chepito');
      return null;
    }
    if (!cobros.length) return null;
    const items: OutboxItem[] = [
      { chat_jid: m.chatId, reason: 'answer', body: respuestaAlDeudor(que, cobros, idioma), dedupe_key: `answer:${m.chatId}:${m.messageId}` },
    ];
    for (const c of cobros) {
      if (c.acreedor_chat)
        items.push({ chat_jid: c.acreedor_chat, reason: 'answer', body: avisoAlAcreedor(que, c), dedupe_key: `chepito-${que}:${c.cobro_id}` });
    }
    await this.#encolar(items);
    this.log.info({ chat: maskWaId(m.chatId), que, cobros: cobros.length }, 'Respondió un cobro de Chepito');
    return `chepito:${que}`;
  }

  /** La respuesta a «¿dónde lo anoto?»: lo anota en esa cuenta, marca su pago, o nada. null si no era para esto */
  async #eleccionGasto(session: SessionInfo, m: IncomingMessage, texto: string, idioma: Idioma): Promise<Outcome | null> {
    const espera = this.#gastosPrivados.get(m.chatId);
    if (!espera) return this.#eleccionPorAbrir(m, texto, idioma);
    const responder = (body: string) => this.#encolar([{ chat_jid: m.chatId, reason: 'answer', body, dedupe_key: `answer:${m.chatId}:${m.messageId}` }]);
    // El número, «sí» o «no», o el nombre («casa», «Mister Luks»)
    const eleccion = leerEleccion(texto, Math.max(espera.opciones.length, 1), espera.opciones.map(nombreParaElegir));
    if (eleccion === null) return null;
    if (espera.hasta < Date.now()) {
      this.#gastosPrivados.delete(m.chatId);
      await responder(GASTO_PRIVADO.seMePerdio(idioma));
      return 'gasto_privado:se_perdio';
    }
    this.#gastosPrivados.delete(m.chatId);
    if (eleccion === 'no') {
      await responder(GASTO_PRIVADO.noAnoto(idioma));
      return 'gasto_privado:no';
    }

    const opcion = espera.opciones[eleccion - 1];
    if (opcion.tipo === 'nueva') {
      // Su cuenta del chat privado: ya, o apenas entre a Luks con el link
      const primero = espera.gastos[0]?.kind;
      return this.#abrirCuentaPrivada(session, m, espera.gastos, primero === 'pdf' ? 'pdf' : primero === 'photo' ? 'foto' : 'texto', idioma, true);
    }
    if (opcion.tipo === 'pago') {
      // Es su pago de lo que debe: como «ya pagué» (y no se anota como gasto)
      const r = await this.store.yaPague(m.chatId, m.sender, [opcion.transferId]);
      const nombre = primerNombre(r.pagadas[0]?.from_name ?? m.sender.name);
      const items: OutboxItem[] = [
        {
          chat_jid: m.chatId,
          reason: 'answer',
          body: r.pagadas.length ? PAGOS.listo(idioma, nombre, r, true) : PAGOS.nada(idioma, nombre, null),
          dedupe_key: `answer:${m.chatId}:${m.messageId}`,
        },
      ];
      for (const p of r.pagadas) {
        const chat = p.to_private_jid ?? p.group_jid;
        if (!chat) continue;
        const idiomaP = p.account.language ?? idioma;
        items.push({
          chat_jid: chat,
          reason: 'answer',
          body: p.to_private_jid ? PAGOS.tePagaron(idiomaP, p) : PAGOS.pagoEnGrupo(idiomaP, p),
          dedupe_key: `pagado:${p.id}`,
        });
      }
      await this.#encolar(items);
      this.log.info({ chat: maskWaId(m.chatId), pagadas: r.pagadas.length }, 'Un gasto por privado era su pago');
      return 'gasto_privado:pago';
    }

    // En la cuenta que eligió: cada cosa que mandó entra como un mensaje de esa cuenta
    let anotados = 0;
    let razon: string | undefined;
    for (const g of espera.gastos) {
      const mediaPath = await this.#subirGasto(opcion.id, g);
      const r = await this.store.ingestPrivado({
        chatJid: m.chatId,
        accountId: opcion.id,
        waMessageId: g.messageId,
        sender: m.sender,
        kind: g.kind,
        text: g.text,
        mediaPath,
        fileName: g.fileName,
        mimeType: g.archivo?.contentType ?? null,
        sentAt: g.sentAt,
      });
      if (r.ingest || r.reason === 'repetido') anotados += 1;
      else razon = r.reason;
    }
    await responder(anotados ? GASTO_PRIVADO.anotando(idioma, opcion.nombre, anotados) : GASTO_PRIVADO.noPude(idioma, opcion.nombre, razon));
    this.log.info({ chat: maskWaId(m.chatId), anotados, razon }, 'Un gasto por privado, a una cuenta');
    return anotados ? 'gasto_privado:anotado' : `gasto_privado:${razon ?? 'no_pude'}`;
  }

  /**
   * La respuesta a la pregunta que le hizo la base al entrar a Luks con cuentas que ya
   * tenía (migración 670): lo que mandó va a la cuenta que eligió (con sus archivos) o
   * a la nueva, «Cuenta con Mister Luks». La última opción es la nueva. null si no era para esto
   */
  async #eleccionPorAbrir(m: IncomingMessage, texto: string, idioma: Idioma): Promise<Outcome | null> {
    // Solo si parece una respuesta: un número, «no» o unas pocas palabras (el nombre de la cuenta)
    if (!pareceEleccion(texto)) return null;
    let espera: PorAbrirEnEspera | null;
    try {
      espera = await this.store.porAbrirEnEspera(m.chatId);
    } catch (e) {
      // Sin la migración 670 todavía: sigue como cualquier otro mensaje
      this.log.warn({ err: (e as Error).message }, 'No se pudo leer la pregunta de la cuenta por abrir');
      return null;
    }
    if (!espera) return null;
    const eleccion = leerEleccion(texto, espera.opciones.length + 1, [...espera.opciones.map((o) => o.name), `${espera.account_name} nueva`]);
    if (eleccion === null) return null;
    const responder = (body: string) => this.#encolar([{ chat_jid: m.chatId, reason: 'answer', body, dedupe_key: `answer:${m.chatId}:${m.messageId}` }]);

    if (eleccion === 'no') {
      await this.store.resolverPorAbrir(espera.account_id, 'no');
      await responder(GASTO_PRIVADO.noAnoto(idioma));
      return 'gasto_privado:no';
    }
    if (eleccion > espera.opciones.length) {
      const r = await this.store.resolverPorAbrir(espera.account_id, 'nueva');
      if (!r.ok || !r.account_id) {
        await responder(GASTO_PRIVADO.noPude(idioma, espera.account_name, undefined));
        return 'gasto_privado:no_pude';
      }
      await responder(GASTO_PRIVADO.cuentaAbierta(idioma, r.account_name ?? espera.account_name, `${this.#web}/c/${r.account_id}`, (r.leyendo ?? 0) > 0, true));
      return 'gasto_privado:cuenta_abierta';
    }

    // En una de sus cuentas: los archivos pasan a la carpeta de esa cuenta y cada cosa entra ahí
    const opcion = espera.opciones[eleccion - 1];
    let anotados = 0;
    let razon: string | undefined;
    for (const g of espera.items) {
      let mediaPath: string | null = null;
      if (g.media_path) {
        mediaPath = `${opcion.id}/${g.media_path.split('/').slice(1).join('/')}`;
        try {
          await this.store.moverEvidencia(g.media_path, mediaPath);
        } catch (e) {
          this.log.warn({ err: (e as Error).message }, 'No se pudo mover el archivo a la cuenta que eligió');
          razon = 'sin_archivo';
          continue;
        }
      }
      const r = await this.store.ingestPrivado({
        chatJid: m.chatId,
        accountId: opcion.id,
        waMessageId: g.wa_message_id,
        sender: m.sender,
        kind: g.kind,
        text: g.text,
        mediaPath,
        fileName: g.file_name,
        mimeType: g.mime_type,
        sentAt: new Date(g.sent_at),
      });
      if (r.ingest || r.reason === 'repetido') anotados += 1;
      else razon = r.reason;
    }
    await this.store.resolverPorAbrir(espera.account_id, 'listo');
    await responder(anotados ? GASTO_PRIVADO.anotando(idioma, opcion.name, anotados) : GASTO_PRIVADO.noPude(idioma, opcion.name, razon));
    this.log.info({ chat: maskWaId(m.chatId), anotados, razon }, 'Lo que mandó antes de entrar a Luks, a una de sus cuentas');
    return anotados ? 'gasto_privado:anotado' : `gasto_privado:${razon ?? 'no_pude'}`;
  }

  /** «la 1 son 3» respondiendo la lista (en el grupo, o por privado sobre lo que confirma): la cantidad, sin cambiar el total */
  async #cantidad(jid: string, lista: string, m: IncomingMessage, c: { n: number; cantidad: number }, responderEn: string): Promise<Outcome | null> {
    let r: Awaited<ReturnType<Store['itemsCantidad']>>;
    try {
      r = await this.store.itemsCantidad(jid, lista, m.sender, c.n, c.cantidad);
    } catch (e) {
      // Sin la migración 500 todavía: sigue como cualquier otro mensaje
      this.log.warn({ err: (e as Error).message }, 'No se pudo cambiar la cantidad del ítem');
      return null;
    }
    if (!r.ok && r.reason === 'no_es_pregunta') return null;
    const salen: OutboxItem[] = [{ chat_jid: responderEn, reason: 'answer', body: contestarCantidad(r), dedupe_key: `answer:${responderEn}:${m.messageId}` }];
    // Si fue por privado, en el grupo también se ve
    if (r.ok && responderEn !== jid) salen.push({ chat_jid: jid, reason: 'answer', body: contestarCantidad(r), dedupe_key: `answer:${jid}:${m.messageId}` });
    await this.#encolar(salen);
    this.log.info({ group: jid, n: c.n, cantidad: c.cantidad, ok: r.ok, sender: maskWaId(m.sender.id) }, '¿Cuántas trae el ítem?');
    return `items:${r.ok ? 'cantidad' : r.reason}`;
  }

  /**
   * Por privado (migración 500): le llegó lo suyo de una lista de ítems. «Sí»
   * lo deja así; «no», que diga cómo fue (o el link para arreglarlo en la
   * app); con los números, lo cambia como si respondiera la lista en el grupo
   * (y allá se ve). null si no hay nada esperando o no era para esto.
   */
  async #confirmacion(m: IncomingMessage, texto: string): Promise<Outcome | null> {
    const c = this.#confirmaciones.get(m.chatId);
    if (!c) return null;
    if (c.hasta < Date.now()) {
      this.#confirmaciones.delete(m.chatId);
      return null;
    }
    const responder = (body: string, chat = m.chatId) => ({ chat_jid: chat, reason: 'answer' as const, body, dedupe_key: `answer:${chat}:${m.messageId}` });
    const modo = siONo(texto);
    if (modo) {
      if (modo === 'si') this.#confirmaciones.delete(m.chatId);
      await this.#encolar([responder(respuestaConfirmacion(modo, c))]);
      return `items:${modo === 'si' ? 'confirmado' : 'no'}`;
    }
    // «la 1 son 3» también por privado (y en el grupo se ve)
    const cuantas = leerCantidad(texto);
    if (cuantas) return this.#cantidad(c.jid, c.lista, m, cuantas, m.chatId);
    const respuesta = leerRespuesta(texto);
    if (!respuesta) return null;
    let r: Awaited<ReturnType<Store['itemsRespuesta']>>;
    try {
      r = await this.store.itemsRespuesta(c.jid, c.lista, m.sender, respuesta.claims);
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, 'No se pudo corregir lo suyo por privado');
      return null;
    }
    if (!r.ok && r.reason === 'no_es_pregunta') return null;
    if (!r.ok) {
      await this.#encolar([responder(contestar(r))]);
      return `items:${r.reason}`;
    }
    // Lo nuevo por privado (para confirmar otra vez) y la línea en el grupo, como si lo hubiera respondido allá
    c.hasta = Date.now() + CONFIRMAR_MS;
    await this.#encolar([responder(confirmacionPrivada(r)), responder(contestar(r), c.jid)]);
    this.log.info({ group: c.jid, claims: respuesta.claims.length, sender: maskWaId(m.sender.id) }, '¿Quién pidió qué? (corregido por privado)');
    return 'items:corregido';
  }

  /**
   * Por privado (migración 480), lo de cada quien en todas sus cuentas: si
   * está en una, se lo cuenta todo (cuánto debe, a quién, qué pidió y cuánto
   * costó); si está en varias, la lista con cómo va en cada una y responde con
   * el número (la lista sirve 30 minutos). Un saludo también muestra la lista.
   * null si no era para esto (sigue como cualquier mensaje por privado).
   */
  async #loSuyo(m: IncomingMessage, texto: string, primeraVez: boolean): Promise<Outcome | null> {
    const ahora = Date.now();
    const lista = this.#listas.get(m.chatId);
    if (lista && lista.hasta < ahora) this.#listas.delete(m.chatId);
    const numero = /^\s*(\d{1,2})\uFE0F?\u20E3?\s*[.!)]*\s*$/.exec(texto)?.[1];
    const conLista = Boolean(numero && lista && lista.hasta >= ahora);
    const elegida = conLista && lista ? lista.ids[Number(numero) - 1] : undefined;
    // Un saludo, «mis cuentas» o un número que no está en la lista: la lista
    const saludo = !elegida && (esMenu(texto) || conLista);
    let intencion: Intencion | null = elegida && lista ? lista.intencion : intencionDe(texto);
    if (!elegida && !intencion && !saludo && pareceUnaPregunta(texto) && this.mister.clasificar) intencion = await this.mister.clasificar(texto);
    if (intencion && !PRIVADAS.includes(intencion)) return null;
    const idioma = idiomaDeNumero(m.sender.phone);
    const responder = async (body: string, clave = m.messageId) => {
      await this.#encolar([{ chat_jid: m.chatId, reason: 'answer', body, dedupe_key: `answer:${m.chatId}:${clave}` }]);
    };
    if (!intencion && !saludo) {
      // Lo que no se entiende solo se contesta si pregunta algo (un «gracias» no), y como mucho cada 10 minutos
      if (primeraVez || !pareceUnaPregunta(texto)) return null;
      await responder(PRIVADO.noEntendi(idioma), `no_entendi:${tramo(m.sentAt, 10)}`);
      return 'suyo:no_entendi';
    }

    let d: Awaited<ReturnType<Store['misCuentas']>>;
    try {
      d = await this.store.misCuentas(m.chatId, m.sender);
    } catch (e) {
      // Sin la 480 en la base, por privado sigue como antes
      this.log.warn({ err: e }, 'No se pudieron leer las cuentas por privado');
      return null;
    }
    const cuentas: Numeros[] = d.cuentas.map((c) => ({ ...c, ok: true, identity_id: d.identity_id, pref: null, contador_en_grupo: false }));
    if (!cuentas.length) {
      if (primeraVez) return null;
      await responder(PRIVADO.noTeEncuentro(idioma));
      return 'suyo:no_te_encuentro';
    }
    const cuenta = elegida ? cuentas.find((c) => c.account.id === elegida) : cuentas.length === 1 ? cuentas[0] : undefined;
    const que = intencion ?? 'mi_saldo';
    if (!cuenta) {
      const nombre = primerNombre(cuentas.find((c) => c.me)?.me?.name ?? m.sender.name);
      this.#listas.set(m.chatId, { ids: cuentas.map((c) => c.account.id ?? ''), intencion: que, hasta: ahora + LISTA_MS });
      this.#confirmaciones.delete(m.chatId);
      await responder(this.#conPista(m.chatId, PRIVADO.lista(cuentas, nombre, idioma), idioma, primeraVez));
      this.log.info({ chat: maskWaId(m.chatId), cuentas: cuentas.length, intent: que }, 'Sus cuentas, por privado');
      return 'suyo:lista';
    }

    const enCuenta: Idioma = cuenta.account.language ?? idioma;
    const me = cuenta.me;
    let body = !me
      ? PREGUNTAS.noTeConozco(enCuenta, cuenta.account.name)
      : que === 'mis_gastos'
        ? RESPUESTA.misGastos(cuenta, me, enCuenta)
        : que === 'total'
          ? RESPUESTA.total(cuenta, enCuenta)
          : que === 'deudas'
            ? RESPUESTA.deudas(cuenta, enCuenta)
            : RESPUESTA.miSaldo(cuenta, me, enCuenta, true);
    if (cuentas.length > 1) body = antesDeLaFirma(body, PRIVADO.otraCuenta(enCuenta));
    await responder(this.#conPista(m.chatId, body, enCuenta, primeraVez));
    this.log.info({ chat: maskWaId(m.chatId), intent: que }, 'Lo suyo, por privado');
    return `suyo:${que}`;
  }

  /**
   * Por privado, una vez al día: la línea que dice cómo ver todo lo que sabe
   * hacer («ayuda»), antes de la firma. La primera vez no: la bienvenida ya lo dice.
   */
  #conPista(chat: string, body: string, idioma: Idioma, primeraVez: boolean): string {
    const ahora = Date.now();
    if ((this.#pistas.get(chat) ?? 0) > ahora) return body;
    this.#pistas.set(chat, ahora + PISTA_MS);
    return primeraVez ? body : antesDeLaFirma(body, `\n\n${PISTA_AYUDA[idioma]}`);
  }

  /**
   * «luks soy yo»: quiere asociar su número a su cuenta de Luks. Si ya está
   * verificado, se lo dice; si no, por privado (lo pidió) le llega un link
   * /v/CÓDIGO de un solo uso, y en el grupo, que lo revise. Como mucho una vez
   * cada 10 minutos por persona.
   */
  /**
   * Le preguntan algo a Mister Luks (fase 7): «cuánto llevamos», «quién le debe
   * a quién», «cuánto debo», «mis gastos», «privado» o «aquí», «no me cuentes».
   * Los números salen de la base. Lo del grupo se responde en el grupo; lo de
   * cada quien, como lo prefiera (la primera vez pregunta). En un grupo que solo
   * lee un WhatsApp vinculado nadie escribe en el grupo: Mister Luks le responde
   * por privado a quien le preguntó, si existe (si no, queda en la app).
   * Devuelve null si no era una pregunta («luks taxi 45 lucas» es un gasto).
   */
  async #pregunta(session: SessionInfo, m: IncomingMessage, texto: string, explicito: boolean): Promise<Outcome | null> {
    let intencion = intencionDe(texto);
    if (!intencion && looksLikeExpense(texto)) return null;
    if (!intencion && texto && this.mister.clasificar) intencion = await this.mister.clasificar(texto);
    // Un «Luks…» que no se entiende puede ser charla; a una mención o a una cita sí se le contesta
    if (!intencion && !explicito) return null;
    if (intencion === 'ya_pague') return this.#yaPague(session, m, texto);

    const d = await this.store.question(m.chatId, m.sender);
    if (!d) return 'ignorado:pregunta';
    // Si Mister Luks está en el grupo, responde él (no también el WhatsApp vinculado)
    if (session.kind !== 'contador' && d.contador_en_grupo) return 'ignorado:lo_responde_mister_luks';
    const enGrupo = session.kind === 'contador';
    if (enGrupo && (intencion === 'privado' || intencion === 'aqui')) return this.#canal(session, m, intencion, false);

    const privado = privadoDe(m);
    // Un WhatsApp vinculado nunca escribe: le responde Mister Luks por privado
    if (!enGrupo && (!privado || !(await this.store.openPrivateAnswer(privado)))) return 'pregunta:sin_mister_luks';
    const idioma: Idioma = d.ok ? (d.account.language ?? 'es') : idiomaDeNumero(m.sender.phone);
    const nombre = primerNombre((d.ok ? d.me?.name : null) ?? m.sender.name);
    const items: OutboxItem[] = [];
    const decir = (body: string, donde: 'grupo' | 'privado' = enGrupo ? 'grupo' : 'privado', clave = m.messageId) => {
      const chat = donde === 'grupo' ? m.chatId : (privado as string);
      items.push({ chat_jid: chat, reason: 'answer', body, dedupe_key: `answer:${chat}:${clave}` });
    };
    let outcome: Outcome = `pregunta:${intencion ?? 'no_entendi'}`;

    if (!intencion) {
      // Como mucho una vez cada 10 minutos por grupo
      decir(PREGUNTAS.noEntendi(idioma), undefined, `no_entendi:${tramo(m.sentAt, 10)}`);
    } else if (!d.ok) {
      decir(PREGUNTAS.sinCuenta(idioma), undefined, `sin_cuenta:${tramo(m.sentAt, 60)}`);
    } else if (intencion === 'privado' || intencion === 'aqui') {
      await this.store.answerPref(m.chatId, m.sender, intencion, false);
      decir(PREGUNTAS.canalListo(idioma, nombre, intencion));
    } else if (intencion === 'no_me_cuentes' || intencion === 'cuentame') {
      await this.store.optout(m.chatId, m.sender, intencion === 'no_me_cuentes');
      decir(intencion === 'no_me_cuentes' ? PREGUNTAS.noMeCuentes(idioma, nombre, d.account.name) : PREGUNTAS.cuentame(idioma, nombre, d.account.name));
    } else if (intencion === 'total' || intencion === 'deudas') {
      decir(intencion === 'total' ? RESPUESTA.total(d, idioma) : RESPUESTA.deudas(d, idioma));
    } else if (!d.me) {
      decir(PREGUNTAS.noTeConozco(idioma, d.account.name));
    } else {
      const respuesta = intencion === 'mi_saldo' ? RESPUESTA.miSaldo(d, d.me, idioma) : RESPUESTA.misGastos(d, d.me, idioma);
      if (!enGrupo || d.pref === 'aqui' || (d.pref === 'privado' && !privado)) {
        decir(respuesta);
      } else if (d.pref === 'privado' && privado) {
        // Lo pidió: su chat privado queda abierto
        await this.store.privateChat(session.id, privado);
        decir(respuesta, 'privado');
        decir(PREGUNTAS.porPrivado(idioma, nombre));
      } else {
        await this.store.askAnswerPref(m.chatId, d.identity_id, intencion);
        decir(PREGUNTAS.canal(idioma, nombre));
        outcome = 'pregunta:canal';
      }
    }
    await this.#encolar(items);
    this.log.info({ group: m.chatId, intent: intencion, sender: maskWaId(m.sender.id), in_group: enGrupo }, 'Pregunta a Mister Luks');
    return outcome;
  }

  #esDeLuks(id: string | null | undefined) {
    return Boolean(id && (this.#misterLuks.has(id) || this.#misterLuks.has(`lid:${id}`)));
  }

  /**
   * Responden (citan) la lista numerada de una cuenta con lo suyo: «1, 5»,
   * «1x2». La base lo anota y reparte; Mister Luks confirma en una línea.
   * null si no era la lista o no trae números (sigue como cualquier mensaje).
   */
  async #items(m: IncomingMessage): Promise<Outcome | null> {
    const texto = aMisterLuks(m, this.#misterLuks)?.texto ?? m.text ?? '';
    // «la 1 son 3»: cuántas trae un ítem (antes que los números de lo suyo)
    const cuantas = m.quotedId ? leerCantidad(texto) : null;
    if (cuantas && m.quotedId) return this.#cantidad(m.chatId, m.quotedId, m, cuantas, m.chatId);
    const respuesta = leerRespuesta(texto);
    if (!respuesta || !m.quotedId) return null;
    const r = await this.store.itemsRespuesta(m.chatId, m.quotedId, m.sender, respuesta.claims);
    if (!r.ok && r.reason === 'no_es_pregunta') return null;
    // Si ya le escribió a Mister Luks, lo suyo le llega por privado para que lo confirme
    const privado = r.ok && r.privado ? r.privado : null;
    const body = contestar(r, Boolean(privado));
    const salen: OutboxItem[] = body ? [{ chat_jid: m.chatId, reason: 'answer', body, dedupe_key: `answer:${m.chatId}:${m.messageId}` }] : [];
    if (r.ok && privado) {
      salen.push({ chat_jid: privado, reason: 'answer', body: confirmacionPrivada(r), dedupe_key: `items-privado:${privado}:${m.messageId}` });
      this.#listas.delete(privado);
      this.#confirmaciones.set(privado, {
        jid: m.chatId,
        lista: m.quotedId,
        idioma: r.language === 'en' ? 'en' : 'es',
        nombre: primerNombre(r.name),
        comercio: r.merchant,
        link: r.account_id && r.expense_id ? linkDividir(this.#web, r.account_id, r.expense_id) : null,
        hasta: Date.now() + CONFIRMAR_MS,
      });
    }
    if (salen.length) await this.#encolar(salen);
    this.log.info(
      { group: m.chatId, ok: r.ok, reason: r.ok ? undefined : r.reason, claims: respuesta.claims.length, sender: maskWaId(m.sender.id) },
      '¿Quién pidió qué?',
    );
    return `items:${r.ok ? 'ok' : r.reason}`;
  }

  /**
   * La respuesta a «¿reabro el paseo o abro una cuenta nueva?» (migración 450).
   * null si no es una respuesta o no había pregunta (sigue como cualquier mensaje).
   */
  async #decision(m: IncomingMessage, quotedId: string | null, texto?: string): Promise<Outcome | null> {
    const modo = leerDecision(texto ?? aMisterLuks(m, this.#misterLuks)?.texto ?? m.text);
    if (!modo) return null;
    let r: Awaited<ReturnType<Store['decidirLiquidada']>>;
    try {
      r = await this.store.decidirLiquidada(m.chatId, quotedId, m.sender, modo);
    } catch (e) {
      // Sin la migración 450 todavía: el mensaje sigue como cualquier otro
      this.log.warn({ err: (e as Error).message }, 'No se pudo responder la pregunta de reabrir');
      return null;
    }
    if (!r.ok && r.reason === 'no_es_pregunta') return null;
    const body = contestarDecision(r, this.mister.webUrl ?? 'https://mrluks.com');
    if (body) await this.#encolar([{ chat_jid: m.chatId, reason: 'answer', body, dedupe_key: `answer:${m.chatId}:${m.messageId}` }]);
    this.log.info({ group: m.chatId, modo, ok: r.ok, reason: r.ok ? undefined : r.reason, sender: maskWaId(m.sender.id) }, '¿Reabrir o cuenta nueva?');
    return `reabrir:${r.ok ? r.modo : r.reason}`;
  }

  /**
   * «luks elimina este gasto» (migración 520): citan el mensaje del gasto (la
   * foto, el PDF, el texto o la lista de «¿quién pidió qué?») y la base lo
   * elimina si quien lo pide lo mandó, lo pagó o administra la cuenta. Sin cita,
   * Mister Luks explica cómo (como mucho una vez cada 10 minutos por grupo).
   */
  async #eliminar(m: IncomingMessage): Promise<Outcome> {
    const r = await this.store.eliminarGasto(m.chatId, m.quotedId ?? null, m.sender);
    const idioma: Idioma = r.language ?? idiomaDeNumero(m.sender.phone);
    const body = contestarEliminar(r, idioma);
    const clave = !r.ok && r.reason === 'sin_cita' ? `eliminar:${m.chatId}:${tramo(m.sentAt, 10)}` : `answer:${m.chatId}:${m.messageId}`;
    if (body) await this.#encolar([{ chat_jid: m.chatId, reason: 'answer', body, dedupe_key: clave }]);
    this.log.info({ group: m.chatId, ok: r.ok, reason: r.ok ? undefined : r.reason, sender: maskWaId(m.sender.id) }, 'Eliminar un gasto');
    return `eliminar:${r.ok ? 'ok' : r.reason}`;
  }

  /**
   * «Ya le pagué a Santiago» (migración 420), en el grupo o por privado: lo que
   * le falta pagar a quien escribe queda marcado. Cuál, lo decide elegirPagos
   * (por a quién, por el monto o porque es lo único); si no queda claro,
   * pregunta. Quien recibe se entera: en el grupo lo ve; si fue por privado, se
   * lo dice Mister Luks por su privado (si ya le escribió) o en el grupo.
   * Devuelve null si era un gasto («luks ya pagué la luz 120 lucas»).
   */
  async #yaPague(session: SessionInfo, m: IncomingMessage, texto: string, sinHablarle = false): Promise<Outcome | null> {
    const enGrupo = m.chatKind === 'grupo';
    const d = await this.store.porPagar(m.chatId, m.sender);
    // Si Mister Luks está en el grupo, responde él (no también el WhatsApp vinculado)
    if (enGrupo && session.kind !== 'contador' && d.contador_en_grupo) return 'ignorado:lo_responde_mister_luks';
    const decision = d.conocido && (!enGrupo || d.account) ? elegirPagos(d.pendientes, texto, enGrupo) : null;
    if (decision?.tipo === 'gasto') return null;
    // Sin hablarle, solo si hay una liquidación de por medio y queda claro (si no, es charla)
    if (sinHablarle && (!d.account?.liquidada || !decision || decision.tipo === 'no_le_debes')) return null;

    // En el grupo responde Mister Luks; si lo lee solo un WhatsApp vinculado, por privado (nunca escribe ese)
    const privado = privadoDe(m);
    const aqui = enGrupo && session.kind === 'contador' ? m.chatId : privado;
    if (!aqui) return 'ignorado:sin_numero';
    if (enGrupo && session.kind !== 'contador' && !(await this.store.openPrivateAnswer(aqui))) return 'pregunta:sin_mister_luks';

    const idioma: Idioma = d.account?.language ?? d.pendientes[0]?.account.language ?? idiomaDeNumero(m.sender.phone);
    const nombre = primerNombre(d.pendientes[0]?.from_name ?? m.sender.name);
    const conCuenta = !enGrupo;
    const items: OutboxItem[] = [];
    const decir = (chat: string, body: string, clave = `answer:${chat}:${m.messageId}`) =>
      items.push({ chat_jid: chat, reason: 'answer', body, dedupe_key: clave });

    let outcome: Outcome = `pago:${decision?.tipo ?? 'no_te_conozco'}`;
    if (enGrupo && !d.account) {
      decir(aqui, PREGUNTAS.sinCuenta(idioma), `answer:${aqui}:sin_cuenta:${tramo(m.sentAt, 60)}`);
      outcome = 'pago:sin_cuenta';
    } else if (!decision) {
      decir(aqui, d.account ? PREGUNTAS.noTeConozco(idioma, d.account.name) : PAGOS.noTeEncuentro(idioma));
    } else if (decision.tipo === 'nada') {
      // Dicho sin hablarle, «ya está todo pago» una vez por hora (no a cada «ya pagué»)
      const clave = sinHablarle ? `answer:${aqui}:nada:${m.sender.id}:${tramo(m.sentAt, 60)}` : undefined;
      decir(
        aqui,
        d.account && !d.account.liquidada ? PAGOS.sinLiquidar(idioma, nombre, d.account.name) : PAGOS.nada(idioma, nombre, d.account?.name ?? null),
        clave,
      );
    } else if (decision.tipo === 'cual') {
      decir(aqui, PAGOS.cual(idioma, nombre, d.pendientes, decision.nombre, conCuenta));
    } else if (decision.tipo === 'no_le_debes') {
      decir(aqui, PAGOS.noLeDebes(idioma, nombre, decision.nombre, d.pendientes, conCuenta));
    } else {
      const r = await this.store.yaPague(m.chatId, m.sender, decision.ids);
      if (!r.pagadas.length) {
        decir(aqui, PAGOS.nada(idioma, nombre, d.account?.name ?? null));
        outcome = 'pago:nada';
      } else {
        decir(aqui, PAGOS.listo(idioma, nombre, r, conCuenta));
        // En el grupo con Mister Luks, quien recibe ya lo vio
        if (!(enGrupo && session.kind === 'contador')) {
          for (const p of r.pagadas) {
            const chat = p.to_private_jid ?? p.group_jid;
            if (!chat) continue;
            const idiomaP = p.account.language ?? idioma;
            decir(chat, p.to_private_jid ? PAGOS.tePagaron(idiomaP, p) : PAGOS.pagoEnGrupo(idiomaP, p), `pagado:${p.id}`);
          }
        }
      }
    }
    await this.#encolar(items);
    this.log.info({ chat: m.chatId, outcome, marked: decision?.tipo === 'marcar' ? decision.ids.length : 0, sender: maskWaId(m.sender.id) }, '«Ya pagué»');
    return outcome;
  }

  /**
   * «privado» o «aquí»: cómo quiere recibir lo suyo. Si una pregunta suya
   * estaba esperando esa respuesta, la responde ya; a secas (sin hablarle a
   * Luks, soloPendiente) solo cuenta si había una esperando.
   */
  async #canal(session: SessionInfo, m: IncomingMessage, modo: 'privado' | 'aqui', soloPendiente: boolean): Promise<Outcome | null> {
    const r = await this.store.answerPref(m.chatId, m.sender, modo, soloPendiente);
    if (!r.changed) return null;
    const d = await this.store.question(m.chatId, m.sender);
    const idioma: Idioma = d?.ok ? (d.account.language ?? 'es') : idiomaDeNumero(m.sender.phone);
    const nombre = primerNombre((d?.ok ? d.me?.name : null) ?? m.sender.name);
    const privado = privadoDe(m);
    const items: OutboxItem[] = [];
    const decir = (chat: string, body: string) => items.push({ chat_jid: chat, reason: 'answer', body, dedupe_key: `answer:${chat}:${m.messageId}` });
    if (r.pending_intent && d?.ok && d.me) {
      const respuesta = r.pending_intent === 'mi_saldo' ? RESPUESTA.miSaldo(d, d.me, idioma) : RESPUESTA.misGastos(d, d.me, idioma);
      if (modo === 'privado' && privado) {
        // Lo pidió: su chat privado queda abierto
        await this.store.privateChat(session.id, privado);
        decir(privado, respuesta);
        decir(m.chatId, PREGUNTAS.porPrivado(idioma, nombre));
      } else {
        decir(m.chatId, respuesta);
      }
    } else {
      decir(m.chatId, PREGUNTAS.canalListo(idioma, nombre, modo));
    }
    await this.#encolar(items);
    this.log.info({ group: m.chatId, mode: modo, pending: r.pending_intent ?? null, sender: maskWaId(m.sender.id) }, '¿Privado o aquí?');
    return `pregunta:${modo}`;
  }

  async #soyYo(session: SessionInfo, m: IncomingMessage): Promise<Outcome> {
    const privado = privadoDe(m);
    if (!privado) return 'ignorado:sin_numero';
    const idioma = idiomaDeNumero(m.sender.phone);
    const r = await this.store.soyYo(session.id, privado, m.sender.phone, m.sender.lid ?? null, m.sender.name);
    const cuando = tramo(m.sentAt, 10);
    const items: OutboxItem[] = [];
    if (m.chatKind === 'grupo') {
      items.push({
        chat_jid: m.chatId,
        reason: 'soy_yo',
        body: r.verified ? MISTER.soyYo.reconocido(idioma, r.name) : MISTER.soyYo.noEncontrado(idioma, r.last4),
        dedupe_key: `soy_yo:${m.chatId}:${privado}:${cuando}`,
      });
    }
    if (!r.verified) {
      items.push({
        chat_jid: privado,
        reason: 'verify',
        body: MISTER.soyYo.link(idioma, r.last4),
        identity_id: r.identity_id,
        dedupe_key: `verify:${privado}:${cuando}`,
      });
    } else if (m.chatKind === 'privado') {
      items.push({ chat_jid: privado, reason: 'soy_yo', body: MISTER.soyYo.yaVerificado(idioma, r.name), dedupe_key: `soy_yo:${privado}:${cuando}` });
    }
    await this.#encolar(items);
    this.log.info({ verified: r.verified, sender: maskWaId(m.sender.id) }, '«luks soy yo»');
    return 'soy_yo';
  }

  /** El .zip o .txt del chat, si no pesa demasiado; si pesa, Mister Luks lo explica (como mucho una vez por hora) */
  async #bajarChat(m: IncomingMessage, responder: (body: string) => Promise<unknown>, idioma: Idioma) {
    const media = m.media;
    if (!media) return null;
    if (media.sizeBytes && media.sizeBytes > this.limits.maxChatBytes) {
      this.log.info({ msg_id: m.messageId, bytes: media.sizeBytes }, 'Chat exportado demasiado pesado: no se baja');
      await responder(MISTER.importar.muyPesado(idioma));
      return null;
    }
    const body = await media.download();
    if (body.length > this.limits.maxChatBytes) {
      await responder(MISTER.importar.muyPesado(idioma));
      return null;
    }
    return { body, ext: media.mimeType === 'text/plain' ? 'txt' : 'zip', mimeType: media.mimeType };
  }

  /**
   * Mandaron el chat exportado en el grupo: queda en el bucket de importaciones y en la
   * cola del worker, que lee lo de antes de que Luks empezara a anotar. Lo leen las dos
   * sesiones si están en el grupo (la base no lo importa dos veces); solo Mister Luks responde.
   */
  async #chatExportado(session: SessionInfo, m: IncomingMessage): Promise<Outcome> {
    const idioma = idiomaDeNumero(m.sender.phone);
    const responder = (body: string, clave = `import:${m.chatId}:${m.messageId}`) =>
      session.kind === 'contador' ? this.#encolar([{ chat_jid: m.chatId, reason: 'import', body, dedupe_key: clave }]) : Promise.resolve([]);
    const check = await this.store.shouldIngest(m.chatId, m.messageId, m.sentAt);
    if (!check.account_id) {
      await responder(MISTER.importar.sinCuenta(idioma), `import:${m.chatId}:sin_cuenta:${tramo(m.sentAt, 60)}`);
      return `ignorado:${check.reason ?? 'sin_cuenta'}`;
    }
    const chat = await this.#bajarChat(m, responder, idioma);
    if (!chat) return 'chat_muy_pesado';
    const path = `${check.account_id}/whatsapp/${mes(m.sentAt)}/${nombreSeguro(m.messageId)}.${chat.ext}`;
    await this.store.uploadImport(path, chat.body, chat.mimeType);
    const r = await this.store.requestImport(m.chatId, path, m.media?.fileName ?? null, m.messageId, m.sender.name);
    this.log.info({ group: m.chatId, ok: r.ok, already: r.ok ? r.already : undefined, sender: maskWaId(m.sender.id) }, 'Chat exportado');
    if (!r.ok) return `ignorado:${r.reason}`;
    if (!r.already) await responder(MISTER.importar.recibido(r.language ?? idioma));
    return 'chat_importado';
  }

  /** Mandaron el chat exportado por privado: de cuál de sus grupos conectados es (si se sabe) */
  async #chatPrivado(m: IncomingMessage, idioma: Idioma): Promise<Outcome> {
    const responder = (body: string) => this.#encolar([{ chat_jid: m.chatId, reason: 'import', body, dedupe_key: `import:${m.chatId}:${m.messageId}` }]);
    const chat = await this.#bajarChat(m, responder, idioma);
    if (!chat) return 'chat_muy_pesado';
    const path = `privado/${mes(m.sentAt)}/${nombreSeguro(m.messageId)}.${chat.ext}`;
    await this.store.uploadImport(path, chat.body, chat.mimeType);
    const fileName = m.media?.fileName ?? null;
    const r = await this.store.requestImportPrivate(path, fileName, m.messageId, m.sender.phone, m.sender.lid ?? null, m.sender.name, nombreDelChat(fileName));
    this.log.info({ ok: r.ok, reason: r.ok ? undefined : r.reason, sender: maskWaId(m.sender.id) }, 'Chat exportado por privado');
    if (!r.ok) {
      await responder(MISTER.importar.sinGrupo(idioma));
      return `ignorado:${r.reason}`;
    }
    if (!r.already) await responder(MISTER.importar.privadoRecibido(r.language ?? idioma, r.group_name ?? ''));
    return 'chat_importado';
  }

  /** Mandaron por privado el link de un grupo: Mister Luks entra (y lo cuenta por privado) */
  async #unirse(connector: MessagingConnector, m: IncomingMessage, code: string, idioma: Idioma): Promise<Outcome> {
    const quien = m.sender.id ?? m.chatId;
    const responder = (body: string) => this.#encolar([{ chat_jid: m.chatId, reason: 'invite', body, dedupe_key: `invite:${m.chatId}:${m.messageId}` }]);
    if (!this.mister.joins.allow(quien)) {
      await responder(MISTER.unirse.tope(idioma));
      return 'link_grupo:tope';
    }
    let r: Awaited<ReturnType<MessagingConnector['joinGroup']>>;
    try {
      r = await connector.joinGroup(code);
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, 'No se pudo entrar al grupo con el link');
      r = { status: 'invalid' };
    }
    this.log.info({ status: r.status, sender: maskWaId(m.sender.id) }, 'Link de grupo por privado');
    if (r.status === 'invalid') {
      await responder(MISTER.unirse.invalid(idioma));
      return 'link_grupo:invalid';
    }
    if (r.status !== 'already') this.mister.joins.record(quien);
    const nombre = r.name ?? (idioma === 'en' ? 'the group' : 'el grupo');
    await responder(MISTER.unirse[r.status](idioma, nombre));
    return `link_grupo:${r.status}`;
  }
}
