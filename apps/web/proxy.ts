import type { NextRequest } from 'next/server';
import { updateSession } from '@/utils/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Fuera del proxy: estáticos, animaciones Lottie, los GIF de Chepito (.mp4, los baja Mister Luks sin sesión), íconos y archivos de la PWA (manifest y service worker)
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|fonts/|lottie/|icons/|serwist/|manifest.webmanifest|sin-conexion|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2|lottie|mp4)$).*)',
  ],
};
