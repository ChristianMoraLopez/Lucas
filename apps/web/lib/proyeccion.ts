/* ¿Les alcanza? El saldo del hogar con el modelo de segundo orden del proyecto
   de Ecuaciones Diferenciales (UCompensar, 2026):

     S'' + kS' = −k·G0,  S(0) = S0,  S'(0) = −Gi

   Resuelto con la transformada de Laplace sobre el sistema S' = −G, G' = −k(G − G0):
     G(s) = G0/s + (Gi − G0)/(s + k)               → G(t) = G0 + (Gi − G0)e^(−kt)
     S(s) = S0/s − G0/s² − (Gi − G0)/(s(s + k))     → S(t) = S0 − G0·t − (Gi − G0)(1 − e^(−kt))/k
   Un ingreso o un gasto grande el día a suma m·e^(−as)/s (segundo teorema de
   traslación: m·u(t − a)). Si al llegar la plata el gasto vuelve a subir, G
   recibe un salto J: J·e^(−as)/(s + k) en G y −J·e^(−as)/(s(s + k)) en S. */

export interface Evento {
  /** Días desde hoy */
  dia: number;
  /** + plata que llega, − gasto grande */
  monto: number;
  /** Al llegar la plata, el gasto diario vuelve al de hoy */
  reinicia?: boolean;
}

export interface Escenario {
  saldo: number;
  gastoHoy: number;
  gastoBase: number;
  /** Tasa de adaptación, día⁻¹ */
  k: number;
  umbral: number;
  eventos?: Evento[];
}

/** (1 − e^(−kx))/k, que tiende a x cuando k → 0 (la convolución 1 * e^(−kt)) */
const acumulado = (k: number, x: number) => (Math.abs(k) < 1e-9 ? x : (1 - Math.exp(-k * x)) / k);

/** Los eventos en orden, con el salto J del gasto ya calculado */
export function saltos(e: Escenario) {
  const { gastoHoy: Gi, gastoBase: G0, k } = e;
  const out: (Evento & { J: number })[] = [];
  for (const ev of [...(e.eventos ?? [])].filter((x) => x.dia >= 0).sort((a, b) => a.dia - b.dia)) {
    const antes = G0 + (Gi - G0) * Math.exp(-k * ev.dia) + out.reduce((s, p) => s + p.J * Math.exp(-k * (ev.dia - p.dia)), 0);
    out.push({ ...ev, J: ev.reinicia && ev.monto > 0 ? Gi - antes : 0 });
  }
  return out;
}

/** Gasto diario G(t) */
export function gasto(e: Escenario, t: number, ev = saltos(e)) {
  let g = e.gastoBase + (e.gastoHoy - e.gastoBase) * Math.exp(-e.k * t);
  for (const x of ev) if (t >= x.dia) g += x.J * Math.exp(-e.k * (t - x.dia));
  return g;
}

/** Saldo S(t); en el día de un evento cuenta ya el evento (u(t − a) con u(0) = 1) */
export function saldo(e: Escenario, t: number, ev = saltos(e)) {
  let s = e.saldo - e.gastoBase * t - (e.gastoHoy - e.gastoBase) * acumulado(e.k, t);
  for (const x of ev) if (t >= x.dia) s += x.monto - x.J * acumulado(e.k, t - x.dia);
  return s;
}

export interface Cruce {
  dia: number;
  /** Las aproximaciones de Newton-Raphson (vacío si el cruce fue por un gasto grande) */
  iteraciones: number[];
}

/**
 * El primer día en que S(t) = nivel, dentro de horizonte. Entre eventos S es
 * continua, decreciente y convexa, así que Newton desde la izquierda no se pasa;
 * igual se protege con bisección.
 */
