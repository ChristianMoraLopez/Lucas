'use client';

import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext } from 'react';
import { COOKIE_REGION, type Region } from '@/lib/region';

const Contexto = createContext<Region>('CO');

/** La región que decidió el servidor (cookie o navegador) */
export function RegionProvider({ region, children }: { region: Region; children: ReactNode }) {
  return <Contexto.Provider value={region}>{children}</Contexto.Provider>;
}

export const useRegion = () => useContext(Contexto);

/** Cambiar de región: queda en la cookie (un año) y la pantalla se vuelve a pintar */
export function useCambiarRegion() {
  const router = useRouter();
  return useCallback(
    (region: Region) => {
      // biome-ignore lint/suspicious/noDocumentCookie: es una preferencia simple que también lee el servidor
      document.cookie = `${COOKIE_REGION}=${region}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    },
    [router],
  );
}
