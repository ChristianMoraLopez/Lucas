/*
 * La interfaz que separa a Luks de cómo se habla con WhatsApp.
 *
 * Hoy la implementa Baileys (whatsapp/baileys.ts), que se conecta como un
 * dispositivo vinculado de un número normal. Mañana la puede implementar la
 * API oficial (WhatsApp Cloud API): recibe los mensajes por webhook y los
 * entrega con `onMessage`, y `sendText` llama a su endpoint de envío. Nada de
 * la ingesta, el enlace de grupos ni las confirmaciones sabe cuál de las dos
 * está detrás.
 */

export type SessionKind = 'contador' | 'personal';

/** Una sesión tal como la guarda la base (whatsapp_connections) */
export interface SessionInfo {
  id: string;
  kind: SessionKind;
  ownerId: string | null;
  label: string | null;
  /** Si viene, se vincula con un código de 8 letras en vez del QR */
  pairingPhone: string | null;
}

export type MediaKind = 'photo' | 'pdf';

export interface IncomingMedia {
  kind: MediaKind;
  mimeType: string;
  fileName: string | null;
  /** Lo que dice WhatsApp que pesa (para no bajar archivos enormes) */
  sizeBytes: number | null;
  download(): Promise<Buffer>;
}

export interface Sender {
  /** Número sin «+» (573001234567) o «lid:…» si WhatsApp no deja ver el número */
  id: string | null;
  phone: string | null;
  /** El nombre que la persona se puso en WhatsApp */
  name: string | null;
}

/** Un mensaje de un grupo, ya sin nada propio de Baileys */
export interface IncomingMessage {
  sessionId: string;
  chatId: string;
  chatName: string | null;
  messageId: string;
  sender: Sender;
  sentAt: Date;
  /** Texto del mensaje o pie de la foto/PDF */
  text: string | null;
  media: IncomingMedia | null;
  /** Lo mandó el mismo número de la sesión */
  fromMe: boolean;
}

/** Alguien que está en el grupo */
export interface GroupMember {
  /** Número sin «+» (573001234567) o «lid:…» si WhatsApp no deja ver el número */
  id: string;
  phone: string | null;
  /** El LID (id interno de WhatsApp), para reconocer a quien escribió antes con él */
  lid: string | null;
  /** El nombre que la persona se puso en WhatsApp (o como la tiene guardada quien vinculó) */
  name: string | null;
  admin: boolean;
}

export interface GroupInfo {
  chatId: string;
  name: string | null;
  participants: number | null;
  /** Quiénes están: con esto las personas de la cuenta son las del grupo */
  members?: GroupMember[];
}

export type SessionState =
  | { status: 'connecting' }
  | { status: 'pairing'; qr: string | null; code: string | null; expiresAt: Date }
  | { status: 'connected'; jid: string | null; lid: string | null; phone: string | null }
  /** loggedOut: la sesión ya no sirve (la cerraron desde el teléfono o venció el QR) */
  | { status: 'closed'; loggedOut: boolean; reason: string };

export interface ConnectorHandlers {
  onState(state: SessionState): Promise<void>;
  onMessage(message: IncomingMessage): Promise<void>;
  onGroupJoined(group: GroupInfo): Promise<void>;
  onGroupLeft(chatId: string): Promise<void>;
}

export interface MessagingConnector {
  readonly session: SessionInfo;
  /** Conecta (y se reconecta solo si se cae, hasta que la cierren) */
  start(): Promise<void>;
  /** Deja de escuchar sin desvincular: al volver a arrancar sigue la misma sesión */
  stop(): Promise<void>;
  /** Desvincula el dispositivo: para volver hay que escanear otra vez */
  logout(): Promise<void>;
  isConnected(): boolean;
  /** Grupos donde está ahora (para saber quién puede responder en cada uno) */
  groups(): ReadonlySet<string>;
  sendText(chatId: string, text: string): Promise<void>;
}

export type ConnectorFactory = (session: SessionInfo, handlers: ConnectorHandlers) => MessagingConnector;
