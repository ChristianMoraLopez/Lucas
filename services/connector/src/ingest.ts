import type { GroupInfo, GroupMember, IncomingMessage, MessagingConnector, SessionInfo } from './connector.js';
import { type Logger, maskWaId } from './log.js';
import { type MediaLimits, MediaRejected, prepareMedia } from './media.js';
import { elegirPagos, PAGOS } from './pagos.js';
import { PREGUNTAS, primerNombre, RESPUESTA } from './preguntas.js';
import type { Clasificador } from './qwen.js';
import type { RateLimiter } from './replies.js';
import type { OutboxItem, Store } from './store.js';
import {
  aMisterLuks,
  canalDe,
  esMensajeDeLuks,
  esPedidoDeAyuda,
  esSoyYo,
  guia,
  type Idioma,
  idiomaDeNumero,
  intencionDe,
  looksLikeExpense,
  MISTER,
  MSG,
  nombreDelChat,
  parseHistoria,
  parseInviteLink,
  parseLinkCommand,
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
  | 'desde_cuando'
  | 'chat_importado'
  | 'chat_muy_pesado'
  | `pregunta:${string}`
  | `pago:${string}`
  | `link_grupo:${string}`
  | `ignorado:${string}`;

export interface IngestLimits extends MediaLimits {
  maxDownloadBytes: number;
  /** El chat exportado (.zip o .txt): hasta el límite del bucket «importaciones» */
  maxChatBytes: number;
}

export interface MisterLuksOptions {
  /** Dónde están la imagen y el PDF de la guía (https://mrluks.com/guia) */
  guiaUrl: string;
  /** Cuántos grupos acepta Mister Luks con links de invitación (por quien manda el link y en total, por hora) */
  joins: RateLimiter;
  /** Qwen, para las preguntas que las reglas no entienden (sin Ollama, no hay) */
  clasificar?: Clasificador | null;
}

const mes = (d: Date) => d.toISOString().slice(0, 7);
const nombreSeguro = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
/** El tramo de tiempo del mensaje: lo mismo dentro del tramo no se responde dos veces */
const tramo = (d: Date, minutos: number) => Math.floor(d.getTime() / (minutos * 60_000));

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

    // El chat exportado: se importa (lo de antes de que Luks empezara a anotar)
    if (m.media?.kind === 'chat') return this.#chatExportado(session, m);

    // «¿Desde cuándo anoto?»: «1»/«2» si la pregunta sigue abierta, o «luks desde ya» / «luks lee todo» cuando sea
    if (session.kind === 'contador' && !m.media) {
      const orden = parseHistoria(m.text, this.#misterLuks);
      const modo = orden ?? respuestaNumerada(m.text);
      if (modo) {
        const r = await this.store.historyAnswer(m.chatId, modo, m.sender.name, !orden);
        this.log.info({ group: m.chatId, mode: modo, changed: r.changed, reason: r.reason }, '¿Desde cuándo anoto?');
        return r.changed ? 'desde_cuando' : 'ignorado:desde_cuando';
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
      return 'ayuda';
    }

    // Le preguntan algo a Mister Luks (antes del filtro de la charla), o responden «privado» / «aquí»
    if (!m.media) {
      const pregunta = aMisterLuks(m, this.#misterLuks);
      const respuesta = pregunta
        ? await this.#pregunta(session, m, pregunta.texto, pregunta.explicito)
        : session.kind === 'contador' && canalDe(m.text)
          ? await this.#canal(session, m, canalDe(m.text) as 'privado' | 'aqui', true)
          : null;
      if (respuesta) return respuesta;
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

    const nuevas = await this.#encolar([
      { chat_jid: m.chatId, reason: 'welcome', body: MISTER.bienvenida(idioma), ...conGuia, dedupe_key: `welcome:${m.chatId}` },
    ]);
    const primeraVez = nuevas.length > 0;
    if (soyYo) return soyYo;

    if (m.media?.kind === 'chat') return this.#chatPrivado(m, idioma);

    const invitacion = parseInviteLink(m.text);
    if (invitacion) return this.#unirse(connector, m, invitacion, idioma);

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

  /**
   * «Ya le pagué a Santiago» (migración 420), en el grupo o por privado: lo que
   * le falta pagar a quien escribe queda marcado. Cuál, lo decide elegirPagos
   * (por a quién, por el monto o porque es lo único); si no queda claro,
   * pregunta. Quien recibe se entera: en el grupo lo ve; si fue por privado, se
   * lo dice Mister Luks por su privado (si ya le escribió) o en el grupo.
   * Devuelve null si era un gasto («luks ya pagué la luz 120 lucas»).
   */
  async #yaPague(session: SessionInfo, m: IncomingMessage, texto: string): Promise<Outcome | null> {
    const enGrupo = m.chatKind === 'grupo';
    const d = await this.store.porPagar(m.chatId, m.sender);
    // Si Mister Luks está en el grupo, responde él (no también el WhatsApp vinculado)
    if (enGrupo && session.kind !== 'contador' && d.contador_en_grupo) return 'ignorado:lo_responde_mister_luks';
    const decision = d.conocido && (!enGrupo || d.account) ? elegirPagos(d.pendientes, texto, enGrupo) : null;
    if (decision?.tipo === 'gasto') return null;

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
      decir(aqui, d.account && !d.account.liquidada ? PAGOS.sinLiquidar(idioma, nombre, d.account.name) : PAGOS.nada(idioma, nombre, d.account?.name ?? null));
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
