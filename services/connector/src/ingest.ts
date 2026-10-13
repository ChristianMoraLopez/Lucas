import type { GroupInfo, GroupMember, IncomingMessage, MessagingConnector, SessionInfo } from './connector.js';
import { type Logger, maskWaId } from './log.js';
import { type MediaLimits, MediaRejected, prepareMedia } from './media.js';
import type { RateLimiter } from './replies.js';
import type { OutboxItem, Store } from './store.js';
import {
  esMensajeDeLuks,
  esPedidoDeAyuda,
  esSoyYo,
  guia,
  type Idioma,
  idiomaDeNumero,
  looksLikeExpense,
  MISTER,
  MSG,
  parseInviteLink,
  parseLinkCommand,
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
  | `link_grupo:${string}`
  | `ignorado:${string}`;

export interface IngestLimits extends MediaLimits {
  maxDownloadBytes: number;
}

export interface MisterLuksOptions {
  /** Dónde están la imagen y el PDF de la guía (https://mrluks.com/guia) */
  guiaUrl: string;
  /** Cuántos grupos acepta Mister Luks con links de invitación (por quien manda el link y en total, por hora) */
  joins: RateLimiter;
}

const mes = (d: Date) => d.toISOString().slice(0, 7);
const nombreSeguro = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
/** El tramo de tiempo del mensaje: lo mismo dentro del tramo no se responde dos veces */
const tramo = (d: Date, minutos: number) => Math.floor(d.getTime() / (minutos * 60_000));

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
    const r = await this.store.setGroupMembers(groupId, lista);
    if (r.people_added) this.log.info({ group: groupId, members: r.members, added: r.people_added }, 'Personas nuevas desde el grupo');
    return { lista, cuantos: r.members };
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

    if (m.chatKind === 'privado') return session.kind === 'contador' ? this.#privado(session, connector, m) : 'ignorado:privado';

    const code = parseLinkCommand(m.text);
    if (code) return this.#link(session, connector, m, code);

    // «luks soy yo» en el grupo: solo lo atiende Mister Luks
    if (session.kind === 'contador' && !m.media && esSoyYo(m.text)) return this.#soyYo(session, m);

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
      return 'ayuda';
    }

    // Las cuentas o un cobro que mandaron desde Luks, o una respuesta de Luks: no es un gasto
    if (esMensajeDeLuks(m.text)) return 'de_luks';
    if (!m.media && !looksLikeExpense(m.text)) return 'charla';

    const check = await this.store.shouldIngest(m.chatId, m.messageId, m.sentAt);
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
      const body = r.ok
        ? r.already
          ? MSG.alreadyLinked(r.account_name, r.language ?? 'es')
          : MSG.linked(r.account_name, gente?.cuantos ?? r.members, r.language ?? 'es')
        : r.error === 'otra_cuenta'
          ? MSG.otherAccount
          : MSG.badCode;
      const dedupe = r.ok ? `link:${m.chatId}:${m.messageId}` : `link:${m.chatId}:error:${tramo(m.sentAt, 60)}`;
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

    const nuevas = await this.#encolar([
      { chat_jid: m.chatId, reason: 'welcome', body: MISTER.bienvenida(idioma), ...conGuia, dedupe_key: `welcome:${m.chatId}` },
    ]);
    const primeraVez = nuevas.length > 0;
    if (soyYo) return soyYo;

    const invitacion = parseInviteLink(m.text);
    if (invitacion) return this.#unirse(connector, m, invitacion, idioma);

    if (esPedidoDeAyuda(m.text) && !primeraVez) {
      await this.#encolar([
        { chat_jid: m.chatId, reason: 'guide', body: MISTER.guia(idioma), ...conGuia, dedupe_key: `guide:${m.chatId}:${tramo(m.sentAt, 10)}` },
      ]);
      return 'ayuda';
    }
    return primeraVez ? 'bienvenida' : 'privado';
  }

  /**
   * «luks soy yo»: quiere asociar su número a su cuenta de Luks. Si ya está
   * verificado, se lo dice; si no, por privado (lo pidió) le llega un link
   * /v/CÓDIGO de un solo uso, y en el grupo, que lo revise. Como mucho una vez
   * cada 10 minutos por persona.
   */
  async #soyYo(session: SessionInfo, m: IncomingMessage): Promise<Outcome> {
    const privado = m.chatKind === 'privado' ? m.chatId : m.sender.phone ? `${m.sender.phone}@s.whatsapp.net` : m.sender.lid ? `${m.sender.lid}@lid` : null;
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
