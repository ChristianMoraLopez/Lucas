/*
 * La interfaz que separa a Luks de cómo se habla con WhatsApp.
 *
 * Hoy la implementa Baileys (whatsapp/baileys.ts), que se conecta como un
 * dispositivo vinculado de un número normal. Mañana la puede implementar la
 * API oficial (WhatsApp Cloud API): recibe los mensajes por webhook y los
 * entrega con `onMessage`, y `send` llama a su endpoint de envío. Nada de
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

/** 'chat': el .zip o .txt de «Exportar chat» (fase 6): no es un recibo, se importa */
export type MediaKind = 'photo' | 'pdf' | 'chat';

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
  /** El LID (id interno de WhatsApp), si se sabe: con él se reconoce el mismo número */
  lid?: string | null;
  /** El nombre que la persona se puso en WhatsApp */
  name: string | null;
  /** Su usuario de WhatsApp («juanes», sin «@»), si tiene y WhatsApp lo manda */
  username?: string | null;
}

/** Un grupo, o (solo para el contador) un chat privado con Mister Luks */
export type ChatKind = 'grupo' | 'privado';

/** Un mensaje de un grupo o de un chat privado, ya sin nada propio de Baileys */
export interface IncomingMessage {
  sessionId: string;
  chatId: string;
  chatKind: ChatKind;
  chatName: string | null;
  messageId: string;
  sender: Sender;
  sentAt: Date;
  /** Texto del mensaje o pie de la foto/PDF */
  text: string | null;
  media: IncomingMedia | null;
  /** Lo mandó el mismo número de la sesión */
  fromMe: boolean;
  /** A quiénes menciona (@…): números sin «+» o LID, sin el dominio */
  mentions?: string[];
  /** Si responde (cita) un mensaje: el número o LID de quien lo escribió */
  quotedFrom?: string | null;
  /** Y el id de ese mensaje (para saber a cuál responde: la lista de ítems, por ejemplo) */
  quotedId?: string | null;
  /** Una tarjeta de contacto (solo por privado): a quién le cobra Chepito (migración 710) */
  contacto?: { nombre: string | null; telefono: string | null } | null;
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
  /** Su usuario de WhatsApp («juanes», sin «@»), si tiene */
  username?: string | null;
  admin: boolean;
}

/**
 * Un grupo, sin quiénes están: de los grupos de un WhatsApp vinculado que no
 * son de una cuenta solo se guarda el nombre. Los integrantes se piden aparte
 * (MessagingConnector.members) cuando el grupo es de una cuenta o lo lee el
 * contador (migración 280).
 */
export interface GroupInfo {
  chatId: string;
  name: string | null;
  participants: number | null;
}

/** Lo que manda Mister Luks: un texto, o una imagen o un GIF (con pie) o un documento por URL */
export type Outgoing =
  | { text: string }
  | { imageUrl: string; caption?: string }
  | { gifUrl: string; caption?: string }
  | { documentUrl: string; fileName: string; mimeType: string; caption?: string };

/** Qué pasó al entrar a un grupo con su link de invitación */
export type JoinResult = { status: 'joined' | 'pending' | 'already'; chatId: string; name: string | null } | { status: 'invalid' };

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
  /** Quiénes están en un grupo: con esto las personas de la cuenta son las del grupo */
  members(chatId: string): Promise<GroupMember[]>;
  /** Manda un mensaje y devuelve su id en WhatsApp */
  send(chatId: string, message: Outgoing): Promise<string | null>;
  /** Entra a un grupo con el código de su link (chat.whatsapp.com/CÓDIGO) */
  joinGroup(inviteCode: string): Promise<JoinResult>;
}

export type ConnectorFactory = (session: SessionInfo, handlers: ConnectorHandlers) => MessagingConnector;
