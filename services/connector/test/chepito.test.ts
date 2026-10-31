import { beforeEach, describe, expect, it } from 'vitest';
import {
  avisarChepito,
  avisoAlAcreedor,
  avisoDeCobro,
  esNoLeDebo,
  esPedidoDeCobro,
  festivosDeColombia,
  gifDeChepito,
  leerCobro,
  leerComoMePagan,
  puedeCobrar,
} from '../src/chepito.js';
import type { IncomingMessage } from '../src/connector.js';
import { Ingestor } from '../src/ingest.js';
import { RateLimiter } from '../src/replies.js';
import type { ChepitoPendiente, ChepitoRespuesta } from '../src/store.js';
import { leerVcard } from '../src/whatsapp/normalize.js';
import { contador, FakeConnector, FakeStore, silentLog } from './fakes.js';

// Chepito: cobrar por WhatsApp (migraciones 700 y 710)

/** Hora de Colombia (UTC−5) */
const co = (fechaHora: string) => new Date(`${fechaHora}-05:00`);

describe('cuándo se puede cobrar (Ley 2300 de 2023)', () => {
  it('los festivos de Colombia en 2026, con los que se pasan al lunes y los de Semana Santa', () => {
    expect([...festivosDeColombia(2026)].sort()).toEqual([
      '2026-01-01',
      '2026-01-12',
      '2026-03-23',
      '2026-04-02',
      '2026-04-03',
      '2026-05-01',
      '2026-05-18',
      '2026-06-08',
      '2026-06-15',
      '2026-06-29',
      '2026-07-20',
      '2026-08-07',
      '2026-08-17',
      '2026-10-12',
      '2026-11-02',
      '2026-11-16',
      '2026-12-08',
      '2026-12-25',
    ]);
  });

  it('lunes a viernes de 8 a 19, sábados de 8 a 15; ni domingos ni festivos', () => {
    expect(puedeCobrar(co('2026-10-30T10:00:00'))).toBe(true); // viernes
    expect(puedeCobrar(co('2026-10-30T07:59:00'))).toBe(false);
    expect(puedeCobrar(co('2026-10-30T19:00:00'))).toBe(false);
    expect(puedeCobrar(co('2026-10-31T14:30:00'))).toBe(true); // sábado
    expect(puedeCobrar(co('2026-10-31T15:00:00'))).toBe(false);
    expect(puedeCobrar(co('2026-11-01T10:00:00'))).toBe(false); // domingo
    expect(puedeCobrar(co('2026-11-02T10:00:00'))).toBe(false); // festivo (Todos los Santos, al lunes)
    expect(puedeCobrar(co('2026-11-03T10:00:00'))).toBe(true);
  });
});

describe('lo que dice quien pide el cobro', () => {
  it('a quién, su WhatsApp, cuánto y por qué', () => {
    expect(esPedidoDeCobro('Juan me debe 50 mil por la boleta del concierto')).toBe(true);
    expect(leerCobro('Juan me debe 50 mil por la boleta del concierto')).toEqual({ nombre: 'Juan', monto: 50000, concepto: 'la boleta del concierto' });
    expect(leerCobro('Oye Luks, mi prima Sofía 300 123 4567 me debe 2 palos del arriendo')).toEqual({
      nombre: 'Sofía',
      telefono: '573001234567',
      monto: 2_000_000,
      concepto: 'arriendo',
    });
    expect(esPedidoDeCobro('cóbrale a Pedro 30 lucas del almuerzo')).toBe(true);
    expect(leerCobro('cóbrale a Pedro 30 lucas del almuerzo')).toEqual({ nombre: 'Pedro', monto: 30000, concepto: 'almuerzo' });
    expect(esPedidoDeCobro('taxi 45 lucas')).toBe(false);
    expect(esPedidoDeCobro('¿cuánto debo?')).toBe(false);
  });

  it('la tarjeta de contacto: el nombre y el número de WhatsApp', () => {
    const vcard = 'BEGIN:VCARD\nVERSION:3.0\nN:Pérez;Juan;;;\nFN:Juan Pérez\nTEL;type=CELL;type=VOICE;waid=573001234567:+57 300 1234567\nEND:VCARD';
    expect(leerVcard(vcard, 'Juan Pérez')).toEqual({ nombre: 'Juan Pérez', telefono: '573001234567' });
    expect(leerVcard('BEGIN:VCARD\nFN:Ana\nTEL:+56 9 8765 4321\nEND:VCARD', null)).toEqual({ nombre: 'Ana', telefono: '56987654321' });
  });

  it('cómo le pagan: Nequi, Daviplata o su llave; o «no»', () => {
    expect(leerComoMePagan('Nequi 300 123 4567')).toEqual({ nequi: '3001234567' });
    expect(leerComoMePagan('mi llave es @juanes')).toEqual({ llave: '@juanes' });
    expect(leerComoMePagan('daviplata +57 310 999 8877')).toEqual({ daviplata: '3109998877' });
    expect(leerComoMePagan('3001234567')).toEqual({ llave: '3001234567' });
    expect(leerComoMePagan('no gracias')).toBe('no');
    expect(leerComoMePagan('hola')).toBeNull();
  });

  it('«no le debo»', () => {
    for (const t of ['No le debo', 'yo no le debo nada', 'no le debo nada a esa persona', 'Número equivocado', 'I don’t owe anything']) {
      expect(esNoLeDebo(t)).toBe(true);
    }
    expect(esNoLeDebo('ya le pagué')).toBe(false);
  });
});

