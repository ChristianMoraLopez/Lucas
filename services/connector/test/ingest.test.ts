import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import type { IncomingMessage } from '../src/connector.js';
import { Ingestor } from '../src/ingest.js';
import { RateLimiter } from '../src/replies.js';
import { LINK_GRUPO, MISTER, MSG } from '../src/text.js';
import { contador, FakeConnector, FakeStore, GRUPO, grupo, PASEO, personal, silentLog } from './fakes.js';

const LIMITS = { maxDownloadBytes: 25 * 1024 * 1024, maxChatBytes: 50 * 1024 * 1024, maxUploadBytes: 6 * 1024 * 1024, maxSide: 1600, jpegQuality: 80 };
const GUIA = 'https://mrluks.com/guia';
const PRIVADO = '573016667788@s.whatsapp.net';

let store: FakeStore;
let wa: FakeConnector;
let ing: Ingestor;
let reloj: number;

beforeEach(() => {
  store = new FakeStore();
  wa = new FakeConnector(contador);
  reloj = 1_000_000;
  const joins = new RateLimiter({ minIntervalMs: 0, maxPerHourPerGroup: 2, maxPerHourTotal: 4 }, () => reloj);
  ing = new Ingestor(store, LIMITS, { guiaUrl: GUIA, joins }, silentLog);
});

const m = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  sessionId: 'contador',
  chatId: GRUPO,
  chatKind: 'grupo',
  chatName: 'Paseo Santa Marta 2026',
  messageId: `W${Math.random().toString(36).slice(2, 8)}`,
  sender: { id: '573016667788', phone: '573016667788', name: 'Mafe' },
  sentAt: new Date('2026-10-01T15:00:00Z'),
  text: 'taxi al aeropuerto 45 lucas',
  media: null,
  fromMe: false,
  ...over,
});

/** Un mensaje por privado a Mister Luks */
const privado = (over: Partial<IncomingMessage> = {}) => m({ chatId: PRIVADO, chatKind: 'privado', chatName: null, text: 'Hola', ...over });

/** Lo que Mister Luks dejó en la bandeja de salida (para un chat, o todo) */
const bandeja = (jid?: string) => store.outbox.filter((o) => !jid || o.chat_jid === jid);

async function enlazado() {
  await ing.onGroupJoined(contador, wa, grupo());
  await ing.onMessage(contador, wa, m({ text: 'lucas PASEO-7K2Q' }));
  store.outbox = [];
  reloj += 60_000;
}

