import { primerNombre } from './preguntas.js';
import type { Transferencia, YaPagueResult } from './store.js';
import { formatCOP, type Idioma, looksLikeExpense, plano } from './text.js';

/*
 * «Ya pagué» (migración 420): quien debe le dice a Mister Luks que ya pagó y
 * queda marcado, como en Liquidar. Aquí se decide cuál de lo que le falta
 * pagar es (por a quién, por el monto o porque es lo único) y se escriben las
 * respuestas. Las que traen montos firman «Más detalle en mrluks.com»: así
 * nadie las anota como gasto (es_mensaje_de_luks).
 */

export type Decision =
  /** Estas quedan pagadas */
  | { tipo: 'marcar'; ids: string[] }
  /** No le falta pagar nada */
  | { tipo: 'nada' }
  /** Le debe a varios (o a dos con el mismo nombre): ¿a cuál? */
  | { tipo: 'cual'; nombre: string | null }
  /** Dijo a quién, pero a esa persona no le debe */
  | { tipo: 'no_le_debes'; nombre: string }
  /** Trae un monto y no es de lo que debe: es un gasto («ya pagué la luz 120 lucas») */
  | { tipo: 'gasto' };

/** Lo que no es un nombre en «ya le pagué los 33 mil a Santi por Nequi» */
const RELLENO = new Set(
  (
    'ya les los las del que por para con pague pagado pago pagaste cancele transferi consigne gire deposite mande envie pase hice ' +
    'transferencia plata platica dinero money payment already just paid sent transferred you him her them and the mis mio mia parte ' +
    'listo hecho okay gracias thanks luks mister mrluks esta quedo todo todos todas all everyone everybody everything mil lucas luca ' +
    'luquitas pesos palos cop clp usd hoy ayer ahora recien tambien cuenta cuentas deuda debia debo toca tocaba nequi daviplata ' +
    'bancolombia banco bank transfer via eso esto una uno sus tus your his their for from today yesterday done also too share'
  ).split(' '),
);
const TODOS = /\b(?:todo|todos|todas|everyone|everybody|all|everything)\b/;

/** Las palabras que pueden ser un nombre */
const palabras = (texto: string) =>
  plano(texto)
    .split(' ')
    .filter((w) => w.length >= 3 && !/\d/.test(w) && !RELLENO.has(w));

/** «a Santi», «to Sam», «paid Sam»: a quién dice que le pagó */
function nombrados(texto: string) {
  const t = plano(texto);
  return [...t.matchAll(/\b(?:a|al|to|paid)\s+(?:(?:la|el|los|las|mi|my|the)\s+)?([a-z]{3,})/g)].map((x) => x[1]).filter((w) => !RELLENO.has(w));
}

/** «Santi» es Santiago Ricaurte; «Ricaurte» también */
const coincide = (nombre: string, palabra: string) =>
  plano(nombre)
    .split(' ')
    .some((p) => p.startsWith(palabra));
/** «chile» es «DaniChile» */
const deLaCuenta = (cuenta: string, palabra: string) => coincide(cuenta, palabra) || (palabra.length >= 4 && plano(cuenta).replace(/ /g, '').includes(palabra));

const decimales = (t: Transferencia) => (t.account.currency === 'USD' || t.account.currency === 'BOB' ? 2 : 0);

/** «33.789», «$33789», «33 mil», «33k», «33 lucas», «12,50» → en pesos (o dólares) */
export function montoEn(texto: string): number | null {
  const m = texto.match(/(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d{1,2})?)\s*(mil|k|lucas?|luquitas?)?(?![\p{L}\d])/iu);
  if (!m) return null;
  const n = /[.,]\d{3}(?:\D|$)/.test(m[1]) ? Number(m[1].replace(/[.,]/g, '')) : Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n * (m[2] ? 1000 : 1) : null;
}

/** El monto que dijo es el de esa transferencia (con lo que se redondea al hablar: «33 mil» por $33.789) */
function cerca(t: Transferencia, v: number) {
  const d = decimales(t);
  const u = Number(t.amount) / 10 ** d;
  return Math.abs(u - v) <= Math.max(u * 0.03, d ? 1 : 1000);
}

/**
 * Cuál de lo que le falta pagar es. Por a quién («a Santi»; si hay dos Daniel,
 * pregunta cuál), por la cuenta («lo de Chile»), por el monto o, si le debe a
 * una sola persona, esa. En un grupo, si trae un monto que no es de lo que
 * debe, es un gasto.
 */
