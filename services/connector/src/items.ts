import type { Logger } from './log.js';
import { dia } from './preguntas.js';
import type { ItemsCantidad, ItemsPregunta, ItemsRespuesta, Store } from './store.js';
import { formatCOP, type Idioma, plano } from './text.js';

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
  // Los ejemplos, con los números de esta lista: uno entero, unas unidades, varios
  const k = p.items.findIndex((i) => Number(i.quantity) > 1);
  const entero = (p.items.findIndex((i) => Number(i.quantity) <= 1) + 1 || 1).toString();
  const varios = `1, ${Math.min(p.items.length, 3)}`;
  const como = [
    en ? 'How to reply:' : 'Cómo responder:',
    en
      ? `• “${entero}” → all of item ${entero} (if someone else claims it too, you split it)`
      : `• «${entero}» → el ítem ${entero} entero (si otro también lo pide, se lo parten)`,
    ...(k >= 0
      ? [
          en
            ? `• “${k + 1}x2” or “${k + 1}*2” → 2 of the ${cantidad(p.items[k].quantity)} in item ${k + 1}`
            : `• «${k + 1}x2» o «${k + 1}*2» → 2 de las ${cantidad(p.items[k].quantity)} del ítem ${k + 1}`,
        ]
      : []),
    en ? `• “${varios}” → several at once` : `• «${varios}» → varios a la vez`,
    en
      ? `• “${k >= 0 ? k + 1 : 1} are 3” → if item ${k >= 0 ? k + 1 : 1} was 3 (the total doesn’t change)`
      : `• «${k >= 0 ? k + 1 : 1} son 3» → si el ítem ${k >= 0 ? k + 1 : 1} eran 3 (el total no cambia)`,
  ];
  const reparto = en
    ? `What nobody claims is split among everyone${extra > 0 ? ', and the tip and service by what each one had' : ''}. If you’ve messaged me privately, I’ll send you your share there to confirm.`
    : `Lo que nadie diga se divide entre todos${extra > 0 ? ', y la propina y el servicio según lo que consumió cada uno' : ''}. Si ya me escribiste por privado, allá te mando lo tuyo para que lo confirmes.`;
  return [
    `🧾 *${limpio(p.merchant)}* · ${$(p.total)}${pago}`,
    en ? 'Who had what? Reply to *this message* with the numbers of yours:' : '¿Quién pidió qué? Respondan *este mensaje* con los números de lo suyo:',
    '',
    ...items,
    '',
    ...como,
    reparto,
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

/** Lo que contesta Mister Luks a cada respuesta (porPrivado: le mandó lo suyo por privado para confirmarlo) */
export function contestar(r: ItemsRespuesta, porPrivado = false): string {
  const idioma: Idioma = r.language === 'en' ? 'en' : 'es';
  const en = idioma === 'en';
  if (r.ok) {
    const $ = formatCOP(Number(r.parte), r.currency, idioma);
    const nombre = primerNombre(r.name);
    const linea = en
      ? `✅ Logged: ${nombre} → ${suyos(r, idioma)} · ${$} in “${limpio(r.merchant)}”`
      : `✅ Anotado: ${nombre} → ${suyos(r, idioma)} · ${$} en «${limpio(r.merchant)}»`;
    const faltan = Number(r.sin_nadie);
    const privado = porPrivado
      ? `\n${en ? '📩 I sent you the detail privately to confirm it.' : '📩 Te mandé el detalle por privado para que lo confirmes.'}`
      : '';
    if (!faltan) return `${linea}${privado}`;
    return `${linea}\n${en ? `${faltan} still unclaimed.` : faltan === 1 ? 'Falta 1 por decir de quién es.' : `Faltan ${faltan} por decir de quién son.`}${privado}`;
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

/**
 * Por privado, lo suyo de la cuenta para que lo confirme (migración 500):
 * cada ítem con su plata, lo demás (lo que nadie ha dicho, propina) y el total.
 */
export function confirmacionPrivada(r: Extract<ItemsRespuesta, { ok: true }>): string {
  const idioma: Idioma = r.language === 'en' ? 'en' : 'es';
  const en = idioma === 'en';
  const $ = (n: number) => formatCOP(Number(n), r.currency, idioma);
  const cuando = r.expense_date ? ` · ${dia(r.expense_date, idioma)}` : '';
  const cuenta = r.account_name ? (en ? ` · “${limpio(r.account_name)}”` : ` · «${limpio(r.account_name)}»`) : '';
  const lineas = r.mios.map((i) => {
    const q = Number(i.quantity);
    const u = Number(i.units);
    const cuantas = q > 1 ? (en ? ` (${cantidad(u)} of ${cantidad(q)})` : ` (${cantidad(u)} de ${cantidad(q)})`) : u !== 1 ? ` (×${cantidad(u)})` : '';
    return `• ${limpio(i.name)}${cuantas}${i.amount != null ? `: ${$(i.amount)}` : ''}`;
  });
  const enItems = r.mios.reduce((s, i) => s + Number(i.amount ?? 0), 0);
  const resto = Number(r.parte) - enItems;
  if (r.mios.every((i) => i.amount != null) && resto > r.mios.length) {
    lineas.push(
      Number(r.sin_nadie) > 0
        ? `• ${en ? 'Your share of what nobody claimed, tip and service' : 'Tu parte de lo que nadie ha dicho, la propina y el servicio'}: ${$(resto)}`
        : `• ${en ? 'Tip and service' : 'Propina y servicio'}: ${$(resto)}`,
    );
  }
  return [
    `🧾 *${limpio(r.merchant)}*${cuando}${cuenta}`,
    en ? `${primerNombre(r.name)}, this is your share:` : `${primerNombre(r.name)}, esto es lo tuyo:`,
    ...lineas,
    `Total: *${$(r.parte)}*`,
    '',
    en ? 'Is that right? Reply *yes* or *no*.' : '¿Está bien? Respóndeme *sí* o *no*.',
    '',
    FIRMA[idioma],
  ].join('\n');
}

/**
 * «la 1 son 3», «el 2 eran 2», «3 = 4», «items 1 are 3»: cuántas unidades trae
 * un ítem de la lista (sin cambiar lo que vale el renglón). null si no es eso.
 */
export function leerCantidad(texto: string | null | undefined): { n: number; cantidad: number } | null {
  const t = (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  const m = t.match(
    /^(?:(?:la|el|lo|del|de la|item|items|numero|nro|no\.?|#)\s*)*(\d{1,2})\s*(?:son|eran|fueron|=|are|were|is|was)\s*(\d{1,2})(?:\s+[a-z].*)?$/,
  );
  if (!m) return null;
  const n = Number(m[1]);
  const cantidad = Number(m[2]);
  return n >= 1 && cantidad >= 1 && cantidad <= 99 ? { n, cantidad } : null;
}

/** Lo que contesta a «la 1 son 3» */
export function contestarCantidad(r: ItemsCantidad): string {
  const idioma: Idioma = r.language === 'en' ? 'en' : 'es';
  const en = idioma === 'en';
  if (r.ok) {
    const $ = (n: number) => formatCOP(Number(n), r.currency, idioma);
    const q = cantidad(r.quantity);
    const cada = $(Math.round(Number(r.total) / Number(r.quantity)));
    return en
      ? `✅ Logged: “${limpio(r.item)}” is ${q} · ${$(r.total)} in total (${cada} each). Now each person says “${r.n}x1” if they had one of the ${q}.`
      : `✅ Anotado: «${limpio(r.item)}» son ${q} · ${$(r.total)} en total (${cada} c/u). Ahora cada quien dice «${r.n}x1» si fue una de las ${q}.`;
  }
  const { reason, ...resto } = r;
  if (reason === 'cantidad') return en ? '🤔 It has to be between 1 and 99.' : '🤔 Tiene que ser entre 1 y 99.';
  return contestar({ ...resto, ok: false, reason });
}

/** «sí» o «no» a la confirmación por privado */
export function siONo(texto: string | null | undefined): 'si' | 'no' | null {
  const t = plano(texto ?? '');
  if (/^(?:si+|sip|s|ok|okay|dale|listo|correcto|exacto|perfecto|asi es|esta bien|todo bien|yes|yep|yeah|y|correct|right)$/.test(t)) return 'si';
  if (/^(?:no+|nop|nope|n|no es asi|esta mal|incorrecto|wrong|not right)$/.test(t)) return 'no';
  return null;
}

/** Lo que contesta a «sí» o «no» */
export function respuestaConfirmacion(modo: 'si' | 'no', c: { idioma: Idioma; nombre: string; comercio: string; link: string | null }): string {
  const en = c.idioma === 'en';
  if (modo === 'si') {
    return en ? `✅ Done, ${c.nombre}: that’s how it stays in “${c.comercio}”.` : `✅ Listo, ${c.nombre}: así queda en «${c.comercio}».`;
  }
  const app = c.link ? (en ? ` If something isn’t yours, remove it in the app: ${c.link}` : ` Si algo no es tuyo, quítalo en la app: ${c.link}`) : '';
  return en
    ? `👌 Tell me here how it was, with the list numbers (for example “1x2, 3”), and I’ll change it.${app}`
    : `👌 Dime aquí cómo fue, con los números de la lista (por ejemplo «1x2, 3»), y lo cambio.${app}`;
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
