'use client';

import type { DotLottie } from '@lottiefiles/dotlottie-react';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

/* Animaciones de LottieFiles (Lottie Simple License) recoloreadas a la paleta
   del kit. Solo para los momentos que el kit reserva: vacío, procesando,
   registrado, conectando WhatsApp y cierre de evento.
   Fuentes: «Empty» de Ali Azgar, «Scan a receipt» de Musa, «success» de
   Biswajit Rout, «Chat» de Mahendra, «Success» de Mildred y «Money stack» de
   JuanMakes. */
export const LOTTIES = {
  vacio: { loop: true },
  escaneo: { loop: true },
  'gasto-registrado': { loop: false },
  'conectando-whatsapp': { loop: true },
  'whatsapp-conectado': { loop: false },
  'cierre-evento': { loop: false },
} as const;
export type LottieName = keyof typeof LOTTIES;

export const isLottieName = (name: string): name is LottieName => name in LOTTIES;

// El reproductor (WASM) se carga solo en el navegador y solo cuando hace falta
const Player = dynamic(
  async () => {
    const mod = await import('@lottiefiles/dotlottie-react');
    mod.setWasmUrl('/lottie/dotlottie-player.wasm');
    return mod.DotLottieReact;
  },
  { ssr: false },
);

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(q.matches);
    const on = () => setReduce(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return reduce;
}

export function Lottie({ name, width, height, label }: { name: LottieName; width: number; height: number; label?: string }) {
  const reduce = usePrefersReducedMotion();
  const [player, setPlayer] = useState<DotLottie | null>(null);

  // Con movimiento reducido: sin animar, quieto en el último cuadro
  useEffect(() => {
    if (!player || !reduce) return;
    const final = () => player.setFrame(Math.max(0, player.totalFrames - 1));
    if (player.isLoaded) final();
    player.addEventListener('load', final);
    return () => player.removeEventListener('load', final);
  }, [player, reduce]);

  return (
    <span className="lu-lottie-player" role="img" aria-label={label ?? name} style={{ width, height }}>
      <Player src={`/lottie/${name}.lottie`} autoplay={!reduce} loop={LOTTIES[name].loop && !reduce} dotLottieRefCallback={setPlayer} />
    </span>
  );
}
