import { notFound } from 'next/navigation';
import type { SettlementOverview } from '@/lib/types';
import { siteOrigin } from '@/utils/site';
import { requireUser } from '@/utils/supabase/server';
import { SettleScreen } from './settle-screen';

export default async function LiquidarPage({ params, searchParams }: PageProps<'/c/[accountId]/liquidar'>) {
  const { accountId } = await params;
  const { mes } = await searchParams;
  const { supabase, userId } = await requireUser(`/c/${accountId}/liquidar`);

  // ?mes=2026-09 en un hogar (se liquida mes a mes); sin mes, el mes en curso
  const month = typeof mes === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? `${mes}-01` : null;
  const { data, error } = await supabase.rpc('settlement_overview', { p_account_id: accountId, p_month: month });
  if (error) {
    if (/No eres miembro/.test(error.message)) notFound();
    throw error;
  }

  const d = data as SettlementOverview;

  // Para cobrar por WhatsApp: el link público (si ya lo crearon) y el número de cada quien
  const [link, numeros, origin, yo] = await Promise.all([
    supabase.rpc('share_link', { p_account_id: accountId }),
    supabase
      .from('person_whatsapp_ids')
      .select('person_id, wa_id')
      .in(
        'person_id',
        d.people.map((p) => p.id),
      ),
    siteOrigin(),
    // Si es titular (borra del todo) y si ya la archivó
    supabase.from('account_members').select('role, archived_at').eq('account_id', accountId).eq('user_id', userId).maybeSingle(),
  ]);
  const phones: Record<string, string> = {};
  for (const n of numeros.data ?? []) {
    // «lid:…» es un id interno de WhatsApp, no un número al que se pueda escribir
    if (/^\d{8,15}$/.test(n.wa_id) && !phones[n.person_id]) phones[n.person_id] = n.wa_id;
  }

  // La pantalla escucha sola los gastos y las transferencias (tiempo real)
  const miembro = yo.data as { role: string; archived_at: string | null } | null;
  return (
    <SettleScreen
      d={d}
      shareToken={(link.data as string | null) ?? null}
      phones={phones}
      origin={origin}
      titular={miembro?.role === 'owner'}
      archivada={Boolean(miembro?.archived_at)}
    />
  );
}
