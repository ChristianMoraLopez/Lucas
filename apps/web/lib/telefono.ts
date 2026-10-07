/* Números de WhatsApp de Colombia (lo de siempre) y del resto de América
   Latina, Estados Unidos y España. Se guardan como WhatsApp los manda: solo
   dígitos, con el indicativo («573001234567»), sin «+».

   WhatsApp no siempre usa el número como lo escribe la gente: en Argentina
   los celulares llevan un 9 después del 54; en México algunas cuentas viejas
   llevan un 1 después del 52; en Brasil algunas no tienen el noveno dígito.
   La forma «canónica» es la que WhatsApp usa hoy; las variantes, las otras
   con las que puede llegar el mismo número (igual que public.wa_canonico y
   public.wa_variantes en la base, migración 260). */

import type { Region } from '@/lib/region';

export interface Pais {
  /** ISO 3166 de dos letras */
  id: string;
  nombre: string;
  bandera: string;
  indicativo: string;
  /** Cuántos dígitos tiene el número sin el indicativo */
  largo: number[];
  /** Cómo se escribe uno (y cómo se agrupan los dígitos al mostrarlo) */
  ejemplo: string;
}

// Colombia primero; después los demás por nombre. Los nombres pasan por t.
export const PAISES: Pais[] = [
  { id: 'CO', nombre: 'Colombia', bandera: '🇨🇴', indicativo: '57', largo: [10], ejemplo: '300 123 4567' },
  { id: 'AR', nombre: 'Argentina', bandera: '🇦🇷', indicativo: '54', largo: [10], ejemplo: '11 2345 6789' },
  { id: 'BO', nombre: 'Bolivia', bandera: '🇧🇴', indicativo: '591', largo: [8], ejemplo: '7123 4567' },
  { id: 'BR', nombre: 'Brasil', bandera: '🇧🇷', indicativo: '55', largo: [11, 10], ejemplo: '11 91234 5678' },
  { id: 'CL', nombre: 'Chile', bandera: '🇨🇱', indicativo: '56', largo: [9], ejemplo: '9 1234 5678' },
  { id: 'CR', nombre: 'Costa Rica', bandera: '🇨🇷', indicativo: '506', largo: [8], ejemplo: '8312 3456' },
  { id: 'CU', nombre: 'Cuba', bandera: '🇨🇺', indicativo: '53', largo: [8], ejemplo: '5123 4567' },
  { id: 'EC', nombre: 'Ecuador', bandera: '🇪🇨', indicativo: '593', largo: [9], ejemplo: '99 123 4567' },
  { id: 'SV', nombre: 'El Salvador', bandera: '🇸🇻', indicativo: '503', largo: [8], ejemplo: '7012 3456' },
  { id: 'ES', nombre: 'España', bandera: '🇪🇸', indicativo: '34', largo: [9], ejemplo: '612 345 678' },
  { id: 'US', nombre: 'Estados Unidos', bandera: '🇺🇸', indicativo: '1', largo: [10], ejemplo: '201 555 0123' },
  { id: 'GT', nombre: 'Guatemala', bandera: '🇬🇹', indicativo: '502', largo: [8], ejemplo: '5123 4567' },
  { id: 'HN', nombre: 'Honduras', bandera: '🇭🇳', indicativo: '504', largo: [8], ejemplo: '9123 4567' },
  { id: 'MX', nombre: 'México', bandera: '🇲🇽', indicativo: '52', largo: [10], ejemplo: '55 1234 5678' },
  { id: 'NI', nombre: 'Nicaragua', bandera: '🇳🇮', indicativo: '505', largo: [8], ejemplo: '8123 4567' },
  { id: 'PA', nombre: 'Panamá', bandera: '🇵🇦', indicativo: '507', largo: [8], ejemplo: '6123 4567' },
  { id: 'PY', nombre: 'Paraguay', bandera: '🇵🇾', indicativo: '595', largo: [9], ejemplo: '961 456 789' },
  { id: 'PE', nombre: 'Perú', bandera: '🇵🇪', indicativo: '51', largo: [9], ejemplo: '912 345 678' },
  { id: 'PR', nombre: 'Puerto Rico', bandera: '🇵🇷', indicativo: '1', largo: [10], ejemplo: '787 234 5678' },
  { id: 'DO', nombre: 'República Dominicana', bandera: '🇩🇴', indicativo: '1', largo: [10], ejemplo: '809 234 5678' },
  { id: 'UY', nombre: 'Uruguay', bandera: '🇺🇾', indicativo: '598', largo: [8], ejemplo: '94 231 234' },
  { id: 'VE', nombre: 'Venezuela', bandera: '🇻🇪', indicativo: '58', largo: [10], ejemplo: '412 123 4567' },
];

