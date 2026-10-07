import { getT } from '@/lib/i18n/server';
import { imagenCuentas, mesDe } from '@/lib/imagen-cuentas';
import { esMoneda } from '@/lib/moneda';
import type { SettlementOverview } from '@/lib/types';
import { createClient } from '@/utils/supabase/server';

/*
 * La misma imagen del link compartido, para verla en Liquidar antes de
 * mandarla al grupo (aunque el link todavía no exista). Solo para miembros.
 */
export async function GET(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const supabase = await createClient();
  const [{ data, error }, { data: cuenta }, t] = await Promise.all([
    supabase.rpc('settlement_overview', { p_account_id: accountId, p_month: mesDe(new URL(request.url).searchParams) }),
    supabase.from('accounts').select('currency').eq('id', accountId).maybeSingle(),
    getT(),
  ]);
  if (error || !data) return new Response('No se pudo leer la cuenta', { status: 404 });
  return imagenCuentas(data as SettlementOverview, { cache: 'private, max-age=30', t, moneda: esMoneda(cuenta?.currency) ? cuenta.currency : 'COP' });
}
