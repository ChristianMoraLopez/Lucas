'use client';

import type { DotLottie } from '@lottiefiles/dotlottie-react';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

/* Animaciones de LottieFiles (Lottie Simple License) recoloreadas a la paleta
   del kit, para los momentos que importan: vacío, cargando, subiendo,
   procesando, registrado, todo revisado, conectando WhatsApp, cierre de
   evento, sin conexión, no encontrado, buscar sin resultados, transferencia
   y error.
   Fuentes: «Empty» de Ali Azgar, «Scan a receipt» de Musa, «success» de
   Biswajit Rout, «Chat» de Mahendra, «Success» de Mildred, «Money stack» de
   JuanMakes, «coin» de Nook, «success confetti» de Deepesh Reddy,
   «uploading» de Avinash Reddy, «no internet» de Twinkle Sharma, «not found»
   de Tùng Hoàng Hữu, «Money Bag» de Mahendra Bhunwal, «Empty» de Mahmoud
   Madkour, «Money Transfer» de Musa Adanur y «error» de Thais Roese. */
export const LOTTIES = {
  vacio: { loop: true },
  escaneo: { loop: true },
  'gasto-registrado': { loop: false },
  'conectando-whatsapp': { loop: true },
  'whatsapp-conectado': { loop: false },
  'cierre-evento': { loop: false },
  cargando: { loop: true },
  subiendo: { loop: true },
  'todo-revisado': { loop: false },
  'sin-conexion': { loop: true },
  'no-encontrado': { loop: true },
  bienvenida: { loop: true },
  buscar: { loop: true },
  transferencia: { loop: false },
  error: { loop: false },
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

export function Lottie({
  name,
  width,
  height,
  label,
  onLoad,
  alVerse = false,
}: {
  name: LottieName;
  width: number;
  height: number;
  label?: string;
  /** Ya se ve la animación (para quitar lo que la reemplazaba mientras cargaba) */
  onLoad?: () => void;
  /** Arranca cuando aparece en pantalla (y una sola vez), no al montarse */
  alVerse?: boolean;
}) {
  const reduce = usePrefersReducedMotion();
  const [player, setPlayer] = useState<DotLottie | null>(null);
  const [caja, setCaja] = useState<HTMLSpanElement | null>(null);

  // Con movimiento reducido: sin animar, quieto en el último cuadro
  useEffect(() => {
    if (!player || !reduce) return;
    const final = () => player.setFrame(Math.max(0, player.totalFrames - 1));
    if (player.isLoaded) final();
    player.addEventListener('load', final);
    return () => player.removeEventListener('load', final);
  }, [player, reduce]);

  // Avisar cuando ya está lista
  useEffect(() => {
    if (!player || !onLoad) return;
    if (player.isLoaded) onLoad();
    player.addEventListener('load', onLoad);
    return () => player.removeEventListener('load', onLoad);
  }, [player, onLoad]);

  // alVerse: espera a que esté en pantalla para arrancar
  useEffect(() => {
    if (!alVerse || !player || !caja || reduce) return;
    const obs = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          player.play();
          obs.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    obs.observe(caja);
    return () => obs.disconnect();
  }, [alVerse, player, caja, reduce]);

  return (
    <span ref={setCaja} className="lu-lottie-player" role="img" aria-label={label ?? name} style={{ width, height }}>
      <Player src={`/lottie/${name}.lottie`} autoplay={!reduce && !alVerse} loop={LOTTIES[name].loop && !reduce} dotLottieRefCallback={setPlayer} />
    </span>
  );
}
