import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tone } from '@/components/lucas-core';

/* Lo común de las imágenes que genera Luks (next/og): la de las cuentas
   (vista previa del link) y las historias de Instagram. */

export const C = {
  papel: '#FFFBF6',
  tinta: '#1C1433',
  tinta2: '#625A78',
  borde: '#E6DEEE',
  verde: '#0A7A4C',
  verdeSuave: '#DDF7EA',
  morado: '#6A35E6',
  moradoSuave: '#ECE4FF',
  amarillo: '#FFC53D',
};
export const TONOS: Record<Tone, string> = {
  morado: '#B79CFF',
  naranja: '#FF9A4D',
  azul: '#7DB8FF',
  coral: '#FF8A99',
  verde: '#2BD48A',
  amarillo: '#FFC53D',
  turquesa: '#3FD6CC',
  rosa: '#FF8FC0',
};

// Las fuentes de Luks en TTF estático (la imagen no lee woff2 ni fuentes variables).
// Rutas fijas: así el build incluye solo estos archivos y no todo el proyecto.
let recursos: Promise<Buffer[]> | null = null;
export const cargar = () => {
  recursos ??= Promise.all([
    readFile(join(process.cwd(), 'assets', 'og', 'Figtree-600.ttf')),
    readFile(join(process.cwd(), 'assets', 'og', 'Figtree-800.ttf')),
    readFile(join(process.cwd(), 'assets', 'og', 'Bricolage-800.ttf')),
    readFile(join(process.cwd(), 'public', 'brand', 'luks-logo-plano.svg')),
  ]).catch((e) => {
    recursos = null;
    throw e;
  });
  return recursos;
};

/** Las fuentes de la imagen no traen emojis: se quitan para que no salgan cuadritos */
export const limpio = (s: string, max = 40) => {
  const t = s
    .replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}|\u{20E3}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t || 'Alguien';
};
export const inicial = (n: string) => n.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?';

/** Las fuentes de Luks para ImageResponse */
export const FUENTES = (figtree600: Buffer, figtree800: Buffer, bricolage800: Buffer) => [
  { name: 'Figtree', data: figtree600, weight: 600 as const, style: 'normal' as const },
  { name: 'Figtree', data: figtree800, weight: 800 as const, style: 'normal' as const },
  { name: 'Bricolage', data: bricolage800, weight: 800 as const, style: 'normal' as const },
];
