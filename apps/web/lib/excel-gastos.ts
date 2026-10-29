import ExcelJS from 'exceljs';
import type { T } from '@/lib/i18n';
import { DECIMALES, type Moneda, SIMBOLO } from '@/lib/moneda';

/*
 * El Excel de Gastos: lo que se ve en la lista (con sus filtros), con la cara
 * de Luks. Tres hojas: «Resumen» (las cifras, por categoría, quién pagó contra
 * lo que le tocaba y por mes, con barras), «Gastos» (la tabla con filtros y un
 * total que cambia al filtrar) y «Divisiones» (cuánto le toca a cada quien de
 * cada gasto, para tablas dinámicas). Los montos van como números con el
 * formato de la moneda, no como texto: se pueden sumar.
 */

export interface GastoExcel {
  id: string;
  /** «2026-09-24» */
  fecha: string;
  comercio: string;
  categoria: { nombre: string; tono: string | null } | null;
  pagador: string | null;
  /** En la unidad de la base: pesos o centavos (dólares, bolivianos) */
  total: number;
  pendiente: boolean;
  /** «WhatsApp · Foto», «Web · PDF» */
  origen: string;
  /** «USD 12,50», si el recibo era de otra moneda */
  original: string | null;
  division: { persona: string; monto: number }[];
}

export interface LibroGastos {
  cuenta: string;
  tipo: 'hogar' | 'evento';
  moneda: Moneda;
  /** «Octubre 2026» o «Todos los gastos» */
  periodo: string;
  /** Los filtros que se aplicaron, ya en palabras («Categoría: Comida») */
  filtros: string[];
  /** «28 de octubre de 2026» */
  exportado: string;
  /** https://mrluks.com: para el link de cada gasto */
  web: string;
  accountId: string;
  /** «Octubre 2026» por cada «2026-10» */
  nombreMes: (mes: string) => string;
  gastos: GastoExcel[];
}

// Los colores del kit (lucas-design-kit): tinta, billete verde (marca), morado (eventos), naranja (pendiente) y coral
const C = {
  tinta: 'FF1C1433',
  tinta2: 'FF6B6280',
  fondo: 'FFFFFBF6',
  borde: 'FFE6DEEE',
  verde: 'FF0A7A4C',
  verdeClaro: 'FFE3F4EC',
  morado: 'FF6A35E6',
  moradoClaro: 'FFF3EEFF',
  naranja: 'FFFF7A1A',
  naranjaClaro: 'FFFFF1E5',
  coral: 'FFDB2F47',
  cebra: 'FFFBF9FE',
  blanco: 'FFFFFFFF',
  subtitulo: 'FFCFC6E8',
};
const TONOS: Record<string, string> = {
  morado: 'FFB79CFF',
  naranja: 'FFFF9A4D',
  azul: 'FF7DB8FF',
  coral: 'FFFF8A99',
  verde: 'FF2BD48A',
  amarillo: 'FFFFC53D',
  turquesa: 'FF3FD6CC',
  rosa: 'FFFF8FC0',
};
const FUENTE = 'Calibri';

const relleno = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const linea = (argb = C.borde, style: ExcelJS.BorderStyle = 'thin'): Partial<ExcelJS.Border> => ({ style, color: { argb } });

/** El formato de la moneda: «$ 84.300», «$ 12.50», «Bs 40.00» (los separadores los pone Excel según el idioma) */
function formatoDe(moneda: Moneda, { signo = false } = {}) {
  const s = SIMBOLO[moneda].trim();
  const n = DECIMALES[moneda] ? '#,##0.00' : '#,##0';
  return signo ? `"+${s}"${n};"-${s}"${n};"${s}"0` : `"${s}"${n}`;
}

export async function libroDeGastos(d: LibroGastos, t: T): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Luks · mrluks.com';
  wb.title = `${d.cuenta} · ${d.periodo}`;
  wb.created = new Date();

  const div = 10 ** DECIMALES[d.moneda];
  const plata = (n: number) => n / div;
  const fmt = formatoDe(d.moneda);

  resumen(wb, d, t, plata, fmt);
  hojaGastos(wb, d, t, plata, fmt);
  hojaDivisiones(wb, d, t, plata, fmt);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** La franja de arriba: «Luks · Paseo Santa Marta» y debajo el período y los filtros */
