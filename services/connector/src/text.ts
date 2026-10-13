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
const RESPUESTA_LUKS = /^\s*\W{0,4}\s*(?:anotad[oa]s?|recibido|ya estaba anotado|logged|received|already logged)[\s:].*·\s*(?:\$|bs\s?)\d/is;
// Los saludos de Mister Luks y el «Listo: este grupo quedó conectado…» traen montos de ejemplo
const SALUDO_LUKS = /(?:soy|i[’']m) \*?mister luks|(?:listo[:!]?|done[:!]?)\s*(?:este grupo quedó conectado|this group is now connected)/i;

export function esMensajeDeLuks(text: string | null | undefined): boolean {
  if (!text) return false;
  return FIRMA_LUKS.test(text) || RESPUESTA_LUKS.test(text) || SALUDO_LUKS.test(text);
}

/** El link de invitación de un grupo (chat.whatsapp.com/…) → su código */
export function parseInviteLink(text: string | null | undefined): string | null {
  const m = text?.match(/(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{18,26})(?![A-Za-z0-9])/i);
  return m ? m[1] : null;
}

/** «ayuda», «instrucciones», «help» (solos, o con «luks» o una mención antes) */
export function esPedidoDeAyuda(text: string | null | undefined): boolean {
  return /^\s*(?:@\S+\s+)*(?:(?:mr\.?\s*|mister\s+)?luks[\s,:]+)?(?:ayuda|instrucciones|la gu[ií]a|gu[ií]a|help|instructions|guide)\s*[?!.¡¿]*\s*$/i.test(
    text ?? '',
  );
}

/** «luks soy yo» (o «mister luks soy yo», «luks it's me»): quiere asociar su número a su cuenta de Luks */
export function esSoyYo(text: string | null | undefined): boolean {
  return /^\s*(?:@\S+\s+)*(?:(?:mr\.?\s*|mister\s+)?luks[\s,:]+)?(?:soy\s+yo|it[’']?s\s+me|this\s+is\s+me)\s*[.!¡]*\s*$/i.test(text ?? '');
}

/** El idioma de alguien por su número: +1 (Estados Unidos, Canadá) en inglés; el resto, español */
export const idiomaDeNumero = (phone: string | null | undefined): Idioma => (phone?.startsWith('1') ? 'en' : 'es');

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
    if (r.status === 'duplicate') return `🔁 ${linea(r)}.`;
    if (r.expense?.status === 'confirmed') return `✅ ${en ? 'Logged' : 'Anotado'}: ${linea(r)}.`;
    return en ? `🧾 Received: ${linea(r)}. Needs review in Luks 👀` : `🧾 Recibido: ${linea(r)}. Queda por revisar en Luks 👀`;
  }
  const porRevisar = items.filter((r) => r.status === 'done' && r.expense?.status !== 'confirmed').length;
  const lineas = items.map((r) => `• ${linea(r)}`);
  if (en) {
    const cola = porRevisar ? `\n👀 ${porRevisar === 1 ? 'One needs' : `${porRevisar} need`} review in Luks.` : '';
    return `✅ Logged ${items.length}:\n${lineas.join('\n')}${cola}`;
  }
  const cola = porRevisar ? `\n👀 ${porRevisar === 1 ? 'Uno queda' : `${porRevisar} quedan`} por revisar en Luks.` : '';
  return `✅ Anotados ${items.length}:\n${lineas.join('\n')}${cola}`;
}

// Antes de enlazar el grupo no se sabe el idioma de la cuenta: español y, debajo, inglés
export const MSG = {
  linked: (account: string, members?: number, idioma: Idioma = 'es') =>
    idioma === 'en'
      ? `🎉 Done! This group is now connected to “${account}”${members ? ` and its ${members} members are already in the account 🙌` : ''}.\n\nSend receipt photos, PDFs or messages with the amount (for example “airport taxi $45”) and I’ll log them ✅`
      : `🎉 ¡Listo! Este grupo quedó conectado a «${account}»${members ? ` y sus ${members} integrantes ya están en la cuenta 🙌` : ''}.\n\nManden fotos de recibos, PDFs o mensajes con el monto (por ejemplo «taxi al aeropuerto 45 lucas») y yo los anoto ✅`,
  alreadyLinked: (account: string, idioma: Idioma = 'es') =>
    idioma === 'en' ? `😉 This group is already connected to “${account}”.` : `😉 Este grupo ya está conectado a «${account}».`,
  badCode:
    '🤔 Ese código no me sirve: puede que esté mal escrito o que ya venció. Búsquenlo en la app, en Conectar WhatsApp.\n\n' +
    '🤔 That code doesn’t work: it may be mistyped or expired. Find it in the app, under Connect WhatsApp.',
  otherAccount:
    '🙈 Este grupo ya está conectado a otra cuenta de Luks. Para cambiarlo, desconéctenlo primero desde la app.\n\n' +
    '🙈 This group is already connected to another Luks account. To change it, disconnect it from the app first.',
} as const;

/** En el mensaje de verificación, el lugar del link /v/CÓDIGO: el código se crea al mandarlo (nunca se guarda) */
export const LINK_VERIFICACION = '{link}';

/**
 * En el saludo y la guía de un grupo sin cuenta, el lugar del link /g/CÓDIGO
 * para crearla: también se crea al mandarlo. Si el grupo ya tiene cuenta,
 * la línea entera se quita (sinLineaDelLink).
 */
export const LINK_GRUPO = '{grupo}';

/** El mensaje sin las líneas que llevan el link /g/ (el grupo ya tiene cuenta) */
export const sinLineaDelLink = (body: string) =>
  body
    .split('\n')
    .filter((l) => !l.includes(LINK_GRUPO))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** La guía de mrluks.com/guia: la imagen vertical y el PDF, en el idioma de quien la recibe */
export const guia = (base: string, idioma: Idioma) => ({
  imagen: `${base}/luks-guia-${idioma}.png`,
  pdf: `${base}/luks-guia-${idioma}.pdf`,
  nombrePdf: idioma === 'en' ? 'Mister Luks guide.pdf' : 'Guía de Mister Luks.pdf',
});

/** «Vale», «Vale y Santi», «Vale, Santi y Mafe» (en inglés, con «and») */
export function listaNombres(nombres: string[], idioma: Idioma): string {
  const y = idioma === 'en' ? 'and' : 'y';
  return nombres.length <= 1 ? (nombres[0] ?? '') : `${nombres.slice(0, -1).join(', ')} ${y} ${nombres.at(-1)}`;
}

/** Lo que Mister Luks escribe por su cuenta (va por la bandeja de salida, whatsapp_outbox) */
export const MISTER = {
  bienvenida: (idioma: Idioma) =>
    idioma === 'en'
      ? 'Hi! 👋 I’m *Mister Luks*, the one who keeps the books at Luks 🧾✨\n\nHere’s how I work:\n1️⃣ Add me to your WhatsApp group (or send me the group link right here and I’ll join on my own).\n2️⃣ Send receipt photos, PDFs or messages like “taxi $45”.\n3️⃣ I log them, split them and tell everyone who pays whom 🤝\n\nHere’s the guide 👇 If you need it again, just type “help”.'
      : '¡Hola! 👋 Soy *Mister Luks*, el que lleva las cuentas en Luks 🧾✨\n\nAsí funciono:\n1️⃣ Agrégame a tu grupo de WhatsApp (o mándame aquí el link del grupo y entro solito).\n2️⃣ Manden fotos de recibos, PDFs o mensajes como «taxi 45 lucas».\n3️⃣ Yo los anoto, los divido y les digo quién le paga a quién 🤝\n\nTe dejo la guía 👇 Si la necesitas otra vez, escríbeme «ayuda».',
  guia: (idioma: Idioma) =>
    idioma === 'en'
      ? '📘 Here’s the Mister Luks guide. The full one is at mrluks.com/guia 😉'
      : '📘 Aquí tienes la guía de Mister Luks. La completa está en mrluks.com/guia 😉',
  /** La guía en un grupo: si todavía no tiene cuenta, con el link para crearla (se quita si ya la tiene) */
  guiaGrupo: (idioma: Idioma) =>
    idioma === 'en'
      ? `📘 Here’s the Mister Luks guide. The full one is at mrluks.com/guia 😉\n\nNo account for this group yet? Just one person creates it here 👉 ${LINK_GRUPO}`
      : `📘 Aquí tienes la guía de Mister Luks. La completa está en mrluks.com/guia 😉\n\n¿Todavía no tienen cuenta? Una sola persona la crea aquí 👉 ${LINK_GRUPO}`,
  /**
   * El saludo del grupo, una sola vez. Con cuenta: desde hoy lleva las cuentas
   * aquí. Sin cuenta, el link /g/ para crearla (LINK_GRUPO, se crea al mandarlo)
   * y según quién del grupo ya usa Luks (su número verificado, por su primer
   * nombre): a esa persona la cuenta la espera en la app; si nadie, que quien
   * ya tenga cuenta (con Gmail, por ejemplo) escriba «luks soy yo» y, si no,
   * que una sola persona la cree.
   */
  saludoGrupo: (idioma: Idioma, cuenta: string | null, usuarios: string[] = []) => {
    const en = idioma === 'en';
    const nombres = listaNombres(usuarios, idioma);
    const cierre = en
      ? 'Send receipt photos, PDFs or messages like “taxi $45” and I’ll take care of the rest 😉 The guide is in the image 👇'
      : 'Manden fotos de recibos, PDFs o mensajes como «taxi 45 lucas» y yo me encargo del resto 😉 La guía va en la imagen 👇';
    if (cuenta) {
      const ya = usuarios.length
        ? en
          ? `\n\n${nombres} ${usuarios.length === 1 ? 'is' : 'are'} already in the account 🙌`
          : `\n\nEn la cuenta ya ${usuarios.length === 1 ? 'está' : 'están'} ${nombres} 🙌`
        : '';
      return en
        ? `Hi everyone! 👋 I’m *Mister Luks* and from today I keep the books for “${cuenta}” 🧾✨${ya}\n\n${cierre}`
        : `¡Hola, parche! 👋 Soy *Mister Luks* y desde hoy llevo las cuentas de «${cuenta}» 🧾✨${ya}\n\n${cierre}`;
    }
    const hola = en
      ? 'Hi everyone! 👋 I’m *Mister Luks* and I’m here to keep this group’s books 🧾✨'
      : '¡Hola, parche! 👋 Soy *Mister Luks* y vengo a llevar las cuentas del grupo 🧾✨';
    if (usuarios.length) {
      const quien =
        usuarios.length === 1
          ? en
            ? `I see ${nombres} already uses Luks 🙌 ${nombres}, this group’s account is waiting for you in the app 👉 ${LINK_GRUPO}`
            : `Veo que ${nombres} ya usa Luks 🙌 ${nombres}, la cuenta de este grupo te espera en la app 👉 ${LINK_GRUPO}`
          : en
            ? `I see ${nombres} already use Luks 🙌 One of you, create this group’s account in the app 👉 ${LINK_GRUPO}`
            : `Veo que ${nombres} ya usan Luks 🙌 Alguno de ustedes, cree la cuenta del grupo en la app 👉 ${LINK_GRUPO}`;
      return `${hola}\n\n${quien}\n\n${cierre}`;
    }
    const empezar = en
      ? `I don’t recognize any number in this group on Luks yet:\n• Already have an account (for example, you signed in with Gmail)? Type *luks it’s me* here and I’ll send you a private link to add your number.\n• Nobody? *Just one person* creates the account here and nobody else has to do anything 🙌\n👉 ${LINK_GRUPO}`
      : `Todavía no reconozco ningún número de este grupo en Luks:\n• ¿Ya tienes cuenta (por ejemplo, entraste con Gmail)? Escribe *luks soy yo* aquí y te mando por privado un link para unir tu número.\n• ¿Nadie? *Una sola persona* crea la cuenta aquí y los demás no tienen que hacer nada 🙌\n👉 ${LINK_GRUPO}`;
    return `${hola}\n\n${empezar}\n\n${cierre}`;
  },
  /** «luks soy yo»: en el grupo, si ya lo reconoce o si le mandó el link por privado */
  soyYo: {
    reconocido: (idioma: Idioma, nombre: string | null) =>
      idioma === 'en'
        ? `✅ I know you${nombre ? `, ${nombre}` : ''}: your WhatsApp is already verified in Luks.`
        : `✅ Te reconozco${nombre ? `, ${nombre}` : ''}: tu WhatsApp ya está verificado en Luks.`,
    noEncontrado: (idioma: Idioma, ultimos: string) =>
      idioma === 'en'
        ? `🔎 I can’t find a Luks account with your number (••• ${ultimos}). It may not be linked yet. I sent you a private message with how to fix it 📩`
        : `🔎 No encuentro una cuenta de Luks con tu número (••• ${ultimos}). Puede que no esté asociado. Te mandé por privado cómo arreglarlo 📩`,
    /** Por privado, con el link de un solo uso (LINK_VERIFICACION se cambia por el link al mandarlo) */
    link: (idioma: Idioma, ultimos: string) =>
      idioma === 'en'
        ? `🔐 To link this WhatsApp (••• ${ultimos}) to your Luks account, open this link while signed in:\n${LINK_VERIFICACION}\n\nIt works once and expires in 30 minutes. Don’t have Luks yet? The same link takes you to sign up 😉`
        : `🔐 Para asociar este WhatsApp (••• ${ultimos}) a tu cuenta de Luks, abre este link con tu sesión iniciada:\n${LINK_VERIFICACION}\n\nSirve una sola vez y vence en 30 minutos. ¿Todavía no tienes Luks? El mismo link te lleva a registrarte 😉`,
    yaVerificado: (idioma: Idioma, nombre: string | null) =>
      idioma === 'en'
        ? `✅ This WhatsApp is already verified in your Luks account${nombre ? `, ${nombre}` : ''}. Nothing else to do 🙌`
        : `✅ Este WhatsApp ya está verificado en tu cuenta de Luks${nombre ? `, ${nombre}` : ''}. No hace falta nada más 🙌`,
  },
  /** Respuestas por privado a un link de grupo */
  unirse: {
    joined: (idioma: Idioma, grupo: string) =>
      idioma === 'en'
        ? `🙌 Done! I joined “${grupo}”. I’ll explain how to start over there 😉`
        : `🙌 ¡Listo! Ya entré a «${grupo}». Allá les cuento cómo empezar 😉`,
    pending: (idioma: Idioma, grupo: string) =>
      idioma === 'en'
        ? `⏳ I asked to join “${grupo}”: a group admin has to approve me.`
        : `⏳ Pedí entrar a «${grupo}»: un admin del grupo tiene que aceptarme.`,
    already: (idioma: Idioma, grupo: string) => (idioma === 'en' ? `😉 I’m already in “${grupo}”.` : `😉 Ya estoy en «${grupo}».`),
    invalid: (idioma: Idioma) =>
      idioma === 'en'
        ? '🤔 That link didn’t work for me: it may be expired or copied wrong. Ask a group admin for a new one (Group info → Invite via link).'
        : '🤔 Ese link no me funcionó: puede que esté vencido o mal copiado. Pídele a un admin del grupo uno nuevo (Info del grupo → Invitar con enlace).',
    tope: (idioma: Idioma) =>
      idioma === 'en'
        ? '😅 I can’t join more groups right now. Send me the link again in a while, or add me to the group directly.'
        : '😅 Ahora mismo no puedo entrar a más grupos. Mándame el link otra vez en un rato, o agrégame directo al grupo.',
  },
} as const;
