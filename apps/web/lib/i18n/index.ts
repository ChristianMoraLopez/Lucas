/* Idiomas de Luks: español (el de siempre) e inglés (para Estados Unidos).
   El texto fuente es el español: t('Crear cuenta') devuelve el inglés si la
   persona eligió inglés y, si falta la traducción, el mismo español (nunca un
   hueco). Las variables van entre llaves: t('Hola, {nombre}', { nombre }). */

import { EN } from './en';

export type Idioma = 'es' | 'en';
export const IDIOMAS: Idioma[] = ['es', 'en'];
export const NOMBRE_IDIOMA: Record<Idioma, string> = { es: 'Español', en: 'English' };
/** La cookie donde queda el idioma elegido (la lee el servidor para pintar en ese idioma) */
export const COOKIE_IDIOMA = 'luks-idioma';

export type Vars = Record<string, string | number>;
export type T = ((texto: string, vars?: Vars) => string) & { idioma: Idioma };

export function traducir(idioma: Idioma, texto: string, vars?: Vars): string {
  const base = idioma === 'en' ? (EN[texto] ?? texto) : texto;
  return vars ? base.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : base;
}

export function crearT(idioma: Idioma): T {
  return Object.assign((texto: string, vars?: Vars) => traducir(idioma, texto, vars), { idioma });
}

export const esIdioma = (v: unknown): v is Idioma => v === 'es' || v === 'en';

/**
 * El idioma de la persona: el que eligió (cookie) o, si no ha elegido, el de su
 * navegador (Accept-Language): el primero entre español e inglés. Si no dice, español.
 */
export function idiomaDe(cookie?: string | null, acceptLanguage?: string | null): Idioma {
  if (esIdioma(cookie)) return cookie;
  for (const parte of (acceptLanguage ?? '').split(',')) {
    const codigo = parte.trim().slice(0, 2).toLowerCase();
    if (esIdioma(codigo)) return codigo;
  }
  return 'es';
}

/** «es-CO» / «en-US» para Intl */
export const LOCALE: Record<Idioma, string> = { es: 'es-CO', en: 'en-US' };

/** «1 cuenta» / «3 cuentas»; en inglés, «1 account» / «3 accounts» (las palabras pasan por t) */
export function plural(t: T, n: number, uno: string, varios: string) {
  return `${n} ${t(n === 1 ? uno : varios)}`;
}
