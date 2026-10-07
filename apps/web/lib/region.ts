/* Dónde está la persona: elige la moneda de sus cuentas nuevas y el país de
   su número de WhatsApp. Colombia si no dice nada. Queda en una cookie, como
   el idioma (lo lee el servidor). */

import type { Moneda } from '@/lib/moneda';

export type Region = 'CO' | 'CL' | 'BO' | 'US';
export const REGIONES: Region[] = ['CO', 'CL', 'BO', 'US'];
export const COOKIE_REGION = 'luks-region';

/** El nombre pasa por t (en inglés «United States») */
export const REGION: Record<Region, { nombre: string; moneda: Moneda; bandera: string }> = {
  CO: { nombre: 'Colombia', moneda: 'COP', bandera: '🇨🇴' },
  CL: { nombre: 'Chile', moneda: 'CLP', bandera: '🇨🇱' },
  BO: { nombre: 'Bolivia', moneda: 'BOB', bandera: '🇧🇴' },
  US: { nombre: 'Estados Unidos', moneda: 'USD', bandera: '🇺🇸' },
};

export const esRegion = (v: unknown): v is Region => typeof v === 'string' && (REGIONES as string[]).includes(v);

/** La que eligió (cookie) o la del navegador («es-CL», «en-US»); si no, Colombia */
export function regionDe(cookie?: string | null, acceptLanguage?: string | null): Region {
  if (esRegion(cookie)) return cookie;
  for (const parte of (acceptLanguage ?? '').split(',')) {
    const pais = parte.trim().split(';')[0].split('-')[1]?.toUpperCase();
    if (esRegion(pais)) return pais;
  }
  return 'CO';
}
