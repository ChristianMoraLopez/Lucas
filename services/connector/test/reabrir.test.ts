import { describe, expect, it } from 'vitest';
import { contestarDecision, leerDecision } from '../src/reabrir.js';
import { esMensajeDeLuks } from '../src/text.js';

// Un paseo liquidado y llega otro gasto: ¿reabrir o cuenta nueva? (migración 450)

describe('lo que responden', () => {
  it.each([
    ['1', 'reabrir'],
    ['1️⃣', 'reabrir'],
    ['reabrir', 'reabrir'],
    ['Ábrela', 'reabrir'],
    ['luks reabre porfa', 'reabrir'],
    ['la misma', 'reabrir'],
    ['2', 'nueva'],
    ['opción 2', 'nueva'],
    ['cuenta nueva', 'nueva'],
    ['otra', 'nueva'],
  ])('«%s» → %s', (t, modo) => expect(leerDecision(t)).toBe(modo));

  it('lo demás no', () => {
    expect(leerDecision('3')).toBeNull();
    expect(leerDecision('abrimos la playa mañana')).toBeNull();
    expect(leerDecision('jajaja')).toBeNull();
  });
});

describe('lo que contesta Mister Luks', () => {
  const WEB = 'https://mrluks.com';
  const base = {
    ok: true as const,
    account_id: 'dc',
    language: 'es' as const,
    currency: 'COP' as const,
    name: 'Christian Rey',
    anterior: 'DaniChile',
    gastos: [{ expense_id: 'g1', duplicate_of: null, merchant: 'Trattoria', total: 120_000, items: 2 }],
  };

  it('reabrir: lo que sumó, que va la lista y que se liquida de nuevo', () => {
    const m = contestarDecision({ ...base, modo: 'reabrir' as const, cuenta: 'DaniChile' }, WEB);
    expect(m).toBe(
      '🔓 Listo, Christian: reabrí «DaniChile» y sumé *Trattoria* ($120.000). Ahora les pregunto quién pidió qué. Cuando terminen, la vuelven a liquidar en mrluks.com.\n\n📊 Más detalle en mrluks.com',
    );
    expect(esMensajeDeLuks(m)).toBe(true);
  });

  it('cuenta nueva', () => {
    expect(contestarDecision({ ...base, modo: 'nueva' as const, cuenta: 'DaniChile 2' }, WEB)).toContain(
      '🆕 Listo, Christian: abrí «DaniChile 2» y ahí anoté *Trattoria* ($120.000).',
    );
    expect(contestarDecision({ ...base, modo: 'nueva' as const, cuenta: 'DaniChile 2', language: 'en' as const }, WEB)).toContain(
      '🆕 Done, Christian: I opened “DaniChile 2”',
    );
  });

  it('si no sigue la lista de ítems, el link para revisarlo y repartirlo en la app', () => {
    const uno = { ...base, modo: 'reabrir' as const, cuenta: 'DaniChile', gastos: [{ ...base.gastos[0], items: 0 }] };
    expect(contestarDecision(uno, WEB)).toContain('\nLo que no quede bien, revísenlo y repártanlo aquí: https://mrluks.com/c/dc/gastos/g1/dividir\n');
    const dos = { ...uno, gastos: [uno.gastos[0], { ...uno.gastos[0], expense_id: 'g2' }] };
    expect(contestarDecision(dos, WEB)).toContain('aquí: https://mrluks.com/c/dc/gastos\n');
    // Con la lista de ítems, el link va en la lista
    expect(contestarDecision({ ...base, modo: 'reabrir' as const, cuenta: 'DaniChile' }, WEB)).not.toContain('/c/dc/gastos');
  });

  it('una cuenta cerrada solo admite cuenta nueva', () => {
    expect(contestarDecision({ ok: false, reason: 'cerrada', language: 'es', account_name: 'DaniChile' }, WEB)).toBe(
      '🔒 «DaniChile» está cerrada: solo puedo anotarlo en una cuenta nueva. Respondan *2*.',
    );
  });
});