function encabezado(ws: ExcelJS.Worksheet, desde: number, hasta: number, titulo: string, subtitulo: string) {
  for (const [fila, alto] of [
    [1, 40],
    [2, 22],
    [3, 10],
  ] as const) {
    ws.getRow(fila).height = alto;
    for (let c = desde; c <= hasta; c++) ws.getCell(fila, c).fill = relleno(C.tinta);
  }
  ws.mergeCells(1, desde + 1, 1, hasta - 1);
  ws.mergeCells(2, desde + 1, 2, hasta - 1);
  const t = ws.getCell(1, desde + 1);
  t.value = titulo;
  t.font = { name: FUENTE, size: 22, bold: true, color: { argb: C.blanco } };
  t.alignment = { vertical: 'bottom' };
  const s = ws.getCell(2, desde + 1);
  s.value = subtitulo;
  s.font = { name: FUENTE, size: 11, color: { argb: C.subtitulo } };
  s.alignment = { vertical: 'top' };
}

function subtituloDe(d: LibroGastos, t: T) {
  return [d.periodo, d.tipo === 'hogar' ? t('Hogar') : t('Evento'), ...d.filtros, t('Exportado el {fecha}', { fecha: d.exportado })].join('  ·  ');
}

/** Una fila de encabezados de tabla, en tinta */
function cabecera(ws: ExcelJS.Worksheet, fila: number, col: number, textos: string[], derecha: number[] = []) {
  const r = ws.getRow(fila);
  r.height = 24;
  textos.forEach((txt, i) => {
    const c = r.getCell(col + i);
    c.value = txt;
    c.font = { name: FUENTE, size: 10, bold: true, color: { argb: C.blanco } };
    c.fill = relleno(C.tinta);
    c.alignment = { vertical: 'middle', horizontal: derecha.includes(i) ? 'right' : 'left', indent: 1 };
  });
}

/** Las filas de datos: cebra suave y una línea abajo */
function cuerpo(ws: ExcelJS.Worksheet, desde: number, hasta: number, col: number, cols: number) {
  for (let f = desde; f <= hasta; f++) {
    const r = ws.getRow(f);
    r.height = 20;
    for (let c = col; c < col + cols; c++) {
      const cell = r.getCell(c);
      if ((f - desde) % 2 === 1) cell.fill = relleno(C.cebra);
      cell.border = { bottom: linea() };
      cell.font = { name: FUENTE, size: 11, color: { argb: C.tinta }, ...(cell.font ?? {}) };
      cell.alignment = { vertical: 'middle', indent: 1, horizontal: typeof cell.value === 'number' ? 'right' : 'left', ...(cell.alignment ?? {}) };
    }
  }
}

/** La fila de total: fondo morado claro y una línea de tinta arriba */
function filaTotal(ws: ExcelJS.Worksheet, fila: number, col: number, cols: number) {
  const r = ws.getRow(fila);
  r.height = 24;
  for (let c = col; c < col + cols; c++) {
    const cell = r.getCell(c);
    cell.fill = relleno(C.moradoClaro);
    cell.border = { top: linea(C.tinta, 'medium') };
    cell.font = { name: FUENTE, size: 11, bold: true, color: { argb: C.tinta } };
    cell.alignment = { vertical: 'middle', indent: 1, ...(cell.alignment ?? {}) };
  }
}

/** «● Comida» con el punto del color de la categoría */
const conPunto = (texto: string, tono: string | null | undefined): ExcelJS.CellRichTextValue => ({
  richText: [
    { text: '●  ', font: { name: FUENTE, size: 12, color: { argb: TONOS[tono ?? ''] ?? C.tinta2 } } },
    { text: texto, font: { name: FUENTE, size: 11, color: { argb: C.tinta } } },
  ],
});

function titulo(ws: ExcelJS.Worksheet, fila: number, col: number, texto: string, nota?: string) {
  const r = ws.getRow(fila);
  r.height = 30;
  const c = r.getCell(col);
  c.value = texto;
  c.font = { name: FUENTE, size: 15, bold: true, color: { argb: C.tinta } };
  c.alignment = { vertical: 'bottom' };
  if (nota) {
    const n = r.getCell(col + 1);
    n.value = nota;
    n.font = { name: FUENTE, size: 10, italic: true, color: { argb: C.tinta2 } };
    n.alignment = { vertical: 'bottom' };
  }
}

function barras(ws: ExcelJS.Worksheet, ref: string, argb: string) {
  ws.addConditionalFormatting({
    ref,
    rules: [
      {
        type: 'dataBar',
        priority: 1,
        gradient: false,
        cfvo: [{ type: 'num', value: 0 }, { type: 'max' }],
        color: { argb },
      } as ExcelJS.DataBarRuleType,
    ],
  });
}

