/* Mister Luks: el número propio de Luks (WhatsApp Business, vinculado al
   servidor como «contador»). La pantalla de WhatsApp muestra el número que está
   conectado (whatsapp_overview); este es el de la guía (/guia) y sus archivos,
   que se generan una vez (scripts/guia-archivos.mjs) y no consultan la base. */

import type { Idioma } from '@/lib/i18n';

export const MISTER_LUKS = { nombre: 'Mister Luks', telefono: '573337627471' } as const;

/** El contacto para guardar (.vcf): sale con el nombre «Mister Luks» */
export function vcard(telefono: string): string {
  return ['BEGIN:VCARD', 'VERSION:3.0', 'N:Luks;Mister;;;', `FN:${MISTER_LUKS.nombre}`, `TEL;TYPE=CELL:+${telefono}`, 'END:VCARD', ''].join('\n');
}

export const vcardHref = (telefono: string) => `data:text/vcard;charset=utf-8,${encodeURIComponent(vcard(telefono))}`;

/** Abre el chat con Mister Luks con el saludo ya escrito */
export const chatHref = (telefono: string, saludo: string) => `https://wa.me/${telefono}?text=${encodeURIComponent(saludo)}`;

/** La guía en imagen (vertical, para mandar por WhatsApp) y en PDF, en public/guia/ */
export const archivosGuia = (idioma: Idioma) => ({ imagen: `/guia/luks-guia-${idioma}.png`, pdf: `/guia/luks-guia-${idioma}.pdf` });
