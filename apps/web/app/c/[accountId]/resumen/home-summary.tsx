import Link from 'next/link';
import { InviteWhatsapp } from '@/components/invite-whatsapp';
import { Amount, Avatar, BillCard, BudgetBar, CategoryTag, LottieSlot, Sticker } from '@/components/lucas-ui';
import { formatRecent, mesCorto, monthName } from '@/lib/dates';
import type { T } from '@/lib/i18n';
import { rico } from '@/lib/i18n/rico';
import { abreviado, dinero, type Moneda } from '@/lib/moneda';
import { asTone, type Dashboard } from '@/lib/types';

const param = (iso: string) => iso.slice(0, 7);

/** Resumen de una cuenta hogar (captura 3): el mes, en qué se fue, tendencia, presupuestos y últimos gastos. */
export function HomeSummary({
  d,
  invitar = false,
  aviso = null,
  t,
  moneda,
}: {
  d: Dashboard;
  invitar?: boolean;
  aviso?: React.ReactNode;
  t: T;
  moneda: Moneda;
}) {
  const formatCOP = (v: number) => dinero(v, moneda, t.idioma);
  const mes = (iso: string) => monthName(iso, t.idioma);
  // «septiembre» en una frase en español; «September» en inglés
  const mesEnFrase = (iso: string) => (t.idioma === 'en' ? mes(iso) : mes(iso).toLowerCase());
  const base = `/c/${d.account.id}/resumen`;
  const esEsteMes = d.month.slice(0, 7) === d.today.slice(0, 7);
  const nombres = d.people.map((p) => p.name);
  const trend = d.trend ?? [];
  const maxBar = Math.max(d.budget ?? 0, ...trend.map((x) => x.total), 1) * 1.08;
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
            <span className="lu-small lu-muted">
              {t('Hogar de {nombres}', {
                nombres: nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} ${t('y')} ${nombres.at(-1)}` : (nombres[0] ?? ''),
              })}
            </span>
            {invitar && (
              <div className="ed-invite">
                <InviteWhatsapp accountId={d.account.id} accountName={d.account.name} accountType="hogar" variant="secondary" />
              </div>
            )}
          </div>
          <span className="lu-avatars">
            {d.people.slice(0, 4).map((p) => (
              <Avatar key={p.id} name={p.name} tone={asTone(p.tone, p.name)} registered={p.registered} />
            ))}
          </span>
        </header>
        {aviso}

        <BillCard
          label={`${mes(d.month)} ${d.month.slice(0, 4)}${esEsteMes ? ` · ${t('va el día {n}', { n: Number(d.today.slice(8, 10)) })}` : ''}`}
          amount={d.total}
          roll
          highlight={esEsteMes}
          href={`/c/${d.account.id}/gastos?mes=${param(d.month)}`}
          linkLabel={t('Ver los gastos de {mes}', { mes: mesEnFrase(d.month) })}
          aside={
            <span className="hd-nav">
              {prevParam ? (
                <Link href={`${base}?mes=${prevParam}`} aria-label={t('Mes anterior')} scroll={false}>
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
                <Link href={`${base}?mes=${nextParam}`} aria-label={t('Mes siguiente')} scroll={false}>
                  ›
                </Link>
              )}
            </span>
          }
        >
          {d.budget ? (
            <span>{rico(t('de {monto} · {n} %'), { monto: <b>{formatCOP(d.budget)}</b>, n: Math.round((d.total / d.budget) * 100) })}</span>
          ) : (
            <span>{t('Sin presupuesto este mes')}</span>
          )}
          {mesAnterior && d.prev_total != null && (
            <span>
              {d.total >= d.prev_total ? '▲' : '▼'} <b>{formatCOP(Math.abs(d.total - d.prev_total))}</b> {t('vs.')} {mesCorto(mesAnterior.month, t.idioma)}
            </span>
          )}
          <span className="lu-bill__more" aria-hidden="true">
            {t('Ver gastos ›')}
          </span>
        </BillCard>

        <section aria-label={t('Gasto por categoría')}>
          <div className="hd-sec">
            <h2 className="lu-title">{t('¿En qué se fue?')}</h2>
            <span className="lu-label">{mes(d.month)}</span>
          </div>
          {gastado.length === 0 ? (
            <EmptyMonth accountId={d.account.id} t={t} />
          ) : (
            <>
              <div className="hd-stack" role="img" aria-label={t('Reparto del gasto de {mes} por categoría', { mes: mesEnFrase(d.month) })}>
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
          <section aria-label={t('Tendencia de 6 meses')}>
            <div className="hd-sec">
              <h2 className="lu-title">{t('Últimos seis meses')}</h2>
              {d.budget ? (
                <span className="hd-legend lu-small">
                  <i /> {t('tope {monto}', { monto: formatCOP(d.budget) })}
                </span>
              ) : null}
            </div>
            <div className="hd-bars" role="img" aria-label={t('Gasto de los últimos seis meses')}>
              {d.budget ? <div className="hd-budgetline" style={{ bottom: `${(d.budget / maxBar) * 100}%` }} /> : null}
              {trend.map((x) => (
                <Link
                  key={x.month}
                  href={`${base}?mes=${param(x.month)}`}
                  scroll={false}
                  className={`hd-bar${x.month === d.month ? ' is-on' : ''}`}
                  aria-label={`${mes(x.month)}: ${formatCOP(x.total)}`}
                >
                  <span className="hd-bar__v lu-num">{x.total ? abreviado(x.total, moneda, t.idioma) : '—'}</span>
                  <span className="hd-bar__col" style={{ height: `${(x.total / maxBar) * 100}%` }} />
                  <span className="hd-bar__k">{mesCorto(x.month, t.idioma)}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="hd-aside">
        <section className="hd-budgets" aria-label={t('Presupuestos')}>
          <div className="hd-sec">
            <h2 className="lu-title">{t('Presupuestos')}</h2>
            {pasados ? (
              <Sticker tone="alerta" size="sm" rotate={4}>
                {pasados === 1 ? t('1 pasado') : t('{n} pasados', { n: pasados })}
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
              {t('Todavía no hay presupuestos para {mes}. Con ellos, Luks les avisa cuando se pasan.', { mes: mesEnFrase(d.month) })}
            </p>
          )}
        </section>

        <section className="hd-liq" aria-label={t('Liquidar el mes')}>
          <h2 className="lu-title" style={{ margin: 0 }}>
            {t('¿Quién le paga a quién?')}
          </h2>
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            {t('Lo que puso cada uno en {mes} y cómo quedan a mano.', { mes: mesEnFrase(d.month) })}
          </p>
          <Link href={`/c/${d.account.id}/liquidar?mes=${param(d.month)}`} className="lu-btn lu-btn--sm lu-btn--secondary">
            {t('Liquidar {mes}', { mes: mesEnFrase(d.month) })}
          </Link>
        </section>

        <section aria-label={t('Últimos gastos')}>
          <div className="hd-sec">
            <h2 className="lu-title">{t('Últimos gastos')}</h2>
            <Link className="hd-all lu-small" href={`/c/${d.account.id}/gastos`}>
              {t('Ver todos')}
            </Link>
          </div>
          <RecentList d={d} t={t} />
        </section>
      </div>
    </div>
  );
}

export function RecentList({ d, t }: { d: Dashboard; t: T }) {
  if (!d.recent.length) {
    return (
      <p className="lu-small lu-muted" style={{ margin: 0 }}>
        {t('Aún no hay gastos.')}
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
              {formatRecent(r.expense_date, r.created_at, d.today, t.idioma)}
              {r.payer && (
                <>
                  {' · '}
                  <Avatar name={r.payer} tone={asTone(r.payer_tone, r.payer)} size="xs" registered={r.payer_registered ?? true} /> {r.payer}
                </>
              )}
              {r.kind === 'pdf' ? ' · PDF' : ''}
              {r.status === 'pending_review' && <span className="ap-pend">{t('por revisar')}</span>}
            </span>
          </span>
          <Amount value={r.total_cop} />
        </li>
      ))}
    </ul>
  );
}

function EmptyMonth({ accountId, t }: { accountId: string; t: T }) {
  return (
    <div className="ap-empty">
      <LottieSlot name="vacio" width={72} height={72} />
      <span className="lu-small lu-muted" style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        {t('Este mes todavía no hay gastos.')}
        <Link href={`/c/${accountId}/subir`} className="lu-btn lu-btn--sm lu-btn--secondary">
          {t('Subir el primero')}
        </Link>
      </span>
    </div>
  );
}
