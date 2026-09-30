import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Llamado desde un Server Component: el proxy se encarga de refrescar la sesión.
        }
      },
    },
  });
}

/**
 * Cliente + id del usuario, o redirige a /login. getClaims() verifica la
 * firma del JWT (no confía en la cookie a ciegas) y no siempre va al servidor
 * de Auth, así que es más rápido que getUser().
 */
export async function requireUser(next?: string) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  return { supabase, userId };
}
