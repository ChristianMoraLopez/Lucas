import { describe, expect, it } from 'vitest';
import { cobroMessage, grupoMessage, PUBLICIDAD, personView, recomendacionMessage, sharedLink, transfersFor } from './share';

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
