import { describe, expect, it } from 'vitest';
import { regionDe } from './region';

describe('región', () => {
  it('la elegida, si no la del navegador, si no Colombia', () => {
    expect(regionDe('CL', 'en-US')).toBe('CL');
    expect(regionDe(undefined, 'en-US,en;q=0.9')).toBe('US');
    expect(regionDe(undefined, 'es-BO,es;q=0.9')).toBe('BO');
    expect(regionDe(undefined, 'es-MX,es;q=0.9')).toBe('CO');
    expect(regionDe(undefined, 'es')).toBe('CO');
    expect(regionDe('XX', null)).toBe('CO');
  });
});
