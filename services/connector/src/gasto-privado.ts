import { formatCOP, type Idioma, type Moneda, plano } from './text.js';

/*
 * Un gasto que llega por privado (migración 630): la foto, el PDF o «arriendo
 * 800 lucas». Mister Luks pregunta dónde lo anota: en una de las cuentas
 * abiertas de quien lo manda o, si es una foto o un PDF y debe algo, si es su
 * pago. Sin cuentas, le dice qué puede hacer (el grupo, crear su cuenta o
 * subirlo en la app). Aquí están los textos y cómo se lee la respuesta.
 */

/**
 * Lo que puede responder: anotarlo en una de sus cuentas, en una cuenta nueva solo para lo
 * del chat privado («Cuenta con Mister Luks», si todavía no la tiene) o marcar su pago de algo que debe
 */
export type Opcion =
  | { tipo: 'cuenta'; id: string; nombre: string }
  | { tipo: 'nueva'; nombre: string }
  | { tipo: 'pago'; transferId: string; a: string; cuenta: string; monto: number; moneda: Moneda };

/** El nombre de la cuenta que se abre desde el chat privado (migración 650) */
export const CUENTA_CON_MISTER_LUKS: Record<Idioma, string> = { es: 'Cuenta con Mister Luks', en: 'My Mister Luks account' };

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
    : o.tipo === 'nueva'
      ? en
        ? `Create a new account: “${o.nombre}”`
        : `Crear una cuenta nueva: «${o.nombre}»`
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
          : o.tipo === 'nueva'
            ? en
              ? `Should I create a new account for it, “${o.nombre}”?`
              : `¿Te creo una cuenta nueva para esto, «${o.nombre}»?`
            : en
              ? `Is it your payment to ${o.a} for “${o.cuenta}” (${formatCOP(o.monto, o.moneda, idioma)})? Then I’ll mark it paid.`
              : `¿Es tu pago a ${o.a} de «${o.cuenta}» (${formatCOP(o.monto, o.moneda, idioma)})? Así lo marco pagado.`;
      return `${cabeza} ${pregunta}\n${en ? 'Reply *yes* or *no*.' : 'Respóndeme *sí* o *no*.'}${tip}`;
    }
    const lista = opciones.map((o, k) => `${k + 1}. ${opcionTexto(o, en, idioma)}`).join('\n');
    // Sin pagos, la pregunta es solo dónde lo anota
    const pide = opciones.some((o) => o.tipo === 'pago')
      ? en
        ? 'What should I do with it?'
        : '¿Qué hago con él?'
      : en
        ? 'Where should I log it?'
        : '¿Dónde lo anoto?';
    const ejemplo = opciones.find((o) => o.tipo === 'cuenta');
    const palabra = ejemplo ? (palabrasDe(ejemplo.nombre)[0] ?? '') : '';
    return en
      ? `${cabeza} ${pide}\n${lista}\n\nReply with the number or the name${palabra ? ` (for example *1* or *${palabra}*)` : ''}, or *no* if it was nothing.${tip}`
      : `${cabeza} ${pide}\n${lista}\n\nRespóndeme con el número o el nombre${palabra ? ` (por ejemplo *1* o *${palabra}*)` : ''}, o *no* si no era nada.${tip}`;
  },

  /**
   * No tiene sesión en Luks (migración 650): para llevar sus gastos entra con el
   * link (crea su usuario o entra con el suyo, y su número queda con ese correo);
   * apenas entra se abre «Cuenta con Mister Luks» con lo que mandó
   */
  sinSesion: (idioma: Idioma, nombre: string, que: QueMando, cuenta: string) => {
    const en = idioma === 'en';
    const hola = nombre ? (en ? `Hi ${nombre}` : `Hola ${nombre}`) : en ? 'Hi' : 'Hola';
    return en
      ? `🧾 ${hola} 👋 I got your ${que === 'foto' ? 'photo' : que === 'pdf' ? 'PDF' : 'expense'}, but I see you don’t have a session at mrluks.com yet.\n\n🙋 If you want to start keeping your expenses with me, open the link I’m sending you now: create your user (or sign in with yours) and your number gets registered with that email. As soon as you’re in, I’ll open “${cuenta}” and log what you sent me, no need to send it again.\n\n🔁 Already have Luks and I didn’t recognize you? Use the same link, or type “soy yo” and I’ll send you another one.\n\n👥 If it’s an expense with other people, the usual thing is a WhatsApp group with them and me: send it there.`
      : `🧾 ${hola} 👋 Recibí tu ${que === 'foto' ? 'foto' : que === 'pdf' ? 'PDF' : 'gasto'}, pero veo que todavía no tienes sesión en mrluks.com.\n\n🙋 Si quieres empezar a llevar tus gastos conmigo, abre el link que te mando ahora: creas tu usuario (o entras con el que ya tienes) y tu número queda registrado con ese correo. Apenas entres, abro «${cuenta}» y anoto lo que me mandaste, sin que lo vuelvas a mandar.\n\n🔁 ¿Ya tienes Luks y no te reconocí? Entra con el mismo link, o escríbeme «soy yo» y te mando otro.\n\n👥 Si es un gasto con otras personas, lo usual es un grupo de WhatsApp con ellas y conmigo: mándalo allá.`;
  },

  /**
   * Tiene sesión pero ninguna cuenta abierta: le abrió «Cuenta con Mister Luks» y está leyendo lo que
   * mandó. Con «pedida», tenía otras y eligió abrir esa (migración 670)
   */
  cuentaAbierta: (idioma: Idioma, cuenta: string, link: string, leyendo: boolean, pedida = false) =>
    idioma === 'en'
      ? `🎉 ${pedida ? 'Done, I' : 'You didn’t have an open account, so I'} opened “${cuenta}” for you${leyendo ? ' and I’m reading what you sent me. I’ll tell you how it went in a moment' : ''}.\n🔗 It’s at ${link}\n\n💡 Send me your expenses right here and I’ll log them there. If it was a shared expense, the usual thing is a WhatsApp group with those people and me; you can also connect this account to a group from the app (Connect WhatsApp) so several people send receipts to it.`
      : `🎉 ${pedida ? 'Listo, te' : 'No tenías una cuenta abierta, así que te'} abrí «${cuenta}»${leyendo ? ' y estoy leyendo lo que me mandaste. Ya te digo cómo quedó' : ''}.\n🔗 Está en ${link}\n\n💡 Mándame tus gastos por aquí y los anoto allá. Si era un gasto compartido, lo usual es un grupo de WhatsApp con esas personas y conmigo; también puedes conectar esta cuenta a un grupo desde la app (Conectar WhatsApp) para que varios manden recibos a ella.`,

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

