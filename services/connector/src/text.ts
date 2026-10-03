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

/** $84.300 */
export function formatCOP(n: number): string {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? '-' : ''}$${String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dia = (iso: string) => `${Number(iso.slice(8, 10))} ${MESES[Number(iso.slice(5, 7)) - 1]}`;

/** Lo que el connector le cuenta al grupo después de que el worker procesó un mensaje */
export interface PendingReply {
  message_id: string;
  group_jid: string;
  wa_message_id: string;
  sender_wa_id: string | null;
  status: 'done' | 'duplicate';
  received_at: string;
  expense: { merchant: string; total_cop: number; status: 'confirmed' | 'pending_review'; payer: string | null; split_count: number } | null;
  duplicate_of: { merchant: string; total_cop: number; expense_date: string } | null;
}

function linea(r: PendingReply): string {
  if (r.status === 'duplicate') {
    return r.duplicate_of
      ? `Ya estaba anotado: ${r.duplicate_of.merchant} · ${formatCOP(r.duplicate_of.total_cop)} (${dia(r.duplicate_of.expense_date)})`
      : 'Ese recibo ya estaba anotado';
  }
  const e = r.expense;
  if (!e) return 'Recibido';
  const partes = [e.merchant, formatCOP(e.total_cop)];
  if (e.payer) partes.push(`pagó ${e.payer}`);
  if (e.split_count > 1) partes.push(`entre ${e.split_count}`);
  return partes.join(' · ');
}

/** Un solo mensaje para varios gastos seguidos (así Luks no llena el grupo) */
export function formatReplies(items: PendingReply[]): string {
  if (items.length === 1) {
    const r = items[0];
    if (r.status === 'duplicate') return `${linea(r)}.`;
    if (r.expense?.status === 'confirmed') return `Anotado: ${linea(r)}.`;
    return `Recibido: ${linea(r)}. Queda por revisar en Luks.`;
  }
  const porRevisar = items.filter((r) => r.status === 'done' && r.expense?.status !== 'confirmed').length;
  const lineas = items.map((r) => `• ${linea(r)}`);
  const cola = porRevisar ? `\n${porRevisar === 1 ? 'Uno queda' : `${porRevisar} quedan`} por revisar en Luks.` : '';
  return `Anotados ${items.length}:\n${lineas.join('\n')}${cola}`;
}

export const MSG = {
  hello:
    'Hola, soy Luks. Para anotar los gastos de este grupo, quien administra la cuenta escribe aquí «luks» y el código de la cuenta (está en la app, en Conectar WhatsApp). Solo leo fotos de recibos, PDFs y mensajes con montos.',
  linked: (account: string, members?: number) =>
    `Listo: este grupo quedó conectado a «${account}»${members ? ` y sus ${members} integrantes ya están en la cuenta` : ''}. Manden fotos de recibos, PDFs o mensajes con el monto (por ejemplo «taxi al aeropuerto 45 lucas») y yo los anoto.`,
  alreadyLinked: (account: string) => `Este grupo ya está conectado a «${account}».`,
  badCode: 'Ese código no sirve: puede que esté mal escrito o que ya venció. Búsquenlo en la app, en Conectar WhatsApp.',
  otherAccount: 'Este grupo ya está conectado a otra cuenta de Luks. Para cambiarlo, desconéctenlo primero desde la app.',
} as const;