export function elegirPagos(pendientes: Transferencia[], texto: string, enGrupo: boolean): Decision {
  const conMonto = looksLikeExpense(texto);
  if (!pendientes.length) return conMonto && enGrupo ? { tipo: 'gasto' } : { tipo: 'nada' };

  // «lo de Chile»: el nombre de la cuenta deja solo lo de esa cuenta
  let pend = pendientes;
  let ws = palabras(texto);
  const deCuenta = ws.filter((w) => pend.some((t) => deLaCuenta(t.account.name, w)) && !pend.some((t) => coincide(t.to_name, w)));
  if (deCuenta.length) {
    pend = pend.filter((t) => deCuenta.some((w) => deLaCuenta(t.account.name, w)));
    ws = ws.filter((w) => !deCuenta.includes(w));
  }

  // Cada palabra, a quiénes de los que les debe se parece (cada persona es de una cuenta)
  const destinos = [...new Map(pend.map((t) => [t.to_id, t.to_name])).entries()];
  const elegidos = new Set<string>();
  const dudas: { palabra: string; quienes: string[] }[] = [];
  for (const w of ws) {
    const quienes = destinos.filter(([, n]) => coincide(n, w)).map(([id]) => id);
    if (quienes.length === 1) elegidos.add(quienes[0]);
    else if (quienes.length > 1) dudas.push({ palabra: w, quienes });
  }
  const monto = montoEn(texto);
  // «Daniel» se parece a dos: vale si otra palabra ya dijo cuál («Daniel Díaz») o si el monto lo dice
  for (const d of dudas.filter((x) => !x.quienes.some((id) => elegidos.has(id)))) {
    const porMonto = monto === null ? [] : pend.filter((t) => d.quienes.includes(t.to_id) && cerca(t, monto));
    if (porMonto.length !== 1) return { tipo: 'cual', nombre: d.palabra };
    elegidos.add(porMonto[0].to_id);
  }
  if (elegidos.size) return { tipo: 'marcar', ids: pend.filter((t) => elegidos.has(t.to_id)).map((t) => t.id) };
  if (TODOS.test(plano(texto))) return { tipo: 'marcar', ids: pend.map((t) => t.id) };
  if (monto !== null) {
    const asi = pend.filter((t) => cerca(t, monto));
    if (asi.length === 1) return { tipo: 'marcar', ids: [asi[0].id] };
  }
  if (conMonto && enGrupo) return { tipo: 'gasto' };
  const nombre = nombrados(texto)[0];
  if (nombre) return { tipo: 'no_le_debes', nombre };
  if (pend.length === 1) return { tipo: 'marcar', ids: [pend[0].id] };
  return { tipo: 'cual', nombre: null };
}

const FIRMA: Record<Idioma, string> = { es: '📊 Más detalle en mrluks.com', en: '📊 More detail at mrluks.com' };
const MAX_LINEAS = 8;
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plata = (t: Transferencia, idioma: Idioma) => formatCOP(Number(t.amount), t.account.currency, idioma);

/** «• *$33.789* a Santiago («DaniChile»)» */
function lineas(ts: Transferencia[], idioma: Idioma, conCuenta: boolean) {
  const en = idioma === 'en';
  const cuenta = (t: Transferencia) => (conCuenta ? (en ? ` (“${t.account.name}”)` : ` («${t.account.name}»)`) : '');
  const ls = ts.slice(0, MAX_LINEAS).map((t) => `• *${plata(t, idioma)}* ${en ? 'to' : 'a'} ${t.to_name}${cuenta(t)}`);
  if (ts.length > MAX_LINEAS) ls.push(en ? `• … and ${ts.length - MAX_LINEAS} more` : `• … y ${ts.length - MAX_LINEAS} más`);
  return ls.join('\n');
}

