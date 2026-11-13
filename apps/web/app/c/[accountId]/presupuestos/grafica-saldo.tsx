'use client';

import { useT } from '@/components/idioma';
import { abreviado, type Moneda } from '@/lib/moneda';
import { curva, type Escenario, type proyectar, saldo } from '@/lib/proyeccion';

const W = 640;
const H = 260;
const M = { l: 52, r: 14, t: 14, b: 30 };

/** El saldo (o el gasto diario) día por día, con el umbral, la alerta y lo que viene */
export function GraficaSaldo({
  e,
  r,
  vista,
  horizonte,
  moneda,
  fecha,
}: {
  e: Escenario;
  r: ReturnType<typeof proyectar>;
  vista: 'saldo' | 'gasto';
  horizonte: number;
  moneda: Moneda;
  fecha: (dia: number) => string;
}) {
  const t = useT();
  const eventos = e.eventos ?? [];
  // Hasta un poco después del agotamiento (o de lo último que viene), mínimo un mes
  const fin = Math.min(horizonte, Math.ceil(Math.max(30, (r.agotamiento?.dia ?? horizonte) + 3, ...eventos.map((x) => x.dia + 5))));
  const puntos = curva(e, fin);
  const constante: Escenario = { ...e, gastoBase: e.gastoHoy, eventos: eventos.map((x) => ({ ...x, reinicia: false })) };

  const valor = (p: (typeof puntos)[number]) => (vista === 'saldo' ? Math.max(p.saldo, 0) : p.gasto);
  const tope = Math.max(...puntos.map(valor), vista === 'saldo' ? e.umbral : e.gastoHoy, 1);
  // Marcas redondas en el eje (1, 2 o 5 por una potencia de 10)
  const bruto = tope / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const pasoY = ([1, 2, 2.5, 5, 10].find((m) => m * potencia >= bruto) ?? 10) * potencia;
  const maxY = Math.ceil((tope * 1.04) / pasoY) * pasoY;
  const x = (d: number) => M.l + (d / fin) * (W - M.l - M.r);
  const y = (v: number) => H - M.b - (v / maxY) * (H - M.t - M.b);

  // En el saldo, la curva se corta al llegar a cero (el modelo no representa deuda)
  const visibles = vista === 'saldo' ? puntos.filter((p, i) => p.saldo > 0 || (i > 0 && puntos[i - 1].saldo > 0)) : puntos;
  const linea = visibles.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(valor(p)).toFixed(1)}`).join('');
  const lineaConstante =
    vista === 'saldo'
      ? puntos
          .filter((p) => saldo(constante, p.t) > -maxY * 0.02)
          .map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(Math.max(saldo(constante, p.t), 0)).toFixed(1)}`)
          .join('')
      : `M${x(0)},${y(e.gastoHoy)}L${x(fin)},${y(e.gastoHoy)}`;

  const marcasY = Array.from({ length: Math.round(maxY / pasoY) + 1 }, (_, i) => i * pasoY);
  const paso = fin <= 31 ? 5 : fin <= 60 ? 10 : 15;
  const marcasX = Array.from({ length: Math.floor(fin / paso) + 1 }, (_, i) => i * paso);

  const etiqueta =
    vista === 'saldo'
      ? t('Saldo proyectado: alerta el {fecha}', { fecha: r.alerta ? fecha(r.alerta.dia) : '—' })
      : t('Gasto diario proyectado: empieza en {monto} y baja hacia el gasto base', { monto: abreviado(e.gastoHoy, moneda, t.idioma) });

  return (
    <figure className="pr-graf">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={etiqueta}>
        {marcasY.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className="pr-graf__rej" />
            <text x={M.l - 8} y={y(v) + 4} textAnchor="end" className="pr-graf__eje">
              {abreviado(v, moneda, t.idioma)}
            </text>
          </g>
        ))}
        {marcasX.map((d) => (
          <text key={d} x={x(d)} y={H - 10} textAnchor="middle" className="pr-graf__eje">
            {d}
          </text>
        ))}

        {eventos
          .filter((ev) => ev.dia <= fin)
          .map((ev) => (
            <g key={`${ev.dia}-${ev.monto}`}>
              <line x1={x(ev.dia)} x2={x(ev.dia)} y1={M.t} y2={H - M.b} className={ev.monto > 0 ? 'pr-graf__ingreso' : 'pr-graf__gasto'} />
              <text x={x(ev.dia) + 4} y={M.t + 10} className="pr-graf__eje">
                {ev.monto > 0 ? '+' : '−'}
                {abreviado(Math.abs(ev.monto), moneda, t.idioma)}
              </text>
            </g>
          ))}

        {vista === 'saldo' ? (
          <line x1={M.l} x2={W - M.r} y1={y(e.umbral)} y2={y(e.umbral)} className="pr-graf__umbral" />
        ) : (
          <line x1={M.l} x2={W - M.r} y1={y(e.gastoBase)} y2={y(e.gastoBase)} className="pr-graf__base" />
        )}
        <path d={lineaConstante} className="pr-graf__constante" />
        <path d={linea} className="pr-graf__linea" />

        {vista === 'saldo' && r.alerta && r.alerta.dia <= fin && <circle cx={x(r.alerta.dia)} cy={y(e.umbral)} r={6} className="pr-graf__alerta" />}
        {vista === 'saldo' && r.agotamiento && r.agotamiento.dia <= fin && <circle cx={x(r.agotamiento.dia)} cy={y(0)} r={5} className="pr-graf__cero" />}
      </svg>
      <figcaption className="pr-leyenda lu-small">
        <span>
          <i className="is-linea" /> {vista === 'saldo' ? t('Saldo con ajuste del gasto') : t('Gasto diario')}
        </span>
        <span>
          <i className="is-constante" /> {vista === 'saldo' ? t('Gastando siempre lo de hoy') : t('Gasto de hoy')}
        </span>
        <span>
          <i className={vista === 'saldo' ? 'is-umbral' : 'is-base'} /> {vista === 'saldo' ? t('Alerta') : t('Gasto que no se recorta')}
        </span>
        <span className="lu-muted">{t('días desde hoy')}</span>
      </figcaption>
    </figure>
  );
}
