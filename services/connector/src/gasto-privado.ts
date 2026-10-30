import { formatCOP, type Idioma, type Moneda, plano } from './text.js';

/*
 * Un gasto que llega por privado (migración 630): la foto, el PDF o «arriendo
 * 800 lucas». Mister Luks pregunta dónde lo anota: en una de las cuentas
 * abiertas de quien lo manda o, si es una foto o un PDF y debe algo, si es su
 * pago. Sin cuentas, le dice qué puede hacer (el grupo, crear su cuenta o
 * subirlo en la app). Aquí están los textos y cómo se lee la respuesta.
 */

/** Lo que puede responder: anotarlo en una cuenta o marcar su pago de algo que debe */
export type Opcion =
  | { tipo: 'cuenta'; id: string; nombre: string }
  | { tipo: 'pago'; transferId: string; a: string; cuenta: string; monto: number; moneda: Moneda };

export type QueMando = 'foto' | 'pdf' | 'texto';

const recibi = (que: QueMando, en: boolean, varios: number) =>
  varios > 1
    ? en
      ? `I got your ${varios} expenses`
      : `recibí tus ${varios} gastos`
    : que === 'foto'
      ? en
        ? 'I got your photo'
        : 'recibí tu foto'
      : que === 'pdf'
        ? en
          ? 'I got your PDF'
          : 'recibí tu PDF'
        : en
          ? 'I see you sent me an expense'
          : 'veo que me mandaste un gasto';

const opcionTexto = (o: Opcion, en: boolean, idioma: Idioma) =>
  o.tipo === 'cuenta'
    ? en
      ? `Log it in “${o.nombre}”`
      : `Anotarlo en «${o.nombre}»`
    : en
      ? `It’s my payment to ${o.a} for “${o.cuenta}” (${formatCOP(o.monto, o.moneda, idioma)})`
      : `Es mi pago a ${o.a} de «${o.cuenta}» (${formatCOP(o.monto, o.moneda, idioma)})`;

