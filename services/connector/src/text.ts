/* Lo que Luks lee y escribe en los grupos. */

/** «luks PASEO-7K2Q» (como lo escriban; también «lucas …», el nombre de antes) → «PASEO-7K2Q» */
export function parseLinkCommand(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/^\s*(?:@\S+\s+)?(?:luks|lucas)[\s:,.-]+([a-z]{3,8}-[a-z0-9]{4})(?![a-z0-9])/i);
  return m ? m[1].toUpperCase() : null;
}

/*
 * Solo se guardan los mensajes que parecen gastos; la conversación normal del
 * grupo no sale de WhatsApp. Un mensaje parece gasto si trae un monto:
 * «taxi 45 lucas», «almuerzo 25.000», «$80.000 el hotel», «pagué 120000»,
 * «2 palos el arriendo», «15k la cerveza».
 */
const MONTO = [
  /\$\s*\d/,
  /\d[\d.,]*\s*(?:lucas?|luquitas?|mil|k|palos?|millones?|mill[oó]n|barras?|pesos|cop)(?![a-z])/i,
  /(?<![\d.,])\d{1,3}(?:[.,]\d{3})+(?![\d])/,
  /(?<![\d+])\d{4,9}(?!\d)/,
];

/** Solo un teléfono («300 123 4567», «+57 3001234567»): no es un gasto */
const SOLO_TELEFONO = /^\s*\+?\d[\d\s-]{8,}\d\s*$/;

export function looksLikeExpense(text: string | null | undefined): boolean {
  if (!text?.trim() || text.length > 2000) return false;
  if (SOLO_TELEFONO.test(text)) return false;
  return MONTO.some((re) => re.test(text));
}

/*
 * Lo que hace Luks no es un gasto: las cuentas y los cobros que se mandan
 * desde Liquidar (firmados «Esto se hizo en mrluks.com», con el link /r/TOKEN)
 * y las respuestas de Luks («Anotado: Hielo · $8.000»), que en un grupo leído
 * también por el WhatsApp de alguien llegan como un mensaje más. La base revisa
 * lo mismo (public.es_mensaje_de_luks, migración 180).
 */
const FIRMA_LUKS =
  /esto se hizo en mrluks\.com|made with mrluks\.com|cuentas hechas con luks|hecho con luks|(?:mrluks\.com|\.vercel\.app)\/r\/[A-Za-z0-9_-]{20,64}/i;
const RESPUESTA_LUKS = /^\s*(?:anotad[oa]s?|recibido|ya estaba anotado|logged|received|already logged)[\s:].*·\s*(?:\$|bs\s?)\d/is;

export function esMensajeDeLuks(text: string | null | undefined): boolean {
  if (!text) return false;
  return FIRMA_LUKS.test(text) || RESPUESTA_LUKS.test(text);
}

/** La moneda de la cuenta (como apps/web/lib/moneda.ts) y el idioma en que Luks responde */
export type Moneda = 'COP' | 'CLP' | 'BOB' | 'USD';
export type Idioma = 'es' | 'en';
const DECIMALES: Record<Moneda, number> = { COP: 0, CLP: 0, BOB: 2, USD: 2 };
const SIMBOLO: Record<Moneda, string> = { COP: '$', CLP: '$', BOB: 'Bs ', USD: '$' };

/**
 * $84.300 en pesos; en dólares y bolivianos el monto llega en centavos
 * (1250 → $12,50). En inglés, con coma de miles y punto decimal ($84,300 · $12.50).
 */
export function formatCOP(n: number, moneda: Moneda = 'COP', idioma: Idioma = 'es'): string {
  const v = Math.round(Number(n) || 0);
  const d = DECIMALES[moneda] ?? 0;
  const base = 10 ** d;
  const abs = Math.abs(v);
  const entero = String(Math.floor(abs / base)).replace(/\B(?=(\d{3})+(?!\d))/g, idioma === 'en' ? ',' : '.');
  const resto = d ? (idioma === 'en' ? '.' : ',') + String(abs % base).padStart(d, '0') : '';
  return `${v < 0 ? '-' : ''}${SIMBOLO[moneda] ?? '$'}${entero}${resto}`;
}

const MESES: Record<Idioma, string[]> = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const dia = (iso: string, idioma: Idioma) => {
  const d = Number(iso.slice(8, 10));
  const m = MESES[idioma][Number(iso.slice(5, 7)) - 1];
  return idioma === 'en' ? `${m} ${d}` : `${d} ${m}`;
};

