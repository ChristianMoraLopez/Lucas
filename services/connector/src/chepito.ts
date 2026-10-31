import { comoPagarle } from './cobros.js';
import type { Logger } from './log.js';
import { montoEn } from './pagos.js';
import type { ChepitoPendiente, ChepitoRespuesta, Pago, Store } from './store.js';
import { formatCOP, type Idioma, type Moneda, plano } from './text.js';

/*
 * Chepito (migraciones 700 y 710): a veces el problema no es repartir los
 * gastos sino cobrarlos. Por privado («Juan me debe 50 mil por la boleta» y
 * su contacto) o desde la app, alguien dice quién le debe, cuánto y por qué;
 * Mister Luks le escribe a esa persona, se presenta y se lo recuerda cada 2
 * días, como mucho 4 veces. Quien debe responde «ya pagué», «no le debo» o
 * «no me escribas», y Mister Luks le avisa a quien cobra.
 *
 * Solo escribe en horario de cobranza (la Ley 2300 de 2023, «Dejen de
 * fregar»): lunes a viernes de 8 a. m. a 7 p. m. y sábados de 8 a. m. a 3 p.
 * m., hora de Colombia; nunca domingos ni festivos.
 */

const FIRMA: Record<Idioma, string> = { es: '📊 Más detalle en mrluks.com', en: '📊 More detail at mrluks.com' };
/** Cuánto espera la respuesta de quien está pidiendo un cobro por privado */
export const CHEPITO_MS = 30 * 60_000;
/** El primer aviso sale unos minutos después de crear el cobro: alcanza a decir cómo le pagan */
export const CHEPITO_ESPERA_MIN = 10;

// ---------------------------------------------------------------------------
// Cuándo se puede cobrar: hora de Colombia (UTC−5, sin horario de verano) y sus festivos
// ---------------------------------------------------------------------------

const DIA = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const masDias = (d: Date, n: number) => new Date(d.getTime() + n * DIA);
/** El lunes siguiente (o el mismo día si ya es lunes): la Ley Emiliani */
const alLunes = (d: Date) => masDias(d, (8 - d.getUTCDay()) % 7);

/** Domingo de Pascua (el algoritmo anónimo del calendario gregoriano) */
function pascua(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mes - 1, dia));
}

