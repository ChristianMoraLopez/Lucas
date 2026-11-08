import { dia } from './preguntas.js';
import type { BusquedaGastos, GastoHallado } from './store.js';
import { formatCOP, type Idioma, type Moneda, plano } from './text.js';

/*
 * Se le pregunta a Mister Luks por gastos de antes (migración 760): «¿cuándo
 * fue la última vez que compré comida para el perro?», «¿qué días gasté en
 * mascotas?», «¿tengo registro de comida para perro?», «¿cuánto he gastado en
 * taxis?». Aquí se entiende la pregunta y se arman los grupos de palabras (cada
 * una con sus parecidas: perro → dog, concentrado, chunky…); la base busca en
 * el comercio, la descripción, los ítems y el texto del recibo. Lo que solo
 * está en la categoría (un Homecenter en Mascotas que no dice qué fue) sale
 * aparte, como «puede ser».
 */

export type ModoBusqueda = 'ultima' | 'dias' | 'cuanto';

export interface Busqueda {
  modo: ModoBusqueda;
  /** Lo que buscan, como lo dijeron sin los rellenos («comida para perro») */
  que: string;
  /** Cada palabra con sus parecidas, ya sin tildes: [["comid","food",…], ["perr","dog",…]] */
  grupos: string[][];
  /** Las categorías que se adivinan («Mascotas») */
  categorias: string[];
  /** La pregunta es solo por la categoría: estar en ella basta */
  categoriaBasta: boolean;
}

const VERBO =
  '(?:compre|compramos|compraste|gaste|gastamos|gastaste|pague|pagamos|pagaste|pedi|pedimos|pediste|comi|comimos|fui|fuimos|tome|tomamos|' +
  'bought|paid|spent|ordered|got|buy|pay|spend|order|get)';
// La pregunta y lo que buscan (el último grupo)
const PREGUNTAS: [ModoBusqueda, RegExp][] = [
  ['ultima', new RegExp(`\\bultima vez (?:que )?(?:${VERBO} )?(?:algo )?(?:(?:en|de|por|para|un|una|el|la) )?(.+)`)],
  ['ultima', new RegExp(`^(?:y )?cuando (?:fue (?:que|la ultima vez que) )?${VERBO} (?:algo )?(?:(?:en|de|por|para) )?(.+)`)],
  ['dias', new RegExp(`\\bque (?:dias|fechas|veces) ${VERBO} (?:algo )?(?:(?:en|de|por|para) )?(.+)`)],
  ['dias', /\b(?:tengo|tenemos|hay) (?:algun |algunos )?(?:registros?|gastos?|compras?) de (.+)/],
  ['cuanto', new RegExp(`\\bcuanto (?:he|hemos|has|han)? ?(?:gastado|${VERBO}) (?:en|de|por) (.+)`)],
  ['ultima', new RegExp(`\\blast time (?:i|we|you) ${VERBO} (?:anything )?(?:(?:on|for|at|some|a) )?(.+)`)],
  ['ultima', new RegExp(`^when did (?:i|we|you) (?:last )?${VERBO} (?:(?:on|for|at|some|a) )?(.+)`)],
  ['cuanto', /\bhow much (?:have|did) (?:i|we|you) (?:spent?|paid?) (?:on|for|at) (.+)/],
];

// Lo que no dice qué buscan
const RELLENO = new Set(
  (
    'a al algo alguna algun con de del el en es esa ese esta este fue la las lo los me mi mis nos nuestra nuestro nuestros ' +
    'para pero por que se su sus te tu tus un una uno unos unas vez y ya hoy ayer mes semana ' +
    'the a an my our for on at of some any time last ever'
  ).split(' '),
);

