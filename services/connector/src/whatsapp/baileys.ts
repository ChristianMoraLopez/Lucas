import makeWASocket, {
  type AuthenticationCreds,
  areJidsSameUser,
  Browsers,
  type ConnectionState,
  type Contact,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  type GroupMetadata,
  jidDecode,
  makeCacheableSignalKeyStore,
  proto,
  type WAMessage,
  type WASocket,
} from 'baileys';
import type { ConnectorHandlers, GroupInfo, MessagingConnector, SessionInfo } from '../connector.js';
import type { SessionCipher } from '../crypto.js';
import type { Logger } from '../log.js';
import type { Store } from '../store.js';
import { useDbAuthState } from './auth-state.js';
import { type Contactos, gruposCon, type Me, membersOf, normalizeMessage, recordarNombres } from './normalize.js';

/*
 * MessagingConnector con Baileys: Luks entra como «dispositivo vinculado» de
 * un número de WhatsApp (el contador, o el de alguien que vincula el suyo).
 *
 *   · Vincular: QR, o código de 8 letras si la sesión trae número. Cada
 *     conexión pide su propio código: el de una conexión que ya se cerró no
 *     sirve, y WhatsApp cierra la conexión si nadie vincula en ~2,5 min.
 *   · Si se cae, se reconecta solo con espera creciente (2 s … 1 min).
 *   · Si la cierran desde el teléfono (o no la vinculan a tiempo), avisa con
 *     { status: 'closed', loggedOut: true } y no insiste.
 */

const PAIRING_TTL_MS = 60_000;
/** Cuántas veces se renueva el QR sin que nadie lo escanee antes de rendirse (~3 min) */
const MAX_UNPAIRED_CLOSES = 3;
const MAX_BACKOFF_MS = 60_000;
/** Al saber un nombre nuevo se espera un poco, para juntar los que llegan seguidos… */
const NOMBRES_ESPERA_MS = 15_000;
/** …y un grupo se vuelve a mandar por eso como mucho cada 10 min */
const NOMBRES_CADA_MS = 10 * 60_000;

export interface BaileysDeps {
  store: Store;
  cipher: SessionCipher;
  log: Logger;
}

