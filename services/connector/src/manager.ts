import type { ConnectorFactory, MessagingConnector, SessionInfo, SessionState } from './connector.js';
import type { Ingestor } from './ingest.js';
import type { Logger } from './log.js';
import type { SenderLookup } from './replies.js';
import type { SessionRow, Store } from './store.js';

/** A quién avisar cuando una sesión se cierra del todo (Sentry, logs) */
export type Alert = (message: string, extra: Record<string, unknown>) => void;

interface Running {
  info: SessionInfo;
  conn: MessagingConnector;
  state: SessionState['status'];
  since: Date;
}

export interface SessionSnapshot {
  id: string;
  kind: SessionInfo['kind'];
  state: SessionState['status'];
  since: string;
  groups: number;
}

/**
 * Las sesiones de WhatsApp que tiene que haber corriendo según la base: el
 * número contador y las vinculaciones personales. Cada `sync` arranca las
 * nuevas, cierra las que pidieron cerrar y marca el latido de las conectadas.
 */
export class SessionManager {
  readonly #running = new Map<string, Running>();

  constructor(
    private readonly store: Store,
    private readonly factory: ConnectorFactory,
    private readonly ingestor: Ingestor,
    private readonly log: Logger,
    private readonly alert: Alert,
  ) {}

  async sync(): Promise<void> {
    const rows = await this.store.sessions();
    const pedidas = new Set(rows.map((r) => r.id));

    for (const row of rows) {
      if (row.stop_requested) {
        await this.#close(row, 'Se desvinculó desde Luks');
      } else if (!this.#running.has(row.id)) {
        await this.#start(row);
      } else if (this.#otroNumero(row)) {
        // Pidieron código en vez de QR (o cambiaron el número) mientras se vinculaba: se empieza de nuevo
        await this.#running.get(row.id)?.conn.stop();
        this.#running.delete(row.id);
        await this.#start(row);
      }
    }
    // Las que ya no están pedidas (las desconectaron desde la base) se apagan sin desvincular
    for (const [id, r] of this.#running) {
      if (!pedidas.has(id)) {
        await r.conn.stop();
        this.#running.delete(id);
      }
    }
    await this.store.heartbeat([...this.#running.values()].filter((r) => r.state === 'connected').map((r) => r.info.id));
  }

  #otroNumero(row: SessionRow) {
    const r = this.#running.get(row.id);
    return Boolean(r && r.state !== 'connected' && (r.info.pairingPhone ?? null) !== (row.pairing_phone ?? null));
  }

  async #start(row: SessionRow) {
    const info: SessionInfo = { id: row.id, kind: row.kind, ownerId: row.owner_id, label: row.label, pairingPhone: row.pairing_phone };
    const entry = { info, state: 'connecting', since: new Date() } as Running;
    entry.conn = this.factory(info, {
      onState: (s) => this.#onState(entry, s),
      onMessage: async (m) => {
        const outcome = await this.ingestor.onMessage(info, entry.conn, m);
        this.log.debug({ session: info.id.slice(0, 8), msg_id: m.messageId, outcome }, 'Mensaje');
      },
      onGroupJoined: (g) => this.ingestor.onGroupJoined(info, entry.conn, g),
      onGroupLeft: (jid) => this.ingestor.onGroupLeft(jid),
    });
    this.#running.set(row.id, entry);
    this.log.info(
      { session: row.id.slice(0, 8), kind: row.kind, has_creds: row.has_creds },
      row.has_creds ? 'Arrancando sesión' : 'Sesión nueva: esperando que la vinculen',
    );
    try {
      await entry.conn.start();
    } catch (e) {
      // Se reintenta en el próximo sync
      this.#running.delete(row.id);
      this.log.error({ session: row.id.slice(0, 8), err: (e as Error).message }, 'No se pudo arrancar la sesión');
    }
  }

  async #close(row: SessionRow, reason: string) {
    const r = this.#running.get(row.id);
    if (r) {
      await r.conn.logout();
      this.#running.delete(row.id);
    }
    await this.store.clearSession(row.id, reason);
    this.log.info({ session: row.id.slice(0, 8), kind: row.kind }, 'Sesión desvinculada a pedido');
  }

  async #onState(entry: Running, s: SessionState) {
    entry.state = s.status;
    entry.since = new Date();
    const id = entry.info.id;
    switch (s.status) {
      case 'connecting':
        await this.store.setStatus(id, 'connecting');
        break;
      case 'pairing':
        await this.store.setPairing(id, s.qr, s.code, s.expiresAt);
        break;
      case 'connected':
        await this.store.setStatus(id, 'connected', { jid: s.jid, lid: s.lid, phone: s.phone });
        break;
      case 'closed':
        if (s.loggedOut) {
          this.#running.delete(id);
          await this.store.clearSession(id, s.reason);
          this.alert(entry.info.kind === 'contador' ? 'Se cerró la sesión del número contador' : 'Se cerró una vinculación personal de WhatsApp', {
            session: id,
            kind: entry.info.kind,
            reason: s.reason,
          });
        } else {
          // El código o el QR de la conexión que se cayó ya no sirven: la web no los muestra hasta que llegue uno nuevo
          await this.store.setPairing(id, null, null, null);
          await this.store.setStatus(id, 'connecting');
          this.log.warn({ session: id.slice(0, 8), reason: s.reason }, 'Sesión caída: reconectando');
        }
        break;
    }
  }

  /** El número contador, si está conectado y en ese grupo (solo él escribe en los grupos) */
  senderFor: SenderLookup = (groupJid) => {
    const contador = [...this.#running.values()].find((r) => r.info.kind === 'contador' && r.state === 'connected' && r.conn.isConnected());
    if (!contador) return { connector: null, reason: 'desconectado' };
    if (!contador.conn.groups().has(groupJid)) return { connector: null, reason: 'no_esta_en_el_grupo' };
    return { connector: contador.conn };
  };

  snapshot(): SessionSnapshot[] {
    return [...this.#running.values()].map((r) => ({
      id: r.info.id,
      kind: r.info.kind,
      state: r.state,
      since: r.since.toISOString(),
      groups: r.conn.groups().size,
    }));
  }

  /** Al apagar el contenedor: se cierran los sockets sin desvincular */
  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.#running.values()].map((r) => r.conn.stop()));
    this.#running.clear();
  }
}
