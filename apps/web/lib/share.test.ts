import { describe, expect, it } from 'vitest';
import { cobroMessage, MARCA, personView, resumenMessage, sharedLink, transfersFor } from './share';

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
    expect(yo.endsWith(`Cuentas hechas con Luks · ${MARCA}`)).toBe(true);

    const otro = cobroMessage({ debtor: 'Santi', creditor: 'Valeria', amount: 1_250_000, accountName: 'Paseo', creditorIsMe: false });
    expect(otro).toContain('le debes a Valeria $1.250.000 (1,3 palos)');
    expect(otro).not.toContain('Acá ves');
  });

  it('el resumen para el grupo', () => {
    const m = resumenMessage({ accountName: 'Paseo', total: 480000, people: 4, link: 'https://mrluks.com/r/abc' });
    expect(m).toContain('gastamos $480.000 entre 4');
    expect(m).toContain('https://mrluks.com/r/abc');
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