const POR_ID = new Map(PAISES.map((p) => [p.id, p]));
export const pais = (id: string) => POR_ID.get(id) ?? PAISES[0];

/** El país del teléfono según la región elegida (Colombia si no) */
export const paisDeRegion = (r: Region): string => r;

/** «549…» con el 9 de los celulares de Argentina, «52…» sin el 1 viejo de México, Brasil con el noveno dígito */
export function canonico(wa: string): string {
  if (wa.startsWith('lid:')) return wa;
  if (/^521\d{10}$/.test(wa)) return `52${wa.slice(3)}`;
  if (/^54[1-8]\d{9}$/.test(wa)) return `549${wa.slice(2)}`;
  if (/^55[1-9][1-9][6-9]\d{7}$/.test(wa)) return `55${wa.slice(2, 4)}9${wa.slice(4)}`;
  return wa;
}

/** Las formas en que WhatsApp puede mandar el mismo número (la canónica primero) */
export function variantes(wa: string): string[] {
  const c = canonico(wa);
  const out = [c];
  if (/^52\d{10}$/.test(c)) out.push(`521${c.slice(2)}`);
  if (/^55[1-9][1-9]9\d{8}$/.test(c)) out.push(`55${c.slice(2, 4)}${c.slice(5)}`);
  return out;
}

/**
 * Lo que alguien escribe → el número de WhatsApp, o null si no se entiende.
 * Con el país elegido: «300 123 4567» en Colombia → «573001234567»; con «+»
 * (o con el indicativo y el largo justo) se toma como número internacional.
 */
export function normalizar(texto: string, paisId = 'CO'): string | null {
  const p = pais(paisId);
  const internacional = texto.trim().startsWith('+') || texto.trim().startsWith('00');
  let d = texto.replace(/\D/g, '');
  if (texto.trim().startsWith('00')) d = d.slice(2);
  if (!d) return null;
  if (!internacional) {
    // El 0 de las llamadas nacionales («011…», «09…»)
    if (d.startsWith('0') && p.largo.includes(d.length - 1)) d = d.slice(1);
    if (p.largo.includes(d.length)) return canonico(p.indicativo + d);
    // Ya trae el indicativo del país elegido
    if (d.startsWith(p.indicativo) && p.largo.includes(d.length - p.indicativo.length)) return canonico(d);
    // Argentina con el 9 o con el «15» de antes: «9 11 2345 6789»
    if (p.id === 'AR' && d.length === 11 && d.startsWith('9')) return canonico(`54${d}`);
  }
  return /^\d{8,15}$/.test(d) ? canonico(d) : null;
}

/** El país de un número completo (el indicativo más largo que coincide) */
export function paisDe(wa: string): Pais | null {
  let mejor: Pais | null = null;
  for (const p of PAISES) {
    if (wa.startsWith(p.indicativo) && (!mejor || p.indicativo.length > mejor.indicativo.length)) mejor = p;
  }
  // +1: Estados Unidos, Puerto Rico y República Dominicana comparten indicativo
  if (mejor?.indicativo === '1') {
    const area = wa.slice(1, 4);
    if (['787', '939'].includes(area)) return pais('PR');
    if (['809', '829', '849'].includes(area)) return pais('DO');
    return pais('US');
  }
  return mejor;
}

/** «573001234567» → «+57 300 123 4567»; «lid:…» → null (WhatsApp no mostró el número) */
export function formatear(wa: string | null | undefined): string | null {
  if (!wa || wa.startsWith('lid:')) return null;
  const p = paisDe(wa);
  if (!p) return `+${wa}`;
  let nacional = wa.slice(p.indicativo.length);
  // Argentina: «+54 9 11 2345 6789»
  let prefijo = '';
  if (p.id === 'AR' && nacional.length === 11 && nacional.startsWith('9')) {
    prefijo = '9 ';
    nacional = nacional.slice(1);
  }
  if (!p.largo.includes(nacional.length)) return `+${p.indicativo} ${prefijo}${nacional}`;
  // Se agrupa como el ejemplo del país (en Brasil, según si tiene el noveno dígito)
  const grupos = p.ejemplo.split(' ').map((g) => g.length);
  if (p.id === 'BR' && nacional.length === 10) grupos.splice(1, 1, 4);
  const partes: string[] = [];
  let i = 0;
  for (const g of grupos) {
    partes.push(nacional.slice(i, i + g));
    i += g;
  }
  if (i < nacional.length) partes.push(nacional.slice(i));
  return `+${p.indicativo} ${prefijo}${partes.filter(Boolean).join(' ')}`;
}
