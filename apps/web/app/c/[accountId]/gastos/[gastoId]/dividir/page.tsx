import { notFound } from 'next/navigation';
import type { Role } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { DividirScreen } from './dividir-screen';

export default async function DividirPage({ params, searchParams }: PageProps<'/c/[accountId]/gastos/[gastoId]/dividir'>) {
  const { accountId, gastoId } = await params;
  const { volver } = await searchParams;
  const { supabase, userId } = await requireUser(`/c/${accountId}/gastos/${gastoId}/dividir`);

  const { data: me } = await supabase.from('account_members').select('role').eq('account_id', accountId).eq('user_id', userId).maybeSingle();
  if (!me) notFound();

  // Al terminar vuelve a donde estaba: la bandeja de revisar o el detalle del gasto
  const atras = volver === 'revisar' ? `/c/${accountId}/revisar?gasto=${gastoId}` : `/c/${accountId}/gastos/${gastoId}`;
  return <DividirScreen accountId={accountId} expenseId={gastoId} myRole={me.role as Role} atras={atras} />;
}
