'use client';

import { useCallback, useState } from 'react';
import { Lottie, type LottieName } from '@/components/lottie';

/**
 * Un Lottie que, mientras llega (con internet lento puede tardar), muestra
 * algo en su lugar: un giro si lo que pasa es que algo carga, o un punto quieto
 * si es un aviso (sin internet, error). Nunca queda un hueco vacío.
 */
export function LottieOGiro({ name, size, label, respaldo = 'giro' }: { name: LottieName; size: number; label?: string; respaldo?: 'giro' | 'punto' }) {
  const [listo, setListo] = useState(false);
  const alCargar = useCallback(() => setListo(true), []);
  return (
    <span className="lu-lottie-giro" style={{ width: size, height: size }}>
      {!listo && <span className={respaldo === 'giro' ? 'lu-carga__gira' : 'lu-red__punto'} aria-hidden="true" />}
      <Lottie name={name} width={size} height={size} label={label} onLoad={alCargar} />
    </span>
  );
}
