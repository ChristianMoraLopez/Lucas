import { notFound } from 'next/navigation';
import { LiveRefresh } from '@/components/live-refresh';
import type { Dashboard } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { EventSummary } from './event-summary';
import { HomeSummary } from './home-summary';

export default async function ResumenPage({ params, searchParams }: PageProps<'/c/[accountId]/resumen'>) {
  const { accountId } = await params;
  const { mes } = await searchParams;
  const { supabase } = await requireUser(`/c/${accountId}/resumen`);

  // ?mes=2026-08 para ver meses anteriores del hogar
  const month = typeof mes === 'string' && /^\d{4}-\d{2}$/.test(mes) ? `${mes}-01` : null;
  const { data, error } = await supabase.rpc('account_dashboard', { p_account_id: accountId, p_month: month });
  if (error) throw error;
  if (!data) notFound();
  const d = data as Dashboard;

  return (
    <>
      <LiveRefresh accountId={accountId} />
      {d.account.type === 'hogar' ? <HomeSummary d={d} /> : <EventSummary d={d} />}
    </>
  );
}
