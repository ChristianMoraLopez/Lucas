import { describe, expect, it } from 'vitest';
import { canonico, formatear, normalizar, paisDe, variantes } from './telefono';

describe('números de WhatsApp de toda América Latina', () => {
  it('Colombia por defecto, como siempre', () => {
    expect(normalizar('300 123 4567')).toBe('573001234567');
    expect(normalizar('+57 300 123 4567')).toBe('573001234567');
    expect(normalizar('573001234567')).toBe('573001234567');
    expect(formatear('573001234567')).toBe('+57 300 123 4567');
  });

  it('con el país elegido, el número local', () => {
    expect(normalizar('9 1234 5678', 'CL')).toBe('56912345678');
    expect(normalizar('7123 4567', 'BO')).toBe('59171234567');
    expect(normalizar('912 345 678', 'PE')).toBe('51912345678');
    expect(normalizar('099 123 4567', 'EC')).toBe('593991234567'); // el 0 nacional sobra
    expect(normalizar('(201) 555-0123', 'US')).toBe('12015550123');
    expect(normalizar('55 1234 5678', 'MX')).toBe('525512345678');
  });

  it('Argentina: los celulares llevan el 9 en WhatsApp', () => {
    expect(normalizar('11 2345 6789', 'AR')).toBe('5491123456789');
    expect(normalizar('011 2345 6789', 'AR')).toBe('5491123456789');
    expect(normalizar('+54 9 11 2345 6789')).toBe('5491123456789');
    expect(normalizar('+54 11 2345 6789')).toBe('5491123456789');
    expect(formatear('5491123456789')).toBe('+54 9 11 2345 6789');
  });

  it('México y Brasil: las otras formas del mismo número', () => {
    expect(canonico('5215512345678')).toBe('525512345678');
    expect(variantes('525512345678')).toEqual(['525512345678', '5215512345678']);
    expect(canonico('551187654321')).toBe('5511987654321');
    expect(variantes('5511987654321')).toEqual(['5511987654321', '551187654321']);
    expect(variantes('573001234567')).toEqual(['573001234567']);
  });

  it('el país de un número y cómo se ve', () => {
    expect(paisDe('59171234567')?.id).toBe('BO');
    expect(paisDe('18092345678')?.id).toBe('DO');
    expect(paisDe('12015550123')?.id).toBe('US');
    expect(formatear('56912345678')).toBe('+56 9 1234 5678');
    expect(formatear('5511987654321')).toBe('+55 11 98765 4321');
    expect(formatear('lid:123')).toBeNull();
  });

  it('lo que no es un número', () => {
    expect(normalizar('')).toBeNull();
    expect(normalizar('123')).toBeNull();
    expect(normalizar('hola')).toBeNull();
  });
});
