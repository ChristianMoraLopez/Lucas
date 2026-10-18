import { describe, expect, it } from 'vitest';
import { crearT } from './i18n';
import { cobroMessage, detalleCobro, grupoMessage, PUBLICIDAD, personView, recomendacionMessage, sharedLink, transfersFor } from './share';

describe('compartir las cuentas', () => {
  it('el link lleva a la persona y al mes', () => {
    expect(sharedLink('https://mrluks.com', 'abc')).toBe('https://mrluks.com/r/abc');
    expect(sharedLink('https://mrluks.com', 'abc', { person: 'p1' })).toBe('https://mrluks.com/r/abc?p=p1');
    expect(sharedLink('https://mrluks.com', 'abc', { person: 'p1', month: '2026-09-01' })).toBe('https://mrluks.com/r/abc?p=p1&mes=2026-09');
  });

  it('el mensaje de cobro dice cuánto, a quién y lleva la publicidad', () => {
    const yo = cobroMessage({
      debtor: 'Mafe',
      creditor: 'Christian',
      amount: 45000,
      accountName: 'Noche de bolos',
      link: 'https://mrluks.com/r/abc?p=1',
      creditorIsMe: true,
    });
    expect(yo).toContain('Hola Mafe');
    expect(yo).toContain('me debes $45.000 (45 lucas)');
    expect(yo).toContain('https://mrluks.com/r/abc?p=1');
    expect(yo.endsWith('_Esto se hizo en mrluks.com_')).toBe(true);

    const otro = cobroMessage({ debtor: 'Santi', creditor: 'Valeria', amount: 1_250_000, accountName: 'Paseo', creditorIsMe: false });
    expect(otro).toContain('le debes a Valeria $1.250.000 (1,3 palos)');
    expect(otro).not.toContain('Acá ves');
  });

  it('el mensaje para el grupo: cuánto fue y quién le paga a quién', () => {
    const nombres: Record<string, string> = { yo: 'Christian', a: 'Mafe', b: 'Santi_*' };
    const base = {
      accountName: 'Noche de bolos',
      total: 480000,
      people: 6,
      porCabeza: 80000,
      nombre: (id: string) => nombres[id],
      liquidada: false,
      link: 'https://mrluks.com/r/abc',
    };
    const m = grupoMessage({
      ...base,
      transfers: [
        { from: 'a', to: 'yo', amount: 45000, paid_at: null },
        { from: 'b', to: 'yo', amount: 30000, paid_at: '2026-10-01T00:00:00Z' },
      ],
    });
    expect(m.split('\n')[0]).toBe('🧾 *Noche de bolos*');
    expect(m).toContain('Gastamos *$480.000* (480 lucas) entre 6: *$80.000* cada uno.');
    expect(m).toContain('• Mafe → Christian: *$45.000*');
    // La pagada va tachada, y un nombre con * o _ no daña el formato
    expect(m).toContain('• ~Santi → Christian: $30.000~ ✅');
    expect(m).toContain('Van 1 de 2 pagadas.');
    expect(m).toContain('https://mrluks.com/r/abc');
    expect(m.endsWith(`_${PUBLICIDAD}_`)).toBe(true);

    const hogar = grupoMessage({
      ...base,
      periodo: 'septiembre 2026',
      porCabeza: null,
      liquidada: true,
      link: null,
      transfers: [{ from: 'a', to: 'yo', amount: 45000, paid_at: '2026-10-01T00:00:00Z' }],
    });
    expect(hogar.split('\n')[0]).toBe('🧾 *Noche de bolos* · septiembre 2026');
    expect(hogar).toContain('entre 6, cada quien su parte.');
    expect(hogar).toContain('Todo pagado: quedamos a mano');
    expect(hogar).not.toContain('👀');

    expect(grupoMessage({ ...base, transfers: [] })).toContain('Nadie le debe a nadie');
  });

  it('recomendar Luks: para el grupo y para tus gastos personales, con mrluks.com', () => {
    const r = recomendacionMessage();
    expect(r.url).toBe('https://mrluks.com');
    expect(r.texto).toContain('cuentas del grupo');
    expect(r.texto).toContain('grupo de WhatsApp contigo mismo');
    expect(r.texto).toContain('por categoría');
    expect(r.texto.endsWith('https://mrluks.com')).toBe(true);
  });

  it('sin liquidar se calculan las transferencias; liquidado, se usan las guardadas', () => {
    const people = [
      { id: 'yo', name: 'Christian', balance: 90000 },
      { id: 'a', name: 'Mafe', balance: -45000 },
      { id: 'b', name: 'Santi', balance: -45000 },
    ];
    const ts = transfersFor({ people, settlement: null });
    expect(ts).toHaveLength(2);
    expect(ts.every((t) => t.to === 'yo' && t.amount === 45000 && t.paid_at === null)).toBe(true);
    expect(personView('a', ts)).toEqual({ debe: [ts.find((t) => t.from === 'a')], recibe: [] });
    expect(personView('yo', ts).recibe).toHaveLength(2);

    const guardada = { id: 't', from: 'a', to: 'yo', amount: 90000, paid_at: '2026-10-01T00:00:00Z', paid_by: 'Christian' };
    expect(transfersFor({ people, settlement: { transfers: [guardada] } })).toEqual([guardada]);
    // Saldos que no cuadran: nada, en vez de romper la página
    expect(transfersFor({ people: [{ id: 'x', name: 'X', balance: 5 }], settlement: null })).toEqual([]);
  });
});

