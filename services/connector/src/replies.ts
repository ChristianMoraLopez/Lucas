import type { MessagingConnector } from './connector.js';
import type { Logger } from './log.js';
import type { Store } from './store.js';
import { formatReplies, type PendingReply } from './text.js';

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

/** Quién puede escribir en un grupo: el número contador, si está ahí y conectado */
export type SenderLookup = (groupJid: string) => { connector: MessagingConnector } | { connector: null; reason: 'no_esta_en_el_grupo' | 'desconectado' };

export interface ReplyOptions {
  batchMax: number;
  /** Si en este tiempo nadie pudo confirmar (contador caído), ya no se confirma */
  maxWaitMs: number;
}

/**
 * Cuenta en el grupo lo que el worker terminó de procesar («Anotado: …»),
 * agrupando lo que llegó seguido en un solo mensaje.
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

  async tick(): Promise<{ sent: number; dropped: number }> {
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

      const tanda = items.slice(0, this.options.batchMax);
      try {
        await who.connector.sendText(jid, formatReplies(tanda));
        this.limiter.record(jid);
        await this.store.markReplied(tanda.map((r) => r.message_id));
        sent += tanda.length;
      } catch (e) {
        this.log.warn({ err: (e as Error).message, items: tanda.length }, 'No se pudo confirmar en el grupo; se intenta otra vez');
      }
    }
    return { sent, dropped };
  }
}