const WEB = 'https://mrluks.com';
const cobro = (over: Partial<ChepitoPendiente> = {}): ChepitoPendiente => ({
  cobro_id: 'cb1',
  avisos: 0,
  telefono: '573001234567',
  deudor: 'Juan Pérez',
  acreedor: 'Christian Mora',
  monto: 50000,
  concepto: 'la boleta del concierto',
  currency: 'COP',
  language: 'es',
  pago: { nequi: '3001112233' },
  ...over,
});

describe('lo que le escribe Mister Luks a quien debe', () => {
  it('el primero se presenta: quién es, de parte de quién, cuánto, por qué, cómo pagar y qué responder', () => {
    expect(avisoDeCobro(cobro())).toBe(
      [
        '🎩 Hola Juan, soy *Chepito* y trabajo para Mister Luks, un bot que lleva las cuentas de la casa y de los paseos (mrluks.com). Él las lleva; yo las cobro. 😉',
        '',
        'Te escribo de parte de *Christian Mora*: dice que le debes *$50.000* por «la boleta del concierto».',
        '📲 Mándaselos a Christian: Nequi *300 111 2233*',
        '',
        '✅ Cuando le pagues, respóndeme *ya pagué* y le aviso.',
        '🙅 Si no le debes nada, respóndeme *no le debo*.',
        '🔕 Si no quieres que te escriba, respóndeme *no me escribas*.',
        '',
        '📊 Más detalle en mrluks.com',
      ].join('\n'),
    );
  });

  it('los recordatorios son cortos, y el cuarto dice que es el último', () => {
    expect(avisoDeCobro(cobro({ avisos: 1, pago: null }))).toMatch(
      /^🎩 Hola Juan, soy Chepito otra vez\. Te recuerdo que le debes \*\$50\.000\* a \*Christian Mora\*/,
    );
    expect(avisoDeCobro(cobro({ avisos: 1 }))).not.toContain('último');
    expect(avisoDeCobro(cobro({ avisos: 3 }))).toContain('Es el último recordatorio que te mando.');
  });

  it('solo en horario de cobranza', async () => {
    const store = new FakeStore();
    store.porCobrar = [cobro()];
    expect(await avisarChepito(store, WEB, silentLog, co('2026-11-01T10:00:00'))).toBe(0);
    expect(store.avisosChepito).toEqual([]);
    expect(await avisarChepito(store, WEB, silentLog, co('2026-11-03T10:00:00'))).toBe(1);
    expect(store.avisosChepito).toEqual([{ cobroId: 'cb1', avisos: 0, body: avisoDeCobro(cobro()), gifUrl: 'https://mrluks.com/brand/chepito-hola-es.mp4' }]);
  });

  it('Chepito sale en GIF: saluda en el primero y muestra la cuenta en los recordatorios, en su idioma', () => {
    expect(gifDeChepito(cobro(), WEB)).toBe('https://mrluks.com/brand/chepito-hola-es.mp4');
    expect(gifDeChepito(cobro({ avisos: 2, language: 'en' }), WEB)).toBe('https://mrluks.com/brand/chepito-cobra-en.mp4');
  });
});

