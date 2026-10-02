import { notFound } from 'next/navigation';
import type { SettlementOverview } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { SettleScreen } from './settle-screen';

export default async function LiquidarPage({ params, searchParams }: PageProps<'/c/[accountId]/liquidar'>) {
  const { accountId } = await params;
  const { mes } = await searchParams;
  const { supabase } = await requireUser(`/c/${accountId}/liquidar`);

  // ?mes=2026-09 en un hogar (se liquida mes a mes); sin mes, el mes en curso
  const month = typeof mes === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? `${mes}-01` : null;
  const { data, error } = await supabase.rpc('settlement_overview', { p_account_id: accountId, p_month: month });
  if (error) {
    if (/No eres miembro/.test(error.message)) notFound();
    throw error;
  }

  // La pantalla escucha sola los gastos y las transferencias (tiempo real)
  return <SettleScreen d={data as SettlementOverview} />;
}
