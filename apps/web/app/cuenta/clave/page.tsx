import { LogoLink } from '@/components/logo-link';
import { requireUser } from '@/utils/supabase/server';
import { NewPasswordForm } from './new-password-form';

/** Aquí llega el enlace de «¿Olvidaste tu contraseña?» (ya con sesión) o quien quiera cambiarla. */
export default async function NuevaClavePage() {
  await requireUser('/cuenta/clave');
  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
      </header>
      <div className="nc">
        <div className="ap-intro">
          <h1 className="lu-display">Contraseña nueva</h1>
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            Mínimo 8 caracteres. Con ella entras desde cualquier celular o computador.
          </p>
        </div>
        <NewPasswordForm />
      </div>
    </div>
  );
}
