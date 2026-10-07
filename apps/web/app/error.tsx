'use client';

import { ErrorView } from '@/components/error-view';
import { LogoLink } from '@/components/logo-link';
import { MenuPrincipal } from '@/components/menu-principal';

/** Cuando falla una pantalla fuera de una cuenta (inicio, unirse, subir…). */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
        <span className="ap-me">
          <MenuPrincipal sesion={false} />
        </span>
      </header>
      <ErrorView error={error} retry={retry} />
    </div>
  );
}
