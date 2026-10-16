import { esMonedaRecibo } from '@/lib/moneda';

/*
 * La tasa de cambio de un día, para corregir la moneda de un recibo de viaje
 * (?de=CLP&a=COP&dia=2026-10-14 → { rate, date, source }). La misma fuente que
 * usa el worker (lucas_worker/cambio.py): currency-api, sin llave, por
 * jsDelivr o su espejo; si el día no está, la más reciente. Solo con sesión
 * (lo cuida el proxy), y cada tabla queda en caché unas horas.
 */

const FUENTES = [
  (dia: string, de: string) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${dia}/v1/currencies/${de}.min.json`,
  (dia: string, de: string) => `https://${dia}.currency-api.pages.dev/v1/currencies/${de}.min.json`,
];

type Tabla = { date: string; tasas: Record<string, unknown> };

async function tabla(dia: string, de: string): Promise<Tabla | 'no_esta' | null> {
  let noEsta = false;
  for (const url of FUENTES) {
    try {
      const r = await fetch(url(dia, de), { next: { revalidate: dia === 'latest' ? 21_600 : 86_400 }, signal: AbortSignal.timeout(8_000) });
      if (r.status === 404) {
        noEsta = true;
        continue;
      }
      if (!r.ok) continue;
      const cuerpo = (await r.json()) as Record<string, unknown>;
      const tasas = cuerpo[de];
      if (typeof cuerpo.date === 'string' && tasas && typeof tasas === 'object')
        return { date: cuerpo.date.slice(0, 10), tasas: tasas as Record<string, unknown> };
    } catch {
      // la otra fuente
    }
  }
  return noEsta ? 'no_esta' : null;
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const de = q.get('de')?.toUpperCase();
  const a = q.get('a')?.toUpperCase();
  const pedido = q.get('dia') ?? '';
  if (!esMonedaRecibo(de) || !esMonedaRecibo(a) || !/^\d{4}-\d{2}-\d{2}$/.test(pedido)) {
    return Response.json({ error: 'Pide una moneda y un día válidos' }, { status: 400 });
  }
  if (de === a) return Response.json({ rate: 1, date: pedido, source: 'igual' });
  // Un día en el futuro: el de hoy
  const hoy = new Date().toISOString().slice(0, 10);
  const dia = pedido > hoy ? hoy : pedido;
  for (const etiqueta of [dia, 'latest']) {
    const t = await tabla(etiqueta, de.toLowerCase());
    if (t === null) break; // no respondió ninguna fuente
    if (t === 'no_esta') continue;
    const rate = Number(t.tasas[a.toLowerCase()]);
    if (Number.isFinite(rate) && rate > 0) return Response.json({ rate, date: t.date, source: 'currency-api' });
  }
  return Response.json({ error: 'No pudimos traer la tasa de cambio' }, { status: 502 });
}
