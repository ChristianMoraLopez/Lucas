import { describe, expect, it } from 'vitest';
import {
  esMensajeDeLuks,
  esNoMeEscribas,
  esPedidoDeAyuda,
  esSoyYo,
  formatCOP,
  formatReplies,
  idiomaDeNumero,
  LINK_GRUPO,
  listaNombres,
  looksLikeExpense,
  MISTER,
  MSG,
  nombreDelChat,
  type PendingReply,
  PREGUNTA_DESDE_CUANDO,
  parseHistoria,
  parseInviteLink,
  parseLinkCommand,
  respuestaNumerada,
  sinLineaDelLink,
} from '../src/text.js';

describe('«lucas CÓDIGO»', () => {
  it('reconoce el código como lo escriban', () => {
    expect(parseLinkCommand('lucas PASEO-7K2Q')).toBe('PASEO-7K2Q');
    expect(parseLinkCommand('  Luks: paseo-7k2q ')).toBe('PASEO-7K2Q');
    expect(parseLinkCommand('LUCAS CASA-AB12 gracias')).toBe('CASA-AB12');
    expect(parseLinkCommand('@573150000000 lucas PASEO-7K2Q')).toBe('PASEO-7K2Q');
  });

  it('no confunde un gasto con el comando', () => {
    expect(parseLinkCommand('taxi 45 lucas')).toBeNull();
    expect(parseLinkCommand('lucas 45 el taxi')).toBeNull();
    expect(parseLinkCommand('PASEO-7K2Q')).toBeNull();
    expect(parseLinkCommand('hola lucas PASEO-7K2Q')).toBeNull();
    expect(parseLinkCommand(null)).toBeNull();
  });
});

describe('¿parece un gasto?', () => {
  it.each([
    'taxi al aeropuerto 45 lucas',
    'almuerzo 25.000',
    '$80.000 el hotel',
    'pagué 120000 por las cabañas',
    '2 palos el arriendo',
    '15k la cerveza',
    'mercado 1,250,000',
    'gasolina 90 mil, la pagó Andrés',
  ])('«%s» sí', (t) => expect(looksLikeExpense(t)).toBe(true));

  it.each(['nos vemos a las 3', 'jajaja', 'llego en 10 min', '300 123 4567', '+57 300 123 4567', '', null])('«%s» no', (t) =>
    expect(looksLikeExpense(t)).toBe(false),
  );
});

describe('¿lo hizo Luks?', () => {
  it.each([
    '🧾 *Paseo*\nGastamos *$480.000* entre 4\n• Santi → Vale: *$80.000*\nhttps://mrluks.com/r/76B5n5hlRzSyAs39_Yl50w\n\n_Esto se hizo en mrluks.com_',
    'Hola Mafe 👋 me debes $45.000 (45 lucas).\n\nCuentas hechas con Luks · mrluks.com',
    'miren 50 lucas https://lucas-tau-black.vercel.app/r/76B5n5hlRzSyAs39_Yl50w',
    'Anotado: Asadero · $272.500 · pagó Felipe.',
    'Anotados 2:\n• Hielo · $8.000\n• Ron · $116.000',
    'Recibido: Taxi · $45.000. Queda por revisar en Luks.',
    'Logged: Taxi · $45.00 · paid by Ana.',
    'Received: Uber · $18.50. Needs review in Luks.',
    'Already logged: Hotel · $900.00 (Sep 24).',
    'Anotado: Mercado · Bs 120,50 · pagó Juan.',
    '🧾 *Beach trip*\nWe spent *$480.00*\n\n_Made with mrluks.com_',
  ])('«%s» sí', (t) => expect(esMensajeDeLuks(t)).toBe(true));

  it.each(['taxi al aeropuerto 45 lucas', 'Recibido el pago de 50.000, gracias', 'pagué 120.000 · el hotel', 'https://www.reddit.com/r/Colombia 20 mil', null])(
    '«%s» no',
    (t) => expect(esMensajeDeLuks(t)).toBe(false),
  );
});

const r = (over: Partial<PendingReply>): PendingReply => ({
  message_id: 'm1',
  group_jid: 'g@g.us',
  wa_message_id: 'W1',
  sender_wa_id: null,
  status: 'done',
  received_at: '2026-10-01T15:00:00Z',
  expense: { merchant: 'Asadero El Llanero', total_cop: 272_500, status: 'confirmed', payer: 'Mafe', split_count: 8 },
  duplicate_of: null,
  ...over,
});