function resumen(wb: ExcelJS.Workbook, d: LibroGastos, t: T, plata: (n: number) => number, fmt: string) {
  const ws = wb.addWorksheet(t('Resumen'), {
    properties: { tabColor: { argb: C.verde } },
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 3 }, { width: 34 }, { width: 13 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 3 }];
  encabezado(ws, 1, 7, `Luks · ${d.cuenta}`, subtituloDe(d, t));

  // Las cifras grandes: total, cuántos y promedio
  const total = d.gastos.reduce((s, g) => s + g.total, 0);
  const pendientes = d.gastos.filter((g) => g.pendiente).length;
  const tarjetas: [string, number | string, string, string, number, number][] = [
    [t('Total gastado'), plata(total), fmt, C.verde, 2, 2],
    [t('Gastos'), d.gastos.length, '#,##0', C.morado, 3, 4],
    [t('Promedio por gasto'), d.gastos.length ? plata(Math.round(total / d.gastos.length)) : 0, fmt, C.naranja, 5, 6],
  ];
  ws.getRow(5).height = 20;
  ws.getRow(6).height = 36;
  ws.getRow(7).height = 8;
  for (const [etiqueta, valor, formato, color, de, a] of tarjetas) {
    if (a > de) {
      ws.mergeCells(5, de, 5, a);
      ws.mergeCells(6, de, 6, a);
      ws.mergeCells(7, de, 7, a);
    }
    const e = ws.getCell(5, de);
    e.value = etiqueta.toUpperCase();
    e.font = { name: FUENTE, size: 9, bold: true, color: { argb: C.blanco } };
    e.alignment = { vertical: 'bottom', indent: 1 };
    const v = ws.getCell(6, de);
    v.value = valor;
    v.numFmt = formato;
    v.font = { name: FUENTE, size: 22, bold: true, color: { argb: C.blanco } };
    v.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    for (const f of [5, 6, 7]) for (let c = de; c <= a; c++) ws.getCell(f, c).fill = relleno(color);
  }
  let fila = 8;
  if (pendientes) {
    const p = ws.getCell(fila, 2);
    p.value = t('⚠ {n} por revisar: pueden cambiar cuando alguien los revise en Luks.', { n: pendientes });
    p.font = { name: FUENTE, size: 10, bold: true, color: { argb: C.naranja } };
    fila++;
  }
  fila++;

  const pct = (n: number) => (total ? n / total : 0);

  // Por categoría, de la que más a la que menos
  const cats = [
    ...d.gastos
      .reduce((m, g) => {
        const k = g.categoria?.nombre ?? t('Sin categoría');
        const prev = m.get(k) ?? { n: 0, total: 0, tono: g.categoria?.tono ?? null };
        return m.set(k, { ...prev, n: prev.n + 1, total: prev.total + g.total });
      }, new Map<string, { n: number; total: number; tono: string | null }>())
      .entries(),
  ].sort((a, b) => b[1].total - a[1].total);
  if (cats.length) {
    titulo(ws, fila, 2, t('Por categoría'));
    fila++;
    cabecera(ws, fila, 2, [t('Categoría'), t('Gastos'), t('Total'), t('% del total')], [1, 2, 3]);
    const desde = fila + 1;
    for (const [nombre, x] of cats) {
      fila++;
      const r = ws.getRow(fila);
      r.getCell(2).value = conPunto(nombre, x.tono);
      r.getCell(3).value = x.n;
      r.getCell(4).value = plata(x.total);
      r.getCell(4).numFmt = fmt;
      r.getCell(5).value = pct(x.total);
      r.getCell(5).numFmt = '0.0%';
    }
    cuerpo(ws, desde, fila, 2, 4);
    barras(ws, `E${desde}:E${fila}`, 'FF2BD48A');
    fila += 2;
  }

  // Quién pagó y cuánto le tocaba (de lo que está en este Excel)
  const gente = new Map<string, { n: number; pago: number; toca: number }>();
  const de = (k: string) => gente.get(k) ?? gente.set(k, { n: 0, pago: 0, toca: 0 }).get(k)!;
  for (const g of d.gastos) {
    const p = de(g.pagador ?? t('Sin pagador'));
    p.n++;
    p.pago += g.total;
    for (const s of g.division) de(s.persona).toca += s.monto;
  }
  if (gente.size) {
    titulo(ws, fila, 2, t('Quién pagó'), t('Balance: + le deben, − debe'));
    fila++;
    cabecera(ws, fila, 2, [t('Persona'), t('Pagó (gastos)'), t('Pagó'), t('Le tocaba'), t('Balance')], [1, 2, 3, 4]);
    const desde = fila + 1;
    for (const [nombre, x] of [...gente.entries()].sort((a, b) => b[1].pago - a[1].pago)) {
      fila++;
      const r = ws.getRow(fila);
      r.getCell(2).value = nombre;
      r.getCell(3).value = x.n;
      r.getCell(4).value = plata(x.pago);
      r.getCell(4).numFmt = fmt;
      r.getCell(5).value = plata(x.toca);
      r.getCell(5).numFmt = fmt;
      const b = r.getCell(6);
      b.value = plata(x.pago - x.toca);
      b.numFmt = formatoDe(d.moneda, { signo: true });
      b.font = { name: FUENTE, size: 11, bold: true, color: { argb: x.pago - x.toca > 0 ? C.verde : x.pago - x.toca < 0 ? C.coral : C.tinta2 } };
    }
    cuerpo(ws, desde, fila, 2, 5);
    barras(ws, `D${desde}:D${fila}`, 'FFB79CFF');
    fila += 2;
  }

  // Por mes, si hay más de uno
  const meses = [
    ...d.gastos
      .reduce((m, g) => {
        const k = g.fecha.slice(0, 7);
        const prev = m.get(k) ?? { n: 0, total: 0 };
        return m.set(k, { n: prev.n + 1, total: prev.total + g.total });
      }, new Map<string, { n: number; total: number }>())
      .entries(),
  ].sort((a, b) => b[0].localeCompare(a[0]));
  if (meses.length > 1) {
    titulo(ws, fila, 2, t('Por mes'));
    fila++;
    cabecera(ws, fila, 2, [t('Mes'), t('Gastos'), t('Total'), t('% del total')], [1, 2, 3]);
    const desde = fila + 1;
    for (const [mes, x] of meses) {
      fila++;
      const r = ws.getRow(fila);
      r.getCell(2).value = d.nombreMes(mes);
      r.getCell(3).value = x.n;
      r.getCell(4).value = plata(x.total);
      r.getCell(4).numFmt = fmt;
      r.getCell(5).value = pct(x.total);
      r.getCell(5).numFmt = '0.0%';
    }
    cuerpo(ws, desde, fila, 2, 4);
    barras(ws, `E${desde}:E${fila}`, 'FFFF9A4D');
    fila += 2;
  }

  const pie = ws.getCell(fila, 2);
  pie.value = { text: t('Hecho con Luks · mrluks.com'), hyperlink: d.web };
  pie.font = { name: FUENTE, size: 10, color: { argb: C.morado }, underline: true };
}

