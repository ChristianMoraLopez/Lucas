import { describe, expect, it } from 'vitest';
import { esNavegacion, redLenta } from './conexion';

const AQUI = 'https://mrluks.com/c/abc/resumen';
const toque = { button: 0, mod: false };

describe('¿el link lleva a otra pantalla de la app?', () => {
  it('sí: otra ruta u otros filtros', () => {
    expect(esNavegacion({ href: '/c/abc/gastos', target: '' }, AQUI, toque)).toBe(true);
    expect(esNavegacion({ href: 'https://mrluks.com/c/abc/resumen?mes=2026-09', target: '' }, AQUI, toque)).toBe(true);
  });

  it('no: afuera, otra pestaña, la misma pantalla, descarga o con Ctrl', () => {
    expect(esNavegacion({ href: 'https://wa.me/?text=hola', target: '_blank' }, AQUI, toque)).toBe(false);
    expect(esNavegacion({ href: 'https://wa.me/?text=hola', target: '' }, AQUI, toque)).toBe(false);
    expect(esNavegacion({ href: '/c/abc/resumen', target: '' }, AQUI, toque)).toBe(false);
    expect(esNavegacion({ href: '/c/abc/resumen#gastos', target: '' }, AQUI, toque)).toBe(false);
    expect(esNavegacion({ href: '/datos.csv', target: '', download: true }, AQUI, toque)).toBe(false);
    expect(esNavegacion({ href: '/c/abc/gastos', target: '' }, AQUI, { button: 0, mod: true })).toBe(false);
    expect(esNavegacion({ href: '/c/abc/gastos', target: '' }, AQUI, { button: 1, mod: false })).toBe(false);
  });
});

describe('¿la red está lenta?', () => {
  it('2G, mucha demora o casi sin bajada', () => {
    expect(redLenta({ effectiveType: '2g' })).toBe(true);
    expect(redLenta({ effectiveType: 'slow-2g' })).toBe(true);
    expect(redLenta({ effectiveType: '4g', rtt: 2000 })).toBe(true);
    expect(redLenta({ effectiveType: '3g', downlink: 0.1 })).toBe(true);
  });
  it('4G normal, o el navegador no dice nada', () => {
    expect(redLenta({ effectiveType: '4g', rtt: 100, downlink: 10 })).toBe(false);
    expect(redLenta({ effectiveType: '4g', downlink: 0 })).toBe(false);
    expect(redLenta(null)).toBe(false);
  });
});
