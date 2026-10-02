'use client';

import Link from 'next/link';
import { Logo } from './lucas-ui';

// Los toques se cuentan aquí (no en el componente): el primero ya navega y los
// siguientes caen en el logo de la página nueva
let toques: number[] = [];
let svgAnimado: Promise<string> | null = null;

/**
 * Vuelve a mostrar la animación de inicio (el overlay .lu-intro de
 * app/layout.tsx). El SVG animado se pide una vez y cada vez se usa con una URL
 * nueva (blob:): así la animación de adentro arranca de cero.
 */
export async function playIntro() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const intro = document.querySelector<HTMLElement>('.lu-intro');
  const img = intro?.querySelector<HTMLImageElement>('.lu-intro__img');
  if (!intro || !img) return;
  svgAnimado ??= fetch('/brand/luks-logo-animado.svg').then((r) => r.text());
  let url: string;
  try {
    url = URL.createObjectURL(new Blob([await svgAnimado], { type: 'image/svg+xml' }));
  } catch {
    svgAnimado = null;
    return;
  }
  const anterior = img.src;
  img.src = url;
  // Reinicia la salida del overlay (lu-intro-salir) y lo muestra otra vez
  intro.style.animation = 'none';
  document.documentElement.classList.remove('sin-intro');
  void intro.offsetWidth;
  intro.style.animation = '';
  intro.addEventListener(
    'animationend',
    () => {
      document.documentElement.classList.add('sin-intro');
      if (anterior.startsWith('blob:')) URL.revokeObjectURL(anterior);
    },
    { once: true },
  );
}

/**
 * El logo de arriba: un toque lleva a todas las cuentas; tres toques seguidos
 * repiten la animación del logo.
 */
export function LogoLink({ size }: { size?: number }) {
  return (
    <Link
      href="/"
      className="lu-logo-link"
      aria-label="Luks: ir a mis cuentas"
      onClick={() => {
        const ahora = Date.now();
        toques = [...toques.filter((t) => ahora - t < 900), ahora];
        if (toques.length >= 3) {
          toques = [];
          void playIntro();
        }
      }}
    >
      <Logo size={size} />
    </Link>
  );
}