export function cruce(e: Escenario, nivel: number, horizonte = 90): Cruce | null {
  const ev = saltos(e);
  const bordes = [0, ...ev.map((x) => x.dia).filter((d) => d > 0 && d < horizonte), horizonte];
  for (let i = 0; i < bordes.length - 1; i++) {
    const l = bordes[i];
    const r = bordes[i + 1];
    const f = (t: number) => saldo(e, t, ev) - nivel;
    if (f(l) <= 0) return { dia: l, iteraciones: [] };
    const fr = saldo(e, r - 1e-9, ev) - nivel;
    if (fr > 0) continue;
    let lo = l;
    let hi = r - 1e-9;
    let t = l;
    const iteraciones = [t];
    for (let n = 0; n < 50; n++) {
      const d = -gasto(e, t, ev);
      let sig = d < 0 ? t - f(t) / d : (lo + hi) / 2;
      if (!(sig > lo && sig < hi)) sig = (lo + hi) / 2;
      if (f(sig) > 0) lo = sig;
      else hi = sig;
      iteraciones.push(sig);
      if (Math.abs(sig - t) < 1e-7) break;
      t = sig;
    }
    return { dia: iteraciones.at(-1) as number, iteraciones };
  }
  return null;
}

/** El día de alerta, el de agotamiento y, para comparar, los mismos con gasto constante */
export function proyectar(e: Escenario, horizonte = 90) {
  const constante: Escenario = { ...e, gastoBase: e.gastoHoy, eventos: (e.eventos ?? []).map((x) => ({ ...x, reinicia: false })) };
  return {
    alerta: cruce(e, e.umbral, horizonte),
    agotamiento: cruce(e, 0, horizonte),
    alertaConstante: cruce(constante, e.umbral, horizonte),
    agotamientoConstante: cruce(constante, 0, horizonte),
  };
}

/** Puntos para la gráfica (con el antes y el después de cada salto) */
export function curva(e: Escenario, hasta: number, paso = 0.25) {
  const ev = saltos(e);
  const ts = new Set<number>();
  for (let t = 0; t <= hasta + 1e-9; t += paso) ts.add(Number(t.toFixed(4)));
  for (const x of ev) if (x.dia > 0 && x.dia <= hasta) ts.add(x.dia - 1e-6);
  return [...ts].sort((a, b) => a - b).map((t) => ({ t, saldo: saldo(e, t, ev), gasto: gasto(e, t, ev) }));
}

export type FrecuenciaPago = 'mensual' | 'quincenal';

/**
 * Los pagos del sueldo que caen después de hoy y dentro del horizonte, como
 * eventos: cada uno es un escalón u(t − a) en el saldo. Mensual: todo el día
 * elegido (o el último del mes si ese mes es más corto). Quincenal: la mitad el
 * 15 y la mitad el último día del mes.
 */
export function pagosDelSueldo(hoy: string, sueldo: number, frecuencia: FrecuenciaPago, diaPago: number, reinicia: boolean, horizonte = 90): Evento[] {
  if (sueldo <= 0) return [];
  const base = new Date(`${hoy}T12:00:00`);
  const out: Evento[] = [];
  for (let m = 0; m <= Math.ceil(horizonte / 28); m++) {
    const anio = base.getFullYear();
    const mes = base.getMonth() + m;
    const ultimo = new Date(anio, mes + 1, 0, 12).getDate();
    const dias = frecuencia === 'mensual' ? [Math.min(diaPago, ultimo)] : [15, ultimo];
    for (const d of dias) {
      const dia = Math.round((new Date(anio, mes, d, 12).getTime() - base.getTime()) / 86_400_000);
      if (dia > 0 && dia <= horizonte) out.push({ dia, monto: frecuencia === 'mensual' ? sueldo : sueldo / 2, reinicia });
    }
  }
  return out;
}

/** El ejemplo del informe de Profundización */
export const EJEMPLO_INFORME: Escenario = { saldo: 2_000_000, gastoHoy: 100_000, gastoBase: 40_000, k: 0.03, umbral: 300_000 };
