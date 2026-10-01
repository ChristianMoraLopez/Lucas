/**
 * Mensaje para la persona. Los RPC de Luks ya fallan en español y se
 * muestran tal cual; los errores de Supabase Auth y de red se traducen.
 */
export function humanError(error: { message?: string } | null | undefined): string {
  const m = error?.message ?? '';
  if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/user already registered|already been registered/i.test(m)) return 'Ya hay una cuenta con ese correo. Entra o recupera tu contraseña.';
  if (/email not confirmed/i.test(m)) return 'Primero confirma tu correo: te mandamos un enlace cuando creaste la cuenta.';
  if (/password should be at least|password is too short/i.test(m)) return 'La contraseña debe tener al menos 8 caracteres.';
  if (/pwned|leaked|known to be weak|weak password/i.test(m)) return 'Esa contraseña es muy fácil de adivinar o apareció en filtraciones. Usa otra.';
  if (/same password|different from the old/i.test(m)) return 'La contraseña nueva tiene que ser distinta de la anterior.';
  if (/rate limit|security purposes|only request this after/i.test(m)) return 'Pediste muchos enlaces seguidos. Espera un minuto y vuelve a intentar.';
  if (/invalid.*email|unable to validate email|email address .* is invalid/i.test(m)) return 'Ese correo no parece válido. Revísalo.';
  if (/signups? not allowed/i.test(m)) return 'Por ahora no se pueden crear usuarios nuevos.';
  if (/provider is not enabled|unsupported provider/i.test(m)) return 'La entrada con Google todavía no está activada. Mientras tanto, entra con tu correo.';
  if (/failed to fetch|fetch failed|network/i.test(m)) return 'No hay conexión. Revisa tu internet e intenta otra vez.';
  if (/jwt|not authenticated|auth session missing|Debes iniciar sesión/i.test(m)) return 'Tu sesión venció. Vuelve a entrar.';
  if (/permission denied|row-level security/i.test(m)) return 'No tienes permiso para hacer eso en esta cuenta.';
  if (/duplicate key|already exists/i.test(m)) return 'Eso ya existe.';
  return m || 'Algo salió mal. Intenta otra vez.';
}