export const GASTO_PRIVADO = {
  /** ¿Dónde lo anoto? Con una sola opción, «sí» o «no»; con varias, el número */
  pregunta: (idioma: Idioma, nombre: string, que: QueMando, opciones: Opcion[], varios = 1) => {
    const en = idioma === 'en';
    const hola = nombre ? (en ? `Hi ${nombre}` : `Hola ${nombre}`) : en ? 'Hi' : 'Hola';
    const cabeza = `🧾 ${hola}, ${recibi(que, en, varios)}.`;
    const conCuenta = opciones.some((o) => o.tipo === 'cuenta');
    const tip = conCuenta
      ? en
        ? '\n\n💡 If it’s a shared expense, you can also send it in that account’s WhatsApp group and I’ll log it there.'
        : '\n\n💡 Si es un gasto compartido, también puedes mandarlo en el grupo de WhatsApp de esa cuenta y lo anoto allá.'
      : '';
    if (opciones.length === 1) {
      const [o] = opciones;
      const pregunta =
        o.tipo === 'cuenta'
          ? en
            ? `Should I log it in “${o.nombre}”?`
            : `¿Lo anoto en «${o.nombre}»?`
          : en
            ? `Is it your payment to ${o.a} for “${o.cuenta}” (${formatCOP(o.monto, o.moneda, idioma)})? Then I’ll mark it paid.`
            : `¿Es tu pago a ${o.a} de «${o.cuenta}» (${formatCOP(o.monto, o.moneda, idioma)})? Así lo marco pagado.`;
      return `${cabeza} ${pregunta}\n${en ? 'Reply *yes* or *no*.' : 'Respóndeme *sí* o *no*.'}${tip}`;
    }
    const lista = opciones.map((o, k) => `${k + 1}. ${opcionTexto(o, en, idioma)}`).join('\n');
    return en
      ? `${cabeza} What should I do with it?\n${lista}\n\nReply with the number (or *no* if it was nothing).${tip}`
      : `${cabeza} ¿Qué hago con él?\n${lista}\n\nRespóndeme con el número (o *no* si no era nada).${tip}`;
  },

  /** No tiene una cuenta abierta donde anotarlo */
  sinCuenta: (idioma: Idioma, nombre: string, que: QueMando) => {
    const en = idioma === 'en';
    const hola = nombre ? (en ? `Hi ${nombre}` : `Hola ${nombre}`) : en ? 'Hi' : 'Hola';
    return en
      ? `🧾 ${hola}, ${recibi(que, true, 1)}, but you don’t have an open Luks account to log it in.\n\n• If it’s shared with other people (your home, a trip), send it in their WhatsApp group where I am, or add me to that group.\n• If you want to keep your own expenses with me, reply *yes* and I’ll send you the link to create your account and connect this number. Then send me your expenses right here.\n• You can also upload it at mrluks.com/subir.`
      : `🧾 ${hola}, ${recibi(que, false, 1)}, pero no tienes una cuenta abierta en Luks donde anotarlo.\n\n• Si es con otras personas (tu casa, un paseo), mándalo en el grupo de WhatsApp de ellos donde estoy yo, o agrégame a ese grupo.\n• Si quieres llevar tus gastos conmigo, respóndeme *sí* y te mando el link para crear tu cuenta y conectar este número. Después me mandas tus gastos por aquí.\n• También lo puedes subir en mrluks.com/subir.`;
  },

  /** Ya está conectado a Luks pero no tiene una cuenta abierta */
  creaTuCuenta: (idioma: Idioma) =>
    idioma === 'en'
      ? '✅ Your WhatsApp is already connected to Luks. Create your account at mrluks.com/cuentas/nueva and send me the expense again 😉'
      : '✅ Tu WhatsApp ya está conectado a Luks. Crea tu cuenta en mrluks.com/cuentas/nueva y me vuelves a mandar el gasto 😉',

  /** Después del link para conectar el número */
  despuesDelLink: (idioma: Idioma) =>
    idioma === 'en'
      ? '😉 Once you’re in, create your account and send me the expense again.'
      : '😉 Cuando entres, crea tu cuenta y me vuelves a mandar el gasto.',

  anotando: (idioma: Idioma, cuenta: string, varios: number) =>
    idioma === 'en'
      ? `👍 Done, I’m logging ${varios > 1 ? 'them' : 'it'} in “${cuenta}”. I’ll tell you how it went in a moment.`
      : `👍 Listo, ${varios > 1 ? 'los anoto' : 'lo anoto'} en «${cuenta}». Ya te digo cómo quedó.`,

  noAnoto: (idioma: Idioma) => (idioma === 'en' ? '👍 Got it, I won’t log it.' : '👍 Listo, no lo anoto.'),

  /** La respuesta llegó cuando ya no estaba lo que mandó (pasó mucho rato o se reinició) */
  seMePerdio: (idioma: Idioma) =>
    idioma === 'en'
      ? '🤔 I lost what you sent me (it’s been a while). Could you send it again?'
      : '🤔 Se me perdió lo que me mandaste (pasó mucho rato). ¿Me lo mandas otra vez?',

  noPude: (idioma: Idioma, cuenta: string, razon: string | undefined) => {
    const en = idioma === 'en';
    if (razon === 'cuenta_liquidada') {
      return en
        ? `🔒 “${cuenta}” is already settled, so I can’t log it there. If it’s a new expense for that group, send it in their group and I’ll ask whether to reopen it.`
        : `🔒 «${cuenta}» ya está liquidada, así que no puedo anotarlo ahí. Si es un gasto nuevo de ese grupo, mándalo en el grupo y pregunto si la reabrimos.`;
    }
    if (razon === 'no_me_cuentes') {
      return en
        ? `🙈 You asked me not to log your things in “${cuenta}”. Type “luks count me again” in the group to change it.`
        : `🙈 Me pediste no anotar lo tuyo en «${cuenta}». Escribe «luks cuéntame» en el grupo para cambiarlo.`;
    }
    return en
      ? `😕 I couldn’t log it in “${cuenta}”. You can upload it at mrluks.com/subir.`
      : `😕 No pude anotarlo en «${cuenta}». Lo puedes subir en mrluks.com/subir.`;
  },

  /** «gracias», «ok», «listo»: también se le responde */
  conGusto: (idioma: Idioma) => (idioma === 'en' ? '🙌 You’re welcome!' : '🙌 ¡Con gusto!'),
};

/** La respuesta a «¿dónde lo anoto?»: el número de la opción (con una sola, «sí»), «no», o null si no era eso */
export function leerEleccion(texto: string | null | undefined, opciones: number): number | 'no' | null {
  const t = plano(texto ?? '')
    .replace(/^(?:mr |mister )?luks /, '')
    .replace(/\b(?:porfa|por favor|please|pls|opcion|la|el|en)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const numero = /^(\d{1,2})️?⃣?$/.exec(t)?.[1];
  if (numero) {
    const n = Number(numero);
    return n >= 1 && n <= opciones ? n : null;
  }
  if (/^(?:no|nop|nel|nada|ninguna?|cancela(?:r|lo)?|dejalo|deja asi|no gracias|none|nothing|cancel)$/.test(t)) return 'no';
  if (opciones === 1 && /^(?:si+|sii*|sip|claro|dale|de una|ok|okay|listo|hagale|yes|yep|sure|correcto|eso)$/.test(t)) return 1;
  return null;
}

/** «gracias», «ok», «listo», «jaja», 👍: un mensaje que no pide nada pero merece respuesta */
export function esAgradecimiento(texto: string | null | undefined): boolean {
  const crudo = (texto ?? '').trim();
  if (/^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|️|‍|\s)+$/u.test(crudo) && crudo.length > 0) return true;
  const t = plano(crudo);
  return /^(?:(?:muchas |mil )?gracias(?: (?:luks|mister luks|mr luks|parcero|parce|hermano|bro))?|grax|thanks?(?: you)?|thx|ok(?:ay|i)?|vale|listo|dale|perfecto|genial|super|chevere|bacano|de una|entendido|bueno|bien|jaja\w*|jeje\w*|lol|great|cool|nice)$/.test(
    t,
  );
}
