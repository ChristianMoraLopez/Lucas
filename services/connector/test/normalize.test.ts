import type { GroupMetadata, WAMessage } from 'baileys';
import { describe, expect, it } from 'vitest';
import { membersOf, normalizeMessage } from '../src/whatsapp/normalize.js';

const ME = { phone: '573150000000', lid: '99887766', name: 'Luks' };
const GRUPO = '120363040123456789@g.us';
const bajar = async () => Buffer.from('foto');

const msg = (over: Partial<WAMessage> & { message?: WAMessage['message'] }): WAMessage =>
  ({
    key: { remoteJid: GRUPO, id: '3EB0AAA', participant: '573016667788@s.whatsapp.net', fromMe: false },
    pushName: 'Mafe',
    messageTimestamp: 1_790_000_000,
    message: { conversation: 'taxi 45 lucas' },
    ...over,
  }) as WAMessage;

describe('mensajes de Baileys → IncomingMessage', () => {
  it('texto de un grupo, con número', () => {
    const m = normalizeMessage(msg({}), 's1', ME, bajar);
    expect(m).toMatchObject({
      sessionId: 's1',
      chatId: GRUPO,
      messageId: '3EB0AAA',
      text: 'taxi 45 lucas',
      media: null,
      fromMe: false,
      sender: { id: '573016667788', phone: '573016667788', name: 'Mafe' },
    });
    expect(m?.sentAt.toISOString()).toBe(new Date(1_790_000_000_000).toISOString());
  });

  it('en grupos con LID se prefiere el número si viene; si no, queda «lid:…»', () => {
    const conAlt = normalizeMessage(
      msg({ key: { remoteJid: GRUPO, id: 'X1', participant: '123456789012345@lid', participantAlt: '573016667788@s.whatsapp.net' } }),
      's1',
      ME,
      bajar,
    );
    expect(conAlt?.sender).toEqual({ id: '573016667788', phone: '573016667788', name: 'Mafe' });
    const soloLid = normalizeMessage(msg({ key: { remoteJid: GRUPO, id: 'X2', participant: '123456789012345@lid' } }), 's1', ME, bajar);
    expect(soloLid?.sender).toEqual({ id: 'lid:123456789012345', phone: null, name: 'Mafe' });
  });

  it('foto con pie de foto', async () => {
    const m = normalizeMessage(
      msg({ message: { imageMessage: { caption: ' almuerzo en La Canoa ', mimetype: 'image/jpeg', fileLength: 245_000 } } as WAMessage['message'] }),
      's1',
      ME,
      bajar,
    );
    expect(m).toMatchObject({ text: 'almuerzo en La Canoa', media: { kind: 'photo', mimeType: 'image/jpeg', sizeBytes: 245_000 } });
    expect((await m?.media?.download())?.toString()).toBe('foto');
  });

  it('PDFs sí; Word no', () => {
    const pdf = normalizeMessage(
      msg({
        message: {
          documentMessage: { mimetype: 'application/pdf', fileName: 'factura-energia.pdf', fileLength: { toNumber: () => 88_000 } },
        } as unknown as WAMessage['message'],
      }),
      's1',
      ME,
      bajar,
    );
    expect(pdf?.media).toMatchObject({ kind: 'pdf', fileName: 'factura-energia.pdf', sizeBytes: 88_000 });
    const word = normalizeMessage(
      msg({ message: { documentMessage: { mimetype: 'application/msword', fileName: 'acta.doc' } } as WAMessage['message'] }),
      's1',
      ME,
      bajar,
    );
    expect(word).toBeNull();
  });

  it('el pie de un documento con texto también cuenta', () => {
    const m = normalizeMessage(
      msg({
        message: {
          documentWithCaptionMessage: { message: { documentMessage: { mimetype: 'application/pdf', fileName: 'hotel.pdf', caption: 'hotel 900 lucas' } } },
        } as WAMessage['message'],
      }),
      's1',
      ME,
      bajar,
    );
    expect(m).toMatchObject({ text: 'hotel 900 lucas', media: { kind: 'pdf' } });
  });

  it('lo propio queda como mío', () => {
    const m = normalizeMessage(msg({ key: { remoteJid: GRUPO, id: 'Y', fromMe: true } }), 's1', ME, bajar);
    expect(m).toMatchObject({ fromMe: true, sender: { id: '573150000000', phone: '573150000000' } });
  });

  it('nada de chats privados, estados, reacciones, stickers ni mensajes vacíos', () => {
    expect(normalizeMessage(msg({ key: { remoteJid: '573016667788@s.whatsapp.net', id: 'P' } }), 's1', ME, bajar)).toBeNull();
    expect(normalizeMessage(msg({ key: { remoteJid: 'status@broadcast', id: 'S' } }), 's1', ME, bajar)).toBeNull();
    expect(normalizeMessage(msg({ message: { reactionMessage: { text: '👍' } } as WAMessage['message'] }), 's1', ME, bajar)).toBeNull();
    expect(normalizeMessage(msg({ message: { stickerMessage: {} } as WAMessage['message'] }), 's1', ME, bajar)).toBeNull();
    expect(normalizeMessage(msg({ message: { conversation: '   ' } }), 's1', ME, bajar)).toBeNull();
    expect(normalizeMessage(msg({ message: null }), 's1', ME, bajar)).toBeNull();
  });
});

describe('integrantes de un grupo', () => {
  const grupoCon = (participants: GroupMetadata['participants']) => ({ id: GRUPO, subject: 'Paseo', participants }) as GroupMetadata;

  it('cada uno con su número si se ve, si no con «lid:…», como quien escribe', () => {
    const ms = membersOf(
      grupoCon([
        { id: '573016667788@s.whatsapp.net', notify: 'Mafe', admin: 'admin' },
        { id: '11112222@lid', phoneNumber: '573128880365@s.whatsapp.net' },
        { id: '33334444@lid' },
        { id: '573016667788@s.whatsapp.net' }, // repetido
      ]),
    );
    expect(ms).toEqual([
      { id: '573016667788', phone: '573016667788', lid: null, name: 'Mafe', admin: true },
      { id: '573128880365', phone: '573128880365', lid: '11112222', name: null, admin: false },
      { id: 'lid:33334444', phone: null, lid: '33334444', name: null, admin: false },
    ]);
  });

  it('el nombre sale de WhatsApp o de los contactos de quien vinculó', () => {
    const contactos = new Map([
      ['573128880365', { notify: 'Santi 🏄', name: 'Santiago Herrera' }],
      ['33334444', { name: 'Caro trabajo' }],
    ]);
    const ms = membersOf(grupoCon([{ id: '573128880365@s.whatsapp.net' }, { id: '33334444@lid' }]), contactos);
    expect(ms.map((m) => m.name)).toEqual(['Santi 🏄', 'Caro trabajo']);
  });
});
