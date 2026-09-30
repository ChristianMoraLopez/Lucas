import { notFound } from 'next/navigation';
import { requireUser } from '@/utils/supabase/server';
import { UploadScreen } from './upload-screen';

export default async function SubirPage({ params }: PageProps<'/c/[accountId]/subir'>) {
  const { accountId } = await params;
  const { supabase } = await requireUser(`/c/${accountId}/subir`);
  const { data: account } = await supabase.from('accounts').select('name, status').eq('id', accountId).maybeSingle();
  if (!account) notFound();

  return <UploadScreen accountId={accountId} accountName={account.name as string} closed={account.status === 'closed'} />;
}
