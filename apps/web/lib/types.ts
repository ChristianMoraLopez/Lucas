import { TONES, type Tone, toneFor } from '@/components/lucas-core';
import type { Idioma } from '@/lib/i18n';
import type { Moneda } from '@/lib/moneda';
import { formatear, normalizar } from '@/lib/telefono';

/* Contratos de lo que devuelve Supabase (tablas y RPC de supabase/migrations).
   Se escriben a mano mientras no haya tipos generados con `supabase gen types`. */

export type Role = 'owner' | 'admin' | 'member';
export type AccountType = 'hogar' | 'evento';
/** Un evento liquidado (settling) espera los pagos; si le llega un gasto nuevo, se reabre (active) */
export type AccountStatus = 'active' | 'settling' | 'closed';

export const ROLE_LABEL: Record<Role, string> = { owner: 'Titular', admin: 'Admin', member: 'Miembro' };

export const ROLE_HELP: [Role, string][] = [
  ['owner', 'Todo, incluso borrar la cuenta'],
  ['admin', 'Edita gastos y personas, invita, cierra el evento'],
  ['member', 'Manda gastos y propone correcciones'],
];

/** public.account_overview() */
export interface AccountOverview {
  id: string;
  name: string;
  type: AccountType;
  status: AccountStatus;
  role: Role;
  starts_on: string | null;
  ends_on: string | null;
  closed_at: string | null;
  people_count: number;
  total_cop: number;
  pending_count: number;
  budget_cop: number | null;
  people: { name: string; tone: string; registered: boolean }[];
}

/** public.account_people(p_account_id) */
export interface PersonRow {
  person_id: string | null;
  display_name: string;
  tone: string;
  user_id: string | null;
  role: Role | null;
  joined_at: string | null;
  is_me: boolean;
  paid_count: number;
  corrections_count: number;
  wa_last4: string | null;
  /** De dónde salió el nombre (people.name_source): «WhatsApp 4567», el de WhatsApp, un alias o el que eligió */
  name_source?: NameSource | null;
}

export type NameSource = 'auto' | 'whatsapp' | 'manual' | 'user';

/** public.invitations */
export interface Invitation {
  id: string;
  code: string;
  role: Exclude<Role, 'owner'>;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  revoked_at: string | null;
  created_at: string;
}

/** public.preview_invitation(p_code) */
export interface InvitationPreview {
  account_id: string;
  account_name: string;
  account_type: AccountType;
  starts_on: string | null;
  ends_on: string | null;
  owner_name: string;
  role: Exclude<Role, 'owner'>;
  already_member: boolean;
  people_count: number;
  unclaimed_people: {
    id: string;
    display_name: string;
    tone: string;
    wa_last4: string | null;
    paid_count: number;
    /** Tiene WhatsApp: para entrar como esa persona hay que verificar ese número (o que un admin lo agregue) */
    needs_verification?: boolean;
  }[];
}

/** public.preview_whatsapp_verification(p_token): el link /v/CÓDIGO; del número, solo los últimos 4 */
export interface VerificacionWhatsapp {
  status: 'ok' | 'used' | 'expired' | 'invalid';
  last4?: string;
  /** Ya está verificado para quien abre el link */
  mine?: boolean;
  /** Está verificado para otro usuario (al confirmarlo pasa a quien abre el link) */
  other?: boolean;
}

/** public.preview_group(p_token, p_group_id) (migración 330): un grupo de WhatsApp para crearle la cuenta */
export interface GrupoVista {
  status: 'ok' | 'used' | 'expired' | 'invalid';
  /** Cómo llegó: con el link /g/ de Mister Luks, porque su número verificado está en el grupo o desde su WhatsApp vinculado */
  via?: 'link' | 'detectado' | 'mi_whatsapp';
  group_id?: string;
  name?: string | null;
  /** Mister Luks está en el grupo (escribe ahí) */
  mister_luks?: boolean;
  member_count?: number;
  /** Nombre de WhatsApp y últimos 4 números; me: es un número mío verificado; user: ya usa Luks */
  members?: { name: string; last4: string; me: boolean; user: boolean }[];
  /** Uno de mis números verificados (o mi WhatsApp vinculado) está en el grupo */
  in_group?: boolean;
  /** Ya tiene cuenta: cuál y si estoy en ella (si no estoy, sin su id) */
  linked?: { account_id: string | null; account_name: string; member: boolean } | null;
  /** La cuenta que tenía el grupo y ya se liquidó: no lo ocupa, se crea la siguiente (migración 370) */
  previous?: string | null;
  /** Las cuentas que administro, para conectarle el grupo */
  accounts?: { id: string; name: string; type: AccountType }[];
}

