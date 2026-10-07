'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useCambiarIdioma, useIdioma, useT } from '@/components/idioma';
import { Avatar } from '@/components/lucas-ui';
import { useCambiarRegion, useRegion } from '@/components/region';
import { IconoTema, useTema } from '@/components/theme-toggle';
import { esIdioma, IDIOMAS, NOMBRE_IDIOMA } from '@/lib/i18n';
import { NOMBRE_MONEDA } from '@/lib/moneda';
import { esRegion, REGION, REGIONES } from '@/lib/region';
import { createClient } from '@/utils/supabase/client';

/** La guía de la pantalla escucha este evento (components/guia.tsx) */
export const EVENTO_GUIA = 'luks:guia';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const ICONOS = {
  guia: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle {...P} cx="12" cy="12" r="9" />
      <path {...P} d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.4M12 17h.01" />
    </svg>
  ),
  idioma: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle {...P} cx="12" cy="12" r="9" />
      <path {...P} d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </svg>
  ),
  region: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...P} d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle {...P} cx="12" cy="10" r="2.5" />
    </svg>
  ),
  salir: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...P} d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />
    </svg>
  ),
};

/**
 * El menú de arriba (☰): tu perfil, la guía de esta pantalla, el idioma, el
 * tema y cerrar sesión. Sin sesión (login, link público) quedan idioma y tema.
 * Las tres rayas se vuelven una X al abrir.
 */
export function MenuPrincipal({ sesion = true, nombre, guia = false }: { sesion?: boolean; nombre?: string; guia?: boolean }) {
  const t = useT();
  const idioma = useIdioma();
  const cambiarIdioma = useCambiarIdioma();
  const region = useRegion();
  const cambiarRegion = useCambiarRegion();
  const [tema, alternarTema] = useTema();
  const [abierto, setAbierto] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const router = useRouter();

  const salir = async () => {
    setSaliendo(true);
    await createClient().auth.signOut();
    router.push('/login');
    router.refresh();
  };

  let n = 0;
  const orden = () => ({ '--i': n++ }) as React.CSSProperties;

  return (
    <Menu.Root open={abierto} onOpenChange={setAbierto} modal={false}>
      <Menu.Trigger asChild>
        <button type="button" className={`mn-boton${abierto ? ' is-abierto' : ''}`} aria-label={t('Menú')} data-guia="menu">
          <span className="mn-rayas" aria-hidden="true">
            <i className="mn-raya" />
            <i className="mn-raya" />
            <i className="mn-raya" />
          </span>
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="mn" align="end" sideOffset={8} collisionPadding={12} loop>
          {sesion && (
            <Menu.Item asChild>
              <Link href="/perfil" className="mn-item mn-item--perfil" style={orden()}>
                <Avatar name={nombre || t('Tú')} size="sm" />
                <span className="mn-perfil">
                  <b>{nombre || t('Tu perfil')}</b>
                  <small>{t('Tu perfil y tus datos')}</small>
                </span>
              </Link>
            </Menu.Item>
          )}
          {sesion && guia && (
            <Menu.Item className="mn-item" style={orden()} onSelect={() => window.dispatchEvent(new Event(EVENTO_GUIA))}>
              {ICONOS.guia}
              {t('Guía de esta pantalla')}
            </Menu.Item>
          )}
          {sesion && <Menu.Separator className="mn-sep" />}

          <Menu.Label className="mn-label" style={orden()}>
            {ICONOS.idioma}
            {t('Idioma')}
          </Menu.Label>
          <Menu.RadioGroup value={idioma} onValueChange={(v) => esIdioma(v) && cambiarIdioma(v)}>
            {IDIOMAS.map((i) => (
              <Menu.RadioItem key={i} value={i} className="mn-item mn-radio" style={orden()} onSelect={(e) => e.preventDefault()}>
                <span className="mn-codigo" aria-hidden="true">
                  {i.toUpperCase()}
                </span>
                <span lang={i}>{NOMBRE_IDIOMA[i]}</span>
                <Menu.ItemIndicator className="mn-check">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path {...P} d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
          <Menu.Separator className="mn-sep" />

          <Menu.Label className="mn-label" style={orden()}>
            {ICONOS.region}
            {t('Región y moneda')}
          </Menu.Label>
          <Menu.RadioGroup value={region} onValueChange={(v) => esRegion(v) && cambiarRegion(v)}>
            {REGIONES.map((r) => (
              <Menu.RadioItem key={r} value={r} className="mn-item mn-radio" style={orden()} onSelect={(e) => e.preventDefault()}>
                <span className="mn-codigo mn-codigo--bandera" aria-hidden="true">
                  {REGION[r].bandera}
                </span>
                <span className="mn-region">
                  {t(REGION[r].nombre)}
                  <small>{t(NOMBRE_MONEDA[REGION[r].moneda])}</small>
                </span>
                <Menu.ItemIndicator className="mn-check">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path {...P} d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
          <Menu.Separator className="mn-sep" />

          <Menu.Item
            className="mn-item"
            style={orden()}
            onSelect={(e) => {
              e.preventDefault();
              alternarTema();
            }}
          >
            <IconoTema theme={tema} />
            {tema === 'dark' ? t('Tema día') : t('Tema noche')}
          </Menu.Item>

          {sesion && (
            <>
              <Menu.Separator className="mn-sep" />
              <Menu.Item className="mn-item mn-item--salir" style={orden()} disabled={saliendo} onSelect={salir}>
                {ICONOS.salir}
                {saliendo ? t('Saliendo…') : t('Cerrar sesión')}
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
