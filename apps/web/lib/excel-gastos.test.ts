import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { type GastoExcel, type LibroGastos, libroDeGastos } from './excel-gastos';
import { crearT } from './i18n';

const gasto = (over: Partial<GastoExcel>): GastoExcel => ({
  id: 'g',
  fecha: '2026-10-16',
  comercio: 'Uber',
  categoria: { nombre: 'Transporte', tono: 'azul' },
  pagador: 'Christian',
  total: 28_644,
  pendiente: false,
  origen: 'WhatsApp · Foto',
  original: null,
  division: [
    { persona: 'Christian', monto: 14_322 },
    { persona: 'Mafe', monto: 14_322 },
  ],
  ...over,
});

const libro = (over: Partial<LibroGastos> = {}): LibroGastos => ({
  cuenta: 'Paseo',
  tipo: 'evento',
  moneda: 'COP',
  periodo: 'Todos los gastos',
  filtros: [],
  exportado: '28 de octubre de 2026',
  web: 'https://mrluks.com',
  accountId: 'a',
  nombreMes: (m) => (m === '2026-10' ? 'Octubre 2026' : 'Septiembre 2026'),
  gastos: [
    gasto({ id: 'g1' }),
    gasto({
      id: 'g2',
      fecha: '2026-09-24',
      comercio: 'Arepas',
      categoria: { nombre: 'Comida', tono: 'naranja' },
      pagador: 'Mafe',
      total: 100_000,
      pendiente: true,
      division: [{ persona: 'Christian', monto: 100_000 }],
    }),
  ],
  ...over,
});

async function leer(d: LibroGastos, idioma: 'es' | 'en' = 'es') {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await libroDeGastos(d, crearT(idioma))) as unknown as ArrayBuffer);
  return wb;
}

/** Lo que dice una celda, aunque sea texto con formato o un link */
const texto = (v: ExcelJS.CellValue) =>
  v && typeof v === 'object' && 'richText' in v ? v.richText.map((r) => r.text).join('') : v && typeof v === 'object' && 'text' in v ? v.text : v;

describe('el Excel de Gastos', () => {
  it('trae Resumen, Gastos y Divisiones', async () => {
    const wb = await leer(libro());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumen', 'Gastos', 'Divisiones']);
    expect(wb.getWorksheet('Resumen')?.getCell('B1').value).toBe('Luks · Paseo');
  });

  it('los montos son números con formato de pesos, y el total se ajusta al filtrar', async () => {
    const ws = (await leer(libro())).getWorksheet('Gastos')!;
    expect(ws.getCell('B5').value).toBe('Uber');
    expect(ws.getCell('E5').value).toBe(28_644);
    expect(ws.getCell('E5').numFmt).toBe('"$"#,##0');
    expect(ws.getCell('A5').value).toEqual(new Date(Date.UTC(2026, 9, 16)));
    expect(ws.getCell('H6').value).toBe('Por revisar');
    expect(texto(ws.getCell('K5').value)).toBe('Ver gasto');
    expect((ws.getCell('K5').value as ExcelJS.CellHyperlinkValue).hyperlink).toBe('https://mrluks.com/c/a/gastos/g1');
    expect(ws.getCell('E7').value).toEqual({ formula: 'SUBTOTAL(109,E5:E6)', result: 128_644 });
    expect(ws.autoFilter).toBeTruthy();
  });

  it('el resumen: por categoría (la más grande primero) y el balance de cada quien', async () => {
    const ws = (await leer(libro())).getWorksheet('Resumen')!;
    const filas: unknown[][] = [];
    ws.eachRow((r) => {
      filas.push((r.values as ExcelJS.CellValue[]).slice(2, 7).map(texto));
    });
    expect(filas).toContainEqual(['●  Comida', 1, 100_000, 100_000 / 128_644]);
    // Christian pagó 28.644 y le tocaban 114.322: debe 85.678. Mafe pagó 100.000 y le tocaban 14.322
    expect(filas).toContainEqual(['Christian', 1, 28_644, 114_322, -85_678]);
    expect(filas).toContainEqual(['Mafe', 1, 100_000, 14_322, 85_678]);
    expect(filas).toContainEqual(['Octubre 2026', 1, 28_644, 28_644 / 128_644]);
  });

  it('en dólares, los centavos pasan a dólares con dos decimales', async () => {
    const ws = (await leer(libro({ moneda: 'USD', gastos: [gasto({ total: 1250, division: [] })] }))).getWorksheet('Gastos')!;
    expect(ws.getCell('E5').value).toBe(12.5);
    expect(ws.getCell('E5').numFmt).toBe('"$"#,##0.00');
  });

  it('en inglés', async () => {
    const wb = await leer(libro(), 'en');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Expenses', 'Splits']);
  });

  it('sin gastos también sale', async () => {
    const wb = await leer(libro({ gastos: [] }));
    expect(wb.getWorksheet('Gastos')?.getCell('E6').value).toMatchObject({ formula: 'SUBTOTAL(109,E5:E5)' });
  });
});