describe('confirmaciones', () => {
  it('pesos sin centavos y con puntos', () => {
    expect(formatCOP(272_500)).toBe('$272.500');
    expect(formatCOP(4_816_000)).toBe('$4.816.000');
    expect(formatCOP(900)).toBe('$900');
  });

  it('un gasto confirmado, uno por revisar y uno repetido', () => {
    expect(formatReplies([r({})])).toBe('✅ Anotado: Asadero El Llanero · $272.500 · pagó Mafe · entre 8.');
    expect(formatReplies([r({ expense: { merchant: 'Taxi', total_cop: 45_000, status: 'pending_review', payer: null, split_count: 1 } })])).toBe(
      '🧾 Recibido: Taxi · $45.000. Queda por revisar en Luks 👀',
    );
    expect(
      formatReplies([r({ status: 'duplicate', expense: null, duplicate_of: { merchant: 'Hostal', total_cop: 900_000, expense_date: '2026-09-24' } })]),
    ).toBe('🔁 Ya estaba anotado: Hostal · $900.000 (24 sep).');
  });

  it('varios seguidos van en un solo mensaje', () => {
    const t = formatReplies([
      r({}),
      r({ message_id: 'm2', expense: { merchant: 'Taxi', total_cop: 45_000, status: 'pending_review', payer: 'Santi', split_count: 4 } }),
    ]);
    expect(t).toBe(
      '✅ Anotados 2:\n• Asadero El Llanero · $272.500 · pagó Mafe · entre 8\n• Taxi · $45.000 · pagó Santi · entre 4\n👀 Uno queda por revisar en Luks.',
    );
  });
});

describe('en inglés y en otras monedas', () => {
  it('dólares y bolivianos en centavos; pesos chilenos como los colombianos', () => {
    expect(formatCOP(1250, 'USD', 'en')).toBe('$12.50');
    expect(formatCOP(1_234_550, 'USD', 'en')).toBe('$12,345.50');
    expect(formatCOP(1250, 'BOB')).toBe('Bs 12,50');
    expect(formatCOP(15_990, 'CLP')).toBe('$15.990');
    expect(formatCOP(272_500, 'COP', 'en')).toBe('$272,500');
  });

  it('las confirmaciones en el idioma de la cuenta', () => {
    const en = { currency: 'USD', language: 'en' } as const;
    expect(formatReplies([r({ ...en, expense: { merchant: 'Diner', total_cop: 8_450, status: 'confirmed', payer: 'Sam', split_count: 3 } })])).toBe(
      '✅ Logged: Diner · $84.50 · paid by Sam · split 3 ways.',
    );
    expect(formatReplies([r({ ...en, expense: { merchant: 'Uber', total_cop: 1_850, status: 'pending_review', payer: null, split_count: 1 } })])).toBe(
      '🧾 Received: Uber · $18.50. Needs review in Luks 👀',
    );
    expect(
      formatReplies([r({ ...en, status: 'duplicate', expense: null, duplicate_of: { merchant: 'Motel', total_cop: 12_000, expense_date: '2026-09-24' } })]),
    ).toBe('🔁 Already logged: Motel · $120.00 (Sep 24).');
    expect(
      formatReplies([
        r({ ...en, expense: { merchant: 'Diner', total_cop: 8_450, status: 'confirmed', payer: null, split_count: 1 } }),
        r({ ...en, message_id: 'm2', expense: { merchant: 'Gas', total_cop: 4_000, status: 'pending_review', payer: null, split_count: 1 } }),
      ]),
    ).toBe('✅ Logged 2:\n• Diner · $84.50\n• Gas · $40.00\n👀 One needs review in Luks.');
    // Y Luks no se anota a sí mismo (con el emoji y sin él, como las de antes)
    expect(esMensajeDeLuks('✅ Logged: Diner · $84.50 · paid by Sam · split 3 ways.')).toBe(true);
    expect(esMensajeDeLuks('🧾 Received: Uber · $18.50. Needs review in Luks 👀')).toBe(true);
    expect(esMensajeDeLuks('Logged: Diner · $84.50 · paid by Sam · split 3 ways.')).toBe(true);
  });
});

describe('el nombre nuevo', () => {
  it('«luks CÓDIGO» enlaza, y «lucas CÓDIGO» (el nombre de antes) también', () => {
    expect(parseLinkCommand('luks PASEO-7K2Q')).toBe('PASEO-7K2Q');
    expect(parseLinkCommand('Luks: casa-ab12')).toBe('CASA-AB12');
    expect(parseLinkCommand('lucas PASEO-7K2Q')).toBe('PASEO-7K2Q');
    expect(parseLinkCommand('luks 45 el taxi')).toBeNull();
  });
});

