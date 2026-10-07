import { notFound } from 'next/navigation';
import { esIdioma } from '@/lib/i18n';
import { esMoneda } from '@/lib/moneda';
import type { AccountType } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { WhatsappScreen } from './whatsapp-screen';

export default async function WhatsappPage({ params }: PageProps<'/c/[accountId]/whatsapp'>) {
  const { accountId } = await params;
  const { supabase } = await requireUser(`/c/${accountId}/whatsapp`);

  const [{ data: account }, { count }] = await Promise.all([
    supabase.from('accounts').select('name, type, status, currency, language').eq('id', accountId).maybeSingle(),
    // Con un solo gasto la moneda ya no se cambia
    supabase.from('expenses').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
  ]);
  if (!account) notFound();

  return (
    <WhatsappScreen
      accountId={accountId}
      accountName={account.name as string}
      accountType={account.type as AccountType}
      closed={account.status !== 'active'}
      ajustes={{
        moneda: esMoneda(account.currency) ? account.currency : 'COP',
        idioma: esIdioma(account.language) ? account.language : 'es',
        conGastos: (count ?? 0) > 0,
      }}
    />
  );
}
