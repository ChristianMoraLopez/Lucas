import { primerNombre } from './preguntas.js';
import type { EliminarGasto } from './store.js';
import { formatCOP, type Idioma, plano } from './text.js';

/*
 * «luks elimina este gasto» (migración 510): responden (citan) en el grupo el
 * mensaje de un gasto y Mister Luks lo elimina, como «Eliminar» en la app.
 * Aquí se entiende el pedido y se escribe lo que contesta. Lo que trae montos
 * firma «Más detalle en mrluks.com»: así nadie lo anota como gasto.
 */

const FIRMA: Record<Idioma, string> = { es: '📊 Más detalle en mrluks.com', en: '📊 More detail at mrluks.com' };

/** «elimina este gasto», «bórralo», «quita eso», «anula ese recibo», «delete this expense» (sin «luks» ni la mención) */
export function esEliminar(texto: string | null | undefined): boolean {
  const t = plano(texto ?? '')
    .replace(/^(?:por favor|porfa|please|pls)\s+/, '')
    .replace(/\s+(?:por favor|porfa|please|pls)$/, '');
  return /^(?:eliminar?|elimina(?:lo|la|los)|borrar?|borra(?:lo|la|los)|quitar?|quita(?:lo|la|los)|sacar?|saca(?:lo|la|los)|anular?|anula(?:lo|la|los)|descartar?|descarta(?:lo|la|los)|delete|remove|erase|cancel)(?:\s+(?:este|esta|ese|esa|esto|eso|el|la|this|that|the|it))?(?:\s+(?:gasto|gastos|recibo|recibos|factura|cuenta|compra|expense|receipt|one))?(?:\s+(?:que|del grupo|de aqui|de la cuenta|please))?$/.test(
    t,
  );
}

/** Lo que contesta Mister Luks (vacío si no hay nada que decir) */
export function contestarEliminar(r: EliminarGasto, idioma: Idioma): string {
  const en = idioma === 'en';
  if (!r.ok) {
    const cuenta = r.account_name ?? '';
    switch (r.reason) {
      case 'sin_cita':
        return en
          ? '🤔 Which expense? Press and hold the expense’s message (the photo, the PDF or the text), tap *Reply* and write “luks delete this expense”. You can also delete it at mrluks.com.'
          : '🤔 ¿Cuál gasto? Mantén presionado el mensaje del gasto (la foto, el PDF o el texto), dale *Responder* y escríbeme «luks elimina este gasto». También lo pueden eliminar en mrluks.com.';
      case 'no_es_gasto':
        return en
          ? '🤔 That message has no expense logged. Reply to the expense’s message (the photo, the PDF or the text) with “luks delete this expense”.'
          : '🤔 Ese mensaje no tiene un gasto anotado. Responde el mensaje del gasto (la foto, el PDF o el texto) con «luks elimina este gasto».';
      case 'procesando':
        return en
          ? '⏳ I’m still reading that expense. Ask me again in a moment.'
          : '⏳ Todavía estoy leyendo ese gasto. En un momentico me lo vuelves a pedir.';
      case 'liquidado':
        return en
          ? `🔒 “${cuenta}” is already settled, so its expenses are frozen. To change something, reopen it in Settle up at mrluks.com.`
          : `🔒 «${cuenta}» ya se liquidó, así que sus gastos quedaron congelados. Para cambiar algo, reábranla en Liquidar en mrluks.com.`;
      case 'no_te_conozco':
        return en
          ? `🤔 I don’t know who you are in “${cuenta}”. Type “luks soy yo” so I can recognize you.`
          : `🤔 No sé quién eres en «${cuenta}». Escribe «luks soy yo» para que te reconozca.`;
      case 'no_puedes': {
        const nombre = primerNombre(r.name);
        return en
          ? `🙅 ${nombre}, that expense can only be deleted by whoever sent it, whoever paid it or an admin of “${cuenta}”.`
          : `🙅 ${nombre}, ese gasto lo puede eliminar quien lo mandó, quien lo pagó o quien administra «${cuenta}».`;
      }
      default:
        return '';
    }
  }
  const $ = (n: number) => formatCOP(Number(n), r.currency, idioma);
  const lista = r.gastos.map((g) => `*${g.merchant}* (${$(g.total)})`).join(en ? ' and ' : ' y ');
  const nombre = primerNombre(r.name);
  const cuerpo = en
    ? `🗑️ Done, ${nombre}: I deleted ${lista} from “${r.account_name}”. If it was a mistake, send it again.`
    : `🗑️ Listo, ${nombre}: eliminé ${lista} de «${r.account_name}». Si fue un error, mándenlo otra vez.`;
  return `${cuerpo}\n\n${FIRMA[idioma]}`;
}
