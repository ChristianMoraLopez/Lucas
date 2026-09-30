import { notFound } from 'next/navigation';
import type { Role } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { ReviewScreen } from './review-screen';

export default async function RevisarPage({ params, searchParams }: PageProps<'/c/[accountId]/revisar'>) {
  const { accountId } = await params;
  const { gasto } = await searchParams;
  const { supabase, userId } = await requireUser(`/c/${accountId}/revisar`);

  const { data: me } = await supabase.from('account_members').select('role').eq('account_id', accountId).eq('user_id', userId).maybeSingle();
  if (!me) notFound();

  return <ReviewScreen accountId={accountId} myRole={me.role as Role} focus={typeof gasto === 'string' ? gasto : null} />;
}
