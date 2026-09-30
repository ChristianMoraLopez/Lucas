/**
 * Mensaje para la persona. Los RPC de Lucas ya fallan en español y se
 * muestran tal cual; los errores de Supabase Auth y de red se traducen.
 */
export function humanError(error: { message?: string } | null | undefined): string {
  const m = error?.message ?? '';
  if (/rate limit|security purposes|only request this after/i.test(m)) return 'Pediste muchos enlaces seguidos. Espera un minuto y vuelve a intentar.';
  if (/invalid.*email|unable to validate email|email address .* is invalid/i.test(m)) return 'Ese correo no parece válido. Revísalo.';
  if (/signups? not allowed/i.test(m)) return 'Por ahora no se pueden crear usuarios nuevos.';
  if (/failed to fetch|fetch failed|network/i.test(m)) return 'No hay conexión. Revisa tu internet e intenta otra vez.';
  if (/jwt|not authenticated|auth session missing|Debes iniciar sesión/i.test(m)) return 'Tu sesión venció. Vuelve a entrar.';
  if (/permission denied|row-level security/i.test(m)) return 'No tienes permiso para hacer eso en esta cuenta.';
  if (/duplicate key|already exists/i.test(m)) return 'Eso ya existe.';
  return m || 'Algo salió mal. Intenta otra vez.';
}
