import { describe, expect, it } from 'vitest';
import { conCodigo, convertir, corto, deCampo, dinero, reexpresar, tasaDe } from './moneda';

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

describe('recibos de viaje', () => {
  it('convierte igual que el worker (mitad hacia arriba)', () => {
    expect(convertir(25_990, 'CLP', 'COP', 4.17)).toBe(108_378);
    expect(convertir(1_250, 'USD', 'COP', 3900)).toBe(48_750);
    expect(convertir(100_000, 'COP', 'USD', 0.000256)).toBe(2_560);
    expect(convertir(3_790, 'CLP', 'BOB', 0.0073)).toBe(2_767);
    expect(convertir(1, 'CLP', 'COP', 4.5)).toBe(5);
  });

  it('el mismo número en otra moneda, sin convertir', () => {
    expect(reexpresar(25_990, 'COP', 'CLP')).toBe(25_990);
    expect(reexpresar(12, 'COP', 'USD')).toBe(1_200);
    expect(reexpresar(1_250, 'EUR', 'CLP')).toBe(13);
  });

  it('la tasa de lo que cobró el banco', () => {
    expect(tasaDe(3_790, 'CLP', 15_900, 'COP')).toBeCloseTo(4.195, 3);
    expect(tasaDe(2_000, 'USD', 78_000, 'COP')).toBe(3900);
  });

  it('con el código, para no confundirla con la de la cuenta', () => {
    expect(conCodigo(3_790, 'CLP')).toBe('$3.790 CLP');
    expect(conCodigo(1_250, 'EUR', 'en')).toBe('€12.50 EUR');
    expect(conCodigo(4_590, 'BRL')).toBe('R$ 45,90 BRL');
  });
});