// ---------------------------------------------------------------------------
// Por privado: pedir un cobro y lo que responde quien debe
// ---------------------------------------------------------------------------

const CHRISTIAN = '573016667788@s.whatsapp.net';
const JUAN = '573001234567@s.whatsapp.net';
let store: FakeStore;
let wa: FakeConnector;
let ing: Ingestor;
let n = 0;

const msg = (over: Partial<IncomingMessage>): IncomingMessage => ({
  sessionId: contador.id,
  chatId: CHRISTIAN,
  chatKind: 'privado',
  chatName: null,
  messageId: `M${++n}`,
  sender: { id: '573016667788', phone: '573016667788', name: 'Christian Mora' },
  sentAt: new Date('2026-10-30T15:00:00Z'),
  text: null,
  media: null,
  fromMe: false,
  ...over,
});
const dice = (text: string) => msg({ text });
const bandeja = (jid: string) => store.outbox.filter((o) => o.chat_jid === jid);
const ultimo = (jid = CHRISTIAN) => bandeja(jid).at(-1)?.body ?? '';

beforeEach(async () => {
  store = new FakeStore();
  wa = new FakeConnector(contador);
  ing = new Ingestor(
    store,
    { maxDownloadBytes: 25 * 1024 * 1024, maxChatBytes: 50 * 1024 * 1024, maxUploadBytes: 6 * 1024 * 1024, maxSide: 1600, jpegQuality: 80 },
    {
      guiaUrl: 'https://mrluks.com/guia',
      webUrl: 'https://mrluks.com',
      joins: new RateLimiter({ minIntervalMs: 0, maxPerHourPerGroup: 2, maxPerHourTotal: 4 }),
    },
    silentLog,
  );
  // Ya le había escrito (la bienvenida ya salió)
  await ing.onMessage(contador, wa, dice('gracias'));
});

describe('pedir un cobro por privado', () => {
  it('pregunta lo que falta, confirma, lo crea y pregunta cómo le pagan (queda en su perfil)', async () => {
    expect(await ing.onMessage(contador, wa, dice('Juan me debe 50 mil por la boleta del concierto'))).toBe('chepito:telefono');
    expect(ultimo()).toContain('¿Cuál es el WhatsApp de Juan? Mándame su contacto o su número');

    const tarjeta = msg({ contacto: { nombre: 'Juan Pérez', telefono: '573001234567' } });
    expect(await ing.onMessage(contador, wa, tarjeta)).toBe('chepito:confirmar');
    expect(ultimo()).toBe(
      '🧾 ¿Le cobro a *Juan* (+57 300 123 4567) *$50.000* por «la boleta del concierto»?\n' +
        'Chepito 🎩 le escribe, se presenta y se lo recuerda cada 2 días, hasta 4 veces. Respóndeme *sí* o *no*.',
    );

    expect(await ing.onMessage(contador, wa, dice('Sí'))).toBe('chepito:creado');
    expect(store.cobrosCreados).toEqual([
      { jid: CHRISTIAN, cobro: { nombre: 'Juan', telefono: '573001234567', monto: 50000, concepto: 'la boleta del concierto' }, avisarEnMin: 10 },
    ]);
    expect(ultimo()).toContain('✅ Listo: Chepito 🎩 le cobra a *Juan* *$50.000* por «la boleta del concierto».');
    expect(ultimo()).toContain('🔗 Lo sigues en https://mrluks.com/c/mc/cobros');
    expect(ultimo()).toContain('💳 ¿Quieres que le mande cómo pagarte?');

    expect(await ing.onMessage(contador, wa, dice('Nequi 300 123 4567'))).toBe('chepito:pago_guardado');
    expect(store.pagosGuardados).toEqual([{ nequi: '3001234567' }]);
    expect(ultimo()).toBe('💳 Guardado en tu perfil: Nequi *300 123 4567*. Se lo mando a Juan para que te pague.');
  });

  it('con solo el contacto pregunta si le cobra; «no» lo deja', async () => {
    expect(await ing.onMessage(contador, wa, msg({ contacto: { nombre: 'Ana', telefono: '573109998877' } }))).toBe('chepito:contacto');
    expect(ultimo()).toContain('📇 Recibí el contacto de Ana. ¿Quieres que le cobre algo?');
    expect(await ing.onMessage(contador, wa, dice('30 mil'))).toBe('chepito:concepto');
    expect(ultimo()).toContain('📝 ¿Por qué te debe Ana?');
    expect(await ing.onMessage(contador, wa, dice('el almuerzo'))).toBe('chepito:confirmar');
    expect(await ing.onMessage(contador, wa, dice('no'))).toBe('chepito:cancelado');
    expect(store.cobrosCreados).toEqual([]);
  });

  it('si ya tiene cómo le pagan, no se lo pregunta', async () => {
    store.miPago = { llave: '@christian' };
    await ing.onMessage(contador, wa, dice('Pedro 3009998877 me debe 20 mil del taxi'));
    expect(await ing.onMessage(contador, wa, dice('dale'))).toBe('chepito:creado');
    expect(ultimo()).not.toContain('💳');
  });

  it('sin sesión en Luks: el link para entrar, y después «sí» otra vez', async () => {
    store.respuestaCobro = { ok: false, reason: 'sin_sesion' };
    await ing.onMessage(contador, wa, dice('Pedro 3009998877 me debe 20 mil del taxi'));
    expect(await ing.onMessage(contador, wa, dice('sí'))).toBe('chepito:sin_sesion');
    expect(bandeja(CHRISTIAN).some((o) => o.reason === 'verify')).toBe(true);
    store.respuestaCobro = {};
    expect(await ing.onMessage(contador, wa, dice('sí'))).toBe('chepito:creado');
  });

  it('si a ese número no se le puede cobrar, lo dice', async () => {
    store.respuestaCobro = { ok: false, reason: 'no_quiere' };
    await ing.onMessage(contador, wa, dice('Pedro 3009998877 me debe 20 mil del taxi'));
    expect(await ing.onMessage(contador, wa, dice('sí'))).toBe('chepito:no_quiere');
    expect(ultimo()).toBe('🔕 Pedro le pidió a Mister Luks que no le escriba más, así que no le puedo cobrar.');
  });
});

