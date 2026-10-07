import { cookies, headers } from 'next/headers';
import { COOKIE_REGION, type Region, regionDe } from '@/lib/region';
import { COOKIE_IDIOMA, crearT, type Idioma, idiomaDe } from './index';

/** En un Server Component: el idioma de quien está viendo */
export async function getIdioma(): Promise<Idioma> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return idiomaDe(c.get(COOKIE_IDIOMA)?.value, h.get('accept-language'));
}

/** En un Server Component: const t = await getT(); t('Crear cuenta') */
export async function getT() {
  return crearT(await getIdioma());
}

/** En un Server Component: la región de quien está viendo (moneda de sus cuentas nuevas, país del teléfono) */
export async function getRegion(): Promise<Region> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return regionDe(c.get(COOKIE_REGION)?.value, h.get('accept-language'));
}