/** Lo que dice Mister Luks cuando le dicen «ya pagué» */
export const PAGOS = {
  /** Quedó marcado: lo que pagó, lo que le falta y si con eso pagaron todos */
  listo: (idioma: Idioma, nombre: string, r: YaPagueResult, conCuenta: boolean) => {
    const en = idioma === 'en';
    const [una] = r.pagadas;
    const cuenta = conCuenta ? (en ? ` (“${una.account.name}”)` : ` («${una.account.name}»)`) : '';
    const partes = [
      r.pagadas.length === 1
        ? en
          ? `✅ Done, ${nombre}: I marked that you paid ${una.to_name} *${plata(una, idioma)}*${cuenta}.`
          : `✅ Listo, ${nombre}: anoté que le pagaste *${plata(una, idioma)}* a ${una.to_name}${cuenta}.`
        : `${en ? `✅ Done, ${nombre}: I marked that you paid:` : `✅ Listo, ${nombre}: anoté que pagaste:`}\n${lineas(r.pagadas, idioma, conCuenta)}`,
    ];
    if (r.quedan.length) {
      partes.push(`${en ? 'You still owe:' : 'Te falta:'}\n${lineas(r.quedan, idioma, conCuenta || new Set(r.quedan.map((t) => t.account.id)).size > 1)}`);
    } else {
      partes.push(en ? '🙌 You don’t owe anyone anything now.' : '🙌 Ya no le debes nada a nadie.');
    }
    const cuentas = [...new Map(r.pagadas.filter((p) => p.todos_pagaron).map((p) => [p.account.id, p.account.name])).values()];
    for (const c of cuentas) partes.push(en ? `🎉 With that, everyone paid in “${c}”.` : `🎉 Con eso, ya todos pagaron en «${c}».`);
    return `${partes.join('\n\n')}\n\n${FIRMA[idioma]}`;
  },

  /** A quien recibe, por su privado (ya le había escrito a Mister Luks) */
  tePagaron: (idioma: Idioma, p: YaPagueResult['pagadas'][number]) =>
    idioma === 'en'
      ? `💰 Hi ${primerNombre(p.to_name)}: ${p.from_name} told me they paid you *${plata(p, idioma)}* for “${p.account.name}”. If it hasn’t reached you, let them know: it can be unmarked in Settle up.\n\n${FIRMA.en}`
      : `💰 Hola ${primerNombre(p.to_name)}: ${p.from_name} me dijo que ya te pagó *${plata(p, idioma)}* de «${p.account.name}». Si no te ha llegado, díselo: en Liquidar se puede desmarcar.\n\n${FIRMA.es}`,

  /** A quien recibe, en el grupo (no le ha escrito a Mister Luks por privado) */
  pagoEnGrupo: (idioma: Idioma, p: YaPagueResult['pagadas'][number]) =>
    idioma === 'en'
      ? `✅ ${p.from_name} told me privately they paid ${p.to_name} *${plata(p, idioma)}*. ${primerNombre(p.to_name)}, if it hasn’t reached you, let them know.\n\n${FIRMA.en}`
      : `✅ ${p.from_name} me dijo por privado que ya le pagó *${plata(p, idioma)}* a ${p.to_name}. ${primerNombre(p.to_name)}, si no te ha llegado, díselo.\n\n${FIRMA.es}`,

  nada: (idioma: Idioma, nombre: string, cuenta: string | null) =>
    idioma === 'en'
      ? `✅ Yes, ${nombre}, it’s all marked: you have nothing left to pay${cuenta ? ` in “${cuenta}”` : ''} 🙌`
      : `✅ Sí, ${nombre}, ya quedó: no tienes nada pendiente por pagar${cuenta ? ` en «${cuenta}»` : ''} 🙌`,

  sinLiquidar: (idioma: Idioma, nombre: string, cuenta: string) =>
    idioma === 'en'
      ? `🤔 ${nombre}, “${cuenta}” hasn’t been settled yet. Once it’s settled at mrluks.com, tell me “paid” and I’ll mark it.`
      : `🤔 ${nombre}, «${cuenta}» todavía no se ha liquidado. Cuando la liquiden en mrluks.com, me dices «ya pagué» y lo marco.`,

  /** Le debe a varios: ¿a quién? (o hay dos con ese nombre: ¿a cuál?) */
  cual: (idioma: Idioma, nombre: string, pendientes: Transferencia[], palabra: string | null, conCuenta: boolean) => {
    const en = idioma === 'en';
    const ejemplo = palabra ? pendientes.find((t) => coincide(t.to_name, palabra))?.to_name : primerNombre(pendientes[0].to_name);
    const pregunta = palabra
      ? en
        ? `🤔 ${nombre}, which ${mayuscula(palabra)}? You owe:`
        : `🤔 ${nombre}, ¿a cuál ${mayuscula(palabra)}? Te falta:`
      : en
        ? `🤔 ${nombre}, who did you pay? You owe:`
        : `🤔 ${nombre}, ¿a quién le pagaste? Te falta:`;
    const cierre = en
      ? `Tell me, for example, “I paid ${ejemplo}” (or “I paid everyone”).`
      : `Dime, por ejemplo, «ya le pagué a ${ejemplo}» (o «ya les pagué a todos»).`;
    return `${pregunta}\n${lineas(pendientes, idioma, conCuenta || new Set(pendientes.map((t) => t.account.id)).size > 1)}\n${cierre}\n\n${FIRMA[idioma]}`;
  },

  /** Dijo a quién, pero no le debe */
  noLeDebes: (idioma: Idioma, nombre: string, palabra: string, pendientes: Transferencia[], conCuenta: boolean) => {
    const en = idioma === 'en';
    const lista = lineas(pendientes, idioma, conCuenta || new Set(pendientes.map((t) => t.account.id)).size > 1);
    return en
      ? `🤔 ${nombre}, I don’t see that you owe ${mayuscula(palabra)} anything. You owe:\n${lista}\n\n${FIRMA.en}`
      : `🤔 ${nombre}, no veo que le debas nada a ${mayuscula(palabra)}. Te falta:\n${lista}\n\n${FIRMA.es}`;
  },

  /** Por privado, de un número que no está en ninguna cuenta */
  noTeEncuentro: (idioma: Idioma) =>
    idioma === 'en'
      ? '🤔 I can’t find any account with this number, so there’s nothing for me to mark. If you have a debt at mrluks.com, mark it there.'
      : '🤔 No encuentro cuentas tuyas con este número, así que no tengo nada que marcar. Si te sale una deuda en mrluks.com, márcala allá.',
};
