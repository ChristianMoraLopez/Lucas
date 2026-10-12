'use client';

/* El movimiento de Luks con Motion (motion/react), con las reglas del kit:
   todo entre 150 y 250 ms (--dur-*), con sus curvas (--ease-out, --ease-pop),
   sin bucles decorativos, y con «reducir movimiento» nada se desplaza
   (reducedMotion="user": solo cambia la opacidad).

   Motion es para lo que el CSS no hace: lo que sale de una lista y la píldora
   que se desliza entre pestañas. Lo que entra al cargar (una pantalla, las
   secciones de la guía) va en CSS (.lu-pantalla, .lu-al-verse en app.css):
   así nada queda escondido mientras llega el JavaScript. */

import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import type { ReactNode } from 'react';

export const DUR = { fast: 0.15, base: 0.2, slow: 0.25 } as const;
export const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;
export const EASE_POP = [0.3, 1.6, 0.5, 1] as const;

export function MovimientoProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: DUR.base, ease: EASE_OUT }}>
      {children}
    </MotionConfig>
  );
}

/**
 * Una lista cuyos elementos salen con gracia cuando se van (un número
 * identificado, un grupo desconectado, una invitación aceptada) y los demás
 * se acomodan solos. Lo que ya estaba al abrir la pantalla no se anima.
 */
export function ListaAnimada({ children }: { children: ReactNode }) {
  return <AnimatePresence initial={false}>{children}</AnimatePresence>;
}

/**
 * Un elemento de ListaAnimada: un <li>, o un <div> que envuelve algo que ya
 * entra con su propia animación CSS (si Motion animara ese mismo elemento, la
 * animación CSS le ganaría y la salida no se vería).
 */
export function ItemAnimado({ children, className, as = 'li' }: { children: ReactNode; className?: string; as?: 'li' | 'div' }) {
  const M = as === 'li' ? motion.li : motion.div;
  return (
    <M
      layout="position"
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: DUR.fast } }}
    >
      {children}
    </M>
  );
}
