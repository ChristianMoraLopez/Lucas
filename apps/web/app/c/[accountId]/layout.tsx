import { notFound } from 'next/navigation';
import type { AccountType } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { AccountShell } from './account-shell';

export default async function AccountLayout({ children, params }: LayoutProps<'/c/[accountId]'>) {
  const { accountId } = await params;
  const { supabase } = await requireUser(`/c/${accountId}`);

  const [{ data: account }, { count: pending }] = await Promise.all([
    supabase.from('accounts').select('id, name, type').eq('id', accountId).maybeSingle(),
    supabase.from('expenses').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'pending_review'),
  ]);
  // RLS: si no es miembro, la cuenta simplemente no aparece
  if (!account) notFound();

  return (
    <AccountShell account={account as { id: string; name: string; type: AccountType }} pending={pending ?? 0}>
      {children}
    </AccountShell>
  );
}
