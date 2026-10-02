import { describe, expect, it } from 'vitest';
import { type Balance, EXACT_LIMIT, minTransfers, settlesAll } from './settlement';

const B = (entries: [string, number][]): Balance[] => entries.map(([name, balance]) => ({ id: name, name, balance }));
const legible = (ts: { from: string; to: string; amount: number }[]) => ts.map((t) => `${t.from}→${t.to} ${t.amount}`);

/** Generador pseudoaleatorio con semilla: las pruebas siempre dan lo mismo. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Saldos aleatorios que suman cero, en pesos redondos o no. */
function randomBalances(n: number, rand: () => number, redondos = false): Balance[] {
  const vals = Array.from({ length: n - 1 }, () => {
    const v = Math.round((rand() - 0.5) * 900_000);
    return redondos ? Math.round(v / 1000) * 1000 : v;
  });
  vals.push(-vals.reduce((s, v) => s + v, 0));
  return vals.map((balance, i) => ({ id: `p${i}`, name: `Persona ${i}`, balance }));
}

/** Óptimo por fuerza bruta: el máximo número de grupos disjuntos que suman cero. */
function bruteMaxGroups(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  let best = 0;
  const go = (rest: number[], groups: number) => {
    if (!rest.length) {
      best = Math.max(best, groups);
      return;
    }
    // el primero de lo que queda siempre abre un grupo nuevo
    const [first, ...others] = rest;
    const m = others.length;
    for (let mask = 0; mask < 1 << m; mask++) {
      let s = first;
      const inG: number[] = [];
      const outG: number[] = [];
      for (let j = 0; j < m; j++) {
        if (mask & (1 << j)) {
          s += others[j];
          inG.push(j);
        } else outG.push(others[j]);
      }
      if (s === 0) go(outG, groups + 1);
    }
  };
  go(values, 0);
  return best;
}

describe('liquidación: casos de la vida real', () => {
  it('el Paseo Santa Marta del kit: 5 transferencias, las mismas de la captura 5', () => {
    const t = minTransfers(
      B([
        ['Valeria', 412_500],
        ['Laura', 268_000],
        ['Mafe', 151_500],
        ['Caro', -100_000],
        ['Juan Camilo', -132_500],
        ['Felipe', -151_500],
        ['Andrés', -168_000],
        ['Santi', -280_000],
      ]),
    );
    expect(legible(t)).toEqual(['Santi→Valeria 280000', 'Andrés→Laura 168000', 'Felipe→Mafe 151500', 'Juan Camilo→Valeria 132500', 'Caro→Laura 100000']);
  });

  it('alguien que no pagó nada le paga su parte completa a quien puso', () => {
    // Hotel de $900.000 entre 3; solo Valeria pagó
    const t = minTransfers(
      B([
        ['Valeria', 600_000],
        ['Santi', -300_000],
        ['Caro', -300_000],
      ]),
    );
    expect(legible(t)).toEqual(['Caro→Valeria 300000', 'Santi→Valeria 300000']);
  });

  it('varios que no pagaron nada y uno que pagó exacto lo suyo (no aparece)', () => {
    const t = minTransfers(
      B([
        ['Valeria', 450_000],
        ['Laura', 0],
        ['Santi', -150_000],
        ['Caro', -150_000],
        ['Felipe', -150_000],
      ]),
    );
    expect(t).toHaveLength(3);
    expect(t.every((x) => x.to === 'Valeria' && x.amount === 150_000)).toBe(true);
    expect(t.some((x) => x.from === 'Laura' || x.to === 'Laura')).toBe(false);
  });

  it('todos a paz y salvo: ninguna transferencia', () => {
    expect(
      minTransfers(
        B([
          ['Valeria', 0],
          ['Andrés', 0],
        ]),
      ),
    ).toEqual([]);
    expect(minTransfers([])).toEqual([]);
  });

  it('una sola deuda', () => {
    expect(
      legible(
        minTransfers(
          B([
            ['Valeria', 84_300],
            ['Andrés', -84_300],
          ]),
        ),
      ),
    ).toEqual(['Andrés→Valeria 84300']);
  });

  it('donde el método voraz haría 4, el óptimo hace 3', () => {
    // voraz: 6 con -4, luego 4 con -3, 2 con -3 y 1 con -1 → 4 transferencias
    const t = minTransfers(
      B([
        ['A', 6_000],
        ['B', 4_000],
        ['C', -4_000],
        ['D', -3_000],
        ['E', -3_000],
      ]),
    );
    expect(t).toHaveLength(3);
    expect(legible(t)).toContain('C→B 4000');
  });

  it('redondeos en pesos: $100.001 entre 3 no deja centavos ni pesos perdidos', () => {
    // Como replace_equal_split en la base: el peso que no da exacto va a los primeros
    const partes: Record<string, number> = { Valeria: 33_334, Santi: 33_334, Caro: 33_333 };
    expect(Object.values(partes).reduce((s, v) => s + v, 0)).toBe(100_001);
    const balances = B([
      ['Valeria', 100_001 - partes.Valeria],
      ['Santi', -partes.Santi],
      ['Caro', -partes.Caro],
    ]);
    const t = minTransfers(balances);
    expect(t.every((x) => Number.isInteger(x.amount))).toBe(true);
    expect(t.reduce((s, x) => s + x.amount, 0)).toBe(100_001 - partes.Valeria);
    expect(settlesAll(balances, t)).toBe(true);
  });

  it('saldos de 1 peso también se liquidan', () => {
    expect(
      legible(
        minTransfers(
          B([
            ['A', 1],
            ['B', -1],
          ]),
        ),
      ),
    ).toEqual(['B→A 1']);
  });

  it('no acepta saldos que no cuadran ni con centavos', () => {
    expect(() =>
      minTransfers(
        B([
          ['A', 100],
          ['B', -99],
        ]),
      ),
    ).toThrow('no cuadran');
    expect(() =>
      minTransfers(
        B([
          ['A', 0.5],
          ['B', -0.5],
        ]),
      ),
    ).toThrow('entero');
  });

  it('el resultado no depende del orden en que lleguen las personas', () => {
    const base = B([
      ['Valeria', 412_500],
      ['Laura', 268_000],
      ['Mafe', 151_500],
      ['Caro', -100_000],
      ['Juan Camilo', -132_500],
      ['Felipe', -151_500],
      ['Andrés', -168_000],
      ['Santi', -280_000],
    ]);
    const a = legible(minTransfers(base));
    const b = legible(minTransfers([...base].reverse()));
    expect(b).toEqual(a);
  });
});