const usuario = (jid: string | null | undefined) => (jid ? (jidDecode(jid)?.user ?? null) : null);
const statusCode = (err: unknown) => (err as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;

/**
 * Ya quedó vinculada, por QR o por código. Ojo: `registered` solo lo marca el
 * código; una sesión vinculada por QR lo deja en false para siempre.
 */
export const vinculada = (creds: AuthenticationCreds) => creds.registered || Boolean(creds.account);

/**
 * Borra lo que dejó un código de vinculación que nadie usó. Pedir el código
 * guarda `me` con el número; si la conexión se cierra antes de vincular y se
 * reconecta con eso, Baileys entra como si ya estuviera vinculada, WhatsApp la
 * rechaza y la sesión se pierde. Devuelve si había algo que borrar.
 */
export function olvidarEmparejamiento(creds: AuthenticationCreds): boolean {
  if (vinculada(creds) || (!creds.me && !creds.pairingCode)) return false;
  creds.me = undefined;
  creds.pairingCode = undefined;
  return true;
}

export class BaileysConnector implements MessagingConnector {
  #sock: WASocket | null = null;
  #open = false;
  #stopped = false;
  #retry = 0;
  #unpairedCloses = 0;
  #pairingCode: string | null = null;
  #timer: NodeJS.Timeout | null = null;
  #groups = new Map<string, GroupMetadata>();
  /** Nombres de la gente (los que se pusieron en WhatsApp o como los guardó quien vinculó) */
  #contactos: Contactos = new Map();
  /** Grupos donde alguien tiene un nombre nuevo: se vuelven a mandar para que la cuenta lo vea */
  #porNombres = new Set<string>();
  #nombresEnviados = new Map<string, number>();
  #relojNombres: NodeJS.Timeout | null = null;
  /** Los mensajes de una sesión se procesan de a uno (las fotos se bajan en orden) */
  #cola: Promise<void> = Promise.resolve();
  readonly #log: Logger;

  constructor(
    readonly session: SessionInfo,
    private readonly handlers: ConnectorHandlers,
    private readonly deps: BaileysDeps,
  ) {
    this.#log = deps.log.child({ session: session.id.slice(0, 8), kind: session.kind });
  }

  isConnected() {
    return this.#open;
  }

  groups(): ReadonlySet<string> {
    return new Set(this.#groups.keys());
  }

  async start() {
    this.#stopped = false;
    await this.#connect();
  }

  async stop() {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#pararNombres();
    this.#open = false;
    await this.#sock?.end(undefined).catch(() => {});
    this.#sock = null;
  }

  async logout() {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#pararNombres();
    try {
      await this.#sock?.logout('Luks');
    } catch {
      // ya estaba cerrada
    }
    this.#open = false;
    await this.#sock?.end(undefined).catch(() => {});
    this.#sock = null;
  }

  async sendText(chatId: string, text: string) {
    if (!this.#sock || !this.#open) throw new Error('La sesión no está conectada');
    await this.#sock.sendMessage(chatId, { text });
  }

  #me(): Me {
    const u = this.#sock?.user;
    return { phone: usuario(u?.id), lid: usuario(u?.lid), name: u?.name ?? u?.notify ?? null };
  }

  async #connect() {
    const { state, saveCreds } = await useDbAuthState(this.deps.store, this.deps.cipher, this.session.id);
    // Sin vincular todavía: arranca sin el código de la conexión anterior y pide uno nuevo
    this.#pairingCode = null;
    if (olvidarEmparejamiento(state.creds)) await saveCreds();
    // Baileys habla mucho; solo sus advertencias y errores llegan a los logs
    const logger = this.#log.child({ lib: 'baileys' }, { level: 'warn' });
    let version: [number, number, number] | undefined;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      // sin internet a GitHub: Baileys usa la versión que trae
    }

    const sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      logger,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      // Del historial solo los nombres que la gente se puso en WhatsApp (llegan
      // una vez, al vincular): ningún mensaje viejo
      shouldSyncHistoryMessage: ({ syncType }) => syncType === proto.HistorySync.HistorySyncType.PUSH_NAME,
      generateHighQualityLinkPreview: false,
      cachedGroupMetadata: async (jid) => this.#groups.get(jid),
      getMessage: async () => undefined,
    });
    this.#sock = sock;

    sock.ev.on('creds.update', () => {
      saveCreds().catch((e) => this.#log.error({ err: (e as Error).message }, 'No se pudieron guardar las credenciales'));
    });
    sock.ev.on('connection.update', (u) => {
      this.#onConnection(u, sock).catch((e) => this.#log.error({ err: (e as Error).message }, 'Error al cambiar de estado'));
    });
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      // notify: llegó ahora · append: lo que llegó mientras estaba desconectado
      if (type !== 'notify' && type !== 'append') return;
      for (const raw of messages) this.#encolar(() => this.#onRaw(raw, sock));
    });
    // Los nombres: el del perfil llega con cada mensaje; al vincular, el teléfono
    // manda los que conoce; y los contactos guardados de quien vinculó
    const recordar = (cs: Partial<Contact>[]) => {
      const cambiaron = recordarNombres(this.#contactos, cs);
      for (const jid of gruposCon(this.#groups.values(), cambiaron)) this.#porNombres.add(jid);
      this.#programarNombres(sock);
    };
    sock.ev.on('contacts.upsert', recordar);
    sock.ev.on('contacts.update', recordar);
    sock.ev.on('messaging-history.set', ({ contacts }) => recordar(contacts));
    sock.ev.on('groups.upsert', (grupos) => {
      for (const g of grupos) {
        this.#groups.set(g.id, g);
        this.#encolar(async () => this.handlers.onGroupJoined(await this.#info(g, sock)));
      }
    });
    sock.ev.on('groups.update', (cambios) => {
      for (const c of cambios) {
        const g = c.id ? this.#groups.get(c.id) : undefined;
        if (g && c.subject) {
          g.subject = c.subject;
          this.#encolar(async () => this.handlers.onGroupJoined(await this.#info(g, sock)));
        }
      }
    });
    sock.ev.on('group-participants.update', (ev) => {
      const me = sock.user;
      const soyYo = ev.participants.some((p) => {
        const id = typeof p === 'string' ? p : p.id;
        return areJidsSameUser(id, me?.id) || areJidsSameUser(id, me?.lid);
      });
      if (soyYo && ev.action === 'remove') {
        this.#groups.delete(ev.id);
        this.#encolar(() => this.handlers.onGroupLeft(ev.id));
        return;
      }
      // Agregaron a Luks, o alguien entró, salió o cambió en un grupo donde está:
      // se vuelve a leer el grupo para que las personas de la cuenta sean las del grupo
      if ((soyYo && ev.action !== 'add') || (!soyYo && !this.#groups.has(ev.id))) return;
      this.#encolar(async () => {
        const g = await sock.groupMetadata(ev.id);
        this.#groups.set(g.id, g);
        await this.handlers.onGroupJoined(await this.#info(g, sock));
      });
    });
  }

  /** El grupo con sus integrantes; si de alguien solo se ve el LID, se intenta saber su número */
  async #info(g: GroupMetadata, sock: WASocket): Promise<GroupInfo> {
    const members = membersOf(g, this.#contactos);
    for (const m of members) {
      if (m.phone || !m.lid) continue;
      try {
        const phone = usuario(await sock.signalRepository.lidMapping.getPNForLID(`${m.lid}@lid`));
        if (phone) {
          m.phone = phone;
          m.id = phone;
        }
      } catch {
        // se queda con el LID
      }
    }
    return { chatId: g.id, name: g.subject ?? null, participants: g.size ?? g.participants?.length ?? null, members };
  }

  /** Manda otra vez (con espera y sin repetir seguido) los grupos donde alguien tiene un nombre nuevo */
  #programarNombres(sock: WASocket) {
    if (this.#relojNombres || this.#porNombres.size === 0) return;
    const ahora = Date.now();
    let cuando = Number.POSITIVE_INFINITY;
    for (const jid of this.#porNombres) cuando = Math.min(cuando, Math.max(ahora + NOMBRES_ESPERA_MS, (this.#nombresEnviados.get(jid) ?? 0) + NOMBRES_CADA_MS));
    this.#relojNombres = setTimeout(() => {
      this.#relojNombres = null;
      this.#mandarNombres(sock);
    }, cuando - ahora);
    this.#relojNombres.unref?.();
  }

  #mandarNombres(sock: WASocket) {
    // Se reconectó: al conectar ya se mandaron todos los grupos con los nombres que había
    if (this.#sock !== sock || !this.#open) {
      this.#porNombres.clear();
      return;
    }
    const ahora = Date.now();
    for (const jid of [...this.#porNombres]) {
      if ((this.#nombresEnviados.get(jid) ?? 0) + NOMBRES_CADA_MS > ahora) continue;
      this.#porNombres.delete(jid);
      this.#nombresEnviados.set(jid, ahora);
      this.#encolar(async () => {
        const g = this.#groups.get(jid);
        if (g) await this.handlers.onGroupJoined(await this.#info(g, sock));
      });
    }
    this.#programarNombres(sock);
  }

  #pararNombres() {
    if (this.#relojNombres) clearTimeout(this.#relojNombres);
    this.#relojNombres = null;
    this.#porNombres.clear();
  }

  #encolar(tarea: () => Promise<void>) {
    this.#cola = this.#cola.then(tarea).catch((e) => this.#log.error({ err: (e as Error).message }, 'Error procesando un evento de WhatsApp'));
  }

  async #onRaw(raw: WAMessage, sock: WASocket) {
    const m = normalizeMessage(raw, this.session.id, this.#me(), (r) =>
      downloadMediaMessage(r, 'buffer', {}, { logger: this.#log, reuploadRequest: sock.updateMediaMessage }),
    );
    if (!m) return;
    // Si WhatsApp solo mostró el LID, se intenta saber el número
    if (!m.sender.phone && m.sender.id?.startsWith('lid:')) {
      try {
        const pn = await sock.signalRepository.lidMapping.getPNForLID(`${m.sender.id.slice(4)}@lid`);
        const phone = usuario(pn);
        if (phone) m.sender = { ...m.sender, id: phone, phone };
      } catch {
        // se queda con el LID
      }
    }
    m.chatName = this.#groups.get(m.chatId)?.subject ?? null;
    await this.handlers.onMessage(m);
  }

  async #onConnection(u: Partial<ConnectionState>, sock: WASocket) {
    if (u.qr) {
      if (this.session.pairingPhone && !vinculada(sock.authState.creds) && !this.#pairingCode) {
        try {
          this.#pairingCode = await sock.requestPairingCode(this.session.pairingPhone);
        } catch (e) {
          this.#log.warn({ err: (e as Error).message }, 'No se pudo pedir el código de vinculación; queda el QR');
        }
      }
      await this.handlers.onState({ status: 'pairing', qr: u.qr, code: this.#pairingCode, expiresAt: new Date(Date.now() + PAIRING_TTL_MS) });
    }

    if (u.connection === 'open') {
      this.#open = true;
      this.#retry = 0;
      this.#unpairedCloses = 0;
      this.#pairingCode = null;
      const me = this.#me();
      this.#log.info({ phone: me.phone ? `${me.phone.slice(0, 2)}•••${me.phone.slice(-4)}` : null }, 'Sesión conectada');
      await this.handlers.onState({ status: 'connected', jid: sock.user?.id ?? null, lid: sock.user?.lid ?? null, phone: me.phone });
      try {
        const todos = await sock.groupFetchAllParticipating();
        this.#groups = new Map(Object.entries(todos));
        for (const g of this.#groups.values()) await this.handlers.onGroupJoined(await this.#info(g, sock));
      } catch (e) {
        this.#log.warn({ err: (e as Error).message }, 'No se pudieron leer los grupos');
      }
      return;
    }

    if (u.connection !== 'close') return;
    this.#open = false;
    if (this.#stopped) return;

    const code = statusCode(u.lastDisconnect?.error);
    if (code === DisconnectReason.loggedOut || code === DisconnectReason.forbidden) {
      await this.handlers.onState({ status: 'closed', loggedOut: true, reason: 'Se cerró la sesión desde el teléfono (o WhatsApp la desvinculó)' });
      return;
    }
    if (code === DisconnectReason.restartRequired) {
      // Normal justo después de vincular
      this.#schedule(0);
      return;
    }
    if (!vinculada(sock.authState.creds)) {
      this.#unpairedCloses += 1;
      if (this.#unpairedCloses >= MAX_UNPAIRED_CLOSES) {
        await this.handlers.onState({ status: 'closed', loggedOut: true, reason: 'No se vinculó a tiempo. Pide un código nuevo.' });
        return;
      }
    }
    const reason = code === DisconnectReason.connectionReplaced ? 'Otra conexión tomó esta sesión' : `Se cayó la conexión (${code ?? 'sin código'})`;
    await this.handlers.onState({ status: 'closed', loggedOut: false, reason });
    // Si otra instancia tomó la sesión, se espera más para no pelearla
    this.#schedule(code === DisconnectReason.connectionReplaced ? MAX_BACKOFF_MS * 5 : Math.min(MAX_BACKOFF_MS, 2000 * 2 ** this.#retry));
    this.#retry += 1;
  }

  #schedule(ms: number) {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      if (this.#stopped) return;
      this.#connect().catch((e) => {
        this.#log.error({ err: (e as Error).message }, 'No se pudo reconectar');
        this.#schedule(Math.min(MAX_BACKOFF_MS, 2000 * 2 ** this.#retry++));
      });
    }, ms);
  }
}