function hojaGastos(wb: ExcelJS.Workbook, d: LibroGastos, t: T, plata: (n: number) => number, fmt: string) {
  const ws = wb.addWorksheet(t('Gastos'), {
    properties: { tabColor: { argb: C.morado } },
    views: [{ state: 'frozen', xSplit: 2, ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:4' },
  });
  ws.columns = [
    { width: 13 },
    { width: 34 },
    { width: 20 },
    { width: 20 },
    { width: 16 },
    { width: 9 },
    { width: 40 },
    { width: 15 },
    { width: 18 },
    { width: 16 },
    { width: 14 },
  ];
  encabezado(ws, 1, 11, `${t('Gastos')} · ${d.cuenta}`, subtituloDe(d, t));
  const encabezados = [
    t('Fecha'),
    t('Comercio'),
    t('Categoría'),
    t('Pagó'),
    t('Total'),
    t('Entre'),
    t('Dividido entre'),
    t('Estado'),
    t('Origen'),
    t('En otra moneda'),
    t('En Luks'),
  ];
  cabecera(ws, 4, 1, encabezados, [4, 5]);
  const desde = 5;
  let fila = 4;
  for (const g of d.gastos) {
    fila++;
    const r = ws.getRow(fila);
    const [y, m, dia] = g.fecha.split('-').map(Number);
    r.getCell(1).value = new Date(Date.UTC(y, m - 1, dia));
    r.getCell(1).numFmt = 'dd/mm/yyyy';
    r.getCell(2).value = g.comercio;
    r.getCell(3).value = g.categoria ? conPunto(g.categoria.nombre, g.categoria.tono) : '';
    r.getCell(4).value = g.pagador ?? '';
    r.getCell(5).value = plata(g.total);
    r.getCell(5).numFmt = fmt;
    r.getCell(5).font = { name: FUENTE, size: 11, bold: true, color: { argb: C.tinta } };
    r.getCell(6).value = g.division.length || null;
    r.getCell(6).alignment = { horizontal: 'right', indent: 1 };
    r.getCell(7).value = g.division.map((s) => s.persona).join(', ');
    const e = r.getCell(8);
    e.value = g.pendiente ? t('Por revisar') : t('Confirmado');
    e.font = { name: FUENTE, size: 10, bold: true, color: { argb: g.pendiente ? C.naranja : C.verde } };
    r.getCell(9).value = g.origen;
    r.getCell(9).font = { name: FUENTE, size: 10, color: { argb: C.tinta2 } };
    r.getCell(10).value = g.original ?? '';
    r.getCell(10).font = { name: FUENTE, size: 10, color: { argb: C.tinta2 } };
    r.getCell(11).value = { text: t('Ver gasto'), hyperlink: `${d.web}/c/${d.accountId}/gastos/${g.id}` };
    r.getCell(11).font = { name: FUENTE, size: 10, color: { argb: C.morado }, underline: true };
  }
  const hasta = Math.max(fila, desde);
  cuerpo(ws, desde, fila, 1, 11);
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: hasta, column: 11 } };

  // El total cambia al filtrar (SUBTOTAL ignora las filas ocultas)
  fila = hasta + 1;
  const r = ws.getRow(fila);
  r.getCell(1).value = t('Total');
  r.getCell(2).value = { formula: `SUBTOTAL(103,B${desde}:B${hasta})`, result: d.gastos.length };
  r.getCell(2).numFmt = `0" ${t('gastos')}"`;
  r.getCell(5).value = { formula: `SUBTOTAL(109,E${desde}:E${hasta})`, result: plata(d.gastos.reduce((s, g) => s + g.total, 0)) };
  r.getCell(5).numFmt = fmt;
  filaTotal(ws, fila, 1, 11);
  const nota = ws.getCell(fila + 1, 2);
  nota.value = t('El total se ajusta solo cuando filtras la tabla.');
  nota.font = { name: FUENTE, size: 9, italic: true, color: { argb: C.tinta2 } };
}

