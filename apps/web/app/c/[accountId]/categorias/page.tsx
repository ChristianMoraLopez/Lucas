import { notFound } from 'next/navigation';
import type { Role } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { CategoriesScreen } from './categories-screen';

export default async function CategoriasPage({ params }: PageProps<'/c/[accountId]/categorias'>) {
  const { accountId } = await params;
  const { supabase, userId } = await requireUser(`/c/${accountId}/categorias`);

  const { data: me } = await supabase.from('account_members').select('role').eq('account_id', accountId).eq('user_id', userId).maybeSingle();
  if (!me) notFound();

  return <CategoriesScreen accountId={accountId} myRole={me.role as Role} />;
}