/** public.my_detected_groups(): grupos de Mister Luks sin cuenta donde está mi número verificado */
export interface GrupoDetectado {
  group_id: string;
  name: string | null;
  member_count: number;
  /** Primeros nombres de algunos del grupo (sin el mío) */
  names: string[];
}

/** public.my_whatsapp_groups(): los grupos de mi WhatsApp vinculado (solo el nombre) */
export interface GrupoMio {
  group_id: string;
  name: string | null;
  /** Conectado a una cuenta mía */
  account_id: string | null;
  account_name: string | null;
  /** Conectado a una cuenta en la que no estoy */
  linked_elsewhere: boolean;
  mister_luks: boolean;
}

/** public.account_history(p_account_id) (migración 340): desde cuándo anota cada grupo y sus chats importados */
export interface HistoriaCuenta {
  is_admin: boolean;
  groups: {
    group_id: string;
    name: string | null;
    /** 'pendiente': se preguntó y nadie ha respondido (anota desde que se conectó) */
    history: 'pendiente' | 'desde_ya' | 'todo';
    history_by: string | null;
    history_at: string | null;
    ingest_from: string;
    mister_luks: boolean;
  }[];
  imports: ImportacionChat[];
}

export interface ImportacionChat {
  id: string;
  group_name: string | null;
  source: 'web' | 'whatsapp';
  file_name: string | null;
  requested_name: string | null;
  status: 'queued' | 'processing' | 'done' | 'failed' | 'undone';
  stats: { inserted?: number; messages?: number; before?: number; photos?: number; pdfs?: number; truncated?: number };
  error: string | null;
  before: string;
  created_at: string;
  finished_at: string | null;
  undone_at: string | null;
  /** Los mensajes que trajo y los gastos que ya salieron de ellos */
  messages: number;
  expenses: number;
}

/** public.account_dashboard(p_account_id, p_month) */
export interface Dashboard {
  account: { id: string; name: string; type: AccountType; status: AccountStatus; starts_on: string | null; ends_on: string | null };
  today: string;
  month: string;
  total: number;
  expense_count: number;
  pending_count: number;
  all_equal: boolean;
  budget: number | null;
  prev_total: number | null;
  categories: { id: string; name: string; letter: string; tone: string; total: number; budget: number | null }[];
  trend: { month: string; total: number }[] | null;
  people: { id: string; name: string; tone: string; registered: boolean; paid: number; share: number; balance: number }[];
  recent: {
    id: string;
    merchant: string;
    expense_date: string;
    created_at: string;
    total_cop: number;
    status: 'pending_review' | 'confirmed';
    source: 'whatsapp' | 'web' | 'import';
    kind: 'photo' | 'pdf' | 'text' | null;
    category: string | null;
    payer: string | null;
    payer_tone: string | null;
    payer_registered: boolean | null;
  }[];
}

/** public.settlement_overview(p_account_id, p_month) */
export interface SettlementPerson {
  id: string;
  name: string;
  tone: string;
  registered: boolean;
  /** Lo que pagó, lo que le tocaba (su parte de cada gasto) y la diferencia: + le deben, − debe */
  paid: number;
  share: number;
  balance: number;
  /** Cuántos gastos pagó */
  expenses: number;
  /** Lo que ya le pagó a otros y lo que ya le pagaron, de liquidaciones que se reabrieron (ya está en balance) */
  sent?: number;
  received?: number;
}

/** Un pago ya hecho de una liquidación que se reabrió (cuenta en los saldos) */
export interface SettlementPayment {
  id: string;
  from: string;
  to: string;
  amount: number;
  paid_at: string;
}

export interface SettlementExpense {
  id: string;
  merchant: string;
  expense_date: string;
  total_cop: number;
  status: 'pending_review' | 'confirmed';
  payer_person_id: string | null;
  category: string | null;
  category_letter: string | null;
  category_tone: string | null;
  shares: { person_id: string; amount_cop: number }[];
  /** Migración 400: cómo se dividió, la propina aparte y, si fue por consumo, qué pidió cada uno */
  split_method?: 'equal' | 'percent' | 'exact' | 'items';
  tip_cop?: number;
  items?: SettlementItem[] | null;
}

/** Un ítem de un gasto dividido por consumo (sin nadie = entre todos los del gasto) */
export interface SettlementItem {
  name: string;
  quantity: number;
  total: number;
  extra: boolean;
  people: { id: string; units: number }[];
}

