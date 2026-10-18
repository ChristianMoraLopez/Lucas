import { describe, expect, it } from 'vitest';
import { aQuienPagoPor, type Balance, minTransfers } from '../src/liquidacion.js';

// El de la web se carga al correr la prueba (tsc del connector no revisa archivos de la web)
const WEB = new URL('../../../apps/web/lib/settlement.ts', import.meta.url).href;
const { minTransfers: deLaWeb, aQuienPagoPor: aQuienDeLaWeb } = (await import(WEB)) as {
  minTransfers: typeof minTransfers;
  aQuienPagoPor: typeof aQuienPagoPor;
};

// El connector responde «quién le debe a quién» con el mismo cálculo de Liquidar en la app

/** Saldos al azar que suman cero (determinista: siempre la misma semilla) */
function saldos(semilla: number, n: number): Balance[] {
  let x = semilla;
  const azar = () => {
    x = (x * 1_103_515_245 + 12_345) % 2 ** 31;
    return x / 2 ** 31;
  };
  const out = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Persona ${i}`, balance: Math.round((azar() - 0.5) * 400) * 500 }));
  out[n - 1].balance -= out.reduce((s, b) => s + b.balance, 0);
  return out;
}

describe('quién le paga a quién', () => {
  it('da lo mismo que Liquidar en la app', () => {
    for (let semilla = 1; semilla <= 60; semilla++) {
      const b = saldos(semilla, 2 + (semilla % 9));
      expect(minTransfers(b)).toEqual(deLaWeb(b));
    }
  });

  it('el que debe le paga al que le deben', () => {
    expect(
      minTransfers([
        { id: 'v', name: 'Vale', balance: 50_000 },
        { id: 'm', name: 'Mafe', balance: -50_000 },
      ]),
    ).toEqual([{ from: 'm', to: 'v', amount: 50_000 }]);
  });

  it('«a quien pagó por cada uno» da lo mismo que en la app', () => {
    for (let semilla = 1; semilla <= 60; semilla++) {
      const b = saldos(semilla, 2 + (semilla % 9));
      // Cada deudor tuvo parte en los gastos de algunos de los que les deben
      const acreedores = b.filter((x) => x.balance > 0).map((x) => x.id);
      const pagaron = new Map(b.map((x, i) => [x.id, acreedores.filter((_, k) => (i + k + semilla) % 3 !== 0 || k === 0)]));
      expect(aQuienPagoPor(b, pagaron)).toEqual(aQuienDeLaWeb(b, pagaron));
    }
  });
});
