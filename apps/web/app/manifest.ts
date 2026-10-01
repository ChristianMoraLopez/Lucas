import type { MetadataRoute } from 'next';

/** PWA instalable: desde el celular se abre como app y va directo a subir un recibo. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Luks · cuentas compartidas',
    short_name: 'Luks',
    description: 'Las cuentas del hogar y de los paseos: manden la foto del recibo y Luks la vuelve gasto.',
    lang: 'es-CO',
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
        name: 'Subir un recibo',
        short_name: 'Subir',
        description: 'Tomar la foto de un recibo',
        url: '/subir',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
