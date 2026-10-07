'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lanzarChispas } from '@/components/chispas';
import { useT } from '@/components/idioma';
import { Button, LottieSlot } from '@/components/lucas-ui';
import { EVENTO_GUIA } from '@/components/menu-principal';
import { buscarObjetivo, type Caja, colocar, GUIAS, type NombreGuia, type PasoGuia } from '@/lib/guia';
import { createClient } from '@/utils/supabase/client';

// En este navegador, por usuario: si otra persona ya la vio en el mismo celular, a ti igual te sale
const VISTA = (nombre: NombreGuia, usuario: string) => `luks-guia-${nombre}-${usuario}`;

function yaLaVio(nombre: NombreGuia, usuario: string) {
  try {
    return localStorage.getItem(VISTA(nombre, usuario)) === '1';
  } catch {
    return false;
  }
}

/** Vista (o saltada): no vuelve a salir sola, ni en este navegador ni en otro */
function marcarVista(nombre: NombreGuia, usuario: string) {
  try {
    localStorage.setItem(VISTA(nombre, usuario), '1');
  } catch {
    // sin almacenamiento: queda en la base
  }
  createClient()
    .rpc('marcar_guia', { p_guia: nombre })
    .then(
      () => {},
      () => {},
    );
}

/** «Ver las guías otra vez» (Perfil): que vuelvan a salir solas en este navegador */
export function olvidarGuias(usuario: string) {
  try {
    for (const nombre of Object.keys(GUIAS) as NombreGuia[]) localStorage.removeItem(VISTA(nombre, usuario));
  } catch {
    // sin almacenamiento: no había nada guardado
  }
}

/**
 * La guía paso a paso de esa pantalla. Sale sola la primera vez (`auto`);
 * después, desde el menú de arriba (☰ → Guía de esta pantalla). Se salta cuando quieran.
 */
export function Guia({ nombre, usuario, auto = false }: { nombre: NombreGuia; usuario: string; auto?: boolean }) {
  const [abierta, setAbierta] = useState(false);

  // El menú la abre con un evento (así no tiene que saber dónde está la guía)
  useEffect(() => {
    const abrir = () => setAbierta(true);
    window.addEventListener(EVENTO_GUIA, abrir);
    return () => window.removeEventListener(EVENTO_GUIA, abrir);
  }, []);

  // La primera vez: cuando termina la animación del logo (si la hay) y la pantalla ya está
  useEffect(() => {
    if (!auto || yaLaVio(nombre, usuario)) return;
    const conIntro = !document.documentElement.classList.contains('sin-intro');
    const espera = conIntro ? Math.max(600, 2600 - performance.now()) : 700;
    const t = window.setTimeout(() => setAbierta(true), espera);
    return () => window.clearTimeout(t);
  }, [auto, nombre, usuario]);

  const cerrar = useCallback(() => {
    setAbierta(false);
    marcarVista(nombre, usuario);
    document.querySelector<HTMLElement>('[data-guia="menu"]')?.focus({ preventScroll: true });
  }, [nombre, usuario]);

  return abierta ? <Recorrido pasos={GUIAS[nombre]} onCerrar={cerrar} /> : null;
}

function usePrefiereQuieto() {
  const [quieto, setQuieto] = useState(false);
  useEffect(() => setQuieto(window.matchMedia('(prefers-reduced-motion: reduce)').matches), []);
  return quieto;
}

