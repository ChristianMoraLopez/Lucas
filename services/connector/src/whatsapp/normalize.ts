import { type Contact, type GroupMetadata, getContentType, isJidGroup, isLidUser, isPnUser, jidDecode, normalizeMessageContent, type WAMessage } from 'baileys';
import type { GroupMember, IncomingMedia, IncomingMessage, Sender } from '../connector.js';

/* Un mensaje de Baileys → IncomingMessage (sin nada propio de Baileys). */

export interface Me {
  /** Número de la sesión, sin «+» */
  phone: string | null;
  lid: string | null;
  name: string | null;
}

export type Downloader = (raw: WAMessage) => Promise<Buffer>;

const usuario = (jid: string | null | undefined) => (jid ? (jidDecode(jid)?.user ?? null) : null);

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
  const jids = [raw.key.participant, raw.key.participantAlt, raw.participant].filter((j): j is string => Boolean(j));
  const phone = usuario(jids.find((j) => isPnUser(j)));
  const lid = usuario(jids.find((j) => isLidUser(j)));
  return { id: phone ?? (lid ? `lid:${lid}` : null), phone, name: raw.pushName?.trim() || null };
}

/** Nombres que se conocen de cada número o LID (eventos contacts.* de Baileys) */
export type Contactos = Map<string, { notify?: string | null; name?: string | null }>;

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
    if (!notify && !name) continue;
    for (const jid of [c.id, c.lid, c.phoneNumber]) {
      const u = usuario(jid);
      if (!u) continue;
      const antes = contactos.get(u);
      const ahora = { notify: notify ?? antes?.notify ?? null, name: name ?? antes?.name ?? null };
      if (ahora.notify !== (antes?.notify ?? null) || ahora.name !== (antes?.name ?? null)) cambiaron.add(u);
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
    // Si viene repetido, se queda con lo que se sepa de cada vez
    const antes = out.get(id);
    out.set(id, { id, phone, lid: lid ?? antes?.lid ?? null, name: name ?? antes?.name ?? null, admin: Boolean(p.admin) || Boolean(antes?.admin) });
  }
  return [...out.values()];
}

export function normalizeMessage(raw: WAMessage, sessionId: string, me: Me, download: Downloader): IncomingMessage | null {
  const chatId = raw.key.remoteJid;
  if (!chatId || !isJidGroup(chatId) || !raw.key.id) return null;
  const content = normalizeMessageContent(raw.message);
  if (!content) return null;

  let text: string | null = null;
  let media: IncomingMedia | null = null;
  switch (getContentType(content)) {
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

  const ts = numero(raw.messageTimestamp);
  return {
    sessionId,
    chatId,
    chatName: null,
    messageId: raw.key.id,
    sender: senderOf(raw, me),
    sentAt: ts ? new Date(ts * 1000) : new Date(),
    text: limpio,
    media,
    fromMe: Boolean(raw.key.fromMe),
  };
}