describe('lo que le escriben a Mister Luks', () => {
  it('el link de un grupo, como lo peguen', () => {
    expect(parseInviteLink('https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv')).toBe('AbCdEfGhIjKlMnOpQrStUv');
    expect(parseInviteLink('Únete a mi grupo: chat.whatsapp.com/invite/AbCdEfGhIjKlMnOpQrStUv gracias')).toBe('AbCdEfGhIjKlMnOpQrStUv');
    expect(parseInviteLink('https://chat.whatsapp.com/corto')).toBeNull();
    expect(parseInviteLink('taxi 45 lucas')).toBeNull();
  });

  it.each(['ayuda', 'Ayuda!', 'instrucciones', 'luks ayuda', 'Mister Luks: ayuda', '@573337627471 ayuda', 'help', 'Help?', 'guía'])('«%s» pide la guía', (t) =>
    expect(esPedidoDeAyuda(t)).toBe(true),
  );

  it.each(['necesito ayuda con el taxi', 'ayuda a Vale con 20 lucas', 'gracias por la ayuda', null])('«%s» no', (t) => expect(esPedidoDeAyuda(t)).toBe(false));

  it('el idioma por el número: +1 en inglés, lo demás en español', () => {
    expect(idiomaDeNumero('13055550100')).toBe('en');
    expect(idiomaDeNumero('573016667788')).toBe('es');
    expect(idiomaDeNumero(null)).toBe('es');
  });
});

describe('los saludos de Mister Luks', () => {
  it('nombra a quienes ya usan Luks, en singular y en plural, con el link para crear la cuenta', () => {
    expect(listaNombres(['Vale', 'Santi', 'Mafe'], 'es')).toBe('Vale, Santi y Mafe');
    expect(listaNombres(['Vale', 'Sam'], 'en')).toBe('Vale and Sam');
    const uno = MISTER.saludoGrupo('es', null, ['Christian']);
    expect(uno).toContain(`Veo que Christian ya usa Luks 🙌 Christian, la cuenta de este grupo te espera en la app 👉 ${LINK_GRUPO}`);
    const dos = MISTER.saludoGrupo('es', null, ['Christian', 'Vale']);
    expect(dos).toContain(`Veo que Christian y Vale ya usan Luks 🙌 Alguno de ustedes, cree la cuenta del grupo en la app 👉 ${LINK_GRUPO}`);
    expect(MISTER.saludoGrupo('en', null, ['Sam'])).toContain('I see Sam already uses Luks 🙌 Sam, this group’s account is waiting for you');
    expect(MISTER.saludoGrupo('es', 'Paseo', ['Vale', 'Santi'])).toContain('En la cuenta ya están Vale y Santi 🙌');
    // Con cuenta no hay link que crear
    expect(MISTER.saludoGrupo('es', 'Paseo')).not.toContain(LINK_GRUPO);
  });

  it('sin nadie conocido: quien ya tiene cuenta (con Gmail) escribe «luks soy yo»; si no, una sola persona la crea', () => {
    const es = MISTER.saludoGrupo('es', null);
    expect(es).toContain('Todavía no reconozco ningún número de este grupo en Luks');
    expect(es).toContain('¿Ya tienes cuenta (por ejemplo, entraste con Gmail)? Escribe *luks soy yo*');
    expect(es).toContain('*Una sola persona* crea la cuenta aquí');
    expect(es).toContain(`👉 ${LINK_GRUPO}`);
    const en = MISTER.saludoGrupo('en', null);
    expect(en).toContain('Type *luks it’s me* here');
    // Lo que se le pide escribir es justo lo que Mister Luks entiende
    expect(esSoyYo('luks soy yo')).toBe(true);
    expect(esSoyYo('luks it’s me')).toBe(true);
  });

  it('si el grupo ya tiene cuenta cuando se manda, la línea del link se quita', () => {
    expect(sinLineaDelLink(MISTER.guiaGrupo('es'))).toBe('📘 Aquí tienes la guía de Mister Luks. La completa está en mrluks.com/guia 😉');
    expect(sinLineaDelLink(`Hola\n\nCrea la cuenta 👉 ${LINK_GRUPO}\n\nChao`)).toBe('Hola\n\nChao');
  });

  it('lo que escribe Mister Luks no se anota como gasto, aunque traiga montos de ejemplo', () => {
    for (const t of [
      MISTER.saludoGrupo('es', null),
      MISTER.saludoGrupo('en', 'Trip', ['Sam']),
      MISTER.bienvenida('es'),
      MISTER.bienvenida('en'),
      MSG.linked('Paseo', 8),
      MSG.linked('Trip', 3, 'en'),
      MSG.moved('DaniChile', 'Chile Hack', 5),
      MSG.moved('Trip 2', 'Trip', 3, 'en'),
      // El aviso de la cuenta siguiente (anunciar_cuenta_siguiente, migración 370)
      '🧾 «Chile Hack» ya estaba liquidada, así que abrí una cuenta nueva para lo que sigue: «Chile Hack 2». Ahí anoté este gasto 😉 Si quieren, cámbienle el nombre en mrluks.com.',
      '🧾 “Chile Hack” was already settled, so I opened a new account for what’s next: “Chile Hack 2”. I logged this expense there 😉 You can rename it at mrluks.com.',
    ]) {
      expect(esMensajeDeLuks(t)).toBe(true);
    }
  });
});

