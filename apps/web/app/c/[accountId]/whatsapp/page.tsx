import { notFound } from 'next/navigation';
import type { AccountType } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { WhatsappScreen } from './whatsapp-screen';

export default async function WhatsappPage({ params }: PageProps<'/c/[accountId]/whatsapp'>) {
  const { accountId } = await params;
  const { supabase } = await requireUser(`/c/${accountId}/whatsapp`);

  const { data: account } = await supabase.from('accounts').select('name, type, status').eq('id', accountId).maybeSingle();
  if (!account) notFound();

  return (
    <WhatsappScreen accountId={accountId} accountName={account.name as string} accountType={account.type as AccountType} closed={account.status !== 'active'} />
  );
}