function hojaDivisiones(wb: ExcelJS.Workbook, d: LibroGastos, t: T, plata: (n: number) => number, fmt: string) {
  const ws = wb.addWorksheet(t('Divisiones'), {
    properties: { tabColor: { argb: C.naranja } },
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:4' },
  });
  ws.columns = [{ width: 13 }, { width: 34 }, { width: 22 }, { width: 16 }, { width: 14 }, { width: 3 }];
  encabezado(ws, 1, 6, t('¿A quién le toca qué?'), t('Una fila por persona y gasto: lista para una tabla dinámica.'));
  cabecera(ws, 4, 1, [t('Fecha'), t('Comercio'), t('Persona'), t('Le toca'), t('% del gasto')], [3, 4]);
  const desde = 5;
  let fila = 4;
  for (const g of d.gastos) {
    for (const s of g.division) {
      fila++;
      const r = ws.getRow(fila);
      const [y, m, dia] = g.fecha.split('-').map(Number);
      r.getCell(1).value = new Date(Date.UTC(y, m - 1, dia));
      r.getCell(1).numFmt = 'dd/mm/yyyy';
      r.getCell(2).value = g.comercio;
      r.getCell(3).value = s.persona;
      r.getCell(4).value = plata(s.monto);
      r.getCell(4).numFmt = fmt;
      r.getCell(5).value = g.total ? s.monto / g.total : 0;
      r.getCell(5).numFmt = '0%';
    }
  }
  const hasta = Math.max(fila, desde);
  cuerpo(ws, desde, fila, 1, 5);
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: hasta, column: 5 } };
  fila = hasta + 1;
  ws.getRow(fila).getCell(1).value = t('Total');
  ws.getRow(fila).getCell(4).value = {
    formula: `SUBTOTAL(109,D${desde}:D${hasta})`,
    result: plata(d.gastos.reduce((s, g) => s + g.division.reduce((a, x) => a + x.monto, 0), 0)),
  };
  ws.getRow(fila).getCell(4).numFmt = fmt;
  filaTotal(ws, fila, 1, 5);
}
