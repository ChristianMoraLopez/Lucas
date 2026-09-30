import { headers } from 'next/headers';

/**
 * Origen público del sitio para armar links de invitación en el servidor.
 * NEXT_PUBLIC_SITE_URL manda (dominio de producción); si no está, se toma del
 * request (sirve en local y en los previews de Vercel).
 */
export async function siteOrigin() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