describe('«luks soy yo»', () => {
  it.each(['luks soy yo', 'Luks, soy yo!', 'mister luks soy yo', '@573337627471 soy yo', 'soy yo', "luks it's me", 'Luks this is me'])('«%s» sí', (t) =>
    expect(esSoyYo(t)).toBe(true),
  );
  it.each(['soy yo el que pagó el taxi', 'luks soy yo 45 lucas', 'yo soy', null])('«%s» no', (t) => expect(esSoyYo(t)).toBe(false));
});

describe('¿desde cuándo anoto?', () => {
  const luks = new Set(['573337627471', 'lid:99990000']);
  it.each([
    ['luks desde ya', 'desde_ya'],
    ['Mister Luks, desde ahora!', 'desde_ya'],
    ['mrluks lee todo', 'todo'],
    ['luks todo el chat', 'todo'],
    ['@573337627471 desde ya', 'desde_ya'],
    ['luks from now on', 'desde_ya'],
    ['luks read the whole chat', 'todo'],
  ])('«%s» → %s', (t, modo) => expect(parseHistoria(t, luks)).toBe(modo));

  it.each(['desde ya', '@573001112233 desde ya', 'luks desde ya pago yo el taxi', 'lee todo'])('«%s» no es para Luks', (t) =>
    expect(parseHistoria(t, luks)).toBeNull(),
  );

  it('«1» y «2» a secas responden la pregunta', () => {
    expect(respuestaNumerada('1')).toBe('desde_ya');
    expect(respuestaNumerada(' 2 ')).toBe('todo');
    expect(respuestaNumerada('2️⃣')).toBe('todo');
    expect(respuestaNumerada('12')).toBeNull();
    expect(respuestaNumerada('2 cervezas')).toBeNull();
  });

  it('el nombre del grupo sale del archivo del chat exportado', () => {
    expect(nombreDelChat('Chat de WhatsApp con Paseo Santa Marta.zip')).toBe('Paseo Santa Marta');
    expect(nombreDelChat('WhatsApp Chat with Trip.txt')).toBe('Trip');
    expect(nombreDelChat('WhatsApp Chat - Casa V&A.zip')).toBe('Casa V&A');
    expect(nombreDelChat('fotos.zip')).toBeNull();
  });

  it('los avisos de quién decidió y del chat importado no se anotan como gasto', () => {
    expect(esMensajeDeLuks('👍 Listo: Santi dijo que anote *desde ahora*. Lo de antes del 12 oct no lo toco.')).toBe(true);
    expect(esMensajeDeLuks('📥 Leí el chat exportado: encontré 1200 gastos de antes del 12 oct.')).toBe(true);
    expect(esMensajeDeLuks('📥 I read the exported chat: I found 3 expenses from before Oct 12.')).toBe(true);
    expect(MSG.linked('Paseo', 8)).toContain(PREGUNTA_DESDE_CUANDO.es);
  });
});

describe('«no me escribas» (migración 600)', () => {
  it.each(['no me escribas', 'No me escribas más', 'luks no me escribas por aquí', 'porfa no me escribas', "Don't message me", 'stop messaging me'])(
    '«%s» → sí',
    (t) => expect(esNoMeEscribas(t)).toBe(true),
  );
  it.each(['no me escribas eso en el grupo', 'escríbeme', 'ya pagué', 'no me cuentes'])('«%s» → no', (t) => expect(esNoMeEscribas(t)).toBe(false));
});

describe('respuestas por privado (migración 630)', () => {
  const base = {
    message_id: 'm1',
    group_jid: '573016667788@s.whatsapp.net',
    wa_message_id: 'W1',
    sender_wa_id: '573016667788',
    received_at: '2026-10-30T12:00:00Z',
    privado: true,
    account_name: 'Casa',
    duplicate_of: null,
  };
  it('dicen en qué cuenta quedó, y también si no era un gasto o no se pudo leer', () => {
    const anotado = formatReplies([
      { ...base, status: 'done', expense: { merchant: 'Arriendo', total_cop: 800_000, status: 'confirmed', payer: 'Mafe', split_count: 2 } },
    ]);
    expect(anotado).toBe('✅ Anotado en «Casa»: Arriendo · $800.000 · pagó Mafe · entre 2.\n\n📊 Más detalle en mrluks.com');
    expect(esMensajeDeLuks(anotado)).toBe(true);
    expect(formatReplies([{ ...base, status: 'not_expense', expense: null }])).toContain('Eso no parece un gasto, así que no lo anoté en «Casa»');
    expect(formatReplies([{ ...base, status: 'failed', expense: null }])).toContain('No pude leerlo');
  });
});
