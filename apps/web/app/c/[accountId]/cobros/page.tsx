import { notFound, redirect } from 'next/navigation';
import type { Pago, Role } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { CobrosScreen } from './cobros-screen';

export default async function CobrosPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const { supabase, userId } = await requireUser(`/c/${accountId}/cobros`);

  const [{ data: me }, { data: account }, { data: perfil }] = await Promise.all([
    supabase.from('account_members').select('role').eq('account_id', accountId).eq('user_id', userId).maybeSingle(),
    supabase.from('accounts').select('type, status').eq('id', accountId).maybeSingle(),
    supabase.from('profiles').select('pago_llave, pago_nequi, pago_daviplata').eq('id', userId).maybeSingle(),
  ]);
  if (!me || !account) notFound();
  // Solo las cuentas de cobro tienen cobros
  if (account.type !== 'cobro') redirect(`/c/${accountId}/resumen`);

  const pago: Pago = {
    ...(perfil?.pago_llave ? { llave: perfil.pago_llave as string } : {}),
    ...(perfil?.pago_nequi ? { nequi: perfil.pago_nequi as string } : {}),
    ...(perfil?.pago_daviplata ? { daviplata: perfil.pago_daviplata as string } : {}),
  };
  return <CobrosScreen accountId={accountId} myRole={me.role as Role} closed={account.status === 'closed'} pago={pago} />;
}
