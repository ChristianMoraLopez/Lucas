import { createClient } from '@supabase/supabase-js';
import { imagenCuentas, mesDe } from '@/lib/imagen-cuentas';
import type { SharedOverview } from '@/lib/types';

/*
 * La vista previa del link /r/TOKEN en WhatsApp: la imagen con las cuentas.
 * Con ?p=persona, lo de esa persona (el link de los cobros). La lee cualquiera
 * con el link, como la página.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sp = new URL(request.url).searchParams;

  // Sin sesión: lo mismo que ve cualquiera con el link
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc('shared_overview', { p_token: token, p_month: mesDe(sp) });
  if (error) return new Response('No se pudo leer la cuenta', { status: 502 });
  if (!data) return new Response('No existe', { status: 404 });

  return imagenCuentas(data as SharedOverview, {
    personId: sp.get('p'),
    // Se marcan pagos: que WhatsApp y el CDN no la guarden mucho tiempo
    cache: 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
  });
}