describe('cuando agregan a Mister Luks a un grupo', () => {
  it('saluda una sola vez, con la guía, y explica cómo empezar', async () => {
    await ing.onGroupJoined(contador, wa, grupo());
    await ing.onGroupJoined(contador, wa, grupo());
    expect(bandeja()).toEqual([
      expect.objectContaining({
        chat_jid: GRUPO,
        reason: 'group_hello',
        body: MISTER.saludoGrupo('es', null),
        image_url: `${GUIA}/luks-guia-es.png`,
        // El grupo va con el saludo: el link /g/ para crear la cuenta se crea al mandarlo
        group_id: 'g-1',
        dedupe_key: 'group_hello:g-1',
      }),
    ]);
    expect(bandeja()[0].body).toContain('*Una sola persona*');
    expect(bandeja()[0].body).toContain(LINK_GRUPO);
    // Una sola llamada: el grupo, su gente y el saludo
    expect(wa.pedidos).toEqual([GRUPO, GRUPO]);
    // Directo no escribe nada: lo manda el ReplyLoop con el límite de frecuencia
    expect(wa.enviados).toEqual([]);
  });

  it('nombra a quienes del grupo ya usan Luks', async () => {
    store.usuariosLuks = ['Christian', 'Vale'];
    await ing.onGroupJoined(contador, wa, grupo());
    expect(bandeja()[0].body).toContain('Veo que Christian y Vale ya usan Luks 🙌');
  });

  it('en un grupo que ya tiene cuenta, dice que desde hoy confirma ahí', async () => {
    const mio = new FakeConnector(personal);
    await ing.onMessage(personal, mio, m({ text: 'luks PASEO-7K2Q', fromMe: true }));
    await ing.onGroupJoined(contador, wa, grupo());
    expect(bandeja()[0].body).toBe(MISTER.saludoGrupo('es', 'Paseo Santa Marta'));
  });

  it('un grupo de gente de +1 se saluda en inglés', async () => {
    wa.integrantes.set(GRUPO, [
      { id: '13055550100', phone: '13055550100', lid: null, name: 'Sam', admin: true },
      { id: '13055550101', phone: '13055550101', lid: null, name: 'Alex', admin: false },
      { id: '573016667788', phone: '573016667788', lid: null, name: 'Mafe', admin: false },
    ]);
    await ing.onGroupJoined(contador, wa, grupo());
    expect(bandeja()[0]).toMatchObject({ body: MISTER.saludoGrupo('en', null), image_url: `${GUIA}/luks-guia-en.png` });
  });

  it('manda quiénes están en el grupo; enlazado, quedan como personas de la cuenta', async () => {
    const members = [
      { id: '573016667788', phone: '573016667788', lid: null, name: 'Mafe', admin: true },
      { id: 'lid:33334444', phone: null, lid: '33334444', name: null, admin: false },
    ];
    wa.integrantes.set(GRUPO, members);
    await ing.onGroupJoined(contador, wa, grupo());
    const g = store.groups.get(GRUPO);
    expect(store.members.get(g?.group_id as string)).toEqual(members);

    // Al enlazar, el mensaje dice cuántos quedaron en la cuenta
    store.outbox = [];
    await ing.onMessage(contador, wa, m({ text: 'luks PASEO-7K2Q' }));
    expect(bandeja()[0].body).toBe(MSG.linked('Paseo Santa Marta', 2));
    expect(bandeja()[0].body).toContain('sus 2 integrantes ya están en la cuenta');
  });

  it('una sesión personal no escribe ni deja nada para escribir', async () => {
    const mio = new FakeConnector(personal);
    await ing.onGroupJoined(personal, mio, grupo());
    expect(mio.enviados).toEqual([]);
    expect(bandeja()).toEqual([]);
  });

  it('de un grupo sin cuenta, una sesión personal guarda el nombre pero no quiénes están; al enlazarlo, sí', async () => {
    const mio = new FakeConnector(personal);
    mio.integrantes.set(GRUPO, [{ id: '573016667788', phone: '573016667788', lid: null, name: 'Mafe', admin: false }]);
    await ing.onGroupJoined(personal, mio, grupo());
    const g = store.groups.get(GRUPO);
    expect(g?.name).toBe('Paseo Santa Marta 2026');
    expect(mio.pedidos).toEqual([]);
    expect(store.members.size).toBe(0);

    expect(await ing.onMessage(personal, mio, m({ text: 'luks PASEO-7K2Q', fromMe: true }))).toBe('enlazado');
    expect(store.members.get(g?.group_id as string)).toHaveLength(1);

    // Ya enlazado, cada cambio del grupo vuelve a mandar quiénes están
    await ing.onGroupJoined(personal, mio, grupo());
    expect(mio.pedidos).toEqual([GRUPO, GRUPO]);
  });

  it('lo que escribe Mister Luks no es un gasto, aunque lo lea un WhatsApp vinculado', async () => {
    const mio = new FakeConnector(personal);
    await ing.onMessage(personal, mio, m({ text: 'luks PASEO-7K2Q', fromMe: true }));
    ing.setMisterLuks(['573337627471', 'lid:99990000']);
    const deLuks = { id: '573337627471', phone: '573337627471', name: 'Mister Luks' };
    expect(await ing.onMessage(personal, mio, m({ sender: deLuks, text: 'por ejemplo «taxi 45 lucas»' }))).toBe('de_luks');
    // Y aunque no se sepa su número, sus saludos se reconocen por el texto
    expect(await ing.onMessage(personal, mio, m({ text: MISTER.saludoGrupo('es', null) }))).toBe('de_luks');
    expect(await ing.onMessage(personal, mio, m({ text: MSG.linked('Paseo', 8) }))).toBe('de_luks');
    expect(store.messages.size).toBe(0);
  });
});