// Lo que no sirve para saber cuál eligió: «anótalo en la de casa porfa» → «casa»
const VACIAS = new Set(
  'a al de del el la las los en con y o que si mi mis tu su lo le ese esa este esta cuenta cuentas gasto gastos anota anotalo anotala anotar manda mandalo mandala ponlo ponla pon porfa por favor please pls the in to my account expenses log it'.split(
    ' ',
  ),
);
// «Mister Lucas», «Mr Luks», «la nueva», «otra»: todo apunta a lo mismo
const IGUALES: Record<string, string> = {
  lucas: 'luks',
  mr: 'mister',
  mrluks: 'luks',
  misterluks: 'luks',
  nuevo: 'nueva',
  new: 'nueva',
  otra: 'nueva',
  pague: 'pago',
  payment: 'pago',
  paid: 'pago',
};

/** Las palabras de un nombre con las que se puede elegir esa opción */
export function palabrasDe(nombre: string): string[] {
  return plano(nombre)
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .split(' ')
    .filter((w) => w && !VACIAS.has(w))
    .map((w) => IGUALES[w] ?? w);
}

/** Con qué palabras se elige cada opción: el nombre de la cuenta; la nueva, también con «nueva»; un pago, con «pago» */
export const nombreParaElegir = (o: Opcion) => (o.tipo === 'cuenta' ? o.nombre : o.tipo === 'nueva' ? `${o.nombre} nueva` : 'pago');

/**
 * La respuesta a «¿dónde lo anoto?»: el número de la opción (con una sola, «sí»), «no», o null si
 * no era eso. Con los nombres de las opciones también vale el nombre («casa», «Mister Luks»), si
 * apunta a una sola; un texto con números no (puede ser otro gasto: «mercado casa 50 mil»)
 */
export function leerEleccion(texto: string | null | undefined, opciones: number, nombres?: string[]): number | 'no' | null {
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
  if (!nombres?.length || /\d/.test(t) || t.split(' ').length > 6) return null;
  const exacto = nombres.findIndex((n) => plano(n) === plano(texto ?? ''));
  if (exacto >= 0) return exacto + 1;
  const dice = new Set(palabrasDe(texto ?? ''));
  if (!dice.size) return null;
  const cuales = nombres.flatMap((n, k) => (palabrasDe(n).some((w) => dice.has(w)) ? [k + 1] : []));
  return cuales.length === 1 ? cuales[0] : null;
}

/** ¿Puede ser la respuesta a una pregunta de «¿dónde lo anoto?»? (un número, «no» o unas pocas palabras sin números) */
export const pareceEleccion = (texto: string | null | undefined) => {
  const t = plano(texto ?? '');
  return leerEleccion(t, 9) !== null || (t.length > 0 && !/\d/.test(t) && t.split(' ').length <= 6);
};

/** «gracias», «ok», «listo», «jaja», 👍: un mensaje que no pide nada pero merece respuesta */
export function esAgradecimiento(texto: string | null | undefined): boolean {
  const crudo = (texto ?? '').trim();
  if (/^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|️|‍|\s)+$/u.test(crudo) && crudo.length > 0) return true;
  const t = plano(crudo);
  return /^(?:(?:muchas |mil )?gracias(?: (?:luks|mister luks|mr luks|parcero|parce|hermano|bro))?|grax|thanks?(?: you)?|thx|ok(?:ay|i)?|vale|listo|dale|perfecto|genial|super|chevere|bacano|de una|entendido|bueno|bien|jaja\w*|jeje\w*|lol|great|cool|nice)$/.test(
    t,
  );
}
