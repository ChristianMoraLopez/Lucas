import type { GroupInfo, IncomingMessage, MessagingConnector, SessionInfo } from './connector.js';
import { type Logger, maskWaId } from './log.js';
import { type MediaLimits, MediaRejected, prepareMedia } from './media.js';
import type { RateLimiter } from './replies.js';
import type { Store } from './store.js';
import { esMensajeDeLuks, looksLikeExpense, MSG, parseLinkCommand } from './text.js';

/** Qué pasó con un mensaje (va a los logs; sirve para las pruebas) */
export type Outcome =
  | 'propio'
  | 'de_luks'
  | 'charla'
  | 'enlazado'
  | 'codigo_invalido'
  | 'otra_cuenta'
  | 'guardado'
  | 'archivo_muy_pesado'
  | 'archivo_rechazado'
  | `ignorado:${string}`;

export interface IngestLimits extends MediaLimits {
  maxDownloadBytes: number;
}

const mes = (d: Date) => d.toISOString().slice(0, 7);
const nombreSeguro = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);

/**
 * Lo que entra de los grupos. Solo los grupos enlazados a una cuenta activa
 * llegan a la base, y de ellos solo fotos, PDFs y mensajes con montos.
 */
export class Ingestor {
  constructor(
    private readonly store: Store,
    private readonly limits: IngestLimits,
    private readonly limiter: RateLimiter,
    private readonly log: Logger,
  ) {}

  /** Luks quedó en un grupo (lo agregaron, o ya estaba al conectar) */
  async onGroupJoined(session: SessionInfo, connector: MessagingConnector, group: GroupInfo): Promise<void> {
    const g = await this.store.upsertGroup(session.id, group.chatId, group.name, group.participants);
    // Quiénes están: si el grupo ya es de una cuenta, cada uno queda como persona de ella
    if (group.members?.length) {
      const r = await this.store.setGroupMembers(g.group_id, group.members);
      if (r.people_added) this.log.info({ group: g.group_id, members: r.members, added: r.people_added }, 'Personas nuevas desde el grupo');
    }
    // Solo el número contador escribe; una sesión personal es el WhatsApp de alguien
    if (g.say_hello && session.kind === 'contador' && this.limiter.allow(group.chatId)) {
      try {
        await connector.sendText(group.chatId, MSG.hello);
        this.limiter.record(group.chatId);
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, 'No se pudo saludar en el grupo');
      }
      await this.store.markHello(g.group_id);
    }
  }

  async onGroupLeft(chatId: string): Promise<void> {
    await this.store.groupLeft(chatId);
  }

  async onMessage(session: SessionInfo, connector: MessagingConnector, m: IncomingMessage): Promise<Outcome> {
    // El contador no se lee a sí mismo; en una sesión personal lo propio sí cuenta (es quien paga)
    if (m.fromMe && session.kind === 'contador') return 'propio';

    const code = parseLinkCommand(m.text);
    if (code) return this.#link(session, connector, m, code);

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
    if (session.kind === 'contador' && this.limiter.allow(m.chatId)) {
      const text = r.ok
        ? r.already
          ? MSG.alreadyLinked(r.account_name, r.language ?? 'es')
          : MSG.linked(r.account_name, r.members, r.language ?? 'es')
        : r.error === 'otra_cuenta'
          ? MSG.otherAccount
          : MSG.badCode;
      try {
        await connector.sendText(m.chatId, text);
        this.limiter.record(m.chatId);
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, 'No se pudo responder en el grupo');
      }
    }
    return r.ok ? 'enlazado' : r.error;
  }
}