describe('lo que responde quien debe', () => {
  const juan = { id: '573001234567', phone: '573001234567', name: 'Juan' };
  const respuesta = (over: Partial<ChepitoRespuesta> = {}): ChepitoRespuesta => ({
    cobro_id: 'cb1',
    account_id: 'mc',
    deudor: 'Juan',
    acreedor: 'Christian Mora',
    monto: 50000,
    concepto: 'la boleta',
    currency: 'COP',
    language: 'es',
    avisos: 1,
    acreedor_chat: CHRISTIAN,
    ...over,
  });

  it('«ya pagué»: le agradece (sin la bienvenida) y le avisa a quien cobra', async () => {
    store.cobrando = [respuesta()];
    expect(await ing.onMessage(contador, wa, msg({ chatId: JUAN, sender: juan, text: 'ya pagué' }))).toBe('chepito:pagado');
    expect(bandeja(JUAN).map((o) => o.body)).toEqual(['🎩 ¡Gracias, Juan! Le aviso a Christian que ya le pagaste. No te escribo más por esto.']);
    expect(ultimo()).toBe(avisoAlAcreedor('pagado', respuesta()));
    expect(ultimo()).toContain('💸 ¡Buenas noticias! *Juan* dice que ya te pagó *$50.000* por «la boleta»');
  });

  it('«no le debo» y «no me escribas»', async () => {
    store.cobrando = [respuesta()];
    expect(await ing.onMessage(contador, wa, msg({ chatId: JUAN, sender: juan, text: 'yo no le debo nada' }))).toBe('chepito:no_debe');
    expect(ultimo()).toContain('🙅 *Juan* dice que no te debe *$50.000*');

    store.cobrando = [respuesta({ cobro_id: 'cb2' })];
    expect(await ing.onMessage(contador, wa, msg({ chatId: JUAN, sender: juan, text: 'no me escribas' }))).toBe('chepito:no_escribas');
    expect(ultimo(JUAN)).toBe('🎩 Listo, no te vuelvo a escribir. Le aviso a Christian.');
    expect(ultimo()).toContain('con eso ya sabes que no te va a pagar pronto 😅');
  });

  it('si no le cobran nada, «ya pagué» sigue como siempre', async () => {
    expect(await ing.onMessage(contador, wa, msg({ chatId: JUAN, sender: juan, text: 'ya pagué' }))).not.toMatch(/^chepito:/);
    expect(store.respuestasChepito).toEqual(['pagado']);
  });
});
