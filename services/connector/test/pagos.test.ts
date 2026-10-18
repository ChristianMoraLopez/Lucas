import { describe, expect, it } from 'vitest';
import { elegirPagos, montoEn, PAGOS } from '../src/pagos.js';
import type { Transferencia } from '../src/store.js';
import { esMensajeDeLuks, intencionDe } from '../src/text.js';

// «Ya pagué» por WhatsApp (migración 420): qué dicen y cuál de lo que deben es

const CHILE = { id: 'chile', name: 'DaniChile', language: 'es' as const, currency: 'COP' as const };
const CASA = { id: 'casa', name: 'Casa', language: 'es' as const, currency: 'COP' as const };
const t = (id: string, to_name: string, amount: number, account = CHILE, to_id = `${account.id}-${to_name}`): Transferencia => ({
  id,
  settlement_id: `s-${account.id}`,
  account,
  from_id: 'chris',
  from_name: 'Christian',
  to_id,
  to_name,
  amount,
});
const SANTI = t('t1', 'Santiago Ricaurte', 33_789);
const DANI_C = t('t2', 'Daniel M Castelblanco', 31_676);
const DANI_D = t('t3', 'Daniel Diaz', 12_000);

describe('«ya pagué»: lo entiende', () => {
  it.each([
    'ya pagué',
    'Ya le pagué a Santiago',
    'ya les pagué a todos',
    'listo, ya le transferí',
    'ya le mandé la plata a Santi',
    'ya hice la transferencia',
    'le pagué a Daniel',
    'ya está pago',
    'pagado',
    'Listo, pagado ✅',
    'I paid Sam',
    'already paid',
    'paid',
    'I sent you the money',
  ])('«%s»', (texto) => expect(intencionDe(texto)).toBe('ya_pague'));

  it('lo demás sigue siendo lo de antes', () => {
    expect(intencionDe('qué he pagado')).toBe('mis_gastos');
    expect(intencionDe('what did I pay')).toBe('mis_gastos');
    expect(intencionDe('cuánto debo')).toBe('mi_saldo');
    // Preguntar si ya pagó no es decir que pagó
    expect(intencionDe('¿ya le pagué a Santiago?')).toBe('mi_saldo');
    expect(intencionDe('quién le paga a quién')).toBe('deudas');
    expect(intencionDe('hola')).toBeNull();
  });

  it('montos como se dicen', () => {
    expect(montoEn('ya le pagué los 33 mil')).toBe(33_000);
    expect(montoEn('ya pagué $33.789')).toBe(33_789);
    expect(montoEn('pagué 33789 por nequi')).toBe(33_789);
    expect(montoEn('ya le pasé 34k')).toBe(34_000);
    expect(montoEn('I paid 12,50')).toBe(12.5);
    expect(montoEn('ya pagué')).toBeNull();
  });
});

