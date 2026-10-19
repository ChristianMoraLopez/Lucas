import { describe, expect, it } from 'vitest';
import { deudasDe, type Numeros, PREGUNTAS, RESPUESTA } from '../src/preguntas.js';
import { aMisterLuks, canalDe, esMensajeDeLuks, intencionDe, looksLikeExpense } from '../src/text.js';

// Las preguntas a Mister Luks (fase 7): quién le habla, qué quiere y cómo responde

const LUKS = new Set(['573337627471', 'lid:98765432101234']);

describe('¿le hablan a Mister Luks?', () => {
  it('con su nombre al principio, con una mención o respondiendo un mensaje suyo', () => {
    expect(aMisterLuks({ text: 'luks cuánto llevamos?' }, LUKS)).toEqual({ texto: 'cuánto llevamos?', explicito: false });
    expect(aMisterLuks({ text: 'Mister Luks, quién le debe a quién' }, LUKS)).toEqual({ texto: 'quién le debe a quién', explicito: false });
    expect(aMisterLuks({ text: '@573337627471 cuánto debo', mentions: ['573337627471'] }, LUKS)).toEqual({ texto: 'cuánto debo', explicito: true });
    expect(aMisterLuks({ text: 'cuánto debo @98765432101234 ?', mentions: ['98765432101234'] }, LUKS)).toEqual({ texto: 'cuánto debo  ?', explicito: true });
    expect(aMisterLuks({ text: 'y cuánto llevamos', quotedFrom: '573337627471' }, LUKS)).toEqual({ texto: 'y cuánto llevamos', explicito: true });
  });

  it('a otros no', () => {
    expect(aMisterLuks({ text: 'cuánto llevamos?' }, LUKS)).toBeNull();
    expect(aMisterLuks({ text: '@573001112233 cuánto debo', mentions: ['573001112233'] }, LUKS)).toBeNull();
    expect(aMisterLuks({ text: 'Lukas trae el hielo' }, LUKS)).toBeNull();
    expect(aMisterLuks({ text: 'y eso?', quotedFrom: '573001112233' }, LUKS)).toBeNull();
  });
});

describe('qué le preguntan (reglas en español e inglés)', () => {
  it.each([
    ['cuánto llevamos?', 'total'],
    ['Cuánto vamos', 'total'],
    ['how much so far', 'total'],
    ['quién le debe a quién', 'deudas'],
    ['¿cómo van las cuentas?', 'deudas'],
    ['who owes whom', 'deudas'],
    ['cuánto debo', 'mi_saldo'],
    ['cuánto me deben?', 'mi_saldo'],
    ['how much do I owe', 'mi_saldo'],
    ['¿qué debo?', 'mi_saldo'],
    ['de qué le debo a Daniel', 'mi_saldo'],
    ['por qué debo tanto', 'mi_saldo'],
    ['why do I owe that', 'mi_saldo'],
    ['mis gastos', 'mis_gastos'],
    ['qué he pagado', 'mis_gastos'],
    ['my expenses', 'mis_gastos'],
    ['mándame al privado', 'privado'],
    ['dímelo aquí', 'aqui'],
    ['no me cuentes', 'no_me_cuentes'],
    ["don't count me", 'no_me_cuentes'],
    ['cuéntame otra vez', 'cuentame'],
    ['count me again', 'cuentame'],
  ])('«%s» → %s', (t, i) => expect(intencionDe(t)).toBe(i));

  it('lo demás no', () => {
    expect(intencionDe('hola')).toBeNull();
    expect(intencionDe('trae hielo')).toBeNull();
    expect(intencionDe('')).toBeNull();
  });

  it('«privado» o «aquí» a secas responden «¿privado o aquí?»; en una frase, no', () => {
    expect(canalDe('Privado')).toBe('privado');
    expect(canalDe('aquí!')).toBe('aqui');
    expect(canalDe('here')).toBe('aqui');
    expect(canalDe('aquí estoy, ya llegué')).toBeNull();
  });
});

