'use client';

import { useEffect, useState } from 'react';

/**
 * La pantalla mientras llega otra (loading.tsx). Si tarda, dice que la
 * conexión está lenta; si tarda mucho, ofrece volver a intentar.
 */
export function CargandoPantalla({ pagina = false }: { pagina?: boolean }) {
  const [paso, setPaso] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    const a = window.setTimeout(() => setPaso(1), 4_000);
    const b = window.setTimeout(() => setPaso(2), 20_000);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, []);
  return (
    <div className={`lu-carga${pagina ? ' lu-carga--pagina' : ''}`} role="status">
      <span className="lu-carga__fila">
        <span className="lu-carga__gira" aria-hidden="true" />
        <span>Cargando…</span>
      </span>
      {paso === 1 && <span className="lu-small lu-muted">La conexión está lenta: ya casi.</span>}
      {paso === 2 && (
        <>
          <span className="lu-small lu-muted">Sigue cargando. Si no aparece, revisa tu internet.</span>
          <button type="button" className="lu-btn lu-btn--sm lu-btn--secondary" onClick={() => window.location.reload()}>
            Volver a intentar
          </button>
        </>
      )}
    </div>
  );
}
