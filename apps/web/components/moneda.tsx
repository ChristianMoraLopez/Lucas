'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useT } from '@/components/idioma';
import { corto, dinero, type Moneda } from '@/lib/moneda';

const Contexto = createContext<Moneda>('COP');

/** La moneda de la cuenta que se está viendo (fuera de una cuenta, pesos colombianos) */
export function MonedaProvider({ moneda, children }: { moneda: Moneda; children: ReactNode }) {
  return <Contexto.Provider value={moneda}>{children}</Contexto.Provider>;
}

export const useMoneda = () => useContext(Contexto);

/**
 * La plata en la moneda de la cuenta y el idioma de la pantalla:
 * const $ = useDinero(); $.fmt(84300) → «$84.300»; $.corto(412000) → «412 lucas».
 */
export function useDinero(moneda?: Moneda) {
  const deCuenta = useMoneda();
  const { idioma } = useT();
  const m = moneda ?? deCuenta;
  return useMemo(
    () => ({
      moneda: m,
      fmt: (n: number, opts?: { sign?: boolean }) => dinero(n, m, idioma, opts),
      corto: (n: number) => corto(n, m, idioma),
    }),
    [m, idioma],
  );
}
