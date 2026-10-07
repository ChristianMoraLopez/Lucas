import { esIdioma, type Idioma, traducir } from '@/lib/i18n';

/** El idioma de la pantalla (lo pone el layout en <html lang>); en el servidor, español */
function idiomaDePantalla(): Idioma {
  if (typeof document === 'undefined') return 'es';
  const l = document.documentElement.lang.slice(0, 2);
  return esIdioma(l) ? l : 'es';
}

/**
 * Los errores de la base que traen un dato adentro (un nombre, un monto…): el
 * patrón en español y cómo se dice en inglés con ese mismo dato ($1, $2…).
 */
const CON_DATOS: [RegExp, string][] = [
  [/^(.+) está en una liquidación: reábranla antes de eliminarlo$/, '$1 is part of a settlement: reopen it before removing them'],
  [/^El mensaje (.+) no existe$/, 'Message $1 does not exist'],
  [/^El nombre «(.+)…» es muy largo \(máximo 40 letras\)$/, 'The name “$1…” is too long (40 letters max)'],
  [/^El trabajo (.+) no existe$/, 'Job $1 does not exist'],
  [/^Elige a quién pasan los gastos de (.+)$/, 'Choose who takes over $1’s expenses'],
  [/^Estado no permitido para el worker: (.+)$/, 'Status not allowed for the worker: $1'],
  [/^Faltan 1 transferencia por pagar$/, '1 transfer is still unpaid'],
  [/^Faltan (\d+) transferencias por pagar$/, '$1 transfers are still unpaid'],
  [/^Hay 1 gasto sin quién pagó o sin dividir: corríjanlos antes de liquidar$/, '1 expense has no payer or no split: fix it before settling'],
  [/^Hay (\d+) gastos sin quién pagó o sin dividir: corríjanlos antes de liquidar$/, '$1 expenses have no payer or no split: fix them before settling'],
  [/^Las partes suman (.+) y el gasto es de (.+): tienen que dar lo mismo$/, 'The shares add up to $1 and the expense is $2: they have to match'],
  [/^Para confirmar, escribe el nombre de la cuenta tal cual: «(.+)»$/, 'To confirm, type the account name exactly: “$1”'],
  [/^Primero revisen 1 gasto pendiente$/, 'First review 1 pending expense'],
  [/^Primero revisen (\d+) gastos pendientes$/, 'First review $1 pending expenses'],
  [/^Sobran transferencias: con (\d+) personas con saldo bastan (\d+)$/, 'Too many transfers: with $1 people owing or owed, $2 are enough'],
  [/^Ya hay alguien que se llama «(.+)» en la cuenta$/, 'Someone called “$1” is already in the account'],
  [/^Ya hay una categoría «(.+)» en esta cuenta$/, 'There is already a “$1” category in this account'],
  [/^«(.+)» tiene cuenta en Luks: su nombre lo elige desde su perfil$/, '“$1” has a Luks account: they choose their name from their profile'],
];

/** El error en el idioma de la pantalla (los fijos están en lib/i18n/en.ts) */
function enIdioma(mensaje: string, idioma: Idioma) {
  if (idioma === 'en') {
    for (const [re, en] of CON_DATOS) if (re.test(mensaje)) return mensaje.replace(re, en);
  }
  return traducir(idioma, mensaje);
}

/**
 * Mensaje para la persona. Los RPC de Luks fallan en español (se traducen si
 * la pantalla está en inglés); los errores de Supabase Auth y de red se
 * explican con palabras de aquí.
 */
export function humanError(error: { message?: string } | null | undefined, idioma: Idioma = idiomaDePantalla()): string {
  return enIdioma(explicar(error?.message ?? ''), idioma);
}

function explicar(m: string): string {
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
  if (/failed to fetch|fetch failed|load failed|network|timed? ?out|aborted/i.test(m))
    return 'No hay conexión o está muy lenta. Revisa tu internet e intenta otra vez.';
  if (/jwt|not authenticated|auth session missing|Debes iniciar sesión/i.test(m)) return 'Tu sesión venció. Vuelve a entrar.';
  if (/permission denied|row-level security/i.test(m)) return 'No tienes permiso para hacer eso en esta cuenta.';
  if (/duplicate key|already exists/i.test(m)) return 'Eso ya existe.';
  return m || 'Algo salió mal. Intenta otra vez.';
}
