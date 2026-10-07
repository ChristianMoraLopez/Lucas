import { describe, expect, it } from 'vitest';
import { dividirPorConsumo, repartir, separable, separarUnidades } from './consumo';

const suma = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);

describe('dividir por consumo', () => {
  it('cada ítem entre quienes lo pidieron; sin nadie, entre todos', () => {
    const d = dividirPorConsumo({
      total: 100,
      personas: ['x', 'y', 'z'],
      items: [
        { total: 60, people: ['x'] },
        { total: 20, people: ['y'] },
        { total: 20, people: [] },
      ],
    });
    expect(d.error).toBeNull();
    expect(d.partes).toEqual({ x: 67, y: 27, z: 6 });
    expect(d.extra).toBe(0);
  });

  it('la noche de la hamburguesa: $590.000, la propina según lo que consumió cada uno', () => {
    // Juan y Mafe pidieron hamburguesa; los demás, algo de tomar; la picada, entre todos
    const d = dividirPorConsumo({
      total: 590_000,
      personas: ['juan', 'mafe', 'santi', 'caro', 'pipe'],
      items: [
        { total: 64_000, people: ['juan'] },
        { total: 64_000, people: ['mafe'] },
        { total: 150_000, people: [] },
        { total: 96_000, people: ['santi', 'caro', 'pipe', 'juan'] },
        { total: 162_000, people: ['santi', 'caro'] },
      ],
    });
    expect(d.items).toBe(536_000);
    expect(d.extra).toBe(54_000); // la propina
    expect(suma(d.partes)).toBe(590_000);
    // Lo justo de cada uno lleva su parte de la propina, en proporción
    expect(d.partes.juan).toBeGreaterThan(d.partes.pipe);
    expect(Math.abs(d.partes.santi - d.justo.santi)).toBeLessThan(1);
  });

  it('alguien pone más: pone eso y el resto se reparte entre los demás', () => {
    const sin = dividirPorConsumo({
      total: 110,
      personas: ['x', 'y', 'z'],
      items: [
        { total: 60, people: ['x'] },
        { total: 40, people: [] },
      ],
    });
    const con = dividirPorConsumo({
      total: 110,
      personas: ['x', 'y', 'z'],
      items: [
        { total: 60, people: ['x'] },
        { total: 40, people: [] },
      ],
      fijos: { z: 50 },
    });
    expect(con.partes.z).toBe(50);
    expect(suma(con.partes)).toBe(110);
    expect(con.partes.x).toBeLessThan(sin.partes.x);
    expect(con.partes.y).toBeLessThan(sin.partes.y);
  });

  it('lo fijo no puede pasar el total; si todos fijan, tienen que sumarlo', () => {
    expect(dividirPorConsumo({ total: 100, personas: ['x', 'y'], items: [], fijos: { x: 120 } }).error).toMatch(/pasa el total/);
    expect(dividirPorConsumo({ total: 100, personas: ['x', 'y'], items: [], fijos: { x: 40, y: 50 } }).error).toMatch(/sumar el total/);
    expect(dividirPorConsumo({ total: 100, personas: ['x', 'y'], items: [], fijos: { x: 40, y: 60 } }).partes).toEqual({ x: 40, y: 60 });
  });

  it('sin ítems, por igual; quien no está, no cuenta en los ítems', () => {
    expect(dividirPorConsumo({ total: 100, personas: ['x', 'y', 'z'], items: [] }).partes).toEqual({ x: 34, y: 33, z: 33 });
    // El ítem de alguien que ya no está pasa a ser de todos
    expect(dividirPorConsumo({ total: 90, personas: ['x', 'y'], items: [{ total: 90, people: ['fuera'] }] }).partes).toEqual({ x: 45, y: 45 });
    expect(dividirPorConsumo({ total: 90, personas: [], items: [] }).error).toBe('Elige quiénes estaban');
  });

  it('los ítems que suman más que el total se toman como descuento', () => {
    const d = dividirPorConsumo({
      total: 90,
      personas: ['x', 'y'],
      items: [
        { total: 60, people: ['x'] },
        { total: 40, people: ['y'] },
      ],
    });
    expect(d.extra).toBe(-10);
    expect(d.partes).toEqual({ x: 54, y: 36 });
  });

  it('siempre suma exacto el total, en pesos enteros', () => {
    let semilla = 7;
    const azar = (n: number) => {
      semilla = (semilla * 16807) % 2147483647;
      return semilla % n;
    };
    for (let caso = 0; caso < 300; caso++) {
      const personas = Array.from({ length: 1 + azar(9) }, (_, i) => `p${i}`);
      const items = Array.from({ length: azar(8) }, () => ({
        total: azar(200_000),
        people: personas.filter(() => azar(3) === 0),
      }));
      const fijos = azar(3) === 0 ? { [personas[0]]: azar(50_000) } : {};
      const total = 50_000 + azar(900_000);
      const d = dividirPorConsumo({ total, personas, items, fijos });
      if (d.error) continue;
      expect(suma(d.partes)).toBe(total);
      expect(Object.values(d.partes).every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
    }
  });

  it('repartir: el residuo a las fracciones más grandes', () => {
    expect(repartir(10, ['a', 'b', 'c'], { a: 1, b: 1, c: 1 })).toEqual({ a: 4, b: 3, c: 3 });
    expect(repartir(10, ['a', 'b'], { a: 0, b: 0 })).toEqual({ a: 5, b: 5 });
  });
});

describe('separar en unidades', () => {
  it('tres hamburguesas de $90.000: una de $30.000 para cada uno', () => {
    expect(separarUnidades(90_000, 3)).toEqual([30_000, 30_000, 30_000]);
  });

  it('si no da exacto, los pesos que sobran van en las primeras y suman el total', () => {
    const partes = separarUnidades(10_000, 3);
    expect(partes).toEqual([3_334, 3_333, 3_333]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it('solo cantidades enteras de 2 a 30', () => {
    expect([1, 2, 3, 30, 31, 1.5, 0.82].map(separable)).toEqual([false, true, true, true, false, false, false]);
  });
});
