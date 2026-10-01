import { describe, expect, it } from 'vitest';
import { formatCOP, formatReplies, looksLikeExpense, type PendingReply, parseLinkCommand } from '../src/text.js';

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

describe('el nombre nuevo', () => {
  it('«luks CÓDIGO» enlaza, y «lucas CÓDIGO» (el nombre de antes) también', () => {
    expect(parseLinkCommand('luks PASEO-7K2Q')).toBe('PASEO-7K2Q');
    expect(parseLinkCommand('Luks: casa-ab12')).toBe('CASA-AB12');
    expect(parseLinkCommand('lucas PASEO-7K2Q')).toBe('PASEO-7K2Q');
    expect(parseLinkCommand('luks 45 el taxi')).toBeNull();
  });
});
