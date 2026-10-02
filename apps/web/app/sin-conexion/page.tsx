import { LogoLink } from '@/components/logo-link';
import { LottieSlot } from '@/components/lucas-ui';

export const metadata = { title: 'Sin conexión · Luks' };

/** Lo que ve la PWA cuando no hay internet y la página no estaba guardada. */
export default function SinConexionPage() {
  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
      </header>
      <div className="ph">
        <LottieSlot name="sin-conexion" width={120} height={120} label="Sin conexión" />
        <h1 className="lu-title">No hay conexión</h1>
        <p className="lu-small lu-muted" style={{ margin: 0, maxWidth: '38ch' }}>
          Cuando vuelva el internet, Luks sigue donde ibas. Las fotos que mandaron al grupo no se pierden: llegan igual.
        </p>
      </div>
    </div>
  );
}
