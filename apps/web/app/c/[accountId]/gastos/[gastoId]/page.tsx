import { notFound } from 'next/navigation';
import type { Role } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { ExpenseScreen } from './expense-screen';

export default async function GastoPage({ params }: PageProps<'/c/[accountId]/gastos/[gastoId]'>) {
  const { accountId, gastoId } = await params;
  const { supabase, userId } = await requireUser(`/c/${accountId}/gastos/${gastoId}`);

  const { data: me } = await supabase.from('account_members').select('role').eq('account_id', accountId).eq('user_id', userId).maybeSingle();
  if (!me) notFound();

  return <ExpenseScreen accountId={accountId} expenseId={gastoId} myRole={me.role as Role} />;
}