// Palabras y sus parecidas (en minúscula, sin tildes, el comienzo de la palabra basta)
const MASCOTAS = [
  'perr',
  'dog',
  'canin',
  'mascot',
  'pet ',
  'concentrad',
  'chunky',
  'pedigree',
  'purina',
  'dog chow',
  'dogourmet',
  'nutrecan',
  'veterinar',
  'gat',
  'cat ',
];
const PARECIDAS: [RegExp, string[], string?][] = [
  [/^(?:perr|canin|cachorr|dog|mascot|pet$|pets$)/, MASCOTAS, 'Mascotas'],
  [/^(?:gat|cat$|cats$|felin)/, ['gat', 'cat ', 'felin', 'mascot', 'arena para gat', 'whiskas', 'chunky', 'purina', 'veterinar'], 'Mascotas'],
  [/^veterinar/, ['veterinar', 'vet ', 'mascot'], 'Mascotas'],
  [/^(?:comid|aliment|food|cuido|concentrad)/, ['comid', 'food', 'aliment', 'concentrad', 'cuido']],
  [/^(?:mercad|supermercad|grocer)/, ['mercad', 'supermercad', 'grocer', 'exito', 'carulla', 'jumbo', 'd1 ', 'ara ', 'olimpica', 'makro'], 'Mercado'],
  [/^(?:taxi|uber|didi|cabify|transport|bus$|buses)/, ['taxi', 'uber', 'didi', 'cabify', 'indriver', 'transport', 'transmilenio'], 'Transporte'],
  [/^(?:gasolin|tanque|combustibl|gas$)/, ['gasolin', 'combustibl', 'terpel', 'primax', 'biomax', 'esso', 'mobil'], 'Transporte'],
  [/^(?:farmaci|droguer|medicament|remedi|drogas?$)/, ['farmaci', 'droguer', 'medicament', 'cruz verde', 'cafam', 'colsubsidio'], 'Salud'],
  [/^(?:cervez|trag|licor|aguardient|ron$|beer)/, ['cervez', 'beer', 'licor', 'aguardient', 'ron ', 'trago', 'club colombia', 'aguila', 'poker'], 'Licor'],
  [/^(?:caf[ei]|coffee|tinto)/, ['cafe', 'coffee', 'tinto', 'juan valdez', 'starbucks', 'oma '], 'Café'],
  [/^(?:arriend|rent)/, ['arriend', 'rent'], 'Arriendo'],
  [/^(?:rop[ai]|clothes)/, ['ropa', 'clothes', 'zara', 'h m '], 'Ropa'],
  [/^(?:pizz)/, ['pizz', 'dominos', 'papa johns', 'jenos']],
  [/^(?:hamburgues|burger)/, ['hamburgues', 'burger', 'mcdonald', 'el corral', 'presto']],
];
// Las categorías que se nombran tal cual («¿qué días gasté en mascotas?»)
const CATEGORIAS = [
  'Aseo',
  'Ocio',
  'Ropa',
  'Café',
  'Deuda',
  'Hogar',
  'Licor',
  'Otros',
  'Salud',
  'Belleza',
  'Deporte',
  'Mercado',
  'Regalos',
  'Trabajo',
  'Arriendo',
  'Mascotas',
  'Hospedaje',
  'Servicios',
  'Educación',
  'Transporte',
  'Vacaciones',
  'Restaurante',
]; // prettier-ignore

/** «perros» → «perr», «comida» → «comid», «taxis» → «taxi»: el comienzo que basta para encontrarla */
function raiz(palabra: string): string {
  let p = palabra.replace(/(?:es|s)$/, (s) => (palabra.length > 4 ? '' : s));
  if (p.length > 4) p = p.replace(/[aeo]$/, '');
  return p;
}

