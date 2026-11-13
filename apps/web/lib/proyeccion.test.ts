import { describe, expect, it } from 'vitest';
import { cruce, EJEMPLO_INFORME as E, gasto, pagosDelSueldo, proyectar, saldo } from './proyeccion';

describe('proyección del saldo (modelo de segundo orden)', () => {
  it('da los números del informe', () => {
    expect(saldo(E, 0)).toBe(2_000_000);
    expect(Math.round(saldo(E, 10))).toBe(1_081_636);
    expect(Math.round(gasto(E, 19.967417))).toBe(72_961);
    const p = proyectar(E);
    expect(p.alerta?.dia).toBeCloseTo(19.967417, 5);
    expect(p.agotamiento?.dia).toBeCloseTo(24.195379, 5);
    expect(p.alertaConstante?.dia).toBeCloseTo(17, 6);
    expect(p.agotamientoConstante?.dia).toBeCloseTo(20, 6);
  });

  it('Newton arranca en 0 y converge en pocas vueltas', () => {
    const c = cruce(E, E.umbral);
    expect(c?.iteraciones.length).toBeLessThan(10);
  });

  it('la sensibilidad a k coincide con la tabla 9', () => {
    expect(cruce({ ...E, k: 0.01 }, E.umbral)?.dia).toBeCloseTo(17.91, 2);
    expect(cruce({ ...E, k: 0.05 }, 0)?.dia).toBeCloseTo(27.56, 2);
  });

  it('un ingreso el día 15 corre la alerta (escalón de Heaviside)', () => {
    const conIngreso = { ...E, eventos: [{ dia: 15, monto: 1_000_000 }] };
    expect(saldo(conIngreso, 15) - saldo(E, 15)).toBeCloseTo(1_000_000, 6);
    expect(cruce(conIngreso, E.umbral)?.dia).toBeGreaterThan(30);
  });

  it('si con el ingreso el gasto vuelve a subir, G(15) = Gi', () => {
    const r = { ...E, eventos: [{ dia: 15, monto: 1_000_000, reinicia: true }] };
    expect(gasto(r, 15)).toBeCloseTo(100_000, 6);
    expect(cruce(r, E.umbral)?.dia).toBeLessThan(cruce({ ...E, eventos: [{ dia: 15, monto: 1_000_000 }] }, E.umbral)?.dia as number);
  });

  it('el sueldo quincenal llega el 15 y el último día de cada mes', () => {
    const pagos = pagosDelSueldo('2026-11-12', 3_200_000, 'quincenal', 0, true, 40);
    expect(pagos).toEqual([
      { dia: 3, monto: 1_600_000, reinicia: true },
      { dia: 18, monto: 1_600_000, reinicia: true },
      { dia: 33, monto: 1_600_000, reinicia: true },
    ]);
  });

  it('el sueldo mensual el 31 cae el último día en los meses cortos', () => {
    const pagos = pagosDelSueldo('2027-01-31', 3_200_000, 'mensual', 31, false, 60);
    expect(pagos.map((p) => p.dia)).toEqual([28, 59]);
    expect(pagosDelSueldo('2027-01-31', 0, 'mensual', 31, false)).toEqual([]);
  });

  it('un gasto grande que tumba el saldo da la alerta ese mismo día', () => {
    const c = cruce({ ...E, eventos: [{ dia: 5, monto: -1_300_000 }] }, E.umbral);
    expect(c).toEqual({ dia: 5, iteraciones: [] });
  });
});
