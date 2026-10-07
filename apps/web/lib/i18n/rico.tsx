import { Fragment, type ReactNode } from 'react';

/**
 * Un texto traducido con partes que no son texto (negrillas, enlaces):
 * rico(t('Crea una cuenta de {hogar} o de {evento}.'), { hogar: <b>…</b>, evento: <b>…</b> }).
 * Sirve en el servidor y en el navegador.
 */
export function rico(texto: string, partes: Record<string, ReactNode>): ReactNode {
  return texto.split(/(\{\w+\})/g).map((trozo, i) => {
    const llave = trozo.match(/^\{(\w+)\}$/)?.[1];
    // biome-ignore lint/suspicious/noArrayIndexKey: los trozos de un texto fijo no cambian de orden
    return <Fragment key={i}>{llave && llave in partes ? partes[llave] : trozo}</Fragment>;
  });
}
