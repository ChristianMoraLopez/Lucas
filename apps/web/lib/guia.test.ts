import { describe, expect, it } from 'vitest';
import { colocar, GUIAS } from './guia';

describe('guía paso a paso', () => {
  it('sin elemento: todo oscuro y la tarjeta al centro', () => {
    const c = colocar(null, 375, 800);
    expect(c.lado).toBe('centro');
    expect(c.foco).toEqual({ top: 400, left: 187.5, width: 0, height: 0 });
    expect(c.tarjeta).toEqual({ left: 16, width: 343 });
  });

  it('un botón de arriba: la tarjeta va abajo, sin salirse de la pantalla', () => {
    const c = colocar({ top: 20, left: 330, width: 36, height: 36 }, 375, 800);
    expect(c.lado).toBe('abajo');
    expect(c.foco).toEqual({ top: 14, left: 324, width: 48, height: 48 });
    expect(c.tarjeta).toEqual({ top: 74, left: 16, width: 343 });
    // La flechita apunta al botón (sin pasarse del borde de la tarjeta)
    expect(c.flecha).toBe(321);
  });

  it('una pestaña de abajo: la tarjeta va arriba', () => {
    const c = colocar({ top: 740, left: 80, width: 70, height: 56 }, 375, 800);
    expect(c.lado).toBe('arriba');
    expect(c.tarjeta).toEqual({ bottom: 78, left: 16, width: 343 });
    expect(c.flecha).toBe(99);
  });

  it('en escritorio la tarjeta queda junto al elemento', () => {
    const c = colocar({ top: 300, left: 40, width: 180, height: 44 }, 1280, 800);
    expect(c.tarjeta.left).toBe(16);
    expect(c.tarjeta.width).toBe(360);
  });

  it('cada guía arranca al centro y termina en el botón «?»', () => {
    for (const pasos of Object.values(GUIAS)) {
      expect(pasos[0].objetivo).toBeUndefined();
      expect(pasos.at(-1)?.objetivo).toBe('guia');
      for (const p of pasos) expect(p.texto.length).toBeLessThan(220);
    }
  });
});
