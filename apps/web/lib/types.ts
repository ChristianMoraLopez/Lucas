import { TONES, type Tone, toneFor } from '@/components/lucas-core';

/* Contratos de lo que devuelve Supabase (tablas y RPC de supabase/migrations).
   Se escriben a mano mientras no haya tipos generados con `supabase gen types`. */

export type Role = 'owner' | 'admin' | 'member';
export type AccountType = 'hogar' | 'evento';
/** Un evento se está liquidando (settling): ya no recibe gastos */
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
}

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
  unclaimed_people: { id: string; display_name: string; tone: string; wa_last4: string | null; paid_count: number }[];
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
  settled_months: string[] | null;
}

/** public.shared_overview(token): lo que ve quien abre el link público (lo de Liquidar, sin datos de quien mira) */
export type SharedOverview = Omit<SettlementOverview, 'is_admin' | 'my_person_id'>;

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
  expense_splits: { person_id: string; amount_cop: number; fixed?: boolean }[];
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

/** «573001234567» → «+57 300 123 4567»; «lid:…» → null (WhatsApp no mostró el número) */
export function formatWaNumber(waId: string | null | undefined): string | null {
  if (!waId || waId.startsWith('lid:')) return null;
  const m = waId.match(/^57(\d{3})(\d{3})(\d{4})$/);
  return m ? `+57 ${m[1]} ${m[2]} ${m[3]}` : `+${waId}`;
}

/**
 * Número para pedir el código de vinculación de WhatsApp: solo dígitos, con
 * indicativo. Un celular colombiano escrito sin el 57 («300 123 4567») se completa.
 */
export function numeroParaCodigo(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (/^3\d{9}$/.test(d)) return `57${d}`;
  return /^\d{8,15}$/.test(d) ? d : null;
}

/** «Mafe, Santi y Caro» (o uno por renglón) → ['Mafe', 'Santi', 'Caro'], sin repetidos */
export function separarNombres(raw: string): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const parte of raw.split(/[,;\n]|\s+y\s+/)) {
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
