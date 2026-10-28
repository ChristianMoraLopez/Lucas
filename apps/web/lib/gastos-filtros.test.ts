import { describe, expect, it } from 'vitest';
import { aParams, aplicarFiltros, leerFiltros, montoBuscado, ordenarPorCercania, porCercania } from './gastos-filtros';

describe('buscar un valor', () => {
  it.each([
    ['105 mil', 105_000],
    ['105k', 105_000],
    ['105 lucas', 105_000],
    ['$105.000', 105_000],
    ['105.000', 105_000],
    ['105000', 105_000],
    ['105', 105_000],
    // Los centavos se redondean
    ['28.644,53', 28_645],
    ['1,2 palos', 1_200_000],
    ['2 millones', 2_000_000],
    ['$ 2.864.453', 2_864_453],
  ])('«%s» son %d pesos', (q, v) => {
    expect(montoBuscado(q)).toBe(v);
  });

  it('en dólares, a centavos (y un número suelto es eso, no miles)', () => {
    expect(montoBuscado('12.50', 'USD')).toBe(1250);
    expect(montoBuscado('105', 'USD')).toBe(10_500);
  });

  it.each(['Uber', 'D1', 'pizza 2x1', '', 'la 33 bar'])('«%s» no es un valor', (q) => {
    expect(montoBuscado(q)).toBeNull();
  });
});

/** Un builder de mentiras que anota lo que se le pide */
function consulta() {
  const pasos: string[] = [];
  const anota = (paso: string) => {
    pasos.push(paso);
    return q;
  };
  const q = {
    pasos,
    eq: (c: string, v: unknown) => anota(`eq ${c} ${v}`),
    gte: (c: string, v: unknown) => anota(`gte ${c} ${v}`),
    lt: (c: string, v: unknown) => anota(`lt ${c} ${v}`),
    ilike: (c: string, v: string) => anota(`ilike ${c} ${v}`),
    or: (v: string) => anota(`or ${v}`),
    order: (c: string, o: { ascending: boolean }) => anota(`order ${c} ${o.ascending ? 'asc' : 'desc'}`),
  };
  return q;
}

describe('los filtros sobre la consulta', () => {
  it('«105 mil»: de $94.500 a $115.500, o un comercio que lo diga', () => {
    const f = leerFiltros(new URLSearchParams('q=105 mil'));
    expect(aplicarFiltros(consulta(), f).pasos[0]).toBe('or and(total_cop.gte.94500,total_cop.lte.115500),merchant_normalized.ilike.%105 mil%');
    expect(porCercania(f)).toBe(true);
  });

  it('un comercio busca solo por el nombre; el mes y el orden también se aplican', () => {
    const f = leerFiltros({ q: 'Éxito', mes: '2026-09', orden: 'mayor' });
    expect(aplicarFiltros(consulta(), f).pasos).toEqual([
      'gte expense_date 2026-09-01',
      'lt expense_date 2026-10-01',
      'ilike merchant_normalized %exito%',
      'order total_cop desc',
      'order expense_date desc',
      'order created_at desc',
    ]);
  });

  it('los más cercanos al valor primero', () => {
    const rows = [{ total_cop: 115_000 }, { total_cop: 104_000 }, { total_cop: 105_000 }, { total_cop: 95_000 }];
    expect(ordenarPorCercania(rows, 105_000).map((r) => r.total_cop)).toEqual([105_000, 104_000, 115_000, 95_000]);
  });

  it('a la URL solo van los que cambian', () => {
    expect(aParams(leerFiltros({ q: 'uber', orden: 'recientes', ver: 'pendientes' }), { mes: '2026-10' }).toString()).toBe('q=uber&mes=2026-10&ver=pendientes');
  });
});