/** ¿Pregunta por un gasto de antes? Lo que buscan, con sus parecidas; null si no es esto */
export function busquedaDe(texto: string | null | undefined): Busqueda | null {
  const t = plano(texto ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  for (const [modo, re] of PREGUNTAS) {
    const m = re.exec(t);
    if (!m) continue;
    const palabras = m[1].split(' ').filter((p) => p.length >= 3 && !RELLENO.has(p));
    if (!palabras.length || palabras.length > 6) return null;
    const grupos: string[][] = [];
    const categorias = new Set<string>();
    let todasCategoria = true;
    for (const p of palabras) {
      const categoria = CATEGORIAS.find((c) => raiz(plano(c)) === raiz(p));
      const parecida = PARECIDAS.find(([re]) => re.test(p));
      if (categoria) categorias.add(categoria);
      if (parecida?.[2]) categorias.add(parecida[2]);
      if (!categoria && !parecida?.[2]) todasCategoria = false;
      grupos.push([...new Set([raiz(p), ...(parecida?.[1] ?? [])])]);
    }
    // «¿Cuánto hemos gastado en el paseo?» es el total de siempre: «cuánto… en X» busca solo si X se reconoce
    if (modo === 'cuanto' && !palabras.some((p) => PARECIDAS.some(([re]) => re.test(p)) || CATEGORIAS.some((c) => raiz(plano(c)) === raiz(p)))) return null;
    return { modo, que: palabras.join(' '), grupos, categorias: [...categorias], categoriaBasta: todasCategoria };
  }
  return null;
}

const FIRMA: Record<Idioma, string> = { es: '📊 Más detalle en mrluks.com', en: '📊 More detail at mrluks.com' };

function linea(g: GastoHallado, idioma: Idioma, variasCuentas: boolean): string {
  const fecha = dia(g.fecha, idioma);
  const monto = formatCOP(Number(g.total), (g.moneda as Moneda) || 'COP', idioma);
  const donde = variasCuentas ? ` · ${g.cuenta}` : '';
  return `• ${fecha}: ${g.comercio}, *${monto}*${donde}`;
}

/** Lo que responde Mister Luks: la última vez (o los días), cuánto suman y lo que «puede ser» aparte */
export function respuestaBusqueda(b: Busqueda, r: BusquedaGastos, idioma: Idioma): string {
  const en = idioma === 'en';
  const seguros = r.seguros.gastos;
  const quizas = r.quizas.gastos;
  const variasCuentas = new Set([...seguros, ...quizas].map((g) => g.cuenta)).size > 1;
  const moneda = ((seguros[0] ?? quizas[0])?.moneda as Moneda) || 'COP';
  const partes: string[] = [];

  if (!seguros.length && !quizas.length) {
    return en
      ? `🔎 I don’t have anything recorded for “${b.que}”.\nIf you did buy it, send me the receipt and I’ll add it.`
      : `🔎 No tengo nada anotado de «${b.que}».\nSi sí lo compraste, mándame el recibo y lo anoto.`;
  }

  if (seguros.length) {
    const u = seguros[0];
    const ultima = `*${dia(u.fecha, idioma)}*: ${u.comercio}, *${formatCOP(Number(u.total), moneda, idioma)}*${variasCuentas ? ` (${u.cuenta})` : ''}`;
    if (b.modo === 'cuanto') {
      partes.push(
        en
          ? `🔎 On “${b.que}” you’ve spent *${formatCOP(Number(r.seguros.total), moneda, idioma)}* (${r.seguros.n} ${r.seguros.n === 1 ? 'time' : 'times'}). The last one, ${ultima}.`
          : `🔎 En «${b.que}» llevas *${formatCOP(Number(r.seguros.total), moneda, idioma)}* (${r.seguros.n} ${r.seguros.n === 1 ? 'vez' : 'veces'}). La última, el ${ultima}.`,
      );
    } else {
      partes.push(en ? `🔎 The last time for “${b.que}” was ${ultima}.` : `🔎 La última vez de «${b.que}» fue el ${ultima}.`);
    }
    const antes = b.modo === 'ultima' ? seguros.slice(1, 4) : seguros.slice(1);
    if (antes.length) {
      const encabezado = en ? 'Before that:' : 'Antes:';
      partes.push([encabezado, ...antes.map((g) => linea(g, idioma, variasCuentas))].join('\n'));
    }
    if (b.modo !== 'cuanto' && r.seguros.n > 1) {
      partes.push(
        en
          ? `In total, ${r.seguros.n} times: *${formatCOP(Number(r.seguros.total), moneda, idioma)}*.`
          : `En total, ${r.seguros.n} veces: *${formatCOP(Number(r.seguros.total), moneda, idioma)}*.`,
      );
    }
  } else {
    partes.push(en ? `🔎 Nothing says “${b.que}” for sure.` : `🔎 Nada dice «${b.que}» con seguridad.`);
  }

  if (quizas.length) {
    const cat = quizas[0].categoria ?? '';
    const encabezado = en ? `These are in ${cat}, but the receipt doesn’t say what it was:` : `Estos están en ${cat}, pero el recibo no dice qué fue:`;
    partes.push([encabezado, ...quizas.map((g) => linea(g, idioma, variasCuentas))].join('\n'));
  }
  return `${partes.join('\n\n')}\n\n${FIRMA[idioma]}`;
}
