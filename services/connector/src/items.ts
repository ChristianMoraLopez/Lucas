import type { Logger } from './log.js';
import type { ItemsPregunta, ItemsRespuesta, Store } from './store.js';
import { formatCOP, type Idioma } from './text.js';

/*
 * ¿Quién pidió qué? (migración 440). Cuando llega al grupo la cuenta de un
 * restaurante con varios ítems, Mister Luks la manda numerada en un solo
 * mensaje y cada uno lo responde con los números de lo suyo: «1, 5», «1x2»
 * (2 de las 3 Coca-Colas), «2 de la 1». La base reparte con el mismo cálculo
 * de Dividir en la app. Los mensajes con montos firman como los demás de
 * Mister Luks: así nadie los anota como gasto (es_mensaje_de_luks).
 */

const FIRMA: Record<Idioma, string> = { es: '📊 Más detalle en mrluks.com', en: '📊 More detail at mrluks.com' };

/** Los nombres van tal cual, sin los signos con que WhatsApp pone negrilla, cursiva o tachado */
const limpio = (s: string | null | undefined) => (s ?? '').replace(/[*_~`]/g, '').trim();
const primerNombre = (s: string | null | undefined) => limpio(s).split(/\s+/)[0] ?? '';
const cantidad = (n: number) => String(Number(n)).replace('.', ',');

/** El gasto en la app, para terminar de revisarlo y repartirlo */
export const linkDividir = (webUrl: string, cuenta: string, gasto: string) => `${webUrl}/c/${cuenta}/gastos/${gasto}/dividir`;

/** La lista numerada, para responderla (y el link para terminar en la app lo que no quede bien) */
export function mensajeItems(p: ItemsPregunta, webUrl: string): string {
  const idioma: Idioma = p.account.language === 'en' ? 'en' : 'es';
  const en = idioma === 'en';
  const $ = (n: number) => formatCOP(Number(n), p.account.currency, idioma);
  const pago = p.payer_name ? (en ? ` (${primerNombre(p.payer_name)} paid)` : ` (pagó ${primerNombre(p.payer_name)})`) : '';
  const items = p.items.map((i, k) => `${k + 1}. ${limpio(i.name)}${Number(i.quantity) > 1 ? ` ×${cantidad(i.quantity)}` : ''} · ${$(i.total)}`);
  const extra = Number(p.total) - p.items.reduce((s, i) => s + Number(i.total), 0);
  const conVarias = p.items.find((i) => Number(i.quantity) > 1);
  const ejemplo = conVarias
    ? en
      ? `For example “1, ${Math.min(p.items.length, 3)}”, or “${p.items.indexOf(conVarias) + 1}x2” if you had 2 of the ${cantidad(conVarias.quantity)}.`
      : `Por ejemplo «1, ${Math.min(p.items.length, 3)}», o «${p.items.indexOf(conVarias) + 1}x2» si fueron 2 de las ${cantidad(conVarias.quantity)}.`
    : en
      ? `For example “1, ${Math.min(p.items.length, 3)}”.`
      : `Por ejemplo «1, ${Math.min(p.items.length, 3)}».`;
  const reparto = en
    ? `What nobody claims is split among everyone${extra > 0 ? ', and the tip and service by what each one had' : ''}.`
    : `Lo que nadie diga se divide entre todos${extra > 0 ? ', y la propina y el servicio según lo que consumió cada uno' : ''}.`;
  return [
    `🧾 *${limpio(p.merchant)}* · ${$(p.total)}${pago}`,
    en ? 'Who had what? Reply to *this message* with the numbers of yours:' : '¿Quién pidió qué? Respondan *este mensaje* con los números de lo suyo:',
    '',
    ...items,
    '',
    `${ejemplo} ${reparto}`,
    '',
    // Sin la 460 en la base no llega la cuenta: la lista sale sin el link
    ...(p.account.id
      ? [
          en
            ? `If something isn’t right, finish reviewing and splitting it here: ${linkDividir(webUrl, p.account.id, p.expense_id)}`
            : `Lo que no quede bien, terminen de revisarlo y repartirlo aquí: ${linkDividir(webUrl, p.account.id, p.expense_id)}`,
          '',
        ]
      : []),
    FIRMA[idioma],
  ].join('\n');
}

export interface Respuesta {
  claims: { n: number; units?: number }[];
}

/**
 * Lo que alguien respondió a la lista: «1, 5», «yo la 1 y la 5», «1x2»,
 * «2 de la 1», «1 (2)». null si no trae números o es una pregunta.
 */
export function leerRespuesta(texto: string | null | undefined): Respuesta | null {
  let t = (texto ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[×*]/g, 'x');
  if (!t.trim() || t.length > 160 || /[?¿]/.test(t)) return null;
  const claims = new Map<number, number | undefined>();
  const unidades = (u: string) => {
    const n = Number(u.replace(',', '.'));
    return Number.isFinite(n) && n > 0 && n <= 99 ? n : undefined;
  };
  const tomar = (re: RegExp, f: (m: RegExpMatchArray) => void) => {
    t = t.replace(re, (...args) => {
      f(args as unknown as RegExpMatchArray);
      return ' ';
    });
  };
  // «1x2»: el ítem 1, dos unidades
  tomar(/(?<![\d.,])(\d{1,2})\s*x\s*(\d{1,2}(?:[.,]\d{1,2})?)(?![\d])/g, (m) => claims.set(Number(m[1]), unidades(m[2])));
  // «2 de la 1»
  tomar(/(?<![\d.,])(\d{1,2}(?:[.,]\d{1,2})?)\s+de\s+(?:la|el|los|las)?\s*(\d{1,2})(?![\d])/g, (m) => claims.set(Number(m[2]), unidades(m[1])));
  // «1 (2)»
  tomar(/(?<![\d.,])(\d{1,2})\s*\(\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*\)/g, (m) => claims.set(Number(m[1]), unidades(m[2])));
  // Lo demás: números sueltos
  tomar(/(?<![\d.,])(\d{1,2})(?![\d])/g, (m) => {
    const n = Number(m[1]);
    if (!claims.has(n)) claims.set(n, undefined);
  });
  const lista = [...claims].filter(([n]) => n >= 1).map(([n, units]) => (units === undefined ? { n } : { n, units }));
  return lista.length ? { claims: lista.sort((a, b) => a.n - b.n) } : null;
}

/** «Coca Cola (2 de 3), Pizza» */
function suyos(r: Extract<ItemsRespuesta, { ok: true }>, idioma: Idioma) {
  return r.mios
    .map((i) => {
      const u = Number(i.units);
      const q = Number(i.quantity);
      const cuantas =
        q > 1 ? (idioma === 'en' ? ` (${cantidad(u)} of ${cantidad(q)})` : ` (${cantidad(u)} de ${cantidad(q)})`) : u !== 1 ? ` (×${cantidad(u)})` : '';
      return `${limpio(i.name)}${cuantas}`;
    })
    .join(', ');
}

/** Lo que contesta Mister Luks a cada respuesta */
export function contestar(r: ItemsRespuesta): string {
  const idioma: Idioma = r.language === 'en' ? 'en' : 'es';
  const en = idioma === 'en';
  if (r.ok) {
    const $ = formatCOP(Number(r.parte), r.currency, idioma);
    const nombre = primerNombre(r.name);
    const linea = en
      ? `✅ Logged: ${nombre} → ${suyos(r, idioma)} · ${$} in “${limpio(r.merchant)}”`
      : `✅ Anotado: ${nombre} → ${suyos(r, idioma)} · ${$} en «${limpio(r.merchant)}»`;
    const faltan = Number(r.sin_nadie);
    if (!faltan) return linea;
    return `${linea}\n${en ? `${faltan} still unclaimed.` : faltan === 1 ? 'Falta 1 por decir de quién es.' : `Faltan ${faltan} por decir de quién son.`}`;
  }
  switch (r.reason) {
    case 'liquidado':
      return en
        ? `🔒 “${limpio(r.merchant)}” is already settled: to change who had what, reopen it at mrluks.com.`
        : `🔒 «${limpio(r.merchant)}» ya está liquidada: para cambiar quién pidió qué, reábranla en mrluks.com.`;
    case 'cambio':
    case 'fijos':
      return en
        ? `🤔 “${limpio(r.merchant)}” was already changed in the app: mark it there (Split) at mrluks.com.`
        : `🤔 «${limpio(r.merchant)}» ya la cambiaron en la app: márquenlo allá (Dividir), en mrluks.com.`;
    case 'no_existe':
      return en ? `🤔 The list goes from 1 to ${r.total_items}.` : `🤔 La lista va del 1 al ${r.total_items}.`;
    case 'no_te_conozco':
      return en
        ? `🤔 I don’t know who you are in “${limpio(r.account_name)}”. Type “luks soy yo” so I can recognize you.`
        : `🤔 No sé quién eres en «${limpio(r.account_name)}». Escribe «luks soy yo» para que te reconozca.`;
    default:
      return '';
  }
}

/** Una vuelta: las cuentas recién llegadas, numeradas al grupo (una vez cada una) */
export async function preguntarItems(store: Store, webUrl: string, log: Logger): Promise<number> {
  const pendientes = await store.itemsPorPreguntar(10);
  let nuevas = 0;
  for (const p of pendientes) {
    const clave = `items:${p.expense_id}`;
    const r = await store.outboxEnqueue([{ chat_jid: p.group_jid, reason: 'answer', body: mensajeItems(p, webUrl), dedupe_key: clave }]);
    // Aunque no se haya podido encolar, no se vuelve a preguntar
    await store.itemPromptGuardado(
      p.expense_id,
      p.items.map((i) => i.id),
      p.group_jid,
      clave,
    );
    nuevas += r.length;
  }
  if (pendientes.length) log.info({ cuentas: pendientes.length, nuevas }, '¿Quién pidió qué?');
  return nuevas;
}
