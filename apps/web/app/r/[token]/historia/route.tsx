import { createClient } from '@supabase/supabase-js';
import { mesDe } from '@/lib/imagen-cuentas';
import { historiaCuentas } from '@/lib/imagen-historia';
import type { SharedOverview } from '@/lib/types';

/*
 * Las cuentas de /r/TOKEN como historia de Instagram (1080×1920): cuánto fue y
 * quién le paga a quién. La lee cualquiera con el link, como la página.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sp = new URL(request.url).searchParams;

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc('shared_overview', { p_token: token, p_month: mesDe(sp) });
  if (error) return new Response('No se pudo leer la cuenta', { status: 502 });
  if (!data) return new Response('No existe', { status: 404 });

  return historiaCuentas(data as SharedOverview, { cache: 'public, max-age=60, s-maxage=60, stale-while-revalidate=300' });
}