const festivos = new Map<number, Set<string>>();
/** Los festivos de Colombia de ese año, «2026-11-02» */
export function festivosDeColombia(y: number): Set<string> {
  const ya = festivos.get(y);
  if (ya) return ya;
  const f = (m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
  const p = pascua(y);
  const dias = [
    // Fijos
    f(1, 1),
    f(5, 1),
    f(7, 20),
    f(8, 7),
    f(12, 8),
    f(12, 25),
    // Se pasan al lunes
    ...[f(1, 6), f(3, 19), f(6, 29), f(8, 15), f(10, 12), f(11, 1), f(11, 11)].map(alLunes),
    // Semana Santa, y los que dependen de la Pascua (también al lunes)
    masDias(p, -3),
    masDias(p, -2),
    alLunes(masDias(p, 39)),
    alLunes(masDias(p, 60)),
    alLunes(masDias(p, 68)),
  ];
  const set = new Set(dias.map(iso));
  festivos.set(y, set);
  return set;
}

/** ¿Es horario de cobranza en Colombia? Lunes a viernes de 8 a 19, sábados de 8 a 15, ni domingos ni festivos */
export function puedeCobrar(ahora: Date = new Date()): boolean {
  const co = new Date(ahora.getTime() - 5 * 3_600_000);
  const dia = co.getUTCDay();
  const hora = co.getUTCHours() + co.getUTCMinutes() / 60;
  if (dia === 0 || festivosDeColombia(co.getUTCFullYear()).has(iso(co))) return false;
  return dia === 6 ? hora >= 8 && hora < 15 : hora >= 8 && hora < 19;
}

// ---------------------------------------------------------------------------
// Lo que dice quien pide el cobro: «Juan me debe 50 mil por la boleta», «cóbrale a Pedro 30 lucas del almuerzo»
// ---------------------------------------------------------------------------

export interface BorradorCobro {
  nombre?: string;
  /** E.164 sin «+» (573001234567) */
  telefono?: string;
  /** En pesos (o la unidad de la moneda: la base lo pasa a centavos si hace falta) */
  monto?: number;
  concepto?: string;
}

/** ¿Está pidiendo un cobro? */
export function esPedidoDeCobro(texto: string | null | undefined): boolean {
  const t = plano(texto ?? '');
  return (
    /(?:^|\s)(?:me debe|me deben|me quedo debiendo|me quedaron debiendo|owes me)(?:\s|$)/.test(t) ||
    /^(?:(?:hola |oye |mr |mister )*luks )?(?:cobrale|cobrarle|cobra a|chepito|collect from)\b/.test(t)
  );
}

/** «300 123 4567», «+57 300-123-4567» → 573001234567 (un celular de Colombia sin indicativo lo lleva) */
export function telefonoDe(texto: string | null | undefined): string | null {
  for (const m of (texto ?? '').matchAll(/\+?\d[\d\s().-]{6,20}\d/g)) {
    const d = m[0].replace(/\D/g, '').replace(/^00/, '');
    if (/^3\d{9}$/.test(d)) return `57${d}`;
    if (/^\d{10,15}$/.test(d)) return d;
  }
  return null;
}

/** «50 mil», «50.000», «$50000», «30 lucas», «2 palos», «1,5 millones» → pesos */
export function montoDe(texto: string | null | undefined): number | null {
  const t = (texto ?? '').replace(/\+?\d[\d\s().-]{6,20}\d/g, (x) => (/^\+?(?:3\d{9}|\d{10,15})$/.test(x.replace(/[\s().-]/g, '')) ? ' ' : x));
  const palos = t.match(/(\d+(?:[.,]\d+)?)\s*(?:palos?|millones|mill[oó]n)(?![\p{L}])/iu);
  if (palos) return Math.round(Number(palos[1].replace(',', '.')) * 1_000_000);
  const n = montoEn(t);
  return n && n > 0 ? n : null;
}

// «mi prima Sofía» → «Sofía»
const PARIENTE =
  /^(?:mi|mis|el|la|un|una)\s+(?:amig[oa]|prim[oa]|herman[oa]|ti[oa]|vecin[oa]|compa(?:ñer[oa])?|parcer[oa]|parce|novi[oa]|ex|soci[oa]|jef[ea]|cuñad[oa]|suegr[oa]|compadre|comadre)\s+/i;

/** El nombre, sin números ni lo que sobra («Juan Pérez (300…)» → «Juan Pérez») */
export function nombreLimpio(s: string | null | undefined): string | undefined {
  const n = (s ?? '')
    .replace(/\+?\d[\d\s().-]*/g, ' ')
    .replace(/[*_~`"«»“”()[\]{}:;,.!¡?¿]/g, ' ')
    .replace(PARIENTE, '')
    .replace(/\s+/g, ' ')
    .trim();
  const palabras = n.split(' ').filter(Boolean);
  if (!palabras.length || palabras.length > 4) return undefined;
  return palabras.join(' ').slice(0, 40);
}

/** «por la boleta.», «del almuerzo» → «la boleta», «almuerzo» */
export function conceptoLimpio(s: string | null | undefined): string | undefined {
  const c = (s ?? '')
    .replace(/^\s*(?:por|de|del|for)\s+/i, '')
    .replace(/[\s.!¡?¿,;:]+$/, '')
    .replace(/[*_~`]/g, '')
    .trim();
  return c.length >= 2 ? c.slice(0, 120) : undefined;
}

/** Lo que se le entiende a un pedido de cobro (puede faltar todo menos la intención) */
export function leerCobro(texto: string | null | undefined): BorradorCobro {
  const t = (texto ?? '').trim();
  const b: BorradorCobro = {};
  const telefono = telefonoDe(t);
  if (telefono) b.telefono = telefono;
  const monto = montoDe(t);
  if (monto) b.monto = monto;

  const saludo = /^(?:(?:hola|oye|ey|mira|buenas|mr\.?|mister|luks)[\s,:!]+)*/i;
  const nombre =
    t.replace(saludo, '').match(/^(.+?)\s+me\s+(?:debe|deben|qued[oó]\s+debiendo|quedaron\s+debiendo)\b/i)?.[1] ??
    t.match(/\bc[oó]br(?:a|ale|arle)\s+a\s+(.+?)(?=\s+(?:\$|\+?\d|por\b|de\b|del\b|lo\b|la\b|el\b|los\b|las\b)|$)/i)?.[1] ??
    t.replace(saludo, '').match(/^(.+?)\s+owes\s+me\b/i)?.[1];
  const n = nombreLimpio(nombre);
  if (n) b.nombre = n;

  // El porqué: lo que va después de «por» (o de «de/del» justo después del monto)
  const concepto =
    t.match(/\b(?:por|for)\s+(.{2,140})$/i)?.[1] ??
    t.match(/\d\s*(?:mil|k|lucas?|luquitas?|palos?|millones|mill[oó]n|pesos)?\s+(?:de|del)\s+(.{2,140})$/i)?.[1];
  const c = conceptoLimpio(concepto);
  if (c) b.concepto = c;
  return b;
}

/** Qué le falta, en orden: a quién, su WhatsApp, cuánto y por qué */
export function faltaDe(b: BorradorCobro): 'nombre' | 'telefono' | 'monto' | 'concepto' | null {
  if (!b.nombre) return 'nombre';
  if (!b.telefono) return 'telefono';
  if (!b.monto) return 'monto';
  if (!b.concepto) return 'concepto';
  return null;
}

/** «Nequi 300 123 4567», «mi llave es @juan», «daviplata 3001234567», o «no» */
export function leerComoMePagan(texto: string | null | undefined): Pago | 'no' | null {
  const crudo = (texto ?? '').trim();
  const t = plano(crudo);
  if (/^(?:no|nop|nel|no gracias|ahora no|despues|luego|nada|ninguno|no tengo|no thanks|skip)$/.test(t)) return 'no';
  const cel = (re: RegExp) => {
    const d = crudo
      .match(re)?.[1]
      ?.replace(/\D/g, '')
      .replace(/^57(?=3\d{9}$)/, '');
    return d && /^3\d{9}$/.test(d) ? d : undefined;
  };
  const pago: Pago = {};
  const nequi = cel(/nequi\D{0,12}((?:\+?57)?[\s-]*3[\d\s-]{9,13})/i);
  const daviplata = cel(/davi\s*plata\D{0,12}((?:\+?57)?[\s-]*3[\d\s-]{9,13})/i);
  if (nequi) pago.nequi = nequi;
  if (daviplata) pago.daviplata = daviplata;
  const llave = crudo.match(/(?:llave|bre-?\s?b)\D{0,12}?([@A-Za-z0-9._+-]{3,60})/i)?.[1] ?? crudo.match(/(?:^|\s)(@[A-Za-z0-9._-]{2,59})\b/)?.[1];
  if (llave && !/^(?:es|de|mi|la)$/i.test(llave)) pago.llave = llave;
  // Un celular solo, sin decir de qué: su llave Bre-B (puede ser el celular)
  if (!pago.nequi && !pago.daviplata && !pago.llave) {
    const solo = cel(/^((?:\+?57)?[\s-]*3[\d\s-]{9,13})$/);
    if (solo) pago.llave = solo;
  }
  return Object.keys(pago).length ? pago : null;
}

/** «no le debo», «yo no le debo nada», «número equivocado», «I don’t owe anything» */
export function esNoLeDebo(texto: string | null | undefined): boolean {
  const t = plano(texto ?? '').replace(/^(?:mr |mister )?luks /, '');
  return /^(?:(?:pero |yo |pues |eh )*no (?:le |les )?debo(?: nada)?(?: a (?:nadie|el|ella|esa persona|ese man|esa vieja|ese senor|esa senora))?|no le debo nada a nadie|eso no es (?:mio|mia|cierto|verdad)|no conozco a (?:esa persona|ese|esa|nadie)|(?:numero )?equivocado|wrong number|i (?:dont|do not) owe(?: (?:anything|him|her|them|you))?(?: anything)?)$/.test(
    t,
  );
}

// ---------------------------------------------------------------------------
// Lo que Mister Luks le escribe a quien debe (con la firma: así nadie lo anota como gasto)
// ---------------------------------------------------------------------------

const limpio = (s: string | null | undefined) => (s ?? '').replace(/[*_~`]/g, '').trim();
const primerNombre = (s: string | null | undefined) => limpio(s).split(/\s+/)[0] ?? '';
const idiomaDe = (x: { language?: string | null }): Idioma => (x.language === 'en' ? 'en' : 'es');
const monedaDe = (x: { currency?: string | null }): Moneda => (x.currency as Moneda) || 'COP';

/**
 * Chepito se ve en el mensaje: un GIF (un .mp4 que se repite) con el aviso de
 * pie. En el primero saluda con el sombrero; en los recordatorios muestra la
 * cuenta. Salen de scripts/chepito-gif.mjs de la web.
 */
export function gifDeChepito(c: Pick<ChepitoPendiente, 'avisos' | 'language'>, webUrl: string): string {
  return `${webUrl}/brand/chepito-${c.avisos === 0 ? 'hola' : 'cobra'}-${idiomaDe(c)}.mp4`;
}

/** El aviso número avisos + 1: el primero se presenta; el cuarto es el último */
export function avisoDeCobro(c: ChepitoPendiente): string {
  const idioma = idiomaDe(c);
  const en = idioma === 'en';
  const deudor = primerNombre(c.deudor);
  const acreedor = limpio(c.acreedor);
  const monto = formatCOP(Number(c.monto), monedaDe(c), idioma);
  const concepto = limpio(c.concepto);
  const pago = comoPagarle(primerNombre(c.acreedor), c.pago, idioma);
  const hola = en ? `🎩 Hi${deudor ? ` ${deudor}` : ''}` : `🎩 Hola${deudor ? ` ${deudor}` : ''}`;

  if (c.avisos === 0) {
    const partes = en
      ? [
          `${hola}, I’m *Chepito* and I work for Mister Luks, a bot that keeps track of shared expenses at home and on trips (mrluks.com). He keeps the accounts; I collect them. 😉`,
          `I’m writing on behalf of *${acreedor}*: they say you owe them *${monto}* for “${concepto}”.${pago ? `\n${pago}` : ''}`,
          '✅ When you pay, reply *I paid* and I’ll let them know.\n🙅 If you don’t owe anything, reply *I don’t owe*.\n🔕 If you don’t want me to write to you, reply *don’t message me*.',
        ]
      : [
          `${hola}, soy *Chepito* y trabajo para Mister Luks, un bot que lleva las cuentas de la casa y de los paseos (mrluks.com). Él las lleva; yo las cobro. 😉`,
          `Te escribo de parte de *${acreedor}*: dice que le debes *${monto}* por «${concepto}».${pago ? `\n${pago}` : ''}`,
          '✅ Cuando le pagues, respóndeme *ya pagué* y le aviso.\n🙅 Si no le debes nada, respóndeme *no le debo*.\n🔕 Si no quieres que te escriba, respóndeme *no me escribas*.',
        ];
    return `${partes.join('\n\n')}\n\n${FIRMA[idioma]}`;
  }
  const ultimo = c.avisos >= 3;
  const partes = en
    ? [
        `${hola}, it’s Chepito again. A reminder that you owe *${acreedor}* *${monto}* for “${concepto}”.${pago ? `\n${pago}` : ''}`,
        `✅ If you already paid, reply *I paid*. 🙅 If you don’t owe it, *I don’t owe*. 🔕 So I stop writing, *don’t message me*.${ultimo ? '\n\nThis is the last reminder I’ll send you.' : ''}`,
      ]
    : [
        `${hola}, soy Chepito otra vez. Te recuerdo que le debes *${monto}* a *${acreedor}* por «${concepto}».${pago ? `\n${pago}` : ''}`,
        `✅ Si ya le pagaste, respóndeme *ya pagué*. 🙅 Si no le debes, *no le debo*. 🔕 Para que no te escriba más, *no me escribas*.${ultimo ? '\n\nEs el último recordatorio que te mando.' : ''}`,
      ];
  return `${partes.join('\n\n')}\n\n${FIRMA[idioma]}`;
}

export type QueResponde = 'pagado' | 'no_debe' | 'no_escribas';

/** Lo que se le contesta a quien debe */
export function respuestaAlDeudor(que: QueResponde, cobros: ChepitoRespuesta[], idioma: Idioma): string {
  const en = idioma === 'en';
  const deudor = primerNombre(cobros[0]?.deudor);
  const acreedores = [...new Set(cobros.map((c) => primerNombre(c.acreedor)))].join(en ? ' and ' : ' y ');
  if (que === 'pagado')
    return en
      ? `🎩 Thanks${deudor ? `, ${deudor}` : ''}! I’ll let ${acreedores} know you paid. I won’t write to you about this anymore.`
      : `🎩 ¡Gracias${deudor ? `, ${deudor}` : ''}! Le aviso a ${acreedores} que ya le pagaste. No te escribo más por esto.`;
  if (que === 'no_debe')
    return en
      ? `🎩 Got it${deudor ? `, ${deudor}` : ''}: I won’t write to you about this again, and I’ll let ${acreedores} know.`
      : `🎩 Entendido${deudor ? `, ${deudor}` : ''}: no te vuelvo a escribir por esto y le aviso a ${acreedores}.`;
  return en ? `🎩 Got it, I won’t write to you again. I’ll let ${acreedores} know.` : `🎩 Listo, no te vuelvo a escribir. Le aviso a ${acreedores}.`;
}

/** Lo que se le avisa a quien cobra */
export function avisoAlAcreedor(que: QueResponde, c: ChepitoRespuesta): string {
  const idioma = idiomaDe(c);
  const en = idioma === 'en';
  const deudor = limpio(c.deudor);
  const monto = formatCOP(Number(c.monto), monedaDe(c), idioma);
  const concepto = limpio(c.concepto);
  const cuerpo =
    que === 'pagado'
      ? en
        ? `💸 Good news! *${deudor}* says they already paid you *${monto}* for “${concepto}”, so I stopped reminding them. If the money didn’t arrive, ask Mister Luks to collect again.`
        : `💸 ¡Buenas noticias! *${deudor}* dice que ya te pagó *${monto}* por «${concepto}», así que dejé de cobrarle. Si no te ha llegado la plata, pídele a Mister Luks que le cobre otra vez.`
      : que === 'no_debe'
        ? en
          ? `🙅 *${deudor}* says they don’t owe you *${monto}* for “${concepto}”, so I stopped writing to them. If they do, better talk to them directly.`
          : `🙅 *${deudor}* dice que no te debe *${monto}* por «${concepto}», así que dejé de escribirle. Si sí te debe, mejor háblalo directamente con esa persona.`
        : en
          ? `🔕 *${deudor}* asked me not to write to them anymore, so I stopped collecting *${monto}* for “${concepto}”. Well… now you know they won’t pay you soon 😅`
          : `🔕 *${deudor}* me pidió que no le escriba más, así que dejé de cobrarle *${monto}* por «${concepto}». Bueno… con eso ya sabes que no te va a pagar pronto 😅`;
  return `${en ? '🎩 *Chepito* here:' : '🎩 *Chepito* te cuenta:'}\n${cuerpo}\n\n${FIRMA[idioma]}`;
}

// ---------------------------------------------------------------------------
// Lo que Mister Luks le dice a quien pide el cobro por privado
// ---------------------------------------------------------------------------

const pesos = (n: number, idioma: Idioma) => formatCOP(n, 'COP', idioma);
/** «+57 300 123 4567» */
export const telefonoBonito = (t: string) => (/^573\d{9}$/.test(t) ? `+57 ${t.slice(2, 5)} ${t.slice(5, 8)} ${t.slice(8)}` : `+${t}`);

export const CHEPITO = {
  /** Lo que falta para cobrar */
  pregunta: (falta: 'nombre' | 'telefono' | 'monto' | 'concepto', b: BorradorCobro, idioma: Idioma) => {
    const en = idioma === 'en';
    const n = b.nombre ? primerNombre(b.nombre) : '';
    switch (falta) {
      case 'nombre':
        return en
          ? '🎩 Sure, Chepito (my collector) will handle it. Who owes you? Send me their name or their contact card 📇'
          : '🎩 Listo, de eso se encarga Chepito, mi cobrador. ¿Quién te debe? Mándame su nombre o su contacto 📇';
      case 'telefono':
        return en
          ? `📇 What’s ${n || 'their'}${n ? '’s' : ''} WhatsApp? Send me their contact card or the number (with the country code if it’s not from Colombia).`
          : `📇 ¿Cuál es el WhatsApp de ${n || 'esa persona'}? Mándame su contacto o su número (con el indicativo, si no es de Colombia).`;
      case 'monto':
        return en
          ? `💸 How much does ${n || 'that person'} owe you? (for example “50,000”)`
          : `💸 ¿Cuánto te debe ${n || 'esa persona'}? (por ejemplo «50 mil»)`;
      case 'concepto':
        return en
          ? `📝 What does ${n || 'that person'} owe you for? (for example “the concert ticket”)`
          : `📝 ¿Por qué te debe ${n || 'esa persona'}? (por ejemplo «la boleta del concierto»)`;
    }
  },
  /** Mandó un contacto sin decir nada más */
  contacto: (b: BorradorCobro, idioma: Idioma) =>
    idioma === 'en'
      ? `📇 I got ${primerNombre(b.nombre) || 'the'}${b.nombre ? '’s' : ''} contact. Should I collect money they owe you? Tell me how much (for example “50,000”), or *no*.`
      : `📇 Recibí el contacto de ${primerNombre(b.nombre) || 'esa persona'}. ¿Quieres que le cobre algo? Dime cuánto te debe (por ejemplo «50 mil»), o *no*.`,
  confirmar: (b: Required<BorradorCobro>, idioma: Idioma) =>
    idioma === 'en'
      ? `🧾 Should I collect *${pesos(b.monto, idioma)}* from *${limpio(b.nombre)}* (${telefonoBonito(b.telefono)}) for “${limpio(b.concepto)}”?\nChepito 🎩 writes to them, introduces himself and reminds them every 2 days, up to 4 times. Reply *yes* or *no*.`
      : `🧾 ¿Le cobro a *${limpio(b.nombre)}* (${telefonoBonito(b.telefono)}) *${pesos(b.monto, idioma)}* por «${limpio(b.concepto)}»?\nChepito 🎩 le escribe, se presenta y se lo recuerda cada 2 días, hasta 4 veces. Respóndeme *sí* o *no*.`,
  cancelado: (idioma: Idioma) => (idioma === 'en' ? '👍 Got it, I won’t collect anything.' : '👍 Listo, no le cobro nada.'),
  /** ¿Le mando cómo pagarte? (y queda en su perfil) */
  pago: (idioma: Idioma) =>
    idioma === 'en'
      ? '💳 Do you want me to send them how to pay you? Write your Nequi, your Daviplata or your Bre-B key (for example “Nequi 300 123 4567”), or *no*. I’ll save it in your profile for your other collections.'
      : '💳 ¿Quieres que le mande cómo pagarte? Escríbeme tu Nequi, tu Daviplata o tu llave Bre-B (por ejemplo «Nequi 300 123 4567»), o *no*. Queda guardado en tu perfil para tus otros cobros.',
  /** Guardó cómo le pagan: va en los avisos */
  pagoGuardado: (medios: string, nombre: string, idioma: Idioma) =>
    idioma === 'en'
      ? `💳 Saved in your profile: ${medios}. I’ll send it to ${primerNombre(nombre) || 'them'} so they can pay you.`
      : `💳 Guardado en tu perfil: ${medios}. Se lo mando a ${primerNombre(nombre) || 'esa persona'} para que te pague.`,
  /** No quiso poner cómo le pagan */
  sinPago: (nombre: string, idioma: Idioma) =>
    idioma === 'en'
      ? `👍 Fine, I’ll just remind ${primerNombre(nombre) || 'them'} what they owe you. You can add how you get paid in your profile at mrluks.com.`
      : `👍 Listo, solo le recuerdo a ${primerNombre(nombre) || 'esa persona'} lo que te debe. Cómo te pagan lo puedes poner en tu perfil en mrluks.com.`,
  pagoNoValido: (idioma: Idioma) =>
    idioma === 'en'
      ? '🤔 I didn’t get that. Nequi and Daviplata are Colombian mobile numbers (10 digits, starting with 3); the Bre-B key is what your bank gave you. Or reply *no*.'
      : '🤔 No te entendí. Nequi y Daviplata son celulares de Colombia (10 números, empiezan por 3); la llave Bre-B, la que te dio el banco. O respóndeme *no*.',
  /** Quedó el cobro */
  listo: (b: Required<BorradorCobro>, link: string, ya: boolean, idioma: Idioma) => {
    const en = idioma === 'en';
    const cuando = ya
      ? en
        ? 'in a few minutes'
        : 'en unos minutos'
      : en
        ? 'as soon as it’s collection hours (Monday to Friday 8 a.m. to 7 p.m., Saturdays until 3 p.m.)'
        : 'apenas sea horario de cobro (lunes a viernes de 8 a. m. a 7 p. m., sábados hasta las 3 p. m.)';
    return en
      ? `✅ Done: Chepito 🎩 will collect *${pesos(b.monto, idioma)}* from *${limpio(b.nombre)}* for “${limpio(b.concepto)}”. He’ll write to them ${cuando} and remind them every 2 days, up to 4 times. He’ll let you know when they say they paid.\n🔗 Follow it at ${link}`
      : `✅ Listo: Chepito 🎩 le cobra a *${limpio(b.nombre)}* *${pesos(b.monto, idioma)}* por «${limpio(b.concepto)}». Le escribe ${cuando} y se lo recuerda cada 2 días, hasta 4 veces. Te avisa cuando le diga que te pagó.\n🔗 Lo sigues en ${link}`;
  },
  /** Para cobrar necesita su usuario de Luks (con el link, su número queda con su correo) */
  sinSesion: (idioma: Idioma) =>
    idioma === 'en'
      ? '🔐 To collect for you I need your Luks account: open the link I’m sending you now (create your user or sign in) and your number gets registered. Then reply *yes* here and I’ll start.'
      : '🔐 Para cobrar por ti necesito tu cuenta de Luks: abre el link que te mando ahora (creas tu usuario o entras con el tuyo) y tu número queda registrado. Después respóndeme *sí* aquí y empiezo.',
  noPude: (reason: string | undefined, b: BorradorCobro, idioma: Idioma) => {
    const en = idioma === 'en';
    const n = limpio(b.nombre) || (en ? 'that person' : 'esa persona');
    switch (reason) {
      case 'no_quiere':
        return en
          ? `🔕 ${n} asked Mister Luks not to write to them anymore, so I can’t collect from them.`
          : `🔕 ${n} le pidió a Mister Luks que no le escriba más, así que no le puedo cobrar.`;
      case 'ya_le_cobras':
        return en ? `😉 I’m already collecting from ${n}.` : `😉 Ya le estoy cobrando a ${n}.`;
      case 'tope':
        return en
          ? '✋ You already have 10 open collections. Close one at mrluks.com before starting another.'
          : '✋ Ya tienes 10 cobros abiertos. Cierra alguno en mrluks.com antes de empezar otro.';
      case 'tope_numero':
        return en ? `✋ Several people are already collecting from ${n}.` : `✋ A ${n} ya le están cobrando varias personas.`;
      case 'es_tu_numero':
        return en ? '😅 That WhatsApp is yours.' : '😅 Ese WhatsApp es el tuyo.';
      case 'telefono':
        return en
          ? '🤔 Check the WhatsApp number: with the country code, for example +57 300 123 4567.'
          : '🤔 Revisa el WhatsApp: con el indicativo, por ejemplo +57 300 123 4567.';
      default:
        return en ? '😕 I couldn’t set up the collection. You can do it at mrluks.com.' : '😕 No pude crear el cobro. Lo puedes hacer en mrluks.com.';
    }
  },
};

// ---------------------------------------------------------------------------
// La vuelta de los avisos (cada 5 minutos, con los de cobro de las cuentas)
// ---------------------------------------------------------------------------

/** Los avisos que tocan, solo en horario de cobranza: cada uno sale por la bandeja de salida */
export async function avisarChepito(store: Store, webUrl: string, log: Logger, ahora: Date = new Date()): Promise<number> {
  if (!puedeCobrar(ahora)) return 0;
  const pendientes = await store.chepitoPendientes(20);
  let enviados = 0;
  for (const c of pendientes) {
    try {
      if (await store.chepitoAvisar(c.cobro_id, c.avisos, avisoDeCobro(c), gifDeChepito(c, webUrl))) enviados += 1;
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'No se pudo mandar un aviso de Chepito');
    }
  }
  if (enviados) log.info({ enviados }, 'Avisos de Chepito');
  return enviados;
}
