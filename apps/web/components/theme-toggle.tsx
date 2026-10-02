'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/lucas-ui';

type Theme = 'light' | 'dark';

function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('lucas-theme', next);
    } catch {
      // localStorage no disponible: el tema solo dura esta visita
    }
    setTheme(next);
  };

  return (
    <Button variant="ghost" size="sm" onClick={toggle} aria-label={theme === 'dark' ? 'Cambiar a tema de día' : 'Cambiar a tema de noche'}>
      {/* En celulares angostos queda solo el ícono (ver .lu-theme__txt en app.css) */}
      <svg className="lu-theme__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        {theme === 'dark' ? (
          <>
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
          </>
        ) : (
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        )}
      </svg>
      <span className="lu-theme__txt">{theme === 'dark' ? 'Tema día' : 'Tema noche'}</span>
    </Button>
  );
}
