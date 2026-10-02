'use client';

import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';

/* Selector de pocas opciones («Todos · Por revisar»). Adaptado de «Rubber
   Segment» de React Bits (reactbits.dev): la pastilla se estira hasta la
   opción nueva y se recoge, en 240 ms, con la Web Animations API en vez de
   la librería motion. Con «reducir movimiento» salta sin animar. Es un
   radiogroup: flechas para moverse, como cualquier grupo de opciones. */

interface Opcion<T extends string> {
  value: T;
  label: string;
}

export function Segmento<T extends string>({ opciones, value, onChange, label }: { opciones: Opcion<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  const pista = useRef<HTMLDivElement>(null);
  const pastilla = useRef<HTMLSpanElement>(null);
  const botones = useRef<(HTMLButtonElement | null)[]>([]);
  const anterior = useRef<number | null>(null);
  const [medida, setMedida] = useState<{ l: number; w: number } | null>(null);
  const indice = Math.max(
    0,
    opciones.findIndex((o) => o.value === value),
  );

  const caja = (i: number) => {
    const b = botones.current[i];
    return b ? { l: b.offsetLeft, w: b.offsetWidth } : null;
  };
  // Solo cambia el estado si la medida cambió (si no, cada medición repinta)
  const medir = useRef(() => {});
  medir.current = () => {
    const m = caja(indice);
    setMedida((prev) => (prev && m && prev.l === m.l && prev.w === m.w ? prev : m));
  };

  // Ubica la pastilla en la opción elegida y, si cambió, la estira desde la anterior
  // biome-ignore lint/correctness/useExhaustiveDependencies: caja y medir leen refs; solo importa cuándo cambia la opción
  useLayoutEffect(() => {
    const destino = caja(indice);
    if (!destino) return;
    medir.current();
    const desde = anterior.current === null ? null : caja(anterior.current);
    anterior.current = indice;
    const el = pastilla.current;
    if (!el || !desde || (desde.l === destino.l && desde.w === destino.w)) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const izq = Math.min(desde.l, destino.l);
    const der = Math.max(desde.l + desde.w, destino.l + destino.w);
    el.animate(
      [
        { left: `${desde.l}px`, width: `${desde.w}px` },
        { left: `${izq}px`, width: `${der - izq}px`, offset: 0.45 },
        { left: `${destino.l}px`, width: `${destino.w}px` },
      ],
      { duration: 240, easing: 'cubic-bezier(.2, .8, .2, 1)' },
    );
  }, [indice]);

  // Si cambia el ancho (gira el celular, cargan las fuentes), se vuelve a medir
  useLayoutEffect(() => {
    const el = pista.current;
    if (!el) return;
    const ro = new ResizeObserver(() => medir.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    const paso = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    const i = (indice + paso + opciones.length) % opciones.length;
    onChange(opciones[i].value);
    botones.current[i]?.focus();
  };

  return (
    <div ref={pista} className="lu-seg" role="radiogroup" aria-label={label} onKeyDown={teclas}>
      <span ref={pastilla} className="lu-seg__pastilla" aria-hidden="true" style={medida ? { left: medida.l, width: medida.w } : { opacity: 0 }} />
      {opciones.map((o, i) => (
        <button
          key={o.value}
          ref={(b) => {
            botones.current[i] = b;
          }}
          type="button"
          role="radio"
          aria-checked={i === indice}
          tabIndex={i === indice ? 0 : -1}
          className="lu-seg__op"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
