import { describe, expect, it } from 'vitest';
import { esMensajeDeLuks, formatCOP, formatReplies, looksLikeExpense, type PendingReply, parseLinkCommand } from '../src/text.js';

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
    expect(formatReplies([r({})])).toBe('Anotado: Asadero El Llanero · $272.500 · pagó Mafe · entre 8.');
    expect(formatReplies([r({ expense: { merchant: 'Taxi', total_cop: 45_000, status: 'pending_review', payer: null, split_count: 1 } })])).toBe(
      'Recibido: Taxi · $45.000. Queda por revisar en Luks.',
    );
    expect(
      formatReplies([r({ status: 'duplicate', expense: null, duplicate_of: { merchant: 'Hostal', total_cop: 900_000, expense_date: '2026-09-24' } })]),
    ).toBe('Ya estaba anotado: Hostal · $900.000 (24 sep).');
  });

  it('varios seguidos van en un solo mensaje', () => {
    const t = formatReplies([
      r({}),
      r({ message_id: 'm2', expense: { merchant: 'Taxi', total_cop: 45_000, status: 'pending_review', payer: 'Santi', split_count: 4 } }),
    ]);
    expect(t).toBe(
      'Anotados 2:\n• Asadero El Llanero · $272.500 · pagó Mafe · entre 8\n• Taxi · $45.000 · pagó Santi · entre 4\nUno queda por revisar en Luks.',
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
      'Logged: Diner · $84.50 · paid by Sam · split 3 ways.',
    );
    expect(formatReplies([r({ ...en, expense: { merchant: 'Uber', total_cop: 1_850, status: 'pending_review', payer: null, split_count: 1 } })])).toBe(
      'Received: Uber · $18.50. Needs review in Luks.',
    );
    expect(
      formatReplies([r({ ...en, status: 'duplicate', expense: null, duplicate_of: { merchant: 'Motel', total_cop: 12_000, expense_date: '2026-09-24' } })]),
    ).toBe('Already logged: Motel · $120.00 (Sep 24).');
    expect(
      formatReplies([
        r({ ...en, expense: { merchant: 'Diner', total_cop: 8_450, status: 'confirmed', payer: null, split_count: 1 } }),
        r({ ...en, message_id: 'm2', expense: { merchant: 'Gas', total_cop: 4_000, status: 'pending_review', payer: null, split_count: 1 } }),
      ]),
    ).toBe('Logged 2:\n• Diner · $84.50\n• Gas · $40.00\nOne needs review in Luks.');
    // Y Luks no se anota a sí mismo
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
