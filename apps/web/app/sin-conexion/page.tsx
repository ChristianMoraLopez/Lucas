import { LogoLink } from '@/components/logo-link';
import { LottieSlot } from '@/components/lucas-ui';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t('Sin conexión')} · Luks` };
}

/** Lo que ve la PWA cuando no hay internet y la página no estaba guardada. */
export default async function SinConexionPage() {
  const t = await getT();
  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
      </header>
      {/* data-sin-conexion: al volver el internet, esta pantalla se recarga sola (components/conexion.tsx) */}
      <div className="ph" data-sin-conexion="">
        <LottieSlot name="sin-conexion" width={120} height={120} label={t('Sin conexión')} />
        <h1 className="lu-title">{t('No hay conexión')}</h1>
        <p className="lu-small lu-muted" style={{ margin: 0, maxWidth: '38ch' }}>
          {t('Cuando vuelva el internet, esta pantalla se recarga sola y Luks sigue donde ibas. Las fotos que mandaron al grupo no se pierden: llegan igual.')}
        </p>
      </div>
    </div>
  );
}
