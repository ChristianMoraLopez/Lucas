'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LottieName } from '@/components/lottie';
import { LottieOGiro } from '@/components/lottie-o-giro';

/** La API de red del navegador (Chrome y Android; Safari no la tiene) */
type InfoRed = EventTarget & { effectiveType?: string; rtt?: number; downlink?: number; saveData?: boolean };

/** ¿La red se ve lenta? 2G, mucha demora o casi nada de bajada */
export function redLenta(c: Pick<InfoRed, 'effectiveType' | 'rtt' | 'downlink'> | null | undefined) {
  if (!c) return false;
  return c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || (c.rtt ?? 0) >= 1500 || (c.downlink != null && c.downlink > 0 && c.downlink < 0.25);
}

/**
 * Un link de la app hacia otra pantalla (no uno externo, ni uno que abre otra
 * pestaña, ni uno a la misma pantalla): esos son los que se quedan esperando.
 */
export function esNavegacion(a: { href: string; target: string; download?: boolean }, actual: string, evento: { button: number; mod: boolean }) {
  if (evento.button !== 0 || evento.mod) return false;
  if (a.download || (a.target && a.target !== '_self')) return false;
  let destino: URL;
  let aqui: URL;
  try {
    aqui = new URL(actual);
    destino = new URL(a.href, aqui);
  } catch {
    return false;
  }
  if (destino.origin !== aqui.origin) return false;
  return destino.pathname !== aqui.pathname || destino.search !== aqui.search;
}

const TARDA_MS = 4_000; // desde aquí se avisa que la conexión está lenta
const RINDE_MS = 25_000; // si no llegó nada, se suelta el link para volver a intentar

/**
 * Lo que se ve mientras algo carga y cuando falla la conexión:
 * - al tocar una tarjeta, botón o pestaña que lleva a otra pantalla, esa misma
 *   muestra que está cargando (y no se deja tocar otra vez) y arriba corre una
 *   barrita; si tarda, se avisa que la conexión está lenta;
 * - sin internet, un aviso; cuando vuelve, otro.
 */
