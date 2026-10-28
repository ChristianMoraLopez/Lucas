'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { lanzarChispas } from '@/components/chispas';
import { useT } from '@/components/idioma';
import { LottieSlot } from '@/components/lucas-ui';
import { DUR, EASE_OUT, EASE_POP } from '@/components/movimiento';

/*
 * Las piezas con movimiento de Gastos (Motion, con las reglas del kit: 150–250
 * ms, sin bucles; con «reducir movimiento» nada se desplaza):
 *  · MesesBarras: «¿Cuándo se fue?», una barra por mes que se toca para verlo
 *    (crecen al llegar; la píldora de la elegida se desliza entre meses).
 *  · Reparto: la barra de «¿En qué se fue?» que se llena por categoría.
 *  · MesPlegable: cada mes se pliega y se despliega con su altura.
 *  · BotonExcel: descarga el Excel con chispas y el Lottie de la hoja que se llena.
 */

export interface BarraMes {
  /** «2026-10» */
  mes: string;
  /** «Oct» y «Octubre 2026» */
  corto: string;
  largo: string;
  total: number;
  /** «$1.544.132» */
  monto: string;
  href: string;
}

export function MesesBarras({
  meses,
  actual,
  todos,
  tono,
}: {
  /** Del más reciente al más viejo */
  meses: BarraMes[];
  /** El mes que se ve, o null (todos) */
  actual: string | null;
  todos: { href: string; label: string; detalle: string };
  tono: 'verde' | 'morado';
}) {
  const t = useT();
  const reduce = useReducedMotion();
  const pista = useRef<HTMLDivElement>(null);
  const pill = useId();
  const max = Math.max(...meses.map((m) => m.total), 1);
  // De izquierda a derecha, del más viejo al más reciente (como se lee el tiempo)
  const orden = [...meses].reverse();

  // Al abrir, se ve el mes elegido (o el más reciente) sin tener que deslizar
  useEffect(() => {
    const el = pista.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? pista.current?.lastElementChild;
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, []);

  return (
    <nav className="gm" aria-label={t('Ver por mes')}>
      <div className="gm-head">
        <h2 className="lu-title">{t('¿Cuándo se fue?')}</h2>
        <Link href={todos.href} scroll={false} className={`gm-todos${actual ? '' : ' is-on'}`} aria-current={actual ? undefined : 'page'}>
          {!actual && <motion.span layoutId={pill} className={`gm-pill gm-pill--${tono}`} transition={{ duration: DUR.slow, ease: EASE_OUT }} />}
          <span className="gm-todos__t">{todos.label}</span>
          <span className="gm-todos__n">{todos.detalle}</span>
        </Link>
      </div>
      <div className="gm-pista" ref={pista}>
        {orden.map((m, i) => {
          const on = m.mes === actual;
          return (
            <Link
              key={m.mes}
              href={m.href}
              scroll={false}
              className={`gm-mes${on ? ' is-on' : ''}`}
              aria-current={on ? 'page' : undefined}
              aria-label={`${m.largo}: ${m.monto}`}
            >
              <span className="gm-mes__monto" aria-hidden="true">
                {m.monto}
              </span>
              <span className="gm-mes__carril" aria-hidden="true">
                <motion.i
                  className={`gm-mes__barra${on ? ` gm-mes__barra--${tono}` : ''}`}
                  style={{ height: `${Math.max((m.total / max) * 100, 4)}%`, originY: 1 }}
                  initial={reduce ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: DUR.slow, ease: EASE_POP, delay: Math.min(i * 0.03, 0.3) }}
                />
              </span>
              <span className="gm-mes__nombre">
                {on && <motion.span layoutId={pill} className={`gm-pill gm-pill--${tono}`} transition={{ duration: DUR.slow, ease: EASE_OUT }} />}
                <span className="gm-mes__t">{m.corto}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** La barra de «¿En qué se fue?»: un tramo por categoría, con su tono, que se llena al llegar */
export function Reparto({ tramos }: { tramos: { id: string; tono: string; total: number }[] }) {
  const reduce = useReducedMotion();
  const suma = tramos.reduce((s, x) => s + x.total, 0) || 1;
  return (
    <div className="ed-stack gs-reparto" aria-hidden="true">
      {tramos.map((x, i) => (
        <motion.i
          key={x.id}
          style={{ background: `var(--tono-${x.tono})` }}
          initial={reduce ? false : { flexGrow: 0 }}
          animate={{ flexGrow: x.total / suma }}
          transition={{ duration: DUR.slow, ease: EASE_OUT, delay: Math.min(i * 0.04, 0.2) }}
        />
      ))}
    </div>
  );
}

/** Un mes de la lista: el encabezado dice cuántos y cuánto; al tocarlo se despliega */
export function MesPlegable({
  titulo,
  detalle,
  monto,
  abierto: inicial,
  children,
}: {
  titulo: string;
  detalle: string;
  monto: ReactNode;
  abierto: boolean;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(inicial);
  const id = useId();
  // Cambian los filtros (otra búsqueda, otro mes): vuelve a lo que diga la página
  useEffect(() => setAbierto(inicial), [inicial]);
  return (
    <section className={`gs-month${abierto ? ' is-open' : ''}`} aria-label={titulo}>
      <button type="button" className="gs-month__head" aria-expanded={abierto} aria-controls={id} onClick={() => setAbierto((v) => !v)}>
        <span className="gs-month__t">
          <h2 className="lu-title gs-month__h">{titulo}</h2>
          <span className="lu-small lu-muted">{detalle}</span>
        </span>
        {monto}
        <motion.svg
          className="gs-month__chev"
          viewBox="0 0 24 24"
          aria-hidden="true"
          animate={{ rotate: abierto ? 180 : 0 }}
          transition={{ duration: DUR.base, ease: EASE_OUT }}
        >
          <path d="M6 9l6 6 6-6" />
        </motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {abierto && (
          <motion.div
            id={id}
            key="lista"
            className="gs-month__cuerpo"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DUR.slow, ease: EASE_OUT }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/**
 * «Excel»: descarga lo que se ve, con sus filtros. Mientras el navegador lo
 * baja, el ícono es la hoja que se llena (Lottie propio, «exportar») y saltan
 * chispas; después dice «Listo» un momento.
 */
export function BotonExcel({ href, nombre }: { href: string; nombre: string }) {
  const t = useT();
  const [estado, setEstado] = useState<'quieto' | 'armando' | 'listo'>('quieto');
  const reloj = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => reloj.current.forEach(clearTimeout), []);
  return (
    <a
      href={href}
      download={nombre}
      className={`lu-btn lu-btn--sm lu-btn--ghost gs-excel gs-excel--${estado}`}
      title={t('Descargar en Excel lo que estás viendo')}
      onClick={(e) => {
        lanzarChispas(e);
        setEstado('armando');
        reloj.current.forEach(clearTimeout);
        reloj.current = [setTimeout(() => setEstado('listo'), 2100), setTimeout(() => setEstado('quieto'), 3600)];
      }}
    >
      <span className="gs-excel__ico" aria-hidden="true">
        {estado === 'armando' ? (
          <LottieSlot name="exportar" width={26} height={26} />
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="3" width="16" height="18" rx="3" />
            <path d="M4 8h16M10 8v13" />
          </svg>
        )}
      </span>
      <span aria-live="polite">{estado === 'armando' ? t('Armando…') : estado === 'listo' ? t('¡Listo!') : 'Excel'}</span>
    </a>
  );
}
