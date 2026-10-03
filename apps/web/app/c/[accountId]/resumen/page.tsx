import { notFound } from 'next/navigation';
import { LiveRefresh } from '@/components/live-refresh';
import type { Dashboard } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { EventSummary } from './event-summary';
import { HomeSummary } from './home-summary';

export default async function ResumenPage({ params, searchParams }: PageProps<'/c/[accountId]/resumen'>) {
  const { accountId } = await params;
  const { mes } = await searchParams;
  const { supabase, userId } = await requireUser(`/c/${accountId}/resumen`);

  // ?mes=2026-08 para ver meses anteriores del hogar
  const month = typeof mes === 'string' && /^\d{4}-\d{2}$/.test(mes) ? `${mes}-01` : null;
  const [{ data, error }, { data: me }] = await Promise.all([
    supabase.rpc('account_dashboard', { p_account_id: accountId, p_month: month }),
    supabase.from('account_members').select('role').eq('account_id', accountId).eq('user_id', userId).maybeSingle(),
  ]);
  if (error) throw error;
  if (!data) notFound();
  const d = data as Dashboard;
  // Invitar por WhatsApp: solo quien administra, y mientras la cuenta reciba gente
  const invitar = (me?.role === 'owner' || me?.role === 'admin') && d.account.status !== 'closed';

  return (
    <>
      <LiveRefresh accountId={accountId} />
      {d.account.type === 'hogar' ? <HomeSummary d={d} invitar={invitar} /> : <EventSummary d={d} invitar={invitar} />}
    </>
  );
}
