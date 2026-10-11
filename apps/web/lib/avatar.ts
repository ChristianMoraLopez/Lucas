import { blobatarUri } from 'blobatar/uri';
import type { Tone } from '@/components/lucas-core';

/*
 * La carita de cada persona (blobatar): la forma y los ojos salen del nombre, así
 * que cada quien tiene siempre la misma en la web y en las imágenes que comparte
 * Luks. El color lo pone su tono: el círculo es el tono de Luks y la carita, en
 * tinta oscura del mismo matiz, se lee bien hasta en 24px.
 */

/** El matiz OKLCh (grados) de cada tono de Luks (los hex de tokens.css) */
const MATIZ: Record<Tone, number> = {
  morado: 295,
  naranja: 55,
  azul: 254,
  coral: 13,
  verde: 158,
  amarillo: 84,
  turquesa: 188,
  rosa: 353,
};

export const opcionesCara = (tone: Tone, registered = true) => ({
  background: false as const,
  hue: MATIZ[tone],
  // Quien aún no tiene cuenta va sin círculo y en gris: una carita de tono medio se ve en claro y en oscuro
  tone: registered ? 0.999 : 0.5,
});

const hechas = new Map<string, string>();

/** `data:` URI para `<img>`; las mismas personas se repiten en cada lista, así que se guardan */
export function caraUri(name: string, tone: Tone, registered = true) {
  const clave = `${tone}|${registered ? 1 : 0}|${name}`;
  let uri = hechas.get(clave);
  if (!uri) {
    if (hechas.size > 500) hechas.clear();
    uri = blobatarUri(name, opcionesCara(tone, registered));
    hechas.set(clave, uri);
  }
  return uri;
}
