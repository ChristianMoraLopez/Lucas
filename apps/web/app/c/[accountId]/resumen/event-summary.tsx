import Link from 'next/link';
import { InviteWhatsapp } from '@/components/invite-whatsapp';
import { Amount, Avatar, BillCard, CategoryTag, LottieSlot, Sticker } from '@/components/lucas-ui';
import { eventMoment, formatRange } from '@/lib/dates';
import type { T } from '@/lib/i18n';
import { rico } from '@/lib/i18n/rico';
import { corto, dinero, type Moneda } from '@/lib/moneda';
import { asTone, type Dashboard, plural } from '@/lib/types';

/** Resumen de una cuenta evento (captura 4): total, en qué se fue y quién puso más. */
export function EventSummary({
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
  const n = d.people.length;
  const rango = formatRange(d.account.starts_on, d.account.ends_on, t.idioma);
  const momento = eventMoment(d.account.starts_on, d.account.ends_on, d.today, t.idioma);
  const termino = !!d.account.ends_on && d.account.ends_on < d.today;
  const maxAbs = Math.max(...d.people.map((p) => Math.abs(p.balance)), 1);
  const gastado = d.categories.filter((c) => c.total > 0);

  return (
    <div className="ed">
      <header className="ed-head">
        <span className="lu-label">
          {t('Evento')}
          {rango ? ` · ${rango}` : ''}
        </span>
        <h1 className="lu-display-xl">{d.account.name}</h1>
        {invitar && (
          <div className="ed-invite">
            <InviteWhatsapp accountId={d.account.id} accountName={d.account.name} accountType="evento" variant="secondary" />
          </div>
        )}
      </header>
      {aviso}

      {d.pending_count > 0 && (
        <div className="ed-alert" role="status">
          <Sticker tone="revisar" rotate={-5}>
            {t('{n} por revisar', { n: d.pending_count })}
          </Sticker>
          <span className="lu-small" style={{ flex: 1, minWidth: 160 }}>
            {termino
              ? t('{momento}. Revisen lo pendiente y después liquidan.', { momento })
              : t('Hay gastos que Luks no leyó seguros. Revísenlos para que cuenten bien.')}
          </span>
          <Link href={`/c/${d.account.id}/revisar`} className="lu-btn lu-btn--sm lu-btn--primary">
            {t('Revisar')}
          </Link>
        </div>
      )}

      <div className="ed-top">
        <BillCard
          label={t('Total del evento')}
          amount={d.total}
          tone="morado"
          denom={n === 1 ? t('1 PERSONA') : t('{n} PERSONAS', { n })}
          roll
          href={`/c/${d.account.id}/gastos`}
          linkLabel={t('Ver todos los gastos del evento')}
        >
          {d.all_equal && n > 0 ? (
            <span>{rico(t('{monto} a cada uno'), { monto: <b>{formatCOP(Math.round(d.total / n))}</b> })}</span>
          ) : (
            <span>{t('Divisiones a la medida')}</span>
          )}
          <span>
            {plural(d.expense_count, t('gasto'), t('gastos'))}
            {d.all_equal ? ` · ${t('partes iguales')}` : ''}
          </span>
          <span className="lu-bill__more" aria-hidden="true">
            {t('Ver gastos ›')}
          </span>
        </BillCard>

        <section className="ed-cats" aria-label={t('Por categoría')}>
          <h2 className="lu-title" style={{ marginBottom: 12 }}>
            {t('¿En qué se fue?')}
          </h2>
          {gastado.length ? (
            <>
              <div className="ed-stack" aria-hidden="true">
                {gastado.map((c) => (
                  <i key={c.id} style={{ flex: c.total, background: `var(--tono-${asTone(c.tone)})` }} />
                ))}
              </div>
              {gastado.map((c) => (
                <div className="ed-cat" key={c.id}>
                  <CategoryTag name={c.name} size="sm" />
                  <Amount value={c.total} />
                </div>
              ))}
            </>
          ) : (
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {t('Cuando lleguen gastos, aquí se ve en qué se fue la plata.')}
            </p>
          )}
        </section>
      </div>

      <section className="ed-people" aria-label={t('Balance por persona')}>
        <div className="ed-sec">
          <h2 className="lu-title">{t('¿Quién puso más?')}</h2>
          <span className="ed-legend lu-small">
            <i className="neg" /> {t('debe')} <i className="pos" /> {t('le deben')}
          </span>
        </div>
        {d.expense_count === 0 ? (
          <div className="ap-empty">
            <LottieSlot name="vacio" width={72} height={72} />
            <span className="lu-small lu-muted" style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
              {t('Todavía no hay gastos en el evento.')}
              <Link href={`/c/${d.account.id}/subir`} className="lu-btn lu-btn--sm lu-btn--secondary">
                {t('Subir el primero')}
              </Link>
            </span>
          </div>
        ) : (
          <>
            <ul className="ed-list">
              {d.people.map((p) => (
                <li key={p.id}>
                  <span className="ed-who">
                    <Avatar name={p.name} tone={asTone(p.tone, p.name)} size="sm" registered={p.registered} />
                    <span style={{ display: 'grid', minWidth: 0 }}>
                      <b>{p.name}</b>
                      <span className="lu-muted" style={{ fontSize: 12 }}>
                        {t('pagó {monto}', { monto: formatCOP(p.paid) })}
                      </span>
                    </span>
                  </span>
                  <span className="ed-track" aria-hidden="true">
                    <i className={p.balance >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(p.balance) / maxAbs) * 50}%` }} />
                  </span>
                  <span className="ed-bal">
                    <Amount value={p.balance} sign tone={p.balance >= 0 ? 'pos' : 'neg'} />
                    <span className="lu-muted">{p.balance === 0 ? t('a paz y salvo') : corto(p.balance, moneda, t.idioma)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Link href={`/c/${d.account.id}/liquidar`} className="lu-btn lu-btn--secondary ed-cta">
              {t('Ver quién le paga a quién')}
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
