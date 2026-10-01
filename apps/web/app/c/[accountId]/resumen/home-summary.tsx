import Link from 'next/link';
import { formatCOP } from '@/components/lucas-core';
import { Amount, Avatar, BillCard, BudgetBar, CategoryTag, LottieSlot, Sticker } from '@/components/lucas-ui';
import { formatRecent, monthName } from '@/lib/dates';
import { asTone, type Dashboard } from '@/lib/types';

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const mesDe = (iso: string) => Number(iso.slice(5, 7)) - 1;
const param = (iso: string) => iso.slice(0, 7);

/** Resumen de una cuenta hogar (captura 3): el mes, en qué se fue, tendencia, presupuestos y últimos gastos. */
export function HomeSummary({ d }: { d: Dashboard }) {
  const base = `/c/${d.account.id}/resumen`;
  const esEsteMes = d.month.slice(0, 7) === d.today.slice(0, 7);
  const nombres = d.people.map((p) => p.name);
  const trend = d.trend ?? [];
  const maxBar = Math.max(d.budget ?? 0, ...trend.map((t) => t.total), 1) * 1.08;
  const mesAnterior = trend.length > 1 ? trend[trend.length - 2] : null;
  const conPresupuesto = d.categories.filter((c) => c.budget);
  const pasados = conPresupuesto.filter((c) => c.total > (c.budget as number)).length;
  const gastado = d.categories.filter((c) => c.total > 0);
  const prevParam = trend.length ? param(trend[trend.length - 2]?.month ?? trend[0].month) : null;
  const nextMonth = new Date(`${d.month}T12:00:00`);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextParam = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;

  return (
    <div className="hd">
      <div className="hd-main">
        <header className="hd-head">
          <div>
            <h1 className="lu-display-xl">{d.account.name}</h1>
            <span className="lu-small lu-muted">Hogar de {nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}` : nombres[0]}</span>
          </div>
          <span className="lu-avatars">
            {d.people.slice(0, 4).map((p) => (
              <Avatar key={p.id} name={p.name} tone={asTone(p.tone, p.name)} registered={p.registered} />
            ))}
          </span>
        </header>

        <BillCard
          label={`${monthName(d.month)} ${d.month.slice(0, 4)}${esEsteMes ? ` · va el día ${Number(d.today.slice(8, 10))}` : ''}`}
          amount={d.total}
          roll
          highlight={esEsteMes}
          href={`/c/${d.account.id}/gastos?mes=${param(d.month)}`}
          linkLabel={`Ver los gastos de ${monthName(d.month).toLowerCase()}`}
          aside={
            <span className="hd-nav">
              {prevParam ? (
                <Link href={`${base}?mes=${prevParam}`} aria-label="Mes anterior" scroll={false}>
                  ‹
                </Link>
              ) : (
                <span aria-hidden="true">‹</span>
              )}
              {esEsteMes ? (
                <span className="is-off" aria-hidden="true">
                  ›
                </span>
              ) : (
                <Link href={`${base}?mes=${nextParam}`} aria-label="Mes siguiente" scroll={false}>
                  ›
                </Link>
              )}
            </span>
          }
        >
          {d.budget ? (
            <span>
              de <b>{formatCOP(d.budget)}</b> · {Math.round((d.total / d.budget) * 100)} %
            </span>
          ) : (
            <span>Sin presupuesto este mes</span>
          )}
          {mesAnterior && d.prev_total != null && (
            <span>
              {d.total >= d.prev_total ? '▲' : '▼'} <b>{formatCOP(Math.abs(d.total - d.prev_total))}</b> vs. {MESES_CORTOS[mesDe(mesAnterior.month)]}
            </span>
          )}
          <span className="lu-bill__more" aria-hidden="true">
            Ver gastos ›
          </span>
        </BillCard>

        <section aria-label="Gasto por categoría">
          <div className="hd-sec">
            <h2 className="lu-title">¿En qué se fue?</h2>
            <span className="lu-label">{monthName(d.month)}</span>
          </div>
          {gastado.length === 0 ? (
            <EmptyMonth accountId={d.account.id} />
          ) : (
            <>
              <div className="hd-stack" role="img" aria-label={`Reparto del gasto de ${monthName(d.month).toLowerCase()} por categoría`}>
                {gastado.map((c) => (
                  <i key={c.id} style={{ flex: c.total, background: `var(--tono-${asTone(c.tone)})` }} />
                ))}
              </div>
              <ul className="hd-catlist">
                {gastado.map((c) => (
                  <li key={c.id}>
                    <CategoryTag name={c.name} />
                    <Amount value={c.total} size="md" />
                    <span className="hd-pct lu-num">{Math.round((c.total / d.total) * 100)} %</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {trend.length > 0 && (
          <section aria-label="Tendencia de 6 meses">
            <div className="hd-sec">
              <h2 className="lu-title">Últimos seis meses</h2>
              {d.budget ? (
                <span className="hd-legend lu-small">
                  <i /> tope {formatCOP(d.budget)}
                </span>
              ) : null}
            </div>
            <div className="hd-bars" role="img" aria-label="Gasto de los últimos seis meses">
              {d.budget ? <div className="hd-budgetline" style={{ bottom: `${(d.budget / maxBar) * 100}%` }} /> : null}
              {trend.map((t) => (
                <Link
                  key={t.month}
                  href={`${base}?mes=${param(t.month)}`}
                  scroll={false}
                  className={`hd-bar${t.month === d.month ? ' is-on' : ''}`}
                  aria-label={`${monthName(t.month)}: ${formatCOP(t.total)}`}
                >
                  <span className="hd-bar__v lu-num">{t.total ? `${(t.total / 1e6).toFixed(2).replace('.', ',')}M` : '—'}</span>
                  <span className="hd-bar__col" style={{ height: `${(t.total / maxBar) * 100}%` }} />
                  <span className="hd-bar__k">{MESES_CORTOS[mesDe(t.month)]}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="hd-aside">
        <section className="hd-budgets" aria-label="Presupuestos">
          <div className="hd-sec">
            <h2 className="lu-title">Presupuestos</h2>
            {pasados ? (
              <Sticker tone="alerta" size="sm" rotate={4}>
                {pasados} {pasados === 1 ? 'pasado' : 'pasados'}
              </Sticker>
            ) : null}
          </div>
          {conPresupuesto.length ? (
            <div className="hd-blist">
              {[...conPresupuesto]
                .sort((a, b) => b.total / (b.budget as number) - a.total / (a.budget as number))
                .map((c) => (
                  <BudgetBar key={c.id} name={c.name} spent={c.total} budget={c.budget as number} />
                ))}
            </div>
          ) : (
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              Todavía no hay presupuestos para {monthName(d.month).toLowerCase()}. Con ellos, Lucas les avisa cuando se pasan.
            </p>
          )}
        </section>

        <section aria-label="Últimos gastos">
          <div className="hd-sec">
            <h2 className="lu-title">Últimos gastos</h2>
            <Link className="hd-all lu-small" href={`/c/${d.account.id}/gastos`}>
              Ver todos
            </Link>
          </div>
          <RecentList d={d} />
        </section>
      </div>
    </div>
  );
}

export function RecentList({ d }: { d: Dashboard }) {
  if (!d.recent.length) {
    return (
      <p className="lu-small lu-muted" style={{ margin: 0 }}>
        Aún no hay gastos.
      </p>
    );
  }
  return (
    <ul className="hd-recent">
      {d.recent.map((r) => (
        <li key={r.id} className="gs-row">
          <CategoryTag name={r.category ?? 'Otros'} showName={false} size="lg" />
          <span className="hd-r__t">
            <Link href={`/c/${d.account.id}/gastos/${r.id}`} className="hd-r__m gs-link">
              {r.merchant}
            </Link>
            <span className="hd-r__s">
              {formatRecent(r.expense_date, r.created_at, d.today)}
              {r.payer && (
                <>
                  {' · '}
                  <Avatar name={r.payer} tone={asTone(r.payer_tone, r.payer)} size="xs" registered={r.payer_registered ?? true} /> {r.payer}
                </>
              )}
              {r.kind === 'pdf' ? ' · PDF' : ''}
              {r.status === 'pending_review' && <span className="ap-pend">por revisar</span>}
            </span>
          </span>
          <Amount value={r.total_cop} />
        </li>
      ))}
    </ul>
  );
}

function EmptyMonth({ accountId }: { accountId: string }) {
  return (
    <div className="ap-empty">
      <LottieSlot name="vacio" width={72} height={72} />
      <span className="lu-small lu-muted" style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        Este mes todavía no hay gastos.
        <Link href={`/c/${accountId}/subir`} className="lu-btn lu-btn--sm lu-btn--secondary">
          Subir el primero
        </Link>
      </span>
    </div>
  );
}
