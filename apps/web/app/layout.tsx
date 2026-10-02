import { SerwistProvider } from '@serwist/turbopack/react';
import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import '@/styles/tokens.css';
import '@/styles/lucas.css';
import '@/styles/app.css';

const description = 'Luks vuelve gastos lo que mandan al grupo de WhatsApp: fotos de recibos, PDFs y mensajes, clasificados y divididos.';

/**
 * Dominio con el que se arman las URLs absolutas de la vista previa (WhatsApp,
 * redes) y de los íconos: el de producción, también en los previews de Vercel.
 */
function siteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (fromEnv) return new URL(fromEnv);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  return new URL('http://localhost:3000');
}

// Íconos e imagen para compartir salen de los archivos de app/: favicon.ico
// (Safari, buscadores), icon.svg (pestaña), apple-icon.png (pantalla de inicio
// del iPhone) y opengraph-image.png / twitter-image.png (vista previa del link).
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: 'Luks — cuentas compartidas',
  description,
  applicationName: 'Luks',
  appleWebApp: { capable: true, title: 'Luks', statusBarStyle: 'default' },
  openGraph: {
    type: 'website',
    siteName: 'Luks',
    locale: 'es_CO',
    title: 'Luks — las cuentas del grupo, sin pelear',
    description,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Luks — las cuentas del grupo, sin pelear',
    description,
  },
};

// Colores de la barra del navegador: fondo del tema Día y Noche (tokens.css).
// viewportFit cover: en iPhone la app usa toda la pantalla y las pestañas de
// abajo se corren por encima de la barra de inicio (env(safe-area-inset-*)).
export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFBF6' },
    { media: '(prefers-color-scheme: dark)', color: '#15111F' },
  ],
};

// Antes del primer paint: aplica el tema guardado (sin FOUC) y decide si va la
// animación de inicio: una vez por sesión, nunca con «reducir movimiento».
const themeScript = `var r=document.documentElement;try{var t=localStorage.getItem('lucas-theme');if(t==='dark'||t==='light'){r.dataset.theme=t}}catch(e){}try{if(sessionStorage.getItem('luks-intro')||matchMedia('(prefers-reduced-motion: reduce)').matches){r.classList.add('sin-intro')}else{sessionStorage.setItem('luks-intro','1')}}catch(e){r.classList.add('sin-intro')}`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: script fijo nuestro; aplica el tema antes de pintar */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preload" as="image" href="/brand/luks-logo-animado.svg" type="image/svg+xml" />
      </head>
      <body>
        {/* Animación de inicio: el logo con grabado entra pieza por pieza y se desvanece (solo CSS) */}
        <div className="lu-intro" aria-hidden="true">
          {/* biome-ignore lint/performance/noImgElement: SVG animado con su propio CSS; next/image no lo anima */}
          <img className="lu-intro__img" src="/brand/luks-logo-animado.svg" alt="" />
        </div>
        {/* En desarrollo sin service worker: evita servir páginas viejas de la caché */}
        <SerwistProvider swUrl="/serwist/sw.js" disable={process.env.NODE_ENV === 'development'}>
          <Providers>{children}</Providers>
        </SerwistProvider>
      </body>
    </html>
  );
}
