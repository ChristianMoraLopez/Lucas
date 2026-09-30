/**
 * Ruta interna a la que se vuelve después de entrar. Solo acepta rutas
 * relativas del propio sitio: nada de `//otro.com`, `/\otro.com` ni URLs
 * absolutas (open redirect).
 */
export function safeNext(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback;
  const v = raw.trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return fallback;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: se buscan justamente caracteres de control
  if (/[\u0000-\u001f\u007f]/.test(v)) return fallback;
  if (v === '/login' || v.startsWith('/login?') || v.startsWith('/auth/')) return fallback;
  return v;
}

/**
 * Los correos de Supabase traen `redirect_to` con la URL completa que pidió la
 * app (`https://sitio/auth/callback?next=/e/PASEO-7K2Q`). De ahí sale `next`,
 * pero solo si apunta al mismo sitio.
 */
export function nextFromRedirectTo(redirectTo: string | null | undefined, origin: string): string | null {
  if (!redirectTo) return null;
  try {
    const url = new URL(redirectTo);
    if (url.origin !== origin) return null;
    return url.searchParams.get('next');
  } catch {
    return null;
  }
}

/** URL a la que vuelve Supabase después del enlace mágico o de Google. */
export function callbackUrl(origin: string, next: string) {
  return `${origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}
