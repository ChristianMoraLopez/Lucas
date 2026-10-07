import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '@/components/lucas-core';
import { GUIAS } from '@/lib/guia';
import { EN } from './en';
import { crearT, idiomaDe, traducir } from './index';

const RAIZ = join(__dirname, '..', '..');

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.tsx?$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

/** Cada t('…') del código (los textos fijos; los que vienen de una variable van aparte) */
function textosDelCodigo() {
  const textos = new Map<string, string>();
  const re = /\bt\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\$])*)`)/g;
  // lib/i18n tiene ejemplos en los comentarios
  const todos = ['app', 'components', 'lib'].flatMap((d) => archivos(join(RAIZ, d))).filter((a) => !a.includes(join('lib', 'i18n')));
  for (const archivo of todos) {
    for (const m of readFileSync(archivo, 'utf8').matchAll(re)) {
      const crudo = m[1] ?? m[2] ?? m[3];
      const texto = crudo.replace(/\\n/g, '\n').replace(/\\(.)/g, '$1');
      textos.set(texto, archivo.slice(RAIZ.length + 1));
    }
  }
  return textos;
}

const llaves = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('inglés', () => {
  it('cada texto de la web tiene su traducción', () => {
    const faltan = [...textosDelCodigo()].filter(([texto]) => !(texto in EN)).map(([texto, archivo]) => `${archivo}: ${texto}`);
    expect(faltan).toEqual([]);
  });

  it('las guías y las categorías de siempre también', () => {
    const textos = [...Object.values(GUIAS).flatMap((pasos) => pasos.flatMap((p) => [p.titulo, p.texto])), ...Object.keys(CATEGORIES)];
    expect(textos.filter((x) => !(x in EN))).toEqual([]);
  });

  it('las variables {así} están en los dos idiomas', () => {
    const mal = Object.entries(EN).filter(([es, en]) => llaves(es).join() !== llaves(en).join());
    expect(mal).toEqual([]);
  });

  it('sin traducción queda el español, y las variables se llenan', () => {
    expect(traducir('en', 'Esto no tiene traducción')).toBe('Esto no tiene traducción');
    expect(traducir('es', 'Hola, {nombre}', { nombre: 'Vale' })).toBe('Hola, Vale');
    const t = crearT('es');
    expect(t('{n} de {total}', { n: 2, total: 5 })).toBe('2 de 5');
  });

  it('el idioma: el elegido, si no el del navegador, si no español', () => {
    expect(idiomaDe('en', 'es-CO')).toBe('en');
    expect(idiomaDe(undefined, 'en-US,en;q=0.9')).toBe('en');
    expect(idiomaDe(undefined, 'fr-FR,es;q=0.8,en;q=0.5')).toBe('es');
    expect(idiomaDe(undefined, 'fr-FR')).toBe('es');
    expect(idiomaDe('xx', null)).toBe('es');
  });
});
