'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/components/idioma';
import { LottieOGiro } from '@/components/lottie-o-giro';

/**
 * La pantalla mientras llega otra (loading.tsx): la pila de monedas de
 * «cargando». Si tarda, dice que la conexión está lenta; si tarda mucho,
 * cambia a «sin conexión» y ofrece volver a intentar.
 */
export function CargandoPantalla({ pagina = false }: { pagina?: boolean }) {
  const t = useT();
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
      {paso === 2 ? (
        <LottieOGiro key="sin" name="sin-conexion" size={96} label={t('La conexión no responde')} />
      ) : (
        <LottieOGiro key="cargando" name="cargando" size={80} label={t('Cargando')} />
      )}
      <span>{paso === 2 ? t('Sigue cargando…') : t('Cargando…')}</span>
      {paso === 1 && <span className="lu-small lu-muted lu-carga__nota">{t('La conexión está lenta: ya casi.')}</span>}
      {paso === 2 && (
        <>
          <span className="lu-small lu-muted lu-carga__nota">{t('Si no aparece, revisa tu internet.')}</span>
          <button type="button" className="lu-btn lu-btn--sm lu-btn--secondary" onClick={() => window.location.reload()}>
            {t('Volver a intentar')}
          </button>
        </>
      )}
    </div>
  );
}