describe('liquidación: propiedades con saldos aleatorios', () => {
  it('siempre deja a todos en cero, sin transferencias a sí mismo ni de cero pesos', () => {
    const rand = rng(1581);
    for (let k = 0; k < 400; k++) {
      const n = 2 + Math.floor(rand() * 12);
      const balances = randomBalances(n, rand, k % 2 === 0);
      const t = minTransfers(balances);
      expect(settlesAll(balances, t)).toBe(true);
      const conSaldo = balances.filter((b) => b.balance !== 0).length;
      expect(t.length).toBeLessThanOrEqual(Math.max(0, conSaldo - 1));
    }
  });

  it('es óptimo: coincide con la fuerza bruta (hasta 9 personas)', () => {
    const rand = rng(2012);
    for (let k = 0; k < 250; k++) {
      const n = 2 + Math.floor(rand() * 8);
      // montos pequeños y redondos para que aparezcan muchos subgrupos que suman cero
      const vals = Array.from({ length: n - 1 }, () => (Math.floor(rand() * 7) - 3) * 10_000);
      vals.push(-vals.reduce((s, v) => s + v, 0));
      const balances = vals.map((balance, i) => ({ id: `p${i}`, name: `P${i}`, balance }));
      const conSaldo = vals.filter((v) => v !== 0);
      const optimo = conSaldo.length - bruteMaxGroups(conSaldo);
      expect(minTransfers(balances)).toHaveLength(optimo);
    }
  });

  it(`con más de ${EXACT_LIMIT} personas con saldo usa el voraz y sigue cuadrando`, () => {
    const rand = rng(99);
    const balances = randomBalances(EXACT_LIMIT + 10, rand);
    const t = minTransfers(balances);
    expect(settlesAll(balances, t)).toBe(true);
    expect(t.length).toBeLessThanOrEqual(balances.length - 1);
  });

  it(`con ${EXACT_LIMIT} personas el exacto responde rápido`, () => {
    const rand = rng(7);
    const balances = randomBalances(EXACT_LIMIT, rand, true);
    const start = performance.now();
    const t = minTransfers(balances);
    expect(settlesAll(balances, t)).toBe(true);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});

describe('settlesAll', () => {
  const b = B([
    ['A', 5_000],
    ['B', -5_000],
  ]);
  it('rechaza transferencias que no cuadran, negativas o a sí mismo', () => {
    expect(settlesAll(b, [{ from: 'B', to: 'A', amount: 5_000 }])).toBe(true);
    expect(settlesAll(b, [{ from: 'B', to: 'A', amount: 4_000 }])).toBe(false);
    expect(settlesAll(b, [{ from: 'A', to: 'B', amount: -5_000 }])).toBe(false);
    expect(settlesAll(b, [{ from: 'A', to: 'A', amount: 5_000 }])).toBe(false);
    expect(settlesAll(b, [{ from: 'X', to: 'A', amount: 5_000 }])).toBe(false);
  });
});
