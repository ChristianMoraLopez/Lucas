import { type Contact, type GroupMetadata, getContentType, isJidGroup, isLidUser, isPnUser, jidDecode, normalizeMessageContent, type WAMessage } from 'baileys';
import type { ChatKind, GroupMember, IncomingMedia, IncomingMessage, Sender } from '../connector.js';

/* Un mensaje de Baileys → IncomingMessage (sin nada propio de Baileys). */

export interface Me {
  /** Número de la sesión, sin «+» */
  phone: string | null;
  lid: string | null;
  name: string | null;
}

export type Downloader = (raw: WAMessage) => Promise<Buffer>;

const usuario = (jid: string | null | undefined) => (jid ? (jidDecode(jid)?.user ?? null) : null);

/** El usuario de WhatsApp («@Juanes_99» → «juanes_99»); null si no es uno */
export function usuarioDeWhatsapp(u: string | null | undefined): string | null {
  const v = u?.trim().replace(/^@/, '').toLowerCase();
  return v && /^[a-z0-9._]{3,35}$/.test(v) ? v : null;
}

/** Long de protobuf, número o nada → número */
function numero(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v && 'toNumber' in v && typeof (v as { toNumber: unknown }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Quién mandó el mensaje. En los grupos nuevos WhatsApp identifica a la gente
 * con un LID (un id que no es el número); cuando viene el número también
 * (participantAlt), se prefiere el número. Si solo hay LID queda «lid:…».
 */
export function senderOf(raw: WAMessage, me: Me): Sender {
  if (raw.key.fromMe) {
    return { id: me.phone ?? (me.lid ? `lid:${me.lid}` : null), phone: me.phone, name: me.name ?? raw.pushName ?? null };
  }
  // En un chat privado quien escribe es el chat mismo
  const privado = !isJidGroup(raw.key.remoteJid ?? undefined);
  const jids = (privado ? [raw.key.remoteJid, raw.key.remoteJidAlt] : [raw.key.participant, raw.key.participantAlt, raw.participant]).filter((j): j is string =>
    Boolean(j),
  );
  const phone = usuario(jids.find((j) => isPnUser(j)));
  const lid = usuario(jids.find((j) => isLidUser(j)));
  const username = usuarioDeWhatsapp(privado ? raw.key.remoteJidUsername : raw.key.participantUsername);
  return { id: phone ?? (lid ? `lid:${lid}` : null), phone, lid, name: raw.pushName?.trim() || null, ...(username ? { username } : {}) };
}

/** Nombres que se conocen de cada número o LID (eventos contacts.* de Baileys) */
export type Contactos = Map<string, { notify?: string | null; name?: string | null; username?: string | null }>;

/**
 * Guarda los nombres que llegan (cada mensaje trae el nombre del perfil de
 * quien lo manda; al vincular, el teléfono manda los que conoce; y los
 * contactos guardados) y dice de qué números o LID cambió el nombre.
 */
export function recordarNombres(contactos: Contactos, cs: Partial<Contact>[]): Set<string> {
  const cambiaron = new Set<string>();
  for (const c of cs) {
    const notify = c.notify?.trim() || null;
    const name = c.name?.trim() || null;
    const username = usuarioDeWhatsapp(c.username);
    if (!notify && !name && !username) continue;
    for (const jid of [c.id, c.lid, c.phoneNumber]) {
      const u = usuario(jid);
      if (!u) continue;
      const antes = contactos.get(u);
      const ahora = { notify: notify ?? antes?.notify ?? null, name: name ?? antes?.name ?? null, username: username ?? antes?.username ?? null };
      if (ahora.notify !== (antes?.notify ?? null) || ahora.name !== (antes?.name ?? null) || ahora.username !== (antes?.username ?? null)) cambiaron.add(u);
      contactos.set(u, ahora);
    }
  }
  return cambiaron;
}

/** Los grupos donde está alguno de esos números o LID */
export function gruposCon(grupos: Iterable<GroupMetadata>, usuarios: ReadonlySet<string>): string[] {
  if (usuarios.size === 0) return [];
  const out: string[] = [];
  for (const g of grupos) {
    const esta = g.participants?.some((p) =>
      [p.id, p.lid, p.phoneNumber].some((j) => {
        const u = usuario(j);
        return u !== null && usuarios.has(u);
      }),
    );
    if (esta) out.push(g.id);
  }
  return out;
}

/**
 * Los integrantes de un grupo, identificados igual que quien escribe: el
 * número si se ve, si no «lid:…». El nombre: el que cada quien se puso en
 * WhatsApp; si no se sabe, como lo tiene guardado quien vinculó.
 */
export function membersOf(g: GroupMetadata, contactos: Contactos = new Map()): GroupMember[] {
  const out = new Map<string, GroupMember>();
  for (const p of g.participants ?? []) {
    const phone = usuario([p.phoneNumber, p.id].find((j) => j && isPnUser(j)));
    const lid = usuario([p.lid, p.id].find((j) => j && isLidUser(j)));
    const id = phone ?? (lid ? `lid:${lid}` : null);
    if (!id) continue;
    const c = (phone && contactos.get(phone)) || (lid && contactos.get(lid)) || undefined;
    const name = [p.notify, c?.notify, p.name, c?.name, p.verifiedName].map((n) => n?.trim()).find(Boolean) ?? null;
    const username = usuarioDeWhatsapp(p.username) ?? usuarioDeWhatsapp(c?.username);
    // Si viene repetido, se queda con lo que se sepa de cada vez
    const antes = out.get(id);
    out.set(id, {
      id,
      phone,
      lid: lid ?? antes?.lid ?? null,
      name: name ?? antes?.name ?? null,
      username: username ?? antes?.username ?? null,
      admin: Boolean(p.admin) || Boolean(antes?.admin),
    });
  }
  return [...out.values()];
}

/**
 * El tipo de chat, o null si no es de los que Luks lee: los grupos, y los chats
 * privados (con una persona, no estados, canales ni bots) solo si `privados`,
 * que es para el contador: de una sesión personal nunca se lee un chat privado.
 */
export function tipoDeChat(chatId: string, privados: boolean): ChatKind | null {
  if (isJidGroup(chatId)) return 'grupo';
  if (privados && (isPnUser(chatId) || isLidUser(chatId))) return 'privado';
  return null;
}

export function normalizeMessage(raw: WAMessage, sessionId: string, me: Me, download: Downloader, privados = false): IncomingMessage | null {
  const chatId = raw.key.remoteJid;
  const chatKind = chatId ? tipoDeChat(chatId, privados) : null;
  if (!chatId || !chatKind || !raw.key.id) return null;
  const content = normalizeMessageContent(raw.message);
  if (!content) return null;

  let text: string | null = null;
  let media: IncomingMedia | null = null;
  const tipo = getContentType(content);
  switch (tipo) {
    case 'conversation':
      text = content.conversation ?? null;
      break;
    case 'extendedTextMessage':
      text = content.extendedTextMessage?.text ?? null;
      break;
    case 'imageMessage': {
      const img = content.imageMessage;
      text = img?.caption ?? null;
      media = { kind: 'photo', mimeType: img?.mimetype ?? 'image/jpeg', fileName: null, sizeBytes: numero(img?.fileLength), download: () => download(raw) };
      break;
    }
    case 'documentMessage': {
      const doc = content.documentMessage;
      const mime = doc?.mimetype ?? '';
      const nombre = doc?.fileName ?? null;
      text = doc?.caption ?? null;
      if (mime === 'application/pdf' || /\.pdf$/i.test(nombre ?? '')) {
        media = { kind: 'pdf', mimeType: 'application/pdf', fileName: nombre, sizeBytes: numero(doc?.fileLength), download: () => download(raw) };
      } else if (mime.startsWith('image/')) {
        media = { kind: 'photo', mimeType: mime, fileName: nombre, sizeBytes: numero(doc?.fileLength), download: () => download(raw) };
      } else if (/zip/.test(mime) || /\.zip$/i.test(nombre ?? '') || (mime === 'text/plain' && /\.txt$/i.test(nombre ?? ''))) {
        // El chat exportado («Exportar chat»): se importa, no es un recibo
        const zip = /zip/.test(mime) || /\.zip$/i.test(nombre ?? '');
        media = {
          kind: 'chat',
          mimeType: zip ? 'application/zip' : 'text/plain',
          fileName: nombre,
          sizeBytes: numero(doc?.fileLength),
          download: () => download(raw),
        };
      } else {
        return null; // Word, Excel, audio…: no son recibos que Luks sepa leer
      }
      break;
    }
    default:
      return null; // stickers, audios, encuestas, reacciones, mensajes del sistema
  }

  const limpio = text?.trim() || null;
  if (!limpio && !media) return null;

  // A quién le habla: las menciones y, si responde un mensaje, quién lo escribió
  const ctx = tipo === 'extendedTextMessage' || tipo === 'imageMessage' || tipo === 'documentMessage' ? content[tipo]?.contextInfo : null;
  const mentions = (ctx?.mentionedJid ?? []).map((j) => usuario(j)).filter((u): u is string => Boolean(u));

  const ts = numero(raw.messageTimestamp);
  return {
    sessionId,
    chatId,
    chatKind,
    chatName: null,
    messageId: raw.key.id,
    sender: senderOf(raw, me),
    sentAt: ts ? new Date(ts * 1000) : new Date(),
    text: limpio,
    media,
    fromMe: Boolean(raw.key.fromMe),
    mentions,
    quotedFrom: ctx?.quotedMessage ? usuario(ctx.participant) : null,
    quotedId: ctx?.quotedMessage ? (ctx.stanzaId ?? null) : null,
  };
}