describe('«lucas CÓDIGO»', () => {
  beforeEach(async () => {
    await ing.onGroupJoined(contador, wa, grupo());
    store.outbox = [];
  });

  it('enlaza el grupo y lo confirma', async () => {
    expect(await ing.onMessage(contador, wa, m({ text: 'Luks paseo-7k2q' }))).toBe('enlazado');
    expect(store.groups.get(GRUPO)?.account_id).toBe(PASEO);
    expect(bandeja()).toEqual([expect.objectContaining({ reason: 'link', body: MSG.linked('Paseo Santa Marta') })]);
  });

  it('un código malo se explica, pero sin llenar el grupo si insisten', async () => {
    expect(await ing.onMessage(contador, wa, m({ text: 'lucas NADA-0000' }))).toBe('codigo_invalido');
    expect(await ing.onMessage(contador, wa, m({ text: 'lucas NADA-0001' }))).toBe('codigo_invalido');
    expect(bandeja().map((o) => o.body)).toEqual([MSG.badCode]);
  });

  it('desde una sesión personal también enlaza, en silencio', async () => {
    const mio = new FakeConnector(personal);
    expect(await ing.onMessage(personal, mio, m({ text: 'lucas PASEO-7K2Q', fromMe: true }))).toBe('enlazado');
    expect(mio.enviados).toEqual([]);
    expect(bandeja()).toEqual([]);
  });

  it('«ayuda» en el grupo: la guía (con el link para crear la cuenta, que se quita si ya la tiene), como mucho una vez por hora', async () => {
    expect(await ing.onMessage(contador, wa, m({ text: 'ayuda' }))).toBe('ayuda');
    expect(await ing.onMessage(contador, wa, m({ text: '@573337627471 ayuda' }))).toBe('ayuda');
    expect(bandeja()).toEqual([
      expect.objectContaining({ reason: 'guide', body: MISTER.guiaGrupo('es'), group_id: 'g-1', image_url: `${GUIA}/luks-guia-es.png` }),
    ]);
    expect(bandeja()[0].document_url).toBeUndefined();
    // «necesito ayuda con el taxi» es charla, no un pedido
    expect(await ing.onMessage(contador, wa, m({ text: 'necesito ayuda con el taxi' }))).toBe('charla');
  });
});

describe('chats privados con Mister Luks', () => {
  it('la primera vez, la bienvenida con la imagen y el PDF de la guía; después, nada más', async () => {
    expect(await ing.onMessage(contador, wa, privado())).toBe('bienvenida');
    expect(await ing.onMessage(contador, wa, privado({ text: 'gracias' }))).toBe('privado');
    expect(bandeja()).toEqual([
      expect.objectContaining({
        chat_jid: PRIVADO,
        reason: 'welcome',
        body: MISTER.bienvenida('es'),
        image_url: `${GUIA}/luks-guia-es.png`,
        document_url: `${GUIA}/luks-guia-es.pdf`,
        document_name: 'Guía de Mister Luks.pdf',
      }),
    ]);
    expect(store.privados.has(PRIVADO)).toBe(true);
    expect(store.messages.size).toBe(0);
  });

  it('a un número de +1, en inglés', async () => {
    const sam = { id: '13055550100', phone: '13055550100', name: 'Sam' };
    await ing.onMessage(contador, wa, privado({ chatId: '13055550100@s.whatsapp.net', sender: sam, text: 'Hi' }));
    expect(bandeja()[0]).toMatchObject({ body: MISTER.bienvenida('en'), document_name: 'Mister Luks guide.pdf' });
  });

  it('«ayuda» manda la guía otra vez (no dos veces seguidas)', async () => {
    await ing.onMessage(contador, wa, privado());
    expect(await ing.onMessage(contador, wa, privado({ text: 'Ayuda' }))).toBe('ayuda');
    expect(await ing.onMessage(contador, wa, privado({ text: 'instrucciones' }))).toBe('ayuda');
    expect(bandeja().map((o) => o.reason)).toEqual(['welcome', 'guide']);
  });

  it('un link de grupo: entra y lo cuenta; con tope por hora', async () => {
    const link = 'Únete: https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv';
    expect(await ing.onMessage(contador, wa, privado({ text: link }))).toBe('link_grupo:joined');
    expect(wa.unidos).toEqual(['AbCdEfGhIjKlMnOpQrStUv']);
    expect(bandeja().map((o) => o.body)).toEqual([MISTER.bienvenida('es'), MISTER.unirse.joined('es', 'Cumple de Caro')]);

    expect(await ing.onMessage(contador, wa, privado({ text: link }))).toBe('link_grupo:joined');
    expect(await ing.onMessage(contador, wa, privado({ text: link }))).toBe('link_grupo:tope');
    expect(wa.unidos).toHaveLength(2);
    expect(bandeja().at(-1)?.body).toBe(MISTER.unirse.tope('es'));
  });

  it('un link vencido se explica', async () => {
    wa.alUnirse = { status: 'invalid' };
    expect(await ing.onMessage(contador, wa, privado({ text: 'chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv' }))).toBe('link_grupo:invalid');
    expect(bandeja().at(-1)?.body).toBe(MISTER.unirse.invalid('es'));
  });

  it('«luks CÓDIGO» por privado no enlaza nada; y una sesión personal nunca lee chats privados', async () => {
    expect(await ing.onMessage(contador, wa, privado({ text: 'luks PASEO-7K2Q' }))).toBe('bienvenida');
    expect([...store.groups.values()].some((g) => g.account_id)).toBe(false);
    const mio = new FakeConnector(personal);
    expect(await ing.onMessage(personal, mio, privado({ sessionId: 'personal' }))).toBe('ignorado:privado');
  });
});