export interface SettlementTransfer {
  id: string;
  from: string;
  to: string;
  amount: number;
  paid_at: string | null;
  /** Quién la marcó como pagada */
  paid_by: string | null;
}

export interface SettlementOverview {
  account: { id: string; name: string; type: AccountType; status: AccountStatus; starts_on: string | null; ends_on: string | null };
  is_admin: boolean;
  my_person_id: string | null;
  today: string;
  /** Mes liquidado (día 1) en un hogar; null en un evento (se liquida completo) */
  month: string | null;
  pending_count: number;
  /** Gastos sin quién pagó o con la división incompleta: no cuentan hasta corregirlos */
  incomplete_count: number;
  people: SettlementPerson[];
  expenses: SettlementExpense[];
  settlement: null | { id: string; created_at: string; created_by: string | null; transfers: SettlementTransfer[] };
  /** Lo que ya se pagó de liquidaciones que se reabrieron (migración 390) */
  payments?: SettlementPayment[];
  /** Migración 400: si al liquidar cada quien le paga a quien pagó por él (si no, se cruzan las deudas) */
  direct?: boolean;
  /** Las transferencias directas, por pareja, como si se liquidara hoy */
  direct_transfers?: { from: string; to: string; amount: number }[];
  settled_months: string[] | null;
}

/** public.shared_overview(token): lo que ve quien abre el link público (lo de Liquidar, sin datos de quien mira) */
export type SharedOverview = Omit<SettlementOverview, 'is_admin' | 'my_person_id'> & {
  /** La moneda y el idioma de la cuenta (migración 250; antes, pesos y español) */
  currency?: Moneda;
  language?: Idioma;
};

/** public.my_profile() */
export interface MyProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  /** 'email' (contraseña o enlace al correo), 'google'… */
  providers: string[];
  privacy_accepted_at: string | null;
  privacy_version: string | null;
  accounts: {
    id: string;
    name: string;
    type: AccountType;
    status: AccountStatus;
    role: Role;
    person_id: string | null;
    person_name: string | null;
    person_tone: string | null;
  }[];
  /** Sus números de WhatsApp (E.164 sin «+») */
  whatsapp: string[];
  /** Los que confirmó como suyos (con el link de Mister Luks o vinculando su WhatsApp); los demás son heredados */
  whatsapp_verificados?: string[];
}

export type MessageKind = 'photo' | 'pdf' | 'text';
export type FieldKey = 'merchant' | 'date' | 'total' | 'category' | 'payer';

/** Gasto con lo que hace falta para revisarlo (tabla expenses + su mensaje) */
export interface ReviewExpense {
  id: string;
  merchant: string;
  expense_date: string;
  total_cop: number;
  category_id: string | null;
  payer_person_id: string | null;
  status: 'pending_review' | 'confirmed';
  confidence: number | null;
  field_confidence: Partial<Record<FieldKey, number>> | null;
  ai_snapshot: {
    merchant?: string;
    expense_date?: string;
    total_cop?: number;
    category_id?: string | null;
    payer_person_id?: string | null;
    /** El worker encontró otro gasto con el mismo comercio, día y valor */
    possible_duplicate_of?: string;
  } | null;
  split_note: string | null;
  corrected_by: string | null;
  evidence_path: string | null;
  created_at: string;
  source: 'whatsapp' | 'web' | 'import';
  messages: {
    kind: MessageKind;
    text_body: string | null;
    file_name: string | null;
    received_at: string;
    sender_person_id: string | null;
  } | null;
  /** 'items' = dividido por consumo (quién pidió qué); se respeta al revisar */
  split_method?: 'equal' | 'percent' | 'exact' | 'items';
  /**
   * Un recibo en otra moneda (migración 360): cuál, cuánto decía (en su unidad
   * chica) y a qué tasa se pasó a la moneda de la cuenta. total_cop ya está en
   * la moneda de la cuenta.
   */
  original_currency?: string | null;
  original_total?: number | null;
  fx_rate?: number | string | null;
  fx_date?: string | null;
  fx_source?: string | null;
  expense_splits: { person_id: string; amount_cop: number; fixed?: boolean }[];
  /** Los ítems que leyó Luks de la factura (para invitar a dividir por consumo) */
  expense_items?: { id: string }[];
}

export interface AccountPerson {
  id: string;
  display_name: string;
  tone: string;
  claimed_by: string | null;
}

export interface AccountCategory {
  id: string;
  name: string;
  letter: string;
  tone: string;
  /** Qué entra en ella (lo lee Laya para elegirla) */
  description?: string | null;
  is_default?: boolean;
}

