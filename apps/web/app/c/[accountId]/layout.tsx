import { notFound } from 'next/navigation';
import type { Moneda } from '@/lib/moneda';
import type { AccountType, WhatsappOverview } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { AccountShell } from './account-shell';

export default async function AccountLayout({ children, params }: LayoutProps<'/c/[accountId]'>) {
  const { accountId } = await params;
  const { supabase, userId } = await requireUser(`/c/${accountId}`);

  const [{ data: account }, { count: pending }, { data: whatsapp }, guias, { data: perfil }] = await Promise.all([
    supabase.from('accounts').select('id, name, type, currency').eq('id', accountId).maybeSingle(),
    supabase.from('expenses').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'pending_review'),
    // El estado de WhatsApp va arriba en todas las pantallas (si falla, se pide en el navegador)
    supabase.rpc('whatsapp_overview', { p_account_id: accountId }),
    // Si ya vio la guía de las cuentas (si no se sabe, no sale sola)
    supabase.from('profiles').select('guias_vistas').eq('id', userId).maybeSingle(),
    // El nombre va en el menú de arriba
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
  ]);
  // RLS: si no es miembro, la cuenta simplemente no aparece
  if (!account) notFound();

  return (
    <AccountShell
      account={account as { id: string; name: string; type: AccountType; currency: Moneda }}
      pending={pending ?? 0}
      whatsapp={(whatsapp as WhatsappOverview | null) ?? null}
      usuario={userId}
      nombre={perfil?.full_name?.trim() || ''}
      guiaVista={guias.error || !guias.data ? true : ((guias.data.guias_vistas as string[] | null) ?? []).includes('cuenta')}
    >
      {children}
    </AccountShell>
  );
}
