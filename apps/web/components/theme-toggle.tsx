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
      {theme === 'dark' ? 'Tema día' : 'Tema noche'}
    </Button>
  );
}
