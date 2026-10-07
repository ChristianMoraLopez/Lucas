/* La guía paso a paso: qué se explica en cada pantalla y dónde va la tarjeta.
   Cada paso apunta a un elemento con data-guia="…"; si no está en pantalla, la
   tarjeta sale en el centro (o el paso se salta, si es opcional). */

import type { LottieName } from '@/components/lottie';

export type NombreGuia = 'inicio' | 'cuenta';

export interface PasoGuia {
  /** data-guia del elemento que se resalta; sin objetivo, la tarjeta va al centro */
  objetivo?: string;
  titulo: string;
  texto: string;
  lottie?: LottieName;
  /** Si el elemento no está (p. ej. Presupuesto en un paseo), el paso no sale */
  opcional?: boolean;
}

export const GUIAS: Record<NombreGuia, PasoGuia[]> = {
  inicio: [
    {
      titulo: '¡Hola! Soy Luks 👋',
      texto:
        'Llevo las cuentas para que nadie tenga que hacerlas: la casa de todos los meses, ese paseo con los amigos o tus propios gastos. Te muestro cómo en un minuto.',
      lottie: 'bienvenida',
    },
    {
      objetivo: 'cuentas',
      titulo: 'Tus cuentas',
      texto:
        'Cada cuenta es un grupo de gastos. Un hogar va mes a mes, con presupuesto; un evento (un paseo, una fiesta) se liquida al final. Toca una para entrar.',
    },
    {
      objetivo: 'crear',
      titulo: 'Crea una cuenta',
      texto: 'Ponle nombre y elige si es hogar o evento. Después invitas a los demás con un código o por WhatsApp.',
    },
    {
      objetivo: 'unirse',
      titulo: '¿Te invitaron?',
      texto: 'Si alguien te pasó un código (como PASEO-7K2Q), entras por aquí y eliges tu nombre.',
    },
    {
      titulo: 'Luks vive en WhatsApp',
      texto:
        'Agrega el número de Luks al grupo y manden fotos de recibos, PDFs o mensajes como «hielo 30 lucas». Luks los vuelve gastos, los organiza por categoría y los divide.',
      lottie: 'escaneo',
    },
    {
      titulo: 'También para ti solo',
      texto:
        '¿Tus gastos personales? Arma un grupo de WhatsApp contigo mismo (solo tú y Luks), mándate ahí tus facturas y aquí las ves organizadas por categoría.',
      lottie: 'gasto-registrado',
    },
    {
      objetivo: 'menu',
      titulo: 'El menú',
      texto:
        'Aquí están tu perfil, el idioma, el tema y esta guía, para verla otra vez cuando quieras. Dentro de cada cuenta hay otra que te muestra sus pestañas.',
    },
  ],
  cuenta: [
    {
      titulo: 'Así funciona una cuenta',
      texto: 'Te muestro dónde está cada cosa. Si ya sabes, sáltatelo.',
      lottie: 'todo-revisado',
    },
    {
      objetivo: 'tab-resumen',
      titulo: 'Resumen',
      texto: 'Cuánto llevan gastado, en qué se fue la plata y quién va poniendo más.',
    },
    {
      objetivo: 'whatsapp',
      titulo: 'Conecta el grupo',
      texto: 'Escribe «luks CÓDIGO» en el grupo de WhatsApp y desde ahí lo que manden cae aquí solo. El punto verde dice que Luks está leyendo.',
    },
    {
      objetivo: 'tab-revisar',
      titulo: 'Revisar',
      texto: 'Lo que Luks leyó de las fotos y los mensajes. Confirmas o corriges con un toque. También puedes subir un recibo desde aquí.',
    },
    {
      objetivo: 'tab-gastos',
      titulo: 'Gastos',
      texto: 'Todo lo que entró, con buscador. Abre uno para corregirlo o dividirlo por consumo (quién pidió qué).',
    },
    {
      objetivo: 'tab-presupuestos',
      titulo: 'Presupuesto',
      texto: 'Cuánto quieren gastar al mes, por categoría, y cómo van.',
      opcional: true,
    },
    {
      objetivo: 'tab-liquidar',
      titulo: 'Liquidar',
      texto: 'Quién le paga a quién, con el mínimo de transferencias. Cobra por WhatsApp y, al final, cierren y archiven.',
    },
    {
      objetivo: 'tab-personas',
      titulo: 'Personas',
      texto: 'Quién está en la cuenta. Invita con un código y ponle nombre a quien solo está en WhatsApp.',
    },
    {
      objetivo: 'cuenta',
      titulo: 'Tus otras cuentas',
      texto: 'Toca aquí para volver al inicio o cambiar de cuenta.',
    },
    {
      objetivo: 'menu',
      titulo: '¿Dudas?',
      texto: 'En el menú vuelves a ver esta guía cuando quieras, y cambias el idioma o el tema.',
    },
  ],
};

export type Caja = { top: number; left: number; width: number; height: number };

/** Margen del resaltado alrededor del elemento y separación con la tarjeta */
const HOLGURA = 6;
const SEPARACION = 12;
const BORDE = 16;

/**
 * Dónde van el resaltado y la tarjeta. Sin elemento, el resaltado se cierra en
 * el centro (todo oscuro) y la tarjeta va al centro. Con elemento, la tarjeta
 * va donde haya más espacio (abajo o arriba), sin salirse de la pantalla, y la
 * flechita apunta al centro del elemento.
 */
export function colocar(r: Caja | null, vw: number, vh: number, anchoMax = 360) {
  const ancho = Math.min(anchoMax, vw - 2 * BORDE);
  if (!r) {
    return {
      foco: { top: vh / 2, left: vw / 2, width: 0, height: 0 },
      tarjeta: { left: (vw - ancho) / 2, width: ancho } as { left: number; width: number; top?: number; bottom?: number },
      lado: 'centro' as const,
      flecha: null,
    };
  }
  const foco = { top: r.top - HOLGURA, left: r.left - HOLGURA, width: r.width + 2 * HOLGURA, height: r.height + 2 * HOLGURA };
  const abajo = vh - (foco.top + foco.height);
  const arriba = foco.top;
  const centro = r.left + r.width / 2;
  const left = Math.min(Math.max(centro - ancho / 2, BORDE), vw - BORDE - ancho);
  const flecha = Math.min(Math.max(centro - left, 22), ancho - 22);
  return abajo >= arriba
    ? { foco, tarjeta: { top: foco.top + foco.height + SEPARACION, left, width: ancho }, lado: 'abajo' as const, flecha }
    : { foco, tarjeta: { bottom: vh - foco.top + SEPARACION, left, width: ancho }, lado: 'arriba' as const, flecha };
}

/** El primer elemento visible con ese data-guia (las pestañas existen dos veces: abajo en el celular y al lado en escritorio) */
export function buscarObjetivo(objetivo: string, raiz: ParentNode = document): HTMLElement | null {
  for (const el of raiz.querySelectorAll<HTMLElement>(`[data-guia="${objetivo}"]`)) {
    const r = el.getBoundingClientRect();
    if (el.getClientRects().length > 0 && r.width > 0 && r.height > 0) return el;
  }
  return null;
}
