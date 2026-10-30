import { redirect } from 'next/navigation';
import { requireUser } from '@/utils/supabase/server';

export default async function AccountIndexPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const { supabase } = await requireUser(`/c/${accountId}`);
  // Una cuenta de cobro (Chepito) abre en sus cobros
  const { data } = await supabase.from('accounts').select('type').eq('id', accountId).maybeSingle();
  redirect(`/c/${accountId}/${data?.type === 'cobro' ? 'cobros' : 'resumen'}`);
}