/** Lo que el connector le cuenta al grupo después de que el worker procesó un mensaje */
export interface PendingReply {
  message_id: string;
  group_jid: string;
  wa_message_id: string;
  sender_wa_id: string | null;
  status: 'done' | 'duplicate';
  received_at: string;
  /** De la cuenta (migración 250); si no llegan, pesos colombianos y español */
  currency?: Moneda | null;
  language?: Idioma | null;
  expense: { merchant: string; total_cop: number; status: 'confirmed' | 'pending_review'; payer: string | null; split_count: number } | null;
  duplicate_of: { merchant: string; total_cop: number; expense_date: string } | null;
}

const idiomaDe = (r: PendingReply): Idioma => (r.language === 'en' ? 'en' : 'es');
const monedaDe = (r: PendingReply): Moneda => (r.currency && r.currency in DECIMALES ? r.currency : 'COP');

function linea(r: PendingReply): string {
  const en = idiomaDe(r) === 'en';
  const plata = (n: number) => formatCOP(n, monedaDe(r), idiomaDe(r));
  if (r.status === 'duplicate') {
    if (!r.duplicate_of) return en ? 'That receipt was already logged' : 'Ese recibo ya estaba anotado';
    const d = r.duplicate_of;
    return `${en ? 'Already logged' : 'Ya estaba anotado'}: ${d.merchant} · ${plata(d.total_cop)} (${dia(d.expense_date, idiomaDe(r))})`;
  }
  const e = r.expense;
  if (!e) return en ? 'Received' : 'Recibido';
  const partes = [e.merchant, plata(e.total_cop)];
  if (e.payer) partes.push(en ? `paid by ${e.payer}` : `pagó ${e.payer}`);
  if (e.split_count > 1) partes.push(en ? `split ${e.split_count} ways` : `entre ${e.split_count}`);
  return partes.join(' · ');
}

/** Un solo mensaje para varios gastos seguidos (así Luks no llena el grupo), en el idioma de la cuenta */
export function formatReplies(items: PendingReply[]): string {
  const en = items[0] ? idiomaDe(items[0]) === 'en' : false;
  if (items.length === 1) {
    const r = items[0];
    if (r.status === 'duplicate') return `${linea(r)}.`;
    if (r.expense?.status === 'confirmed') return `${en ? 'Logged' : 'Anotado'}: ${linea(r)}.`;
    return en ? `Received: ${linea(r)}. Needs review in Luks.` : `Recibido: ${linea(r)}. Queda por revisar en Luks.`;
  }
  const porRevisar = items.filter((r) => r.status === 'done' && r.expense?.status !== 'confirmed').length;
  const lineas = items.map((r) => `• ${linea(r)}`);
  if (en) {
    const cola = porRevisar ? `\n${porRevisar === 1 ? 'One needs' : `${porRevisar} need`} review in Luks.` : '';
    return `Logged ${items.length}:\n${lineas.join('\n')}${cola}`;
  }
  const cola = porRevisar ? `\n${porRevisar === 1 ? 'Uno queda' : `${porRevisar} quedan`} por revisar en Luks.` : '';
  return `Anotados ${items.length}:\n${lineas.join('\n')}${cola}`;
}

// Antes de enlazar el grupo no se sabe el idioma de la cuenta: español y, debajo, inglés
export const MSG = {
  hello:
    'Hola, soy Luks. Para anotar los gastos de este grupo, quien administra la cuenta escribe aquí «luks» y el código de la cuenta (está en la app, en Conectar WhatsApp). Solo leo fotos de recibos, PDFs y mensajes con montos.\n\n' +
    'Hi, I’m Luks. To log this group’s expenses, the account admin types “luks” and the account code here (it’s in the app, under Connect WhatsApp). I only read receipt photos, PDFs and messages with amounts.',
  linked: (account: string, members?: number, idioma: Idioma = 'es') =>
    idioma === 'en'
      ? `Done: this group is now connected to “${account}”${members ? ` and its ${members} members are in the account` : ''}. Send receipt photos, PDFs or messages with the amount (for example “airport taxi 45”) and I’ll log them.`
      : `Listo: este grupo quedó conectado a «${account}»${members ? ` y sus ${members} integrantes ya están en la cuenta` : ''}. Manden fotos de recibos, PDFs o mensajes con el monto (por ejemplo «taxi al aeropuerto 45 lucas») y yo los anoto.`,
  alreadyLinked: (account: string, idioma: Idioma = 'es') =>
    idioma === 'en' ? `This group is already connected to “${account}”.` : `Este grupo ya está conectado a «${account}».`,
  badCode:
    'Ese código no sirve: puede que esté mal escrito o que ya venció. Búsquenlo en la app, en Conectar WhatsApp.\n\n' +
    'That code doesn’t work: it may be mistyped or expired. Find it in the app, under Connect WhatsApp.',
  otherAccount:
    'Este grupo ya está conectado a otra cuenta de Luks. Para cambiarlo, desconéctenlo primero desde la app.\n\n' +
    'This group is already connected to another Luks account. To change it, disconnect it from the app first.',
} as const;
