'use client';

import { ErrorView } from '@/components/error-view';
import { LogoLink } from '@/components/logo-link';

/** Cuando falla una pantalla fuera de una cuenta (inicio, unirse, subir…). */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
      </header>
      <ErrorView error={error} retry={retry} />
    </div>
  );
}
