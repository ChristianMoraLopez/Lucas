import { minTransfers } from './liquidacion.js';
import type { QuestionData, QuestionMe } from './store.js';
import { formatCOP, type Idioma } from './text.js';

/* Lo que responde Mister Luks cuando le preguntan (fase 7). Los números vienen
   de la base (connector_question, migración 350); aquí solo se escriben. Las
   respuestas con montos firman «Más detalle en mrluks.com»: así nadie las anota
   como gasto (es_mensaje_de_luks, en el connector, el worker y la base). */

export type Numeros = Extract<QuestionData, { ok: true }>;

const FIRMA: Record<Idioma, string> = { es: '📊 Más detalle en mrluks.com', en: '📊 More detail at mrluks.com' };
const MESES: Record<Idioma, string[]> = {
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const CORTOS: Record<Idioma, string[]> = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const cuantos = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
/** «en octubre» en un hogar; nada en un evento (es todo el evento) */
const periodo = (d: Numeros, idioma: Idioma) =>
  d.account.month ? ` ${idioma === 'en' ? 'in' : 'en'} ${MESES[idioma][Number(d.account.month.slice(5, 7)) - 1]}` : '';
const dia = (iso: string, idioma: Idioma) => {
  const n = Number(iso.slice(8, 10));
  const m = CORTOS[idioma][Number(iso.slice(5, 7)) - 1];
  return idioma === 'en' ? `${m} ${n}` : `${n} ${m}`;
};
/** El primer nombre, para hablarle a alguien */
export const primerNombre = (nombre: string | null | undefined) => nombre?.trim().split(/\s+/)[0] ?? '';

export interface Deuda {
  de: string;
  deId: string;
  a: string;
  aId: string;
  monto: number;
  pagada: boolean;
}

/**
 * Quién le paga a quién: la liquidación, si el período ya se liquidó; si no,
 * como quedaría hoy, con el mismo cálculo de Liquidar en la app.
 */
export function deudasDe(d: Numeros): { liquidado: boolean; lista: Deuda[] } {
  if (d.settlement) {
    return {
      liquidado: true,
      lista: d.settlement.map((t) => ({ de: t.from, deId: t.from_id, a: t.to, aId: t.to_id, monto: Number(t.amount), pagada: t.paid })),
    };
  }
  const nombres = new Map(d.people.map((p) => [p.id, p.name]));
  try {
    const lista = minTransfers(d.people.map((p) => ({ id: p.id, name: p.name, balance: Number(p.balance) })));
    return {
      liquidado: false,
      lista: lista.map((t) => ({ de: nombres.get(t.from) ?? '', deId: t.from, a: nombres.get(t.to) ?? '', aId: t.to, monto: t.amount, pagada: false })),
    };
  } catch {
    // Si los saldos no cuadraran (no debería pasar), mejor no inventar
    return { liquidado: false, lista: [] };
  }
}

/** «Sin contar 2 gastos sin quién pagó o sin dividir» */
function incompletos(d: Numeros, idioma: Idioma) {
  if (!d.incomplete) return '';
  return idioma === 'en'
    ? `\n⚠️ Not counting ${cuantos(d.incomplete, 'expense', 'expenses')} with no payer or no split: fix ${d.incomplete === 1 ? 'it' : 'them'} in the app.`
    : `\n⚠️ Sin contar ${cuantos(d.incomplete, 'gasto', 'gastos')} sin quién pagó o sin dividir: ${d.incomplete === 1 ? 'arréglalo' : 'arréglalos'} en la app.`;
}

/** Las respuestas, en el idioma de la cuenta */
export const RESPUESTA = {
  /** «cuánto llevamos» */
  total: (d: Numeros, idioma: Idioma) => {
    const en = idioma === 'en';
    const plata = (n: number) => formatCOP(n, d.account.currency, idioma);
    if (!d.count) {
      return en ? `🧾 No expenses in “${d.account.name}”${periodo(d, idioma)} yet.` : `🧾 En «${d.account.name}» todavía no hay gastos${periodo(d, idioma)}.`;
    }
    const revisar = d.pending
      ? en
        ? `\n👀 ${d.pending === 1 ? 'One needs' : `${d.pending} need`} review in the app.`
        : `\n👀 ${d.pending === 1 ? 'Uno queda' : `${d.pending} quedan`} por revisar en la app.`
      : '';
    return en
      ? `🧾 “${d.account.name}” is at *${plata(d.total)}*${periodo(d, idioma)} across ${cuantos(d.count, 'expense', 'expenses')}.${revisar}\n\n${FIRMA.en}`
      : `🧾 En «${d.account.name}» llevan *${plata(d.total)}*${periodo(d, idioma)} en ${cuantos(d.count, 'gasto', 'gastos')}.${revisar}\n\n${FIRMA.es}`;
  },

  /** «quién le debe a quién» */
  deudas: (d: Numeros, idioma: Idioma) => {
    const en = idioma === 'en';
    const plata = (n: number) => formatCOP(n, d.account.currency, idioma);
    const { liquidado, lista } = deudasDe(d);
    if (!lista.length) {
      return en
        ? `🙌 Everyone in “${d.account.name}” is all square${periodo(d, idioma)}.${incompletos(d, idioma)}`
        : `🙌 En «${d.account.name}» todos están a paz y salvo${periodo(d, idioma)}.${incompletos(d, idioma)}`;
    }
    const lineas = lista.map((t) =>
      liquidado
        ? `• ${t.de} → ${t.a}: *${plata(t.monto)}*${t.pagada ? ' ✅' : ''}`
        : en
          ? `• ${t.de} pays ${t.a} *${plata(t.monto)}*`
          : `• ${t.de} le paga a ${t.a} *${plata(t.monto)}*`,
    );
    const titulo = liquidado
      ? en
        ? `💸 This is how “${d.account.name}” was settled${periodo(d, idioma)}:`
        : `💸 Así quedó la liquidación de «${d.account.name}»${periodo(d, idioma)}:`
      : en
        ? `💸 This is how “${d.account.name}” stands${periodo(d, idioma)} (if you settled today):`
        : `💸 Así van las cuentas de «${d.account.name}»${periodo(d, idioma)} (si liquidaran hoy):`;
    return `${titulo}\n${lineas.join('\n')}${incompletos(d, idioma)}\n\n${FIRMA[idioma]}`;
  },

  /** «cuánto debo», «cuánto me deben» */
  miSaldo: (d: Numeros, me: QuestionMe, idioma: Idioma) => {
    const en = idioma === 'en';
    const plata = (n: number) => formatCOP(n, d.account.currency, idioma);
    const nombre = primerNombre(me.name);
    const p = d.people.find((x) => x.id === me.id) ?? { paid: 0, share: 0, balance: 0 };
    const saldo = Number(p.balance);
    const { liquidado, lista } = deudasDe(d);
    // Lo que le falta pagar o cobrar (de la liquidación, si ya la hicieron)
    const pendientes = lista.filter((t) => (t.deId === me.id || t.aId === me.id) && !t.pagada);
    if (liquidado && !pendientes.length) {
      return en
        ? `🙌 ${nombre}, “${d.account.name}” was already settled${periodo(d, idioma)} and you have nothing pending.`
        : `🙌 ${nombre}, «${d.account.name}» ya se liquidó${periodo(d, idioma)} y no te queda nada pendiente.`;
    }
    const detalle = pendientes.map((t) =>
      t.deId === me.id
        ? en
          ? `• You pay ${t.a} *${plata(t.monto)}*`
          : `• Le pagas a ${t.a} *${plata(t.monto)}*`
        : en
          ? `• ${t.de} pays you *${plata(t.monto)}*`
          : `• ${t.de} te paga *${plata(t.monto)}*`,
    );
    const puso = en
      ? `you put in *${plata(Number(p.paid))}* and your share is *${plata(Number(p.share))}*`
      : `pusiste *${plata(Number(p.paid))}* y te tocan *${plata(Number(p.share))}*`;
    const cabeza =
      saldo < 0
        ? en
          ? `💸 ${nombre}, in “${d.account.name}”${periodo(d, idioma)} ${puso}: you owe *${plata(-saldo)}*.`
          : `💸 ${nombre}, en «${d.account.name}»${periodo(d, idioma)} ${puso}: debes *${plata(-saldo)}*.`
        : saldo > 0
          ? en
            ? `🙌 ${nombre}, in “${d.account.name}”${periodo(d, idioma)} ${puso}: you’re owed *${plata(saldo)}*.`
            : `🙌 ${nombre}, en «${d.account.name}»${periodo(d, idioma)} ${puso}: te deben *${plata(saldo)}*.`
          : en
            ? `🙌 ${nombre}, you’re all square in “${d.account.name}”${periodo(d, idioma)}.`
            : `🙌 ${nombre}, en «${d.account.name}»${periodo(d, idioma)} estás a paz y salvo.`;
    return `${cabeza}${detalle.length ? `\n${detalle.join('\n')}` : ''}${incompletos(d, idioma)}\n\n${FIRMA[idioma]}`;
  },

  /** «mis gastos» */
  misGastos: (d: Numeros, me: QuestionMe, idioma: Idioma) => {
    const en = idioma === 'en';
    const plata = (n: number) => formatCOP(n, d.account.currency, idioma);
    const nombre = primerNombre(me.name);
    if (!me.paid_count) {
      return en
        ? `🧾 ${nombre}, you haven’t paid any expenses in “${d.account.name}”${periodo(d, idioma)}.`
        : `🧾 ${nombre}, en «${d.account.name}» no has pagado gastos${periodo(d, idioma)}.`;
    }
    const lineas = me.expenses.map((e) => `• ${e.merchant} · ${plata(Number(e.total))} (${dia(e.date, idioma)})`);
    const mas =
      me.paid_count > me.expenses.length ? (en ? `\n…and ${me.paid_count - me.expenses.length} more.` : `\n…y ${me.paid_count - me.expenses.length} más.`) : '';
    return en
      ? `🧾 ${nombre}, in “${d.account.name}” you paid *${plata(Number(me.paid_total))}*${periodo(d, idioma)} across ${cuantos(me.paid_count, 'expense', 'expenses')}:\n${lineas.join('\n')}${mas}\n\n${FIRMA.en}`
      : `🧾 ${nombre}, en «${d.account.name}» pagaste *${plata(Number(me.paid_total))}*${periodo(d, idioma)} en ${cuantos(me.paid_count, 'gasto', 'gastos')}:\n${lineas.join('\n')}${mas}\n\n${FIRMA.es}`;
  },
};

/** Lo demás que dice cuando le preguntan */
export const PREGUNTAS = {
  canal: (idioma: Idioma, nombre: string) =>
    idioma === 'en'
      ? `🤫 ${nombre}, should I send it to you privately or here? Reply *private* or *here*.`
      : `🤫 ${nombre}, ¿te lo mando por privado o aquí? Responde *privado* o *aquí*.`,
  canalListo: (idioma: Idioma, nombre: string, modo: 'privado' | 'aqui') =>
    idioma === 'en'
      ? modo === 'privado'
        ? `👍 Got it, ${nombre}: I’ll send your stuff privately. To change it: “luks tell me here”.`
        : `👍 Got it, ${nombre}: I’ll tell you here. To change it: “luks send me private”.`
      : modo === 'privado'
        ? `👍 Listo, ${nombre}: lo tuyo te lo mando por privado. Para cambiarlo: «luks dímelo aquí».`
        : `👍 Listo, ${nombre}: lo tuyo te lo digo aquí. Para cambiarlo: «luks mándame al privado».`,
  porPrivado: (idioma: Idioma, nombre: string) => (idioma === 'en' ? `📩 ${nombre}, I sent it to you privately.` : `📩 ${nombre}, te lo mandé por privado.`),
  noMeCuentes: (idioma: Idioma, nombre: string, cuenta: string) =>
    idioma === 'en'
      ? `👍 Got it, ${nombre}: from now on I won’t log what you send in “${cuenta}”. What’s already there stays the same. If you change your mind, type “luks count me again”.`
      : `👍 Listo, ${nombre}: desde ahora no anoto lo que mandes en «${cuenta}». Lo de antes queda igual. Si cambias de opinión, escribe «luks cuéntame».`,
  cuentame: (idioma: Idioma, nombre: string, cuenta: string) =>
    idioma === 'en'
      ? `👍 Got it, ${nombre}: I’m logging what you send in “${cuenta}” again.`
      : `👍 Listo, ${nombre}: vuelvo a anotar lo que mandes en «${cuenta}».`,
  noEntendi: (idioma: Idioma) =>
    idioma === 'en'
      ? '🤔 I didn’t get that. Ask me “how much so far”, “who owes whom”, “how much do I owe” or “my expenses”.'
      : '🤔 No te entendí. Pregúntame «cuánto llevamos», «quién le debe a quién», «cuánto debo» o «mis gastos».',
  sinCuenta: (idioma: Idioma) =>
    idioma === 'en'
      ? '🤔 This group doesn’t have a Luks account yet. Type “help” and I’ll send you how to create it.'
      : '🤔 Este grupo todavía no tiene cuenta en Luks. Escriban «ayuda» y les mando cómo crearla.',
  noTeConozco: (idioma: Idioma, cuenta: string) =>
    idioma === 'en'
      ? `🤔 I don’t know who you are in “${cuenta}”. Type “luks soy yo” so I can recognize you.`
      : `🤔 No sé quién eres en «${cuenta}». Escribe «luks soy yo» para que te reconozca.`,
};
