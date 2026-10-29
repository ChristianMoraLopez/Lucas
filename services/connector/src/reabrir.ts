import { linkDividir } from './items.js';
import type { DecisionLiquidada } from './store.js';
import { formatCOP, type Idioma, plano } from './text.js';

/*
 * Un paseo ya liquidado y al grupo llega otro gasto (migración 450): Mister
 * Luks pregunta si lo reabre («1») o lo anota en una cuenta nueva («2»). Si
 * es un comprobante que no pudo emparejar (la 590), también «pago»: no se anota.
 * Aquí se entiende la respuesta y se escribe lo que contesta. Firma como los
 * demás mensajes con montos: así nadie los anota como gasto.
 */

const FIRMA: Record<Idioma, string> = { es: '📊 Más detalle en mrluks.com', en: '📊 More detail at mrluks.com' };

/** «1», «reabrir», «ábrela», «la misma» → reabrir; «2», «cuenta nueva», «otra» → nueva; «pago», «es un pago» → pago. Lo demás, null */
export function leerDecision(texto: string | null | undefined): 'reabrir' | 'nueva' | 'pago' | null {
  const t = plano(texto ?? '')
    .replace(/\b(?:luks|mister|mr|porfa|por favor|la|el|lo|de una|dale|mejor|opcion|yo digo|creo que)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(?:1|uno|reabr\w*|abr\w*|sumal\w*|misma(?: cuenta)?|en misma)$/.test(t)) return 'reabrir';
  if (/^(?:2|dos|nueva(?: cuenta)?|cuenta nueva|otra(?: cuenta)?|aparte)$/.test(t)) return 'nueva';
  if (/^(?:(?:(?:es|fue|era) )?(?:un )?pago(?: entre (?:nosotros|ustedes))?|(?:its |it is |it was )?(?:a )?payment)$/.test(t)) return 'pago';
  return null;
}

const primerNombre = (s: string | null | undefined) =>
  (s ?? '')
    .replace(/[*_~`]/g, '')
    .trim()
    .split(/\s+/)[0] ?? '';

/** Lo que contesta Mister Luks (vacío si no hay nada que decir) */
export function contestarDecision(r: DecisionLiquidada, webUrl: string): string {
  const idioma: Idioma = r.language === 'en' ? 'en' : 'es';
  const en = idioma === 'en';
  if (!r.ok) {
    if (r.reason === 'cerrada') {
      return en
        ? `🔒 “${r.account_name}” is closed: I can only log it in a new account. Reply *2*.`
        : `🔒 «${r.account_name}» está cerrada: solo puedo anotarlo en una cuenta nueva. Respondan *2*.`;
    }
    if (r.reason === 'sin_comprobante') {
      return en
        ? '🤔 What arrived is an expense, not a transfer receipt. Reply *1* to reopen or *2* for a new account.'
        : '🤔 Lo que llegó es un gasto, no un comprobante. Respondan *1* para reabrir o *2* para una cuenta nueva.';
    }
    if (r.reason === 'no_te_conozco') {
      return en
        ? `🤔 I don’t know who you are in “${r.account_name}”. Type “luks soy yo” so I can recognize you.`
        : `🤔 No sé quién eres en «${r.account_name}». Escribe «luks soy yo» para que te reconozca.`;
    }
    return '';
  }
  const $ = (n: number) => formatCOP(Number(n), r.currency, idioma);
  if (r.modo === 'pago') {
    const cuanto = r.gastos.map((g) => $(g.total)).join(en ? ' and ' : ' y ');
    const nombre = primerNombre(r.name);
    return en
      ? `👍 Done, ${nombre}: the receipt (${cuanto}) is a payment, so I didn’t log it as an expense. “${r.cuenta}” stays as it was. If that settles someone’s debt, reply *paid* or mark it at mrluks.com.\n\n${FIRMA[idioma]}`
      : `👍 Listo, ${nombre}: el comprobante (${cuanto}) es un pago, así que no lo anoto como gasto. «${r.cuenta}» queda como estaba. Si con eso alguien quedó a paz y salvo, respóndanme *ya pagué* o márquenlo en mrluks.com.\n\n${FIRMA[idioma]}`;
  }
  const nuevos = r.gastos.filter((g) => !g.duplicate_of);
  const lista = nuevos.map((g) => `*${g.merchant}* (${$(g.total)})`).join(en ? ' and ' : ' y ');
  const conItems = nuevos.some((g) => Number(g.items) >= 2);
  const nombre = primerNombre(r.name);
  const sigue = conItems ? (en ? ' Now I’ll ask who had what.' : ' Ahora les pregunto quién pidió qué.') : '';
  const cuerpo =
    r.modo === 'reabrir'
      ? en
        ? `🔓 Done, ${nombre}: I reopened “${r.cuenta}”${lista ? ` and added ${lista}` : ''}.${sigue} When you’re done, settle it again at mrluks.com.`
        : `🔓 Listo, ${nombre}: reabrí «${r.cuenta}»${lista ? ` y sumé ${lista}` : ''}.${sigue} Cuando terminen, la vuelven a liquidar en mrluks.com.`
      : en
        ? `🆕 Done, ${nombre}: I opened “${r.cuenta}”${lista ? ` and logged ${lista} there` : ''}.${sigue} “${r.anterior}” stays as it was.`
        : `🆕 Listo, ${nombre}: abrí «${r.cuenta}»${lista ? ` y ahí anoté ${lista}` : ''}.${sigue} «${r.anterior}» queda como estaba.`;
  // Si no sigue la lista de ítems, el link para revisarlo y repartirlo en la app
  const link =
    conItems || !r.account_id
      ? null
      : nuevos.length === 1 && nuevos[0].expense_id
        ? linkDividir(webUrl, r.account_id, nuevos[0].expense_id)
        : `${webUrl}/c/${r.account_id}/gastos`;
  const revisar = link
    ? en
      ? `\nIf something isn’t right, review and split it here: ${link}`
      : `\nLo que no quede bien, revísenlo y repártanlo aquí: ${link}`
    : '';
  return `${cuerpo}${revisar}\n\n${FIRMA[idioma]}`;
}
