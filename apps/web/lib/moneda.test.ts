import { describe, expect, it } from 'vitest';
import { corto, deCampo, dinero } from './moneda';

describe('plata en cada moneda', () => {
  it('pesos colombianos y chilenos: sin centavos', () => {
    expect(dinero(84_300)).toBe('$84.300');
    expect(dinero(84_300, 'COP', 'en')).toBe('$84,300');
    expect(dinero(1_785_000, 'CLP')).toBe('$1.785.000');
    expect(dinero(-5_000, 'COP', 'es', { sign: true })).toBe('−$5.000');
    expect(dinero(5_000, 'COP', 'es', { sign: true })).toBe('+$5.000');
  });

  it('dólares y bolivianos: en centavos, con dos decimales', () => {
    expect(dinero(1_250, 'USD', 'en')).toBe('$12.50');
    expect(dinero(1_250, 'USD', 'es')).toBe('$12,50');
    expect(dinero(123_456_789, 'USD', 'en')).toBe('$1,234,567.89');
    expect(dinero(5, 'USD', 'en')).toBe('$0.05');
    expect(dinero(4_500, 'BOB', 'es')).toBe('Bs 45,00');
  });

  it('corto: lucas y palos en pesos, sin centavos en dólares', () => {
    expect(corto(412_000)).toBe('412 lucas');
    expect(corto(1_200_000, 'CLP')).toBe('1,2 palos');
    expect(corto(412_000, 'COP', 'en')).toBe('$412K');
    expect(corto(41_250, 'USD', 'en')).toBe('$413');
    expect(corto(1_234_500, 'USD', 'en')).toBe('$12.3K');
    expect(corto(4_500, 'BOB', 'es')).toBe('Bs 45');
  });

  it('lo que se escribe en un campo: los dígitos son la unidad chica', () => {
    expect(deCampo('$84.300')).toBe(84_300);
    expect(deCampo('$12.505')).toBe(12_505);
    expect(deCampo('')).toBe(0);
  });
});
