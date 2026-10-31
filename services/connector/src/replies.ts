import type { MessagingConnector } from './connector.js';
import type { Logger } from './log.js';
import type { OutboxPending, Store } from './store.js';
import { formatPrimerGasto, formatReplies, formatSegundoGasto, LINK_GRUPO, LINK_VERIFICACION, type PendingReply, sinLineaDelLink } from './text.js';

/*
 * Límite de frecuencia para todo lo que Luks escribe en los grupos: un
 * mínimo entre dos mensajes del mismo grupo, un tope por hora por grupo y un
 * tope por hora en total. Escribir mucho y seguido es la forma más rápida de
 * que WhatsApp bloquee un número.
 */
export interface RateLimits {
  minIntervalMs: number;
  maxPerHourPerGroup: number;
  maxPerHourTotal: number;
}

const HORA = 3_600_000;

export class RateLimiter {
  readonly #byGroup = new Map<string, number[]>();
  #all: number[] = [];

  constructor(
    private readonly limits: RateLimits,
    private readonly now: () => number = Date.now,
  ) {}

  allow(group: string): boolean {
    const t = this.now();
    this.#all = this.#all.filter((x) => t - x < HORA);
    const mine = (this.#byGroup.get(group) ?? []).filter((x) => t - x < HORA);
    this.#byGroup.set(group, mine);
    if (mine.length && t - mine[mine.length - 1] < this.limits.minIntervalMs) return false;
    if (mine.length >= this.limits.maxPerHourPerGroup) return false;
    return this.#all.length < this.limits.maxPerHourTotal;
  }

  record(group: string): void {
    const t = this.now();
    this.#all.push(t);
    this.#byGroup.set(group, [...(this.#byGroup.get(group) ?? []), t]);
  }
}

/** Quién puede escribir en un chat: el número contador, si está conectado (y, en un grupo, si está ahí) */
export type SenderLookup = (chatJid: string) => { connector: MessagingConnector } | { connector: null; reason: 'no_esta_en_el_grupo' | 'desconectado' };

export interface ReplyOptions {
  batchMax: number;
  /** Si en este tiempo nadie pudo confirmar (contador caído), ya no se confirma */
  maxWaitMs: number;
  /** Las confirmaciones de los recibos (GROUP_REPLIES); la bandeja de salida va siempre */
  confirmations?: boolean;
  /** La web, para los links de verificación (https://mrluks.com/v/CÓDIGO) */
  webUrl?: string;
}

/**
 * Todo lo que escribe Mister Luks, con el mismo límite de frecuencia:
 *   · las confirmaciones de lo que el worker terminó de procesar («✅ Anotado: …»),
 *     agrupando lo que llegó seguido en un solo mensaje, y los dos primeros recibos
 *     de cada quien («ya quedó registrado tu gasto, revísalo aquí» y, con el segundo,
 *     que desde ahora apaga las confirmaciones si el grupo no las tiene prendidas);
 *   · la bandeja de salida (whatsapp_outbox): la bienvenida, el saludo del
 *     grupo, la guía y las respuestas a los links. Un mensaje de la bandeja puede
 *     ser texto, imagen con pie y un documento: cuenta como uno solo. Los links
 *     /v/ y /g/ se crean justo antes de mandarlo.
 */
export class ReplyLoop {
  constructor(
    private readonly store: Store,
    private readonly limiter: RateLimiter,
    private readonly senderFor: SenderLookup,
    private readonly options: ReplyOptions,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  async tick(): Promise<{ sent: number; dropped: number; outbox: number }> {
    const { sent, dropped } = this.options.confirmations === false ? { sent: 0, dropped: 0 } : await this.#confirmaciones();
    return { sent, dropped, outbox: await this.#bandeja() };
  }

  async #confirmaciones(): Promise<{ sent: number; dropped: number }> {
    const pending = await this.store.pendingReplies(100);
    const porGrupo = new Map<string, PendingReply[]>();
    for (const r of pending) porGrupo.set(r.group_jid, [...(porGrupo.get(r.group_jid) ?? []), r]);

    let sent = 0;
    let dropped = 0;
    for (const [jid, items] of porGrupo) {
      const who = this.senderFor(jid);
      if (!who.connector) {
        // Si el contador no está en el grupo nunca va a poder responder; si está
        // caído, se espera un rato antes de dejarlo pasar
        const viejos = who.reason === 'no_esta_en_el_grupo' ? items : items.filter((r) => this.now() - Date.parse(r.received_at) > this.options.maxWaitMs);
        if (viejos.length) {
          await this.store.markReplied(viejos.map((r) => r.message_id));
          dropped += viejos.length;
        }
        continue;
      }
      if (!this.limiter.allow(jid)) continue;

      // El primer y el segundo recibo de alguien (la 660 y la 690) van en su propio mensaje, con todo
      // lo suyo que llegó seguido; lo demás, junto como siempre. Lo que quede sale en la próxima vuelta
      const [r0] = items;
      const tipo = r0.primera_vez ? 'primera' : r0.segunda_vez ? 'segunda' : 'otra';
      const deQuien = (r: PendingReply) => r.sender_person_id === r0.sender_person_id && r.account_id === r0.account_id;
      const tanda = items
        .filter((r) =>
          tipo === 'primera'
            ? r.primera_vez && deQuien(r)
            : tipo === 'segunda'
              ? !r.primera_vez && r.segunda_vez && deQuien(r)
              : !r.primera_vez && !r.segunda_vez,
        )
        .slice(0, this.options.batchMax);
      const texto =
        tipo === 'primera'
          ? formatPrimerGasto(tanda, this.options.webUrl)
          : tipo === 'segunda'
            ? formatSegundoGasto(tanda, this.options.webUrl)
            : formatReplies(tanda);
      try {
        await who.connector.send(jid, { text: texto });
        this.limiter.record(jid);
        await this.store.markReplied(tanda.map((r) => r.message_id));
        sent += tanda.length;
      } catch (e) {
        this.log.warn({ err: (e as Error).message, items: tanda.length }, 'No se pudo confirmar en el grupo; se intenta otra vez');
      }
    }
    return { sent, dropped };
  }
  /** Lo de la bandeja de salida: uno por chat en cada vuelta, el más viejo primero */
  async #bandeja(): Promise<number> {
    const pendientes = await this.store.outboxPending(50);
    const porChat = new Map<string, OutboxPending>();
    for (const o of pendientes) if (!porChat.has(o.chat_jid)) porChat.set(o.chat_jid, o);

    let enviados = 0;
    for (const [jid, o] of porChat) {
      const who = this.senderFor(jid);
      if (!who.connector) {
        // Mister Luks ya no está en ese grupo: no va a poder; si está caído, se espera (la base lo deja al día)
        if (who.reason === 'no_esta_en_el_grupo') await this.store.outboxResult(o.id, null, 'Mister Luks no está en ese chat', true);
        continue;
      }
      if (!this.limiter.allow(jid)) continue;
      try {
        let waId: string | null = null;
        let body = o.body;
        // El link de verificación se crea al mandarlo: el código nunca queda guardado
        if (o.reason === 'verify' && body?.includes(LINK_VERIFICACION)) {
          const codigo = await this.store.verifyMint(o.id);
          body = body.replace(LINK_VERIFICACION, `${this.options.webUrl ?? 'https://mrluks.com'}/v/${codigo}`);
        }
        // Igual el link /g/ para crear la cuenta del grupo; si ya la tiene, esa línea sobra
        if (body?.includes(LINK_GRUPO)) {
          const codigo = await this.store.groupLinkMint(o.id);
          body = codigo ? body.replaceAll(LINK_GRUPO, `${this.options.webUrl ?? 'https://mrluks.com'}/g/${codigo}`) : sinLineaDelLink(body);
        }
        // Un .mp4 va como GIF: se repite solo, sin sonido (Chepito, la 740). Si no se pudo, va el texto solo
        if (o.image_url && /\.mp4$/i.test(o.image_url)) {
          const gif = o.image_url;
          const conector = who.connector;
          waId = await conector.send(jid, { gifUrl: gif, caption: body ?? undefined }).catch((e: Error) => {
            if (!body) throw e;
            this.log.warn({ err: e.message, gif }, 'No se pudo mandar el GIF; va el texto solo');
            return conector.send(jid, { text: body });
          });
        } else if (o.image_url) waId = await who.connector.send(jid, { imageUrl: o.image_url, caption: body ?? undefined });
        else if (body) waId = await who.connector.send(jid, { text: body });
        if (o.document_url && o.document_name) {
          const doc = await who.connector.send(jid, { documentUrl: o.document_url, fileName: o.document_name, mimeType: 'application/pdf' });
          waId ??= doc;
        }
        this.limiter.record(jid);
        await this.store.outboxResult(o.id, waId);
        enviados += 1;
      } catch (e) {
        this.log.warn({ err: (e as Error).message, reason: o.reason }, 'No se pudo mandar un mensaje de Mister Luks; se intenta otra vez');
        await this.store.outboxResult(o.id, null, (e as Error).message);
      }
    }
    return enviados;
  }
}
