import { TONES, type Tone, toneFor } from '@/components/lucas-core';

/* Contratos de lo que devuelve Supabase (tablas y RPC de supabase/migrations).
   Se escriben a mano mientras no haya tipos generados con `supabase gen types`. */

export type Role = 'owner' | 'admin' | 'member';
export type AccountType = 'hogar' | 'evento';

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
  status: 'active' | 'closed';
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

/** Tono guardado en la base (siempre uno de los 8), con respaldo por si acaso. */
export function asTone(value: string | null | undefined, fallbackName = ''): Tone {
  return TONES.includes(value as Tone) ? (value as Tone) : toneFor(fallbackName);
}

/** Color del cuadro de la cuenta: fijo por nombre, para reconocerla en todas partes. */
export function accountTone(name: string): Tone {
  return toneFor(`cuenta:${name}`);
}

export function accountGlyph(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'L';
}

export function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`;
}
