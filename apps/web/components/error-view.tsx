'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button, LottieSlot } from '@/components/lucas-ui';

/**
 * Lo que se ve cuando una pantalla falla (app/error.tsx y el de cada cuenta):
 * la animación de error, qué pasó en palabras y cómo seguir. `retry` vuelve a
 * pedir los datos y a pintar solo esa parte (Next 16).
 */
export function ErrorView({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="nf">
      <LottieSlot name="error" width={120} height={120} label="Error" />
      <h1 className="lu-display">Algo salió mal</h1>
      <p className="lu-small lu-muted" style={{ margin: 0, maxWidth: '42ch' }}>
        No pudimos cargar esta pantalla. Puede ser la conexión; intenta otra vez en un momento.
      </p>
      <div className="nf-btns">
        <Button onClick={() => retry()}>Intentar otra vez</Button>
        <Link href="/" className="lu-btn lu-btn--secondary">
          Ir a mis cuentas
        </Link>
      </div>
      {error.digest && <span className="lu-small lu-muted">Código del error: {error.digest}</span>}
    </main>
  );
}
