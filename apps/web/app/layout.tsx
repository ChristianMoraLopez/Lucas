import { SerwistProvider } from '@serwist/turbopack/react';
import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import '@/styles/tokens.css';
import '@/styles/lucas.css';
import '@/styles/app.css';

export const metadata: Metadata = {
  title: 'Lucas — cuentas compartidas',
  description: 'Lucas vuelve gastos lo que mandan al grupo de WhatsApp: fotos de recibos, PDFs y mensajes, clasificados y divididos.',
  applicationName: 'Lucas',
  appleWebApp: { capable: true, title: 'Lucas', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

// Colores de la barra del navegador: fondo del tema Día y Noche (tokens.css)
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFBF6' },
    { media: '(prefers-color-scheme: dark)', color: '#15111F' },
  ],
};

// Antes del primer paint: aplica el tema guardado para evitar FOUC.
const themeScript = `try{var t=localStorage.getItem('lucas-theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t}}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: script fijo nuestro; aplica el tema antes de pintar */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {/* En desarrollo sin service worker: evita servir páginas viejas de la caché */}
        <SerwistProvider swUrl="/serwist/sw.js" disable={process.env.NODE_ENV === 'development'}>
          <Providers>{children}</Providers>
        </SerwistProvider>
      </body>
    </html>
  );
}