describe('ingesta', () => {
  it('la charla del grupo no sale de WhatsApp', async () => {
    await enlazado();
    expect(await ing.onMessage(contador, wa, m({ text: 'llego en 10 min' }))).toBe('charla');
    expect(store.messages.size).toBe(0);
  });

  it('las cuentas que mandan desde Luks no entran como gasto', async () => {
    await enlazado();
    const cuentas = '🧾 *Paseo*\nGastamos *$480.000* entre 4\nhttps://mrluks.com/r/76B5n5hlRzSyAs39_Yl50w\n\n_Esto se hizo en mrluks.com_';
    expect(await ing.onMessage(contador, wa, m({ text: cuentas }))).toBe('de_luks');
    expect(await ing.onMessage(contador, wa, m({ text: 'Anotado: Hielo · $8.000 · pagó Mafe.' }))).toBe('de_luks');
    expect(store.messages.size).toBe(0);
  });

  it('un gasto escrito entra a la cola con quién lo mandó', async () => {
    await enlazado();
    const msg = m({ messageId: 'W-TAXI' });
    expect(await ing.onMessage(contador, wa, msg)).toBe('guardado');
    expect(store.messages.get(`${GRUPO}|W-TAXI`)).toMatchObject({
      kind: 'text',
      text: 'taxi al aeropuerto 45 lucas',
      senderWaId: '573016667788',
      senderName: 'Mafe',
      mediaPath: null,
    });
    expect(await ing.onMessage(contador, wa, msg)).toBe('ignorado:repetido');
  });

  it('solo grupos enlazados', async () => {
    expect(await ing.onMessage(contador, wa, m())).toBe('ignorado:grupo_sin_enlazar');
  });

  it('las fotos se comprimen a JPEG y se suben a la carpeta de la cuenta', async () => {
    await enlazado();
    const png = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#FFC53D' } })
      .png()
      .toBuffer();
    const r = await ing.onMessage(
      contador,
      wa,
      m({ messageId: 'W-FOTO', text: null, media: { kind: 'photo', mimeType: 'image/png', fileName: null, sizeBytes: png.length, download: async () => png } }),
    );
    expect(r).toBe('guardado');
    const [[path, up]] = [...store.uploads];
    expect(path).toBe(`${PASEO}/whatsapp/2026-10/W-FOTO.jpg`);
    expect(up.contentType).toBe('image/jpeg');
    const meta = await sharp(up.body).metadata();
    expect([meta.format, Math.max(meta.width ?? 0, meta.height ?? 0)]).toEqual(['jpeg', 1600]);
    expect(store.messages.get(`${GRUPO}|W-FOTO`)).toMatchObject({ kind: 'photo', mediaPath: path, mimeType: 'image/jpeg' });
  });

  it('un «PDF» que no es PDF, o un archivo enorme, no se guarda', async () => {
    await enlazado();
    const falso = { kind: 'pdf' as const, mimeType: 'application/pdf', fileName: 'x.pdf', sizeBytes: 10, download: async () => Buffer.from('<html>') };
    expect(await ing.onMessage(contador, wa, m({ media: falso }))).toBe('archivo_rechazado');
    const enorme = { ...falso, sizeBytes: 90 * 1024 * 1024, download: async () => Buffer.alloc(0) };
    expect(await ing.onMessage(contador, wa, m({ media: enorme }))).toBe('archivo_muy_pesado');
    expect(store.messages.size).toBe(0);
  });

  it('el contador no se lee a sí mismo; en una sesión personal lo propio sí cuenta', async () => {
    await enlazado();
    expect(await ing.onMessage(contador, wa, m({ fromMe: true }))).toBe('propio');
    expect(await ing.onMessage(personal, new FakeConnector(personal), m({ fromMe: true, messageId: 'W-MIO' }))).toBe('guardado');
  });
});

