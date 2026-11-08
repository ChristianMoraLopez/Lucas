import Link from 'next/link';
import { formatRange } from '@/lib/dates';
import type { T } from '@/lib/i18n';
import { dinero, esMoneda } from '@/lib/moneda';
import { plural } from '@/lib/types';

/** todas_las_noches (migración 770): la cadena de cuentas de un mismo grupo, de la más reciente a la primera */
export interface TodasLasNoches {
  total: number;
  gastos: number;
  noches: {
    id: string;
    name: string;
    type: string;
    status: string;
    currency: string;
    starts_on: string | null;
    ends_on: string | null;
    desde: string | null;
    hasta: string | null;
    total: number;
    gastos: number;
  }[];
}

/**
 * «Gentelinda en todas las noches»: cada «Noche nueva» empieza en ceros, pero
 * aquí se ve cuánto llevan en todas y se entra a cualquiera. Solo si hay más
 * de una.
 */
export function NochesDelGrupo({ d, actual, t }: { d: TodasLasNoches; actual: string; t: T }) {
  if (d.noches.length < 2) return null;
  const moneda = esMoneda(d.noches[0].currency) ? d.noches[0].currency : 'COP';
  const evento = d.noches.every((n) => n.type === 'evento');
  return (
    <section className="tn" aria-labelledby="tn-t">
      <div className="tn-head">
        <h2 id="tn-t" className="lu-title">
          {evento ? t('Todas las noches') : t('Todas las veces')}
        </h2>
        <b className="lu-num">{dinero(Number(d.total), moneda, t.idioma)}</b>
      </div>
      <p className="lu-small lu-muted">
        {t('{n} juntas, {gastos}', {
          n: plural(d.noches.length, evento ? t('noche') : t('vez'), evento ? t('noches') : t('veces')),
          gastos: plural(Number(d.gastos), t('gasto'), t('gastos')),
        })}
      </p>
      <ul className="tn-lista">
        {d.noches.map((n) => (
          <li key={n.id}>
            <Link href={`/c/${n.id}/resumen`} className={`tn-noche${n.id === actual ? ' is-actual' : ''}`} aria-current={n.id === actual ? 'page' : undefined}>
              <span className="tn-noche__n">{n.name}</span>
              <span className="lu-small lu-muted">
                {(formatRange(n.desde ?? n.starts_on, n.hasta ?? n.ends_on, t.idioma) ?? t('Sin gastos todavía')) + (n.id === actual ? ` · ${t('esta')}` : '')}
              </span>
              <b className="lu-num">{dinero(Number(n.total), moneda, t.idioma)}</b>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