function Recorrido({ pasos: todos, onCerrar }: { pasos: PasoGuia[]; onCerrar: () => void }) {
  // Los pasos opcionales cuyo elemento no está en esta pantalla no salen
  const [pasos] = useState(() => todos.filter((p) => !p.opcional || (p.objetivo && buscarObjetivo(p.objetivo))));
  const [i, setI] = useState(0);
  const [caja, setCaja] = useState<Caja | null>(null);
  const [vista, setVista] = useState({ w: 0, h: 0 });
  const quieto = usePrefiereQuieto();
  const principal = useRef<HTMLButtonElement>(null);
  const paso = pasos[i];
  const ultimo = i === pasos.length - 1;

  const t = useT();
  // Encuentra el elemento del paso, lo trae a la vista y sigue su posición (scroll, giro del celular)
  useLayoutEffect(() => {
    let cuadro = 0;
    const el = paso.objetivo ? buscarObjetivo(paso.objetivo) : null;
    const medir = () => {
      cancelAnimationFrame(cuadro);
      cuadro = requestAnimationFrame(() => {
        setVista({ w: window.innerWidth, h: window.innerHeight });
        if (!el) return setCaja(null);
        const r = el.getBoundingClientRect();
        setCaja({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 70 || r.bottom > window.innerHeight - 70) el.scrollIntoView({ block: 'center', behavior: quieto ? 'auto' : 'smooth' });
    }
    medir();
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => {
      cancelAnimationFrame(cuadro);
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
  }, [paso, quieto]);

  useEffect(() => {
    principal.current?.focus({ preventScroll: true });
  }, []);

  const siguiente = (e?: React.MouseEvent<HTMLButtonElement>) => {
    if (ultimo) {
      if (e) lanzarChispas(e);
      onCerrar();
    } else setI((n) => n + 1);
  };
  const atras = () => setI((n) => Math.max(0, n - 1));

  // Teclado: Escape salta, flechas para moverse
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
      else if (e.key === 'ArrowRight') setI((n) => Math.min(pasos.length - 1, n + 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar, pasos.length]);

  if (!vista.w) return null;
  const c = colocar(caja, vista.w, vista.h);
  const centro = c.lado === 'centro';

  return createPortal(
    <div className={`gu${quieto ? ' gu--quieto' : ''}`} role="dialog" aria-modal="true" aria-labelledby="gu-titulo" aria-describedby="gu-texto">
      <div className="gu-velo" />
      <div className={`gu-foco${centro ? ' gu-foco--cerrado' : ''}`} style={c.foco} aria-hidden="true">
        {!centro && <span key={i} className="gu-foco__anillo" />}
      </div>
      <div
        key={i}
        className={`gu-tarjeta gu-tarjeta--${c.lado}`}
        style={{
          ...c.tarjeta,
          ...(centro ? { top: '50%' } : {}),
          ...(c.flecha != null ? ({ '--flecha': `${c.flecha}px` } as React.CSSProperties) : {}),
        }}
      >
        <div className="gu-tarjeta__arriba">
          <span className="gu-cuenta">{t('{n} de {total}', { n: i + 1, total: pasos.length })}</span>
          {!ultimo && (
            <button type="button" className="gu-saltar" onClick={onCerrar}>
              {t('Saltar guía')}
            </button>
          )}
        </div>
        {paso.lottie && (
          <span className="gu-lottie" aria-hidden="true">
            <LottieSlot name={paso.lottie} width={112} height={112} label="" />
          </span>
        )}
        <h2 id="gu-titulo" className="lu-title gu-titulo">
          {t(paso.titulo)}
        </h2>
        <p id="gu-texto" className="gu-texto">
          {t(paso.texto)}
        </p>
        <div className="gu-abajo">
          <span className="gu-puntos" aria-hidden="true">
            {pasos.map((p, n) => (
              <i key={p.titulo} className={n === i ? 'is-aqui' : n < i ? 'is-visto' : undefined} />
            ))}
          </span>
          <span className="gu-botones">
            {i > 0 && (
              <Button size="sm" variant="ghost" onClick={atras}>
                {t('Atrás')}
              </Button>
            )}
            <button ref={principal} type="button" className="lu-btn lu-btn--primary lu-btn--sm" onClick={siguiente}>
              {i === 0 ? t('Empezar') : ultimo ? t('¡Listo!') : t('Siguiente')}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
