'use client';

import { useEffect, useRef, useState } from 'react';

/** Escala, desplazamiento (px desde el centro) y giro (grados) de la foto. */
interface Vista {
  s: number;
  x: number;
  y: number;
  r: number;
}

const INICIO: Vista = { s: 1, x: 0, y: 0, r: 0 };
const MAX = 6;
const DOBLE_TOQUE = 2.5;

interface Gesto {
  v: Vista;
  d: number; // distancia entre dos dedos al empezar (0 si es uno)
  cx: number; // punto de partida (o centro de los dos dedos)
  cy: number;
  t: number;
  movio: boolean;
}

const distancia = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Acercar o alejar a la escala `s` dejando quieto el punto (px, py) de la pantalla. */
function zoomEn(v: Vista, s: number, px: number, py: number): Vista {
  const k = s / v.s;
  return { ...v, s, x: px - k * (px - v.x), y: py - k * (py - v.y) };
}

/**
 * La foto de un recibo a pantalla completa. Arranca entera (ajustada a la
 * pantalla) y se acerca con dos dedos, con doble toque o con la rueda del
 * mouse; acercada, se arrastra. También gira de a 90° (recibos fotografiados
 * de lado). Esc, el botón o «atrás» del teclado la cierran.
 */
export function PhotoViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [caja, setCaja] = useState({ w: 0, h: 0 });
  const [v, setV] = useState<Vista>(INICIO);
  const [arrastrando, setArrastrando] = useState(false);
  const [ayuda, setAyuda] = useState(true);

  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const gesto = useRef<Gesto | null>(null);
  const ultimoToque = useRef(0);

  // Tamaño de la foto ajustada a la pantalla (con el giro aplicado)
  const girada = v.r % 180 !== 0;
  const ajuste = natural && caja.w ? Math.min(caja.w / (girada ? natural.h : natural.w), caja.h / (girada ? natural.w : natural.h)) : 0;
  const ancho = natural ? natural.w * ajuste : 0;
  const alto = natural ? natural.h * ajuste : 0;
  const visible = girada ? { w: alto, h: ancho } : { w: ancho, h: alto };

  /** Escala entre 1 y MAX, y sin dejar ver fondo cuando la foto es más grande que la pantalla. */
  const limitar = (n: Vista): Vista => {
    const s = Math.min(MAX, Math.max(1, n.s));
    const mx = Math.max(0, (visible.w * s - caja.w) / 2);
    const my = Math.max(0, (visible.h * s - caja.h) / 2);
    return { ...n, s, x: Math.min(mx, Math.max(-mx, n.x)), y: Math.min(my, Math.max(-my, n.y)) };
  };
  const limitarRef = useRef(limitar);
  limitarRef.current = limitar;
  const vista = useRef(v);
  vista.current = v;

  // Abre como modal (encima de todo, con el foco adentro) y la página de atrás no se mueve
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    const html = document.documentElement;
    const antes = html.style.overflow;
    html.style.overflow = 'hidden';
    const t = setTimeout(() => setAyuda(false), 2600);
    return () => {
      clearTimeout(t);
      html.style.overflow = antes;
      if (d?.open) d.close();
    };
  }, []);

  // Tamaño del área de la foto (cambia al girar el celular)
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    // Medida inicial ya (el observer avisa en el siguiente cuadro pintado)
    const r = el.getBoundingClientRect();
    setCaja({ w: r.width, h: r.height });
    const ro = new ResizeObserver(([e]) => setCaja({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Rueda del mouse y gestos de Safari: los maneja el visor, no la página
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const rueda = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left - r.width / 2;
      const py = e.clientY - r.top - r.height / 2;
      setV((cur) => limitarRef.current(zoomEn(cur, Math.min(MAX, Math.max(1, cur.s * Math.exp(-e.deltaY * 0.0015))), px, py)));
    };
    const quieto = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', rueda, { passive: false });
    el.addEventListener('touchmove', quieto, { passive: false });
    el.addEventListener('gesturestart', quieto);
    return () => {
      el.removeEventListener('wheel', rueda);
      el.removeEventListener('touchmove', quieto);
      el.removeEventListener('gesturestart', quieto);
    };
  }, []);

  const relativo = (e: { clientX: number; clientY: number }) => {
    const r = (stage.current as HTMLDivElement).getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };

  const empezar = (movio: boolean) => {
    const ps = [...punteros.current.values()];
    if (ps.length >= 2) {
      const [a, b] = ps;
      gesto.current = { v: vista.current, d: distancia(a, b), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, t: Date.now(), movio: true };
    } else if (ps.length === 1) {
      gesto.current = { v: vista.current, d: 0, cx: ps[0].x, cy: ps[0].y, t: Date.now(), movio };
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Sin captura igual funciona mientras el dedo siga encima de la foto
    }
    punteros.current.set(e.pointerId, relativo(e));
    setArrastrando(true);
    setAyuda(false);
    empezar(punteros.current.size > 1);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!punteros.current.has(e.pointerId)) return;
    punteros.current.set(e.pointerId, relativo(e));
    const g = gesto.current;
    if (!g) return;
    const ps = [...punteros.current.values()];
    if (ps.length >= 2 && g.d > 0) {
      const [a, b] = ps;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const s = Math.min(MAX, Math.max(1, (g.v.s * distancia(a, b)) / g.d));
      const z = zoomEn(g.v, s, g.cx, g.cy);
      setV(limitar({ ...z, x: z.x + cx - g.cx, y: z.y + cy - g.cy }));
    } else if (ps.length === 1) {
      const dx = ps[0].x - g.cx;
      const dy = ps[0].y - g.cy;
      if (Math.hypot(dx, dy) > 6) g.movio = true;
      if (g.v.s > 1) setV(limitar({ ...g.v, x: g.v.x + dx, y: g.v.y + dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!punteros.current.has(e.pointerId)) return;
    const g = gesto.current;
    punteros.current.delete(e.pointerId);
    if (punteros.current.size > 0) {
      // Soltó un dedo de los dos: el otro sigue arrastrando desde donde quedó
      empezar(true);
      return;
    }
    gesto.current = null;
    setArrastrando(false);
    if (e.type === 'pointerup' && g && !g.movio && Date.now() - g.t < 300) {
      const ahora = Date.now();
      if (ahora - ultimoToque.current < 320) {
        // Doble toque: acerca donde tocó, o vuelve a verla entera
        ultimoToque.current = 0;
        const p = relativo(e);
        const cur = vista.current;
        setV(cur.s > 1 ? { ...INICIO, r: cur.r } : limitar(zoomEn(cur, DOBLE_TOQUE, p.x, p.y)));
        return;
      }
      ultimoToque.current = ahora;
    }
    setV((cur) => limitarRef.current(cur));
  };

  const acercar = (factor: number) => setV((cur) => limitar(zoomEn(cur, Math.min(MAX, Math.max(1, cur.s * factor)), 0, 0)));
  const girar = () => setV((cur) => ({ ...INICIO, r: (cur.r + 90) % 360 }));
  const ajustar = () => setV((cur) => ({ ...INICIO, r: cur.r }));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === '+' || e.key === '=') acercar(1.5);
    else if (e.key === '-') acercar(1 / 1.5);
    else if (e.key === '0') ajustar();
    else if (e.key.toLowerCase() === 'r') girar();
    else return;
    e.preventDefault();
  };

  return (
    <dialog
      ref={dialog}
      className="pv"
      aria-label={alt}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={stage}
        className={`pv-stage${v.s > 1 ? ' is-zoom' : ''}${arrastrando ? ' is-drag' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* biome-ignore lint/performance/noImgElement: URL firmada de Storage que vence; next/image no aporta aquí */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={`pv-img${arrastrando ? '' : ' is-suave'}${natural ? '' : ' is-cargando'}`}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={
            natural
              ? {
                  width: ancho,
                  height: alto,
                  transform: `translate(-50%, -50%) translate(${v.x}px, ${v.y}px) scale(${v.s}) rotate(${v.r}deg)`,
                }
              : undefined
          }
        />
      </div>

      <div className="pv-top">
        <span className="pv-title">{alt}</span>
        <button type="button" className="pv-btn" onClick={onClose} aria-label="Cerrar">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {ayuda && <p className="pv-hint">Pellizca o toca dos veces para acercar</p>}

      <div className="pv-tools" role="toolbar" aria-label="Zoom de la foto">
        <button type="button" className="pv-btn" onClick={() => acercar(1 / 1.5)} disabled={v.s <= 1} aria-label="Alejar">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button type="button" className="pv-btn pv-btn--txt" onClick={ajustar} disabled={v.s === 1 && v.x === 0 && v.y === 0}>
          {v.s > 1 ? `${Math.round(v.s * 100)} %` : 'Entera'}
        </button>
        <button type="button" className="pv-btn" onClick={() => acercar(1.5)} disabled={v.s >= MAX} aria-label="Acercar">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14M12 5v14" />
          </svg>
        </button>
        <button type="button" className="pv-btn" onClick={girar} aria-label="Girar la foto">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
          </svg>
        </button>
        <a className="pv-btn" href={src} target="_blank" rel="noreferrer">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
          <span className="lu-sr">Abrir la foto original en otra pestaña</span>
        </a>
      </div>
    </dialog>
  );
}
