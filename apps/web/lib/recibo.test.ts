import { describe, expect, it } from 'vitest';
import { reciboDe } from './recibo';

const gasto = {
  shares: [
    { person_id: 'ana', amount_cop: 66_000 },
    { person_id: 'juan', amount_cop: 33_000 },
    { person_id: 'pipe', amount_cop: 11_000 },
  ],
  items: [
    {
      name: 'Coca-Cola',
      quantity: 3,
      total: 9_000,
      extra: false,
      people: [
        { id: 'ana', units: 2 },
        { id: 'juan', units: 1 },
      ],
    },
    { name: 'Pizza', quantity: 1, total: 60_000, extra: false, people: [{ id: 'ana', units: 1 }] },
    { name: 'Papas', quantity: 1, total: 30_000, extra: false, people: [] },
  ],
};

describe('lo de cada uno en un gasto', () => {
  it('los ítems que pidió, cuántas unidades y lo demás (la propina)', () => {
    expect(reciboDe(gasto, 'ana')).toEqual({
      parte: 66_000,
      items: [
        { name: 'Coca-Cola', units: 2, entre: 2, amount: 6_000 },
        { name: 'Pizza', units: null, entre: 1, amount: 60_000 },
        { name: 'Papas', units: null, entre: 3, amount: 10_000 },
      ],
      resto: -10_000,
    });
    expect(reciboDe(gasto, 'pipe')).toEqual({ parte: 11_000, items: [{ name: 'Papas', units: null, entre: 3, amount: 10_000 }], resto: 1_000 });
  });

  it('a quien no le toca, nada; sin ítems, solo su parte', () => {
    expect(reciboDe(gasto, 'otro')).toBeNull();
    expect(reciboDe({ shares: gasto.shares, items: null }, 'juan')).toEqual({ parte: 33_000, items: [], resto: 0 });
  });
});
