import { notFound } from 'next/navigation';
import type { AccountType, Role } from '@/lib/types';
import { siteOrigin } from '@/utils/site';
import { requireUser } from '@/utils/supabase/server';
import { MembersScreen } from './members-screen';

export default async function PersonasPage({ params }: PageProps<'/c/[accountId]/personas'>) {
  const { accountId } = await params;
  const { supabase, userId } = await requireUser(`/c/${accountId}/personas`);

  const [{ data: me }, { data: account }] = await Promise.all([
    supabase.from('account_members').select('role').eq('account_id', accountId).eq('user_id', userId).maybeSingle(),
    supabase.from('accounts').select('name, type, status').eq('id', accountId).maybeSingle(),
  ]);
  if (!me || !account) notFound();

  return (
    <MembersScreen
      accountId={accountId}
      accountName={account.name as string}
      accountType={account.type as AccountType}
      closed={account.status === 'closed'}
      myRole={me.role as Role}
      origin={await siteOrigin()}
    />
  );
}
