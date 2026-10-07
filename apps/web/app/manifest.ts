import type { MetadataRoute } from 'next';
import { LOCALE } from '@/lib/i18n';
import { getT } from '@/lib/i18n/server';

/** PWA instalable: desde el celular se abre como app y va directo a subir un recibo. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getT();
  return {
    name: t('Luks · cuentas compartidas'),
    short_name: 'Luks',
    description: t('Las cuentas del hogar y de los paseos: manden la foto del recibo y Luks la vuelve gasto.'),
    lang: LOCALE[t.idioma],
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FFFBF6',
    theme_color: '#0A7A4C',
    categories: ['finance', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: t('Subir un recibo'),
        short_name: t('Subir'),
        description: t('Tomar la foto de un recibo'),
        url: '/subir',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
