'use client';

/* Chispas al confirmar algo (marcar una transferencia pagada, confirmar un
   gasto). Adaptado de «Click Spark» de React Bits (reactbits.dev): un solo
   canvas para toda la app, encima de todo y sin recibir toques, que solo
   dibuja mientras hay chispas (el original deja el bucle corriendo siempre).
   Dura 250 ms, lo máximo del kit, y con «reducir movimiento» no hace nada. */

const DURACION = 250;
const CANTIDAD = 8;
const RADIO = 26;
const LARGO = 11;
const COLORES = ['--amarillo', '--verde', '--morado'];

interface Chispa {
  x: number;
  y: number;
  angulo: number;
  inicio: number;
  color: string;
}

let lienzo: HTMLCanvasElement | null = null;
let chispas: Chispa[] = [];
let corriendo = false;

function preparar() {
  if (!lienzo) {
    lienzo = document.createElement('canvas');
    lienzo.setAttribute('aria-hidden', 'true');
    lienzo.className = 'lu-chispas';
    document.body.appendChild(lienzo);
  }
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (lienzo.width !== Math.round(w * dpr) || lienzo.height !== Math.round(h * dpr)) {
    lienzo.width = Math.round(w * dpr);
    lienzo.height = Math.round(h * dpr);
  }
  return { ctx: lienzo.getContext('2d') as CanvasRenderingContext2D, dpr };
}

function dibujar() {
  if (!lienzo) return;
  const { ctx, dpr } = preparar();
  const ahora = performance.now();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, lienzo.width, lienzo.height);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  chispas = chispas.filter((c) => {
    const t = (ahora - c.inicio) / DURACION;
    if (t >= 1) return false;
    const e = t * (2 - t); // sale rápido y frena
    const d = e * RADIO;
    const l = LARGO * (1 - e);
    ctx.strokeStyle = c.color;
    ctx.beginPath();
    ctx.moveTo(c.x + d * Math.cos(c.angulo), c.y + d * Math.sin(c.angulo));
    ctx.lineTo(c.x + (d + l) * Math.cos(c.angulo), c.y + (d + l) * Math.sin(c.angulo));
    ctx.stroke();
    return true;
  });
  if (chispas.length) requestAnimationFrame(dibujar);
  else {
    corriendo = false;
    ctx.clearRect(0, 0, lienzo.width, lienzo.height);
  }
}

/**
 * Chispas donde tocaron (o en el centro del botón si fue con el teclado).
 * Uso: onClick={(e) => { lanzarChispas(e); … }}
 */
export function lanzarChispas(e: { clientX: number; clientY: number; currentTarget: EventTarget | null }) {
  if (typeof window === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let { clientX: x, clientY: y } = e;
  // Con Enter o Espacio el clic llega en (0, 0): el centro del botón
  if (x === 0 && y === 0 && e.currentTarget instanceof Element) {
    const r = e.currentTarget.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  preparar();
  const estilo = getComputedStyle(document.documentElement);
  const inicio = performance.now();
  for (let i = 0; i < CANTIDAD; i++) {
    const color = estilo.getPropertyValue(COLORES[i % COLORES.length]).trim() || '#FFC53D';
    chispas.push({ x, y, angulo: (2 * Math.PI * i) / CANTIDAD - Math.PI / 2, inicio, color });
  }
  if (!corriendo) {
    corriendo = true;
    requestAnimationFrame(dibujar);
  }
}