/** Tono guardado en la base (siempre uno de los 8), con respaldo por si acaso. */
export function asTone(value: string | null | undefined, fallbackName = ''): Tone {
  return TONES.includes(value as Tone) ? (value as Tone) : toneFor(fallbackName);
}

/** Color del cuadro de la cuenta: fijo por nombre, para reconocerla en todas partes. */
export function accountTone(name: string): Tone {
  return toneFor(`cuenta:${name}`);
}

export function accountGlyph(name: string) {
  // La primera letra o número (un emoji al principio no sirve de letra)
  return name.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? 'L';
}

export function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`;
}

/** public.whatsapp_overview(p_account_id): la pantalla «Conecta el grupo de WhatsApp» */
export interface WhatsappOverview {
  is_admin: boolean;
  /** Personas de la cuenta (migración 160): deberían ser las mismas del grupo */
  people_count?: number;
  contador: { phone: string | null; connected: boolean; status: string; last_seen_at: string | null } | null;
  /** Invitación vigente para escribir «lucas CÓDIGO» (solo la ven los admins) */
  code: string | null;
  groups: {
    group_id: string;
    name: string | null;
    linked_at: string;
    confirm_in_group: boolean;
    participants: number | null;
    last_message_at: string | null;
    left_at: string | null;
    connection_ok: boolean | null;
    connection_kind: 'contador' | 'personal' | null;
    /** Integrantes del grupo sin contar el número de Luks (migración 160) */
    members?: number;
    messages: number;
    expenses: number;
    last_sender: string | null;
  }[];
  unknown_senders: { wa_id: string; push_name: string | null; message_count: number; last_seen_at: string }[];
  /** WhatsApp personales vinculados (y vivos) de miembros de la cuenta: cada uno lee los grupos donde está (migración 100) */
  lectores?: { name: string; is_me: boolean }[];
}

/** public.my_whatsapp_link(): vincular el WhatsApp propio */
export interface MyWhatsappLink {
  status: 'connecting' | 'connected' | 'disconnected';
  qr: string | null;
  code: string | null;
  expires_at: string | null;
  phone: string | null;
  connected_at: string | null;
  alive: boolean | null;
  disconnect_reason: string | null;
  stopping: boolean;
}

/** «573001234567» → «+57 300 123 4567»; «lid:…» → null (WhatsApp no mostró el número). Ver lib/telefono */
export const formatWaNumber = formatear;

/**
 * Número para pedir el código de vinculación de WhatsApp: solo dígitos, con
 * indicativo. Un celular colombiano escrito sin el 57 («300 123 4567») se completa.
 */
export const numeroParaCodigo = (raw: string) => normalizar(raw, 'CO');

/** «Mafe, Santi y Caro» (o uno por renglón) → ['Mafe', 'Santi', 'Caro'], sin repetidos */
export function separarNombres(raw: string): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const parte of raw.split(/[,;\n]|\s+(?:y|and)\s+/)) {
    const nombre = parte.replace(/\s+/g, ' ').trim();
    const clave = nombre.toLocaleLowerCase('es');
    if (!nombre || vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(nombre);
  }
  return out;
}

export type EstadoWhatsapp = 'leyendo' | 'caido' | 'sin-grupo';

/** ¿Luks está leyendo el grupo de esta cuenta? Para el botón de arriba y el Resumen */
export function estadoWhatsapp(d: WhatsappOverview | null | undefined) {
  const enlazados = (d?.groups ?? []).filter((g) => !g.left_at);
  const leidos = enlazados.filter((g) => g.connection_ok);
  const principal = leidos[0] ?? enlazados[0] ?? null;
  const estado: EstadoWhatsapp = !enlazados.length ? 'sin-grupo' : leidos.length ? 'leyendo' : 'caido';
  return { estado, grupo: principal?.name ?? null, integrantes: principal?.members ?? principal?.participants ?? null };
}

/** public.people_to_add: quien ya está conmigo en otra cuenta y se puede agregar sin código */
export interface Conocido {
  user_id: string;
  name: string;
  tone: string | null;
  /** Las cuentas que compartimos */
  accounts: string[];
}

/** public.my_invites: me agregaron a una cuenta y falta que acepte */
export interface InvitacionRecibida {
  id: string;
  account_id: string;
  account_name: string;
  account_type: AccountType;
  starts_on: string | null;
  ends_on: string | null;
  /** Con qué nombre quedé en esa cuenta */
  person_name: string;
  invited_by: string;
  people_count: number;
  created_at: string;
}
