import { notFound } from 'next/navigation';
import { LiveRefresh } from '@/components/live-refresh';
import { WhatsappHero } from '@/components/whatsapp-hero';
import { getT } from '@/lib/i18n/server';
import { esMoneda } from '@/lib/moneda';
import { type Dashboard, estadoWhatsapp, type WhatsappOverview } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { EventSummary } from './event-summary';
import { HomeSummary } from './home-summary';

export default async function ResumenPage({ params, searchParams }: PageProps<'/c/[accountId]/resumen'>) {
  const { accountId } = await params;
  const { mes } = await searchParams;
  const { supabase, userId } = await requireUser(`/c/${accountId}/resumen`);

  // ?mes=2026-08 para ver meses anteriores del hogar
  const month = typeof mes === 'string' && /^\d{4}-\d{2}$/.test(mes) ? `${mes}-01` : null;
  const [{ data, error }, { data: me }, { data: wa }, { data: cuenta }, t] = await Promise.all([
    supabase.rpc('account_dashboard', { p_account_id: accountId, p_month: month }),
    supabase.from('account_members').select('role').eq('account_id', accountId).eq('user_id', userId).maybeSingle(),
    supabase.rpc('whatsapp_overview', { p_account_id: accountId }),
    supabase.from('accounts').select('currency').eq('id', accountId).maybeSingle(),
    getT(),
  ]);
  const moneda = esMoneda(cuenta?.currency) ? cuenta.currency : 'COP';
  if (error) throw error;
  if (!data) notFound();
  const d = data as Dashboard;
  // Invitar por WhatsApp: solo quien administra, y mientras la cuenta reciba gente
  const invitar = (me?.role === 'owner' || me?.role === 'admin') && d.account.status !== 'closed';
  // Sin grupo de WhatsApp, lo primero es conectarlo (es el motor de Luks)
  const aviso =
    wa && d.account.status !== 'closed' && estadoWhatsapp(wa as WhatsappOverview).estado === 'sin-grupo' ? <WhatsappHero accountId={accountId} /> : null;

  return (
    <>
      <LiveRefresh accountId={accountId} />
      {d.account.type === 'hogar' ? (
        <HomeSummary d={d} invitar={invitar} aviso={aviso} t={t} moneda={moneda} />
      ) : (
        <EventSummary d={d} invitar={invitar} aviso={aviso} t={t} moneda={moneda} />
      )}
    </>
  );
}
