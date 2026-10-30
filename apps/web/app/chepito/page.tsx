import { redirect } from 'next/navigation';
import { requireUser } from '@/utils/supabase/server';

/** Chepito va aparte de las cuentas: cada quien tiene uno (se abre la primera vez) */
export default async function ChepitoPage() {
  const { supabase } = await requireUser('/chepito');
  const { data, error } = await supabase.rpc('mi_chepito');
  if (error || !data) redirect('/');
  redirect(`/c/${data as string}/cobros`);
}
