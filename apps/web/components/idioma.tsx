'use client';

import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useMemo } from 'react';
import { COOKIE_IDIOMA, crearT, type Idioma } from '@/lib/i18n';

const Contexto = createContext<Idioma>('es');

/** El idioma que decidió el servidor (cookie o navegador) para toda la app */
export function IdiomaProvider({ idioma, children }: { idioma: Idioma; children: ReactNode }) {
  return <Contexto.Provider value={idioma}>{children}</Contexto.Provider>;
}

export const useIdioma = () => useContext(Contexto);

/** En un Client Component: const t = useT(); t('Crear cuenta') */
export function useT() {
  const idioma = useIdioma();
  return useMemo(() => crearT(idioma), [idioma]);
}

/** Cambiar de idioma: queda en la cookie (un año) y la pantalla se vuelve a pintar */
export function useCambiarIdioma() {
  const router = useRouter();
  return useCallback(
    (idioma: Idioma) => {
      // biome-ignore lint/suspicious/noDocumentCookie: es una preferencia simple que también lee el servidor
      document.cookie = `${COOKIE_IDIOMA}=${idioma}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = idioma;
      router.refresh();
    },
    [router],
  );
}
