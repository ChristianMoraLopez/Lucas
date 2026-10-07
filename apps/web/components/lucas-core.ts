/* Luks — funciones puras del sistema de diseño (sin React). Viven aparte de
   lucas-ui.tsx, que es 'use client', para poder usarlas en Server Components.
   Mismo comportamiento que lucas-design-kit/components/lucas-ui.jsx. */

export type Tone = 'morado' | 'naranja' | 'azul' | 'coral' | 'verde' | 'amarillo' | 'turquesa' | 'rosa';

/** Pesos colombianos: 84300 → "$84.300" (en inglés, "$84,300") */
export function formatCOP(n: number, { sign = false, idioma = 'es' }: { sign?: boolean; idioma?: 'es' | 'en' } = {}) {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, idioma === 'en' ? ',' : '.');
  return (v < 0 ? '−' : sign && v > 0 ? '+' : '') + '$' + s;
}

/** "412 lucas" — la forma de decirlo en voz alta (miles de pesos); en inglés, "$412K" */
export function lucas(n: number, idioma: 'es' | 'en' = 'es') {
  const k = Math.abs(Number(n) || 0) / 1000;
  if (idioma === 'en') {
    return k >= 1000 ? `$${(k / 1000).toFixed(1).replace('.0', '')}M` : `$${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return k >= 1000
    ? (k / 1000).toFixed(1).replace('.0', '').replace('.', ',') + ' palos'
    : (Number.isInteger(k) ? k : k.toFixed(1).replace('.', ',')) + ' lucas';
}

/* ---------- tonos: personas y categorías ---------- */
export const TONES: Tone[] = ['morado', 'naranja', 'azul', 'coral', 'verde', 'amarillo', 'turquesa', 'rosa'];
const TONE_MAP: Partial<Record<string, Tone>> = {};

/** Fija el tono de cada persona de una cuenta: setTones({ Valeria: 'morado', ... }) */
export function setTones(map: Record<string, Tone>) {
  Object.assign(TONE_MAP, map);
}

export function toneFor(name: string): Tone {
  const fijo = TONE_MAP[name];
  if (fijo) return fijo;
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

// Las 17 de siempre: mismas letras y tonos que public.default_categories (migración 110)
export const CATEGORIES: Record<string, [string, Tone]> = {
  Transporte: ['T', 'azul'],
  Hospedaje: ['H', 'turquesa'],
  Restaurante: ['R', 'coral'],
  Café: ['C', 'naranja'],
  Mercado: ['M', 'verde'],
  Licor: ['L', 'morado'],
  Ocio: ['O', 'azul'],
  Salud: ['S', 'verde'],
  Belleza: ['B', 'rosa'],
  Servicios: ['S', 'amarillo'],
  Hogar: ['H', 'amarillo'],
  Mascotas: ['M', 'naranja'],
  Educación: ['E', 'morado'],
  Ropa: ['R', 'turquesa'],
  Deporte: ['D', 'coral'],
  Regalos: ['R', 'rosa'],
  Otros: ['O', 'rosa'],
};

/** El nombre de una categoría para mostrar: las de siempre pasan por el idioma; las propias, como las escribieron */
export function nombreCategoria(name: string, t: (texto: string) => string) {
  return name in CATEGORIES ? t(name) : name;
}

/* ---------- códigos de invitación: PASEO-7K2Q ---------- */
export const CODE_RE = /^[A-Z]{3,8}-[A-Z0-9]{4}$/;

/** Formatea mientras se escribe. Si pegan el link completo, saca el código. */
export function formatCode(raw: string) {
  const up = String(raw).toUpperCase();
  const link = up.match(/[A-Z]{3,8}-[A-Z0-9]{4}/);
  if (link) return link[0];
  const s = up.replace(/[^A-Z0-9-]/g, '');
  const [a = '', b] = s.split('-');
  if (b != null) return a.slice(0, 8) + '-' + b.replace(/-/g, '').slice(0, 4);
  return a.slice(0, 13);
}
