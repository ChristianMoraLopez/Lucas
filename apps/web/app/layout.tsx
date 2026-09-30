import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import '@/styles/tokens.css';
import '@/styles/lucas.css';
import '@/styles/app.css';

export const metadata: Metadata = {
  title: 'Lucas — cuentas compartidas',
  description: 'Lucas vuelve gastos lo que mandan al grupo de WhatsApp: fotos de recibos, PDFs y mensajes, clasificados y divididos.',
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