describe('cuál de lo que debe es', () => {
  it('por a quién (el nombre o parte de él)', () => {
    const pend = [SANTI, DANI_C];
    expect(elegirPagos(pend, 'ya le pagué a Santiago', true)).toEqual({ tipo: 'marcar', ids: ['t1'] });
    expect(elegirPagos(pend, 'ya le pagué a santi', true)).toEqual({ tipo: 'marcar', ids: ['t1'] });
    expect(elegirPagos(pend, 'ya le pagué a Castelblanco', true)).toEqual({ tipo: 'marcar', ids: ['t2'] });
    expect(elegirPagos(pend, 'ya les pagué a Santi y a Daniel', true)).toEqual({ tipo: 'marcar', ids: ['t1', 't2'] });
    expect(elegirPagos(pend, 'ya les pagué a todos', true)).toEqual({ tipo: 'marcar', ids: ['t1', 't2'] });
  });

  it('si hay dos con el mismo nombre pregunta cuál, salvo que el apellido o el monto lo digan', () => {
    const pend = [SANTI, DANI_C, DANI_D];
    expect(elegirPagos(pend, 'ya le pagué a Daniel', true)).toEqual({ tipo: 'cual', nombre: 'daniel' });
    expect(elegirPagos(pend, 'ya le pagué a Daniel Díaz', true)).toEqual({ tipo: 'marcar', ids: ['t3'] });
    expect(elegirPagos(pend, 'ya le pagué los 12 mil a Daniel', true)).toEqual({ tipo: 'marcar', ids: ['t3'] });
  });

  it('sin decir a quién: si es uno solo, ese; si son varios, por el monto o pregunta', () => {
    expect(elegirPagos([SANTI], 'ya pagué', true)).toEqual({ tipo: 'marcar', ids: ['t1'] });
    expect(elegirPagos([SANTI], 'listo, pagado, gracias por avisar', false)).toEqual({ tipo: 'marcar', ids: ['t1'] });
    expect(elegirPagos([SANTI, DANI_C], 'ya pagué', false)).toEqual({ tipo: 'cual', nombre: null });
    expect(elegirPagos([SANTI, DANI_C], 'ya pagué los 33.789', false)).toEqual({ tipo: 'marcar', ids: ['t1'] });
  });

  it('a alguien a quien no le debe', () => {
    expect(elegirPagos([SANTI], 'ya le pagué a Felipe', false)).toEqual({ tipo: 'no_le_debes', nombre: 'felipe' });
  });

  it('por privado, de varias cuentas: el nombre de la cuenta dice cuál', () => {
    const pend = [SANTI, t('t9', 'Santiago Ricaurte', 50_000, CASA)];
    expect(elegirPagos(pend, 'ya le pagué a Santiago', false)).toEqual({ tipo: 'cual', nombre: 'santiago' });
    expect(elegirPagos(pend, 'ya le pagué a Santiago lo de Chile', false)).toEqual({ tipo: 'marcar', ids: ['t1'] });
    expect(elegirPagos(pend, 'ya le pagué a Santiago lo de la casa', false)).toEqual({ tipo: 'marcar', ids: ['t9'] });
  });

  it('en el grupo, con un monto que no es de lo que debe, es un gasto', () => {
    expect(elegirPagos([SANTI], 'ya pagué la luz 120 lucas', true)).toEqual({ tipo: 'gasto' });
    expect(elegirPagos([], 'ya pagué el gas 45 mil', true)).toEqual({ tipo: 'gasto' });
    expect(elegirPagos([], 'ya pagué', true)).toEqual({ tipo: 'nada' });
    // Con el nombre de a quién sí es un pago
    expect(elegirPagos([SANTI], 'ya le pagué 33 lucas a Santi', true)).toEqual({ tipo: 'marcar', ids: ['t1'] });
  });
});

describe('lo que responde', () => {
  const pagada = { ...SANTI, to_private_jid: null, group_jid: null, todos_pagaron: false };

  it('marcado: qué pagó y qué le falta (o que ya no debe nada y si con eso pagaron todos)', () => {
    expect(PAGOS.listo('es', 'Christian', { pagadas: [pagada], quedan: [DANI_C] }, false)).toBe(
      [
        '✅ Listo, Christian: anoté que le pagaste *$33.789* a Santiago Ricaurte.',
        '',
        'Te falta:\n• *$31.676* a Daniel M Castelblanco',
        '',
        '📊 Más detalle en mrluks.com',
      ].join('\n'),
    );
    const todos = PAGOS.listo('es', 'Christian', { pagadas: [{ ...pagada, todos_pagaron: true }], quedan: [] }, true);
    expect(todos).toContain('anoté que le pagaste *$33.789* a Santiago Ricaurte («DaniChile»).');
    expect(todos).toContain('🙌 Ya no le debes nada a nadie.');
    expect(todos).toContain('🎉 Con eso, ya todos pagaron en «DaniChile».');
  });

  it('nada de lo que dice con montos se anota como gasto', () => {
    const pagada2 = { ...pagada, to_private_jid: 'x', group_jid: 'y' };
    for (const m of [
      PAGOS.listo('es', 'Christian', { pagadas: [pagada], quedan: [] }, false),
      PAGOS.listo('en', 'Christian', { pagadas: [pagada], quedan: [] }, false),
      PAGOS.tePagaron('es', pagada2),
      PAGOS.pagoEnGrupo('es', pagada2),
      PAGOS.cual('es', 'Christian', [SANTI, DANI_C], null, false),
      PAGOS.noLeDebes('es', 'Christian', 'felipe', [SANTI], false),
    ])
      expect(esMensajeDeLuks(m)).toBe(true);
  });

  it('¿a quién?, con un ejemplo de cómo decirlo', () => {
    const m = PAGOS.cual('es', 'Christian', [SANTI, DANI_C, DANI_D], 'daniel', false);
    expect(m.split('\n')[0]).toBe('🤔 Christian, ¿a cuál Daniel? Te falta:');
    expect(m).toContain('Dime, por ejemplo, «ya le pagué a Daniel M Castelblanco» (o «ya les pagué a todos»).');
  });
});
