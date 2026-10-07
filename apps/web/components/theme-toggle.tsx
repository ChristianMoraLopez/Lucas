'use client';

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/components/idioma';
import { Button } from '@/components/lucas-ui';

export type Theme = 'light' | 'dark';

function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** El tema actual y cómo cambiarlo (queda guardado en este navegador) */
export function useTema() {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    setTheme(currentTheme());
  }, []);
  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('lucas-theme', next);
    } catch {
      // localStorage no disponible: el tema solo dura esta visita
    }
    setTheme(next);
  }, []);
  return [theme, toggle] as const;
}

export function IconoTema({ theme, className }: { theme: Theme; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      {theme === 'dark' ? (
        <>
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
        </>
      ) : (
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
      )}
    </svg>
  );
}

export function ThemeToggle() {
  const t = useT();
  const [theme, toggle] = useTema();
  return (
    <Button variant="ghost" size="sm" onClick={toggle} aria-label={theme === 'dark' ? t('Cambiar a tema de día') : t('Cambiar a tema de noche')}>
      {/* En celulares angostos queda solo el ícono (ver .lu-theme__txt en app.css) */}
      <IconoTema theme={theme} className="lu-theme__icon" />
      <span className="lu-theme__txt">{theme === 'dark' ? t('Tema día') : t('Tema noche')}</span>
    </Button>
  );
}