const NUMEROS: Numeros = {
  identity_id: 'i-573016667788',
  pref: null,
  contador_en_grupo: true,
  ok: true,
  account: { name: 'Paseo', type: 'evento', status: 'active', currency: 'COP', language: 'es', month: null },
  optout: false,
  total: 1_250_000,
  count: 12,
  pending: 2,
  incomplete: 0,
  people: [
    { id: 'v', name: 'Valeria', paid: 900_000, share: 500_000, balance: 400_000 },
    { id: 's', name: 'Santi', paid: 150_000, share: 250_000, balance: -100_000 },
    { id: 'm', name: 'Mafe Cárdenas', paid: 200_000, share: 500_000, balance: -300_000 },
  ],
  settlement: null,
  me: {
    id: 'm',
    name: 'Mafe Cárdenas',
    paid_total: 200_000,
    paid_count: 2,
    expenses: [
      { merchant: 'Arepas', total: 80_000, date: '2026-09-27' },
      { merchant: 'Lancha', total: 120_000, date: '2026-09-26' },
    ],
  },
};

describe('las respuestas', () => {
  it('«cuánto llevamos»: el total, lo que falta revisar y la firma', () => {
    expect(RESPUESTA.total(NUMEROS, 'es')).toBe(
      '🧾 En «Paseo» llevan *$1.250.000* en 12 gastos.\n👀 2 quedan por revisar en la app.\n\n📊 Más detalle en mrluks.com',
    );
    const casa: Numeros = { ...NUMEROS, account: { ...NUMEROS.account, name: 'Casa', type: 'hogar', month: '2026-10-01' }, pending: 0, count: 1 };
    expect(RESPUESTA.total(casa, 'en')).toBe('🧾 “Casa” is at *$1,250,000* in October across 1 expense.\n\n📊 More detail at mrluks.com');
  });

  it('«quién le debe a quién»: como Liquidar, o la liquidación si ya la hicieron', () => {
    expect(RESPUESTA.deudas(NUMEROS, 'es')).toBe(
      '💸 Así van las cuentas de «Paseo» (si liquidaran hoy):\n• Mafe Cárdenas le paga a Valeria *$300.000*\n• Santi le paga a Valeria *$100.000*\n\n📊 Más detalle en mrluks.com',
    );
    const liquidado: Numeros = {
      ...NUMEROS,
      settlement: [{ from: 'Mafe Cárdenas', to: 'Valeria', from_id: 'm', to_id: 'v', amount: 300_000, paid: true }],
    };
    expect(deudasDe(liquidado).liquidado).toBe(true);
    expect(RESPUESTA.deudas(liquidado, 'es')).toContain('• Mafe Cárdenas → Valeria: *$300.000* ✅');
    expect(RESPUESTA.deudas({ ...NUMEROS, people: [] }, 'es')).toBe('🙌 En «Paseo» todos están a paz y salvo.');
  });

  it('si la cuenta liquida «a quien pagó por cada uno», responde con esas transferencias', () => {
    const directo: Numeros = {
      ...NUMEROS,
      direct: true,
      direct_transfers: [
        { from: 'Mafe Cárdenas', to: 'Santi', from_id: 'm', to_id: 's', amount: 30_000 },
        { from: 'Mafe Cárdenas', to: 'Valeria', from_id: 'm', to_id: 'v', amount: 270_000 },
      ],
    };
    expect(deudasDe(directo)).toEqual({
      liquidado: false,
      lista: [
        { de: 'Mafe Cárdenas', deId: 'm', a: 'Santi', aId: 's', monto: 30_000, pagada: false },
        { de: 'Mafe Cárdenas', deId: 'm', a: 'Valeria', aId: 'v', monto: 270_000, pagada: false },
      ],
    });
    // Cruzando deudas (o con la base de antes), el cálculo de siempre
    expect(deudasDe({ ...directo, direct: false }).lista).toHaveLength(2);
    expect(deudasDe({ ...directo, direct: false }).lista[0].a).toBe('Valeria');
  });

  it('«cuánto debo»: lo suyo, a quién le paga y la firma', () => {
    expect(RESPUESTA.miSaldo(NUMEROS, NUMEROS.me as NonNullable<Numeros['me']>, 'es')).toBe(
      '💸 Mafe, en «Paseo» pusiste *$200.000* y te tocan *$500.000*: debes *$300.000*.\n• Le pagas a Valeria *$300.000*\n\n📊 Más detalle en mrluks.com',
    );
  });

  it('«cuánto debo», con lo que consumió (la 470): qué pidió en cada gasto y cuánto costó', () => {
    const me: NonNullable<Numeros['me']> = {
      ...(NUMEROS.me as NonNullable<Numeros['me']>),
      consumo: [
        {
          merchant: 'Trattoria',
          payer_person_id: 'v',
          payer_name: 'Valeria',
          shares: [
            { person_id: 'm', amount_cop: 300_000 },
            { person_id: 'v', amount_cop: 100_000 },
          ],
          items: [
            { name: 'Pizza', quantity: 1, total: 180_000, people: [{ id: 'm', units: 1 }] },
            {
              name: 'Vino',
              quantity: 2,
              total: 160_000,
              people: [
                { id: 'm', units: 1 },
                { id: 'v', units: 1 },
              ],
            },
            { name: 'Pasta', quantity: 1, total: 60_000, people: [{ id: 'v', units: 1 }] },
          ],
        },
        {
          merchant: 'Arepas',
          payer_person_id: 'm',
          payer_name: 'Mafe Cárdenas',
          shares: [
            { person_id: 'm', amount_cop: 200_000 },
            { person_id: 'v', amount_cop: 0 },
          ],
          items: null,
        },
      ],
    };
    expect(RESPUESTA.miSaldo(NUMEROS, me, 'es')).toBe(
      [
        '💸 Mafe, en «Paseo» pusiste *$200.000* y te tocan *$500.000*: debes *$300.000*.',
        '• Le pagas a Valeria *$300.000*',
        '',
        '🧾 *Lo tuyo, ítem por ítem:*',
        '',
        '*Trattoria* (pagó Valeria)',
        '• Pizza: $180.000',
        '• Vino (1 de 2): $80.000',
        '• Propina y servicio: $40.000',
        'Total: *$300.000*',
        '',
        '*Arepas* (lo pagaste tú)',
        '• Tu parte: $200.000',
        '',
        '📊 Más detalle en mrluks.com',
      ].join('\n'),
    );
    // A quien le deben no se le explica nada (y sin la 470 sale como antes)
    const vale = { ...me, id: 'v', name: 'Valeria' };
    expect(RESPUESTA.miSaldo(NUMEROS, vale, 'es')).not.toContain('ítem por ítem');
  });

  it('«cuánto me deben»: de qué le paga cada uno (lo que pidió en lo que pagó, la 490)', () => {
    const vale: NonNullable<Numeros['me']> = {
      id: 'v',
      name: 'Valeria',
      paid_total: 900_000,
      paid_count: 1,
      expenses: [],
      pagados: [
        {
          merchant: 'Trattoria',
          payer_person_id: 'v',
          shares: [
            { person_id: 'v', amount_cop: 500_000 },
            { person_id: 's', amount_cop: 100_000 },
            { person_id: 'm', amount_cop: 300_000 },
          ],
          items: [
            { name: 'Pizza', quantity: 1, total: 100_000, people: [{ id: 's', units: 1 }] },
            { name: 'Langosta', quantity: 1, total: 300_000, people: [{ id: 'm', units: 1 }] },
            { name: 'Vino', quantity: 1, total: 500_000, people: [{ id: 'v', units: 1 }] },
          ],
        },
      ],
    };
    expect(RESPUESTA.miSaldo(NUMEROS, vale, 'es')).toBe(
      [
        '🙌 Valeria, en «Paseo» pusiste *$900.000* y te tocan *$500.000*: te deben *$400.000*.',
        '• Mafe Cárdenas te paga *$300.000*',
        '   ↳ Trattoria: Langosta $300.000 = $300.000',
        '• Santi te paga *$100.000*',
        '   ↳ Trattoria: Pizza $100.000 = $100.000',
        '',
        '📊 Más detalle en mrluks.com',
      ].join('\n'),
    );
  });

  it('«mis gastos»: lo que pagó (los últimos)', () => {
    expect(RESPUESTA.misGastos(NUMEROS, NUMEROS.me as NonNullable<Numeros['me']>, 'es')).toBe(
      '🧾 Mafe, en «Paseo» pagaste *$200.000* en 2 gastos:\n• Arepas · $80.000 (27 sep)\n• Lancha · $120.000 (26 sep)\n\n📊 Más detalle en mrluks.com',
    );
  });

  it('nada de lo que responde se anota como gasto (aunque lo lea un WhatsApp vinculado)', () => {
    const me = NUMEROS.me as NonNullable<Numeros['me']>;
    for (const t of [
      RESPUESTA.total(NUMEROS, 'es'),
      RESPUESTA.deudas(NUMEROS, 'en'),
      RESPUESTA.miSaldo(NUMEROS, me, 'es'),
      RESPUESTA.misGastos(NUMEROS, me, 'en'),
    ]) {
      expect(looksLikeExpense(t)).toBe(true);
      expect(esMensajeDeLuks(t)).toBe(true);
    }
    expect(PREGUNTAS.noMeCuentes('es', 'Mafe', 'Paseo')).toContain('Lo de antes queda igual');
  });
});