describe('los mensajes en inglés y en otras monedas', () => {
  const en = crearT('en');
  it('el cobro en dólares, en inglés', () => {
    const m = cobroMessage({ debtor: 'Mafe', creditor: 'Chris', amount: 4_550, accountName: 'Bowling', creditorIsMe: true, t: en, moneda: 'USD' });
    expect(m).toContain('Hi Mafe 👋 For “Bowling” you owe me $45.50.');
    expect(m.endsWith('_Made with mrluks.com_')).toBe(true);
  });

  it('el mensaje del grupo en pesos chilenos, en español, con lucas', () => {
    const m = grupoMessage({
      accountName: 'Asado',
      total: 120_000,
      people: 4,
      porCabeza: 30_000,
      transfers: [],
      nombre: () => '',
      liquidada: false,
      moneda: 'CLP',
    });
    expect(m).toContain('Gastamos *$120.000* (120 lucas) entre 4: *$30.000* cada uno.');
  });

  it('el mensaje del grupo en inglés', () => {
    const m = grupoMessage({
      accountName: 'Road trip',
      total: 48_000,
      people: 3,
      porCabeza: 16_000,
      transfers: [{ from: 'a', to: 'b', amount: 16_000, paid_at: null }],
      nombre: (id) => (id === 'a' ? 'Sam' : 'Alex'),
      liquidada: false,
      link: 'https://mrluks.com/r/abc',
      t: en,
      moneda: 'USD',
    });
    expect(m).toContain('We spent *$480.00* among 3: *$160.00* each.');
    expect(m).toContain('💸 *Who pays whom*');
    expect(m).toContain('• Sam → Alex: *$160.00*');
    expect(recomendacionMessage(en).texto).toContain('I recommend *Luks*');
  });

  it('si la cuenta liquida directo, cada quien le paga a quien pagó por él', () => {
    const people = [
      { id: 'yo', name: 'Christian', balance: -30_000 },
      { id: 'dan', name: 'Daniel', balance: 170_000 },
      { id: 'santi', name: 'Santiago', balance: 40_000 },
      { id: 'mari', name: 'Mari', balance: -180_000 },
    ];
    const directas = [
      { from: 'mari', to: 'dan', amount: 150_000 },
      { from: 'mari', to: 'santi', amount: 30_000 },
      { from: 'yo', to: 'santi', amount: 30_000 },
      { from: 'santi', to: 'dan', amount: 20_000 },
    ];
    expect(transfersFor({ people, settlement: null, direct: true, direct_transfers: directas }).find((x) => x.from === 'yo')?.to).toBe('santi');
    // Cruzando deudas, el mínimo: a Christian le puede tocar pagarle a Daniel
    expect(transfersFor({ people, settlement: null, direct: false, direct_transfers: directas })).toHaveLength(3);
  });

  it('el cobro trae lo suyo gasto por gasto, con lo que pidió, y a quién le paga', () => {
    const nombres: Record<string, string> = { mari: 'Mari', dan: 'Daniel', santi: 'Santiago', yo: 'Christian' };
    const nombre = (id: string) => nombres[id];
    const expenses = [
      {
        merchant: 'Le Due Torri',
        payer_person_id: 'dan',
        shares: [
          { person_id: 'mari', amount_cop: 165_000 },
          { person_id: 'dan', amount_cop: 100_000 },
          { person_id: 'santi', amount_cop: 50_000 },
        ],
        items: [
          {
            name: 'Coca Cola Zero',
            quantity: 3,
            total: 30_000,
            extra: false,
            people: [
              { id: 'mari', units: 2 },
              { id: 'dan', units: 1 },
            ],
          },
          { name: 'Ravioli', quantity: 1, total: 90_000, extra: false, people: [{ id: 'mari', units: 1 }] },
        ],
      },
      {
        merchant: 'Bruna',
        payer_person_id: 'santi',
        shares: [
          { person_id: 'mari', amount_cop: 30_000 },
          { person_id: 'yo', amount_cop: 30_000 },
        ],
        items: null,
      },
    ];
    const transfers = [
      { from: 'mari', to: 'dan', amount: 150_000 },
      { from: 'mari', to: 'santi', amount: 45_000 },
      { from: 'yo', to: 'santi', amount: 30_000 },
    ];
    expect(detalleCobro({ expenses, debtorId: 'mari', creditorId: 'dan', transfers, nombre })).toEqual([
      '🧾 *Lo tuyo, ítem por ítem:*',
      '',
      '*Le Due Torri* (pagó Daniel)',
      '• Coca Cola Zero (2 de 3): $20.000',
      '• Ravioli: $90.000',
      '• Propina y servicio: $55.000',
      'Total: *$165.000*',
      '',
      '*Bruna* (pagó Santiago)',
      '• Tu parte (entre 2): $30.000',
      '',
      'Le pagas $150.000 a Daniel y $45.000 a Santiago.',
    ]);
    // Christian no estuvo en la factura de Daniel: si le tocara pagarle, se explica por qué
    const cruzado = detalleCobro({ expenses, debtorId: 'yo', creditorId: 'dan', transfers: [{ from: 'yo', to: 'dan', amount: 30_000 }], nombre });
    expect(cruzado.at(-1)).toBe('Se cruzaron las deudas para hacer menos transferencias: por eso le pagas a Daniel.');
    const m = cobroMessage({
      debtor: 'Mari',
      creditor: 'Daniel',
      amount: 150_000,
      accountName: 'Chile',
      link: 'https://mrluks.com/r/abc?p=mari',
      creditorIsMe: false,
      detalle: detalleCobro({ expenses, debtorId: 'mari', creditorId: 'dan', transfers, nombre }),
    });
    expect(m.split('\n').slice(0, 6)).toEqual([
      'Hola Mari 👋 De «Chile» le debes a Daniel $150.000 (150 lucas).',
      '',
      '🧾 *Lo tuyo, ítem por ítem:*',
      '',
      '*Le Due Torri* (pagó Daniel)',
      '• Coca Cola Zero (2 de 3): $20.000',
    ]);
  });

  it('a quien pagó por cada uno: Christian le paga a Santiago, no a Daniel', () => {
    const d = {
      people: [
        { id: 'yo', name: 'Christian', balance: -30_000 },
        { id: 'dan', name: 'Daniel', balance: 170_000 },
        { id: 'santi', name: 'Santiago', balance: 40_000 },
        { id: 'mari', name: 'Mari', balance: -180_000 },
      ],
      expenses: [
        {
          payer_person_id: 'dan',
          shares: [
            { person_id: 'mari', amount_cop: 150_000 },
            { person_id: 'dan', amount_cop: 100_000 },
            { person_id: 'santi', amount_cop: 50_000 },
          ],
        },
        {
          payer_person_id: 'santi',
          shares: ['yo', 'dan', 'santi', 'mari'].map((person_id) => ({ person_id, amount_cop: 30_000 })),
        },
      ],
      direct: true,
      direct_transfers: [],
      settlement: null,
    };
    const ts = transfersFor(d);
    expect(ts.find((x) => x.from === 'yo')).toMatchObject({ to: 'santi', amount: 30_000 });
    expect(ts.length).toBeLessThanOrEqual(3);
  });
});
