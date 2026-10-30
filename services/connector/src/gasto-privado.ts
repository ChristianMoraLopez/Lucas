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

  /**
   * No tiene una cuenta abierta (migración 640): lo usual es un grupo con
   * Mister Luks, pero si es solo suyo, le abre una aquí mismo y lee lo que mandó
   */
  sinCuenta: (idioma: Idioma, nombre: string, que: QueMando) => {
    const en = idioma === 'en';
    const hola = nombre ? (en ? `Hi ${nombre}` : `Hola ${nombre}`) : en ? 'Hi' : 'Hola';
    return en
      ? `🧾 ${hola}, ${recibi(que, true, 1)}, but you don’t have an open Luks account to log it in.\n\n👥 The usual thing is a WhatsApp group with the people you share expenses with and me: I log what you send there and tell everyone who pays whom. If you already have that group, send it there (or add me to it).\n\n🙋 If it’s just yours, I can open an account for you right here: reply *yes* and I’ll open it and read what you sent me, no need to send it again.\n\nYou can also upload it at mrluks.com/subir.`
      : `🧾 ${hola}, ${recibi(que, false, 1)}, pero no tienes una cuenta abierta en Luks donde anotarlo.\n\n👥 Lo usual es un grupo de WhatsApp con las personas con quienes compartes gastos y conmigo: allá anoto lo que manden y les digo quién le paga a quién. Si ya tienes ese grupo, mándalo ahí (o agrégame).\n\n🙋 Si es solo tuyo, te abro una cuenta aquí mismo: respóndeme *sí* y la abro y leo lo que me mandaste, sin que lo vuelvas a mandar.\n\nTambién lo puedes subir en mrluks.com/subir.`;
  },

  /** La abrió ya (su WhatsApp tiene usuario de Luks) y está leyendo lo que mandó */
  cuentaAbierta: (idioma: Idioma, cuenta: string, link: string, leyendo: boolean) =>
    idioma === 'en'
      ? `🎉 Done, I opened your account “${cuenta}”${leyendo ? ' and I’m reading what you sent me. I’ll tell you how it went in a moment' : ''}.\n🔗 It’s at ${link}\n\n💡 Send me your expenses right here and I’ll log them there. If you later want other people to send receipts to it, connect it to a WhatsApp group from the app (Connect WhatsApp).`
      : `🎉 Listo, abrí tu cuenta «${cuenta}»${leyendo ? ' y estoy leyendo lo que me mandaste. Ya te digo cómo quedó' : ''}.\n🔗 Está en ${link}\n\n💡 Mándame tus gastos por aquí y los anoto allá. Si después quieres que otras personas manden recibos a esa cuenta, conéctala a un grupo de WhatsApp desde la app (Conectar WhatsApp).`,

  /** Para abrirla tiene que entrar a Luks: va el link, y al entrar se abre sola con lo que mandó */
  cuentaPorAbrir: (idioma: Idioma, cuenta: string) =>
    idioma === 'en'
      ? `🙌 Great. To open “${cuenta}” you need to be in Luks (it’s free): I’m sending you the link right now. As soon as you’re in, I’ll open it and read what you sent me, no need to send it again.`
      : `🙌 Listo. Para abrir «${cuenta}» necesito que entres a Luks (es gratis): ya te mando el link. Apenas entres, la abro y leo lo que me mandaste, sin que lo vuelvas a mandar.`,

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
