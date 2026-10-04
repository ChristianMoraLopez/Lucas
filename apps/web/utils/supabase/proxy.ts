import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { safeNext } from '@/lib/auth';

// /r/TOKEN: las cuentas que alguien compartió; las ve cualquiera con el link, sin entrar
// /historia: la imagen para recomendar Luks en Instagram (la misma para todos)
const PUBLIC_PATHS = ['/login', '/auth/callback', '/r', '/historia'];

/**
 * Refresca la sesión de Supabase en cada request y hace la verificación
 * optimista de rutas: sin sesión solo se puede ir a /login, /auth/callback y
 * a las cuentas compartidas (/r/…), y se recuerda a dónde iba (p. ej. un link
 * de invitación /e/PASEO-7K2Q);
 * con sesión, /login lleva al selector de cuentas.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) supabaseResponse.cookies.set(name, value, options);
      },
    },
  });

  // No meter código entre createServerClient y getClaims: es lo que refresca la sesión.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    if (pathname !== '/') url.searchParams.set('next', pathname + search);
    return redirectWithCookies(url, supabaseResponse);
  }

  if (signedIn && pathname === '/login') {
    const next = safeNext(request.nextUrl.searchParams.get('next'));
    return redirectWithCookies(new URL(next, request.url), supabaseResponse);
  }

  return supabaseResponse;
}

/** Redirige sin perder las cookies de sesión que Supabase acaba de refrescar. */
function redirectWithCookies(url: URL, from: NextResponse) {
  const res = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) res.cookies.set(cookie);
  return res;
}
