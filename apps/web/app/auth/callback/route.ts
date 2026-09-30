import type { EmailOtpType } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { nextFromRedirectTo, safeNext } from '@/lib/auth';
import { createClient } from '@/utils/supabase/server';

/**
 * Aquí vuelve la gente después de entrar:
 * - Google y el enlace mágico con la plantilla por defecto traen `code` (PKCE;
 *   solo funciona en el mismo navegador donde se pidió el enlace).
 * - Con la plantilla de Lucas (supabase/templates) el correo trae
 *   `token_hash` + `type`, que funciona aunque lo abran en otro dispositivo.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get('next') ?? nextFromRedirectTo(searchParams.get('redirect_to'), origin));

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  const supabase = await createClient();
  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  }

  if (ok) return NextResponse.redirect(new URL(next, origin));

  const motivo = searchParams.get('error') === 'access_denied' ? 'cancelado' : 'enlace';
  const login = new URL('/login', origin);
  login.searchParams.set('error', motivo);
  if (next !== '/') login.searchParams.set('next', next);
  return NextResponse.redirect(login);
}
