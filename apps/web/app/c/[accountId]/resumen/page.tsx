import { notFound } from 'next/navigation';
import { VolverAUsar } from '@/components/archivo-cuenta';
import { LiveRefresh } from '@/components/live-refresh';
import { LoMioTambien } from '@/components/lo-mio-tambien';
import { NochesDelGrupo, type TodasLasNoches } from '@/components/todas-las-noches';
import { WhatsappHero } from '@/components/whatsapp-hero';
import { getT } from '@/lib/i18n/server';
import { esMoneda } from '@/lib/moneda';
import { type AccountOverview, type Dashboard, estadoWhatsapp, type WhatsappOverview } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { EventSummary } from './event-summary';
import { HomeSummary } from './home-summary';

export default async function ResumenPage({ params, searchParams }: PageProps<'/c/[accountId]/resumen'>) {
  const { accountId } = await params;
  const { mes } = await searchParams;
  const { supabase, userId } = await requireUser(`/c/${accountId}/resumen`);

  // ?mes=2026-08 para ver meses anteriores del hogar
  const month = typeof mes === 'string' && /^\d{4}-\d{2}$/.test(mes) ? `${mes}-01` : null;
  const [{ data, error }, { data: me }, { data: wa }, { data: cuenta }, { data: noches }, { data: mias }, { data: reflejo }, t] = await Promise.all([
    supabase.rpc('account_dashboard', { p_account_id: accountId, p_month: month }),
    supabase.from('account_members').select('role').eq('account_id', accountId).eq('user_id', userId).maybeSingle(),
    supabase.rpc('whatsapp_overview', { p_account_id: accountId }),
    supabase.from('accounts').select('currency').eq('id', accountId).maybeSingle(),
    // Las noches de antes del mismo grupo (la 770); sin la migración, no sale nada
    supabase.rpc('todas_las_noches', { p_account_id: accountId }),
    // «Lo tuyo de aquí también cuenta en…» (la 800): tus otras cuentas abiertas y la que elegiste
    supabase.rpc('account_overview'),
    supabase.from('cuentas_reflejo').select('destino_account_id').eq('account_id', accountId).eq('user_id', userId).maybeSingle(),
    getT(),
  ]);
  const moneda = esMoneda(cuenta?.currency) ? cuenta.currency : 'COP';
  if (error) throw error;
  if (!data) notFound();
  const d = data as Dashboard;
  // Invitar por WhatsApp: solo quien administra, y mientras la cuenta reciba gente
  const invitar = (me?.role === 'owner' || me?.role === 'admin') && d.account.status !== 'closed';
  // Sin grupo de WhatsApp, lo primero es conectarlo (es el motor de Luks)
  const admin = me?.role === 'owner' || me?.role === 'admin';
  // Liquidada o cerrada: quien administra la vuelve a usar («Noche nueva»: la misma gente, en ceros)
  const evento = d.account.type === 'evento';
  const liquidada = d.account.status === 'closed' || (evento && d.account.status === 'settling');
  const primero =
    liquidada && admin ? (
      <VolverAUsar accountId={accountId} accountName={d.account.name} evento={evento} tarjeta />
    ) : d.account.status !== 'closed' && wa && estadoWhatsapp(wa as WhatsappOverview).estado === 'sin-grupo' ? (
      <WhatsappHero accountId={accountId} />
    ) : null;
  const todas = noches ? <NochesDelGrupo d={noches as TodasLasNoches} actual={accountId} t={t} /> : null;
  const otras = ((mias as AccountOverview[] | null) ?? [])
    .filter((a) => a.id !== accountId && a.status === 'active' && a.type !== 'cobro')
    .map((a) => ({ id: a.id, name: a.name }));
  const loMio =
    d.account.status !== 'closed' && otras.length ? (
      <LoMioTambien accountId={accountId} destino={reflejo?.destino_account_id ?? null} opciones={otras} />
    ) : null;
  const aviso =
    primero || todas || loMio ? (
      <>
        {primero}
        {todas}
        {loMio}
      </>
    ) : null;

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