describe('«luks soy yo»', () => {
  beforeEach(async () => {
    await ing.onGroupJoined(contador, wa, grupo());
    store.outbox = [];
  });

  it('en el grupo, sin verificar: lo dice con los últimos 4 números y le manda el link por privado', async () => {
    expect(await ing.onMessage(contador, wa, m({ text: 'luks soy yo' }))).toBe('soy_yo');
    expect(store.privados.has(PRIVADO)).toBe(true); // lo pidió: su chat privado queda abierto
    expect(bandeja().map((o) => [o.chat_jid, o.reason, o.body])).toEqual([
      [GRUPO, 'soy_yo', MISTER.soyYo.noEncontrado('es', '7788')],
      [PRIVADO, 'verify', MISTER.soyYo.link('es', '7788')],
    ]);
    expect(bandeja(PRIVADO)[0]).toMatchObject({ identity_id: 'i-573016667788' });
    expect(bandeja(PRIVADO)[0].body).toContain('{link}'); // el código se crea al mandarlo
    // Si insiste enseguida, no se repite
    await ing.onMessage(contador, wa, m({ text: 'Luks soy yo!' }));
    expect(bandeja()).toHaveLength(2);
  });

  it('en el grupo, ya verificado: lo reconoce por su nombre y no le escribe por privado', async () => {
    store.verificados.set('573016667788', 'Mafe');
    await ing.onMessage(contador, wa, m({ text: '@573337627471 soy yo' }));
    expect(bandeja().map((o) => [o.chat_jid, o.body])).toEqual([[GRUPO, MISTER.soyYo.reconocido('es', 'Mafe')]]);
  });

  it('por privado: primero el link y después la bienvenida; si ya está verificado, se lo dice', async () => {
    expect(await ing.onMessage(contador, wa, privado({ text: 'luks soy yo' }))).toBe('soy_yo');
    expect(bandeja().map((o) => o.reason)).toEqual(['verify', 'welcome']);
    store.verificados.set('573016667788', 'Mafe');
    await ing.onMessage(contador, wa, privado({ text: 'soy yo', sentAt: new Date('2026-10-01T16:00:00Z') }));
    expect(
      bandeja()
        .map((o) => o.body)
        .slice(2),
    ).toEqual([MISTER.soyYo.yaVerificado('es', 'Mafe')]);
  });

  it('una sesión personal no lo atiende', async () => {
    const mio = new FakeConnector(personal);
    expect(await ing.onMessage(personal, mio, m({ text: 'luks soy yo' }))).toBe('charla');
    expect(bandeja()).toEqual([]);
  });
});

describe('¿desde cuándo anoto?', () => {
  it('al enlazar con el código, Mister Luks pregunta', async () => {
    await ing.onGroupJoined(contador, wa, grupo());
    store.outbox = [];
    await ing.onMessage(contador, wa, m({ text: 'luks PASEO-7K2Q' }));
    expect(bandeja()[0].body).toContain('¿Desde cuándo anoto? Respondan *1* para *desde ahora* o *2* para *todo el chat*');
  });

  it('un «2» la responde; otro «1» suelto ya no la cambia, pero «luks desde ya» sí', async () => {
    await enlazado();
    expect(await ing.onMessage(contador, wa, m({ text: '2' }))).toBe('desde_cuando');
    expect(store.desdeCuando.get(GRUPO)).toEqual({ modo: 'todo', quien: 'Mafe' });
    expect(await ing.onMessage(contador, wa, m({ text: '1' }))).toBe('ignorado:desde_cuando');
    expect(await ing.onMessage(contador, wa, m({ text: 'Luks, desde ya!' }))).toBe('desde_cuando');
    expect(store.desdeCuando.get(GRUPO)?.modo).toBe('desde_ya');
    // Con la mención a Mister Luks (su número) también
    ing.setMisterLuks(['573337627471']);
    expect(await ing.onMessage(contador, wa, m({ text: '@573337627471 lee todo' }))).toBe('desde_cuando');
    // Una sesión personal no lo atiende
    const mio = new FakeConnector(personal);
    expect(await ing.onMessage(personal, mio, m({ text: 'luks desde ya', fromMe: true }))).toBe('charla');
  });
});