export function Conexion() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [enLinea, setEnLinea] = useState(true);
  const [volvio, setVolvio] = useState(false);
  const [lenta, setLenta] = useState(false);
  const [lentaVista, setLentaVista] = useState(false);
  const [navegando, setNavegando] = useState(false);
  const [tarda, setTarda] = useState(false);
  const [noCargo, setNoCargo] = useState(false);
  const marcado = useRef<HTMLElement | null>(null);
  const relojes = useRef<number[]>([]);

  const soltar = useCallback(() => {
    for (const r of relojes.current) window.clearTimeout(r);
    relojes.current = [];
    const a = marcado.current;
    if (a) {
      a.removeAttribute('data-cargando');
      a.removeAttribute('data-cargando-rel');
      a.removeAttribute('aria-busy');
    }
    marcado.current = null;
    setNavegando(false);
    setTarda(false);
  }, []);

  // Llegó la pantalla nueva (o volvieron atrás): se acaba la espera
  // biome-ignore lint/correctness/useExhaustiveDependencies: se suelta cada vez que cambia la ruta
  useEffect(() => {
    soltar();
    setNoCargo(false);
  }, [pathname, search, soltar]);

  // Con o sin internet; y qué tan buena es la red, si el navegador lo dice
  useEffect(() => {
    setEnLinea(navigator.onLine);
    let reloj = 0;
    const on = () => {
      // En la pantalla de «sin conexión» se carga la de verdad; en las demás se refrescan los datos sin perder lo escrito
      if (document.querySelector('[data-sin-conexion]')) {
        window.location.reload();
        return;
      }
      router.refresh();
      setEnLinea(true);
      setVolvio(true);
      window.clearTimeout(reloj);
      reloj = window.setTimeout(() => setVolvio(false), 3_000);
    };
    const off = () => {
      setEnLinea(false);
      setVolvio(false);
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const red = (navigator as Navigator & { connection?: InfoRed }).connection;
    const medir = () => setLenta(redLenta(red));
    medir();
    red?.addEventListener?.('change', medir);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      red?.removeEventListener?.('change', medir);
      window.clearTimeout(reloj);
    };
  }, [router]);

  // Al tocar un link de la app: ese mismo muestra que carga, hasta que llegue la pantalla
  useEffect(() => {
    const alTocar = (e: MouseEvent) => {
      // Un link de la app, o un botón que lleva a otra pantalla (las pestañas: data-navega)
      const el = (e.target as Element | null)?.closest?.('a[href], [data-navega]') as HTMLElement | null;
      if (!el) return;
      const mod = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
      if (el instanceof HTMLAnchorElement) {
        if (!esNavegacion({ href: el.href, target: el.target, download: el.hasAttribute('download') }, window.location.href, { button: e.button, mod })) return;
      } else if (e.button !== 0 || el.getAttribute('aria-current') === 'page' || el.hasAttribute('disabled')) {
        return; // la pestaña en la que ya está no navega
      }
      const a = el;
      soltar();
      setNoCargo(false);
      marcado.current = a;
      const estilo = window.getComputedStyle(a);
      a.setAttribute('data-cargando', estilo.display === 'inline' ? 'texto' : 'bloque');
      if (estilo.position === 'static') a.setAttribute('data-cargando-rel', '');
      a.setAttribute('aria-busy', 'true');
      setNavegando(true);
      relojes.current = [
        window.setTimeout(() => setTarda(true), TARDA_MS),
        window.setTimeout(() => {
          soltar();
          setNoCargo(true);
        }, RINDE_MS),
      ];
    };
    // En captura: antes de que el Link de Next tome el clic
    document.addEventListener('click', alTocar, true);
    return () => document.removeEventListener('click', alTocar, true);
  }, [soltar]);

  // Cada aviso con su Lottie (y un giro mientras llega); el de red lenta, solo un punto
  type Aviso = { tono: 'sin' | 'lenta' | 'ok'; texto: string; cerrar?: () => void; lottie?: LottieName };
  let aviso: Aviso | null = null;
  if (!enLinea) aviso = { tono: 'sin', texto: 'Sin internet. Revisa tu conexión: lo que abras carga cuando vuelva.', lottie: 'sin-conexion' };
  else if (noCargo)
    aviso = { tono: 'sin', texto: 'No cargó: la conexión está muy lenta. Toca otra vez cuando mejore.', cerrar: () => setNoCargo(false), lottie: 'error' };
  else if (navegando && tarda) aviso = { tono: 'lenta', texto: 'Cargando… la conexión está lenta, ya casi.', lottie: 'cargando' };
  else if (volvio) aviso = { tono: 'ok', texto: 'Volvió la conexión.', lottie: 'todo-revisado' };
  else if (lenta && !lentaVista)
    aviso = { tono: 'lenta', texto: 'Tu conexión está lenta: las cosas pueden tardar un poco.', cerrar: () => setLentaVista(true) };

  // Al irse, el aviso sale suave (200 ms) en vez de desaparecer de golpe
  const clave = aviso ? `${aviso.tono}|${aviso.texto}` : null;
  const ultimo = useRef<Aviso | null>(null);
  if (aviso) ultimo.current = aviso;
  const [saliendo, setSaliendo] = useState<Aviso | null>(null);
  useEffect(() => {
    if (clave) {
      setSaliendo(null);
      return;
    }
    const previo = ultimo.current;
    if (!previo) return;
    setSaliendo(previo);
    const t = window.setTimeout(() => {
      setSaliendo(null);
      ultimo.current = null;
    }, 200);
    return () => window.clearTimeout(t);
  }, [clave]);
  const visible = aviso ?? saliendo;

  return (
    <>
      {navegando && <div className="lu-navbar" aria-hidden="true" />}
      <div className="lu-red" role="status" aria-live="polite">
        {visible && (
          <div key={`${visible.tono}|${visible.texto}`} className={`lu-red__aviso lu-red__aviso--${visible.tono}${aviso ? '' : ' is-saliendo'}`}>
            {visible.lottie ? (
              <span className="lu-red__icono">
                <LottieOGiro name={visible.lottie} size={30} label="" respaldo={visible.lottie === 'cargando' ? 'giro' : 'punto'} />
              </span>
            ) : (
              <span className="lu-red__punto" aria-hidden="true" />
            )}
            <span>{visible.texto}</span>
            {visible.cerrar && (
              <button type="button" className="lu-red__x" onClick={visible.cerrar} aria-label="Cerrar aviso">
                ×
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