describe('el chat exportado', () => {
  const zip = Buffer.from('PK\u0003\u0004 chat');
  const chat = (over: Partial<NonNullable<IncomingMessage['media']>> = {}) =>
    m({
      messageId: 'W-ZIP',
      text: null,
      media: {
        kind: 'chat',
        mimeType: 'application/zip',
        fileName: 'Chat de WhatsApp con Paseo.zip',
        sizeBytes: zip.length,
        download: async () => zip,
        ...over,
      },
    });

  it('en un grupo enlazado: al bucket de importaciones, a la cola, y Mister Luks avisa (una vez)', async () => {
    await enlazado();
    expect(await ing.onMessage(contador, wa, chat())).toBe('chat_importado');
    expect([...store.importados.keys()]).toEqual([`${PASEO}/whatsapp/2026-10/W-ZIP.zip`]);
    expect(store.importaciones).toEqual([{ jid: GRUPO, path: `${PASEO}/whatsapp/2026-10/W-ZIP.zip`, fileName: 'Chat de WhatsApp con Paseo.zip' }]);
    expect(bandeja().map((o) => o.body)).toEqual([MISTER.importar.recibido('es')]);
    // El mismo mensaje leído por otra sesión del grupo: no se importa ni se avisa otra vez
    const mio = new FakeConnector(personal);
    expect(await ing.onMessage(personal, mio, chat())).toBe('chat_importado');
    expect(store.importaciones).toHaveLength(1);
    expect(bandeja()).toHaveLength(1);
  });

  it('en un grupo sin cuenta no se importa: Mister Luks explica qué falta', async () => {
    await ing.onGroupJoined(contador, wa, grupo());
    store.outbox = [];
    expect(await ing.onMessage(contador, wa, chat())).toBe('ignorado:grupo_sin_enlazar');
    expect(bandeja().map((o) => o.body)).toEqual([MISTER.importar.sinCuenta('es')]);
    expect(store.importados.size).toBe(0);
  });

  it('un archivo demasiado pesado no se baja', async () => {
    await enlazado();
    let bajado = false;
    const pesado = chat({
      sizeBytes: 80 * 1024 * 1024,
      download: async () => {
        bajado = true;
        return zip;
      },
    });
    expect(await ing.onMessage(contador, wa, pesado)).toBe('chat_muy_pesado');
    expect(bajado).toBe(false);
    expect(bandeja().map((o) => o.body)).toEqual([MISTER.importar.muyPesado('es')]);
  });

  it('por privado: si se sabe de qué grupo es, se importa; si no, explica cómo mandarlo', async () => {
    store.gruposDelPrivado = ['Paseo'];
    const porPrivado = (fileName: string) =>
      privado({
        messageId: `W-${fileName}`,
        text: null,
        media: { kind: 'chat', mimeType: 'application/zip', fileName, sizeBytes: zip.length, download: async () => zip },
      });
    expect(await ing.onMessage(contador, wa, porPrivado('Chat de WhatsApp con Paseo.zip'))).toBe('chat_importado');
    expect(store.importaciones[0]).toMatchObject({ jid: null, chatName: 'Paseo' });
    expect(bandeja(PRIVADO).map((o) => o.body)).toContain(MISTER.importar.privadoRecibido('es', 'Paseo'));

    expect(await ing.onMessage(contador, wa, porPrivado('WhatsApp Chat with Otro.zip'))).toBe('ignorado:sin_grupo');
    expect(bandeja(PRIVADO).map((o) => o.body)).toContain(MISTER.importar.sinGrupo('es'));
  });
});
