import Link from 'next/link';
import { formatCOP, lucas } from '@/components/lucas-core';
import { Amount, Avatar, BillCard, CategoryTag, LottieSlot, Sticker } from '@/components/lucas-ui';
import { eventMoment, formatRange } from '@/lib/dates';
import { asTone, type Dashboard, plural } from '@/lib/types';

/** Resumen de una cuenta evento (captura 4): total, en qué se fue y quién puso más. */
export function EventSummary({ d }: { d: Dashboard }) {
  const n = d.people.length;
  const rango = formatRange(d.account.starts_on, d.account.ends_on);
  const momento = eventMoment(d.account.starts_on, d.account.ends_on, d.today);
  const termino = momento.startsWith('Terminó');
  const maxAbs = Math.max(...d.people.map((p) => Math.abs(p.balance)), 1);
  const gastado = d.categories.filter((c) => c.total > 0);

  return (
    <div className="ed">
      <header className="ed-head">
        <span className="lu-label">Evento{rango ? ` · ${rango}` : ''}</span>
        <h1 className="lu-display-xl">{d.account.name}</h1>
      </header>

      {d.pending_count > 0 && (
        <div className="ed-alert" role="status">
          <Sticker tone="revisar" rotate={-5}>
            {d.pending_count} por revisar
          </Sticker>
          <span className="lu-small" style={{ flex: 1, minWidth: 160 }}>
            {termino
              ? `El evento ${momento.charAt(0).toLowerCase()}${momento.slice(1)}. Revisen lo pendiente y después liquidan.`
              : 'Hay gastos que Lucas no leyó seguros. Revísenlos para que cuenten bien.'}
          </span>
          <Link href={`/c/${d.account.id}/revisar`} className="lu-btn lu-btn--sm lu-btn--primary">
            Revisar
          </Link>
        </div>
      )}

      <div className="ed-top">
        <BillCard
          label="Total del evento"
          amount={d.total}
          tone="morado"
          denom={`${n} ${n === 1 ? 'PERSONA' : 'PERSONAS'}`}
          roll
          href={`/c/${d.account.id}/gastos`}
          linkLabel="Ver todos los gastos del evento"
        >
          {d.all_equal && n > 0 ? (
            <span>
              <b>{formatCOP(Math.round(d.total / n))}</b> a cada uno
            </span>
          ) : (
            <span>Divisiones a la medida</span>
          )}
          <span>
            {plural(d.expense_count, 'gasto', 'gastos')}
            {d.all_equal ? ' · partes iguales' : ''}
          </span>
          <span className="lu-bill__more" aria-hidden="true">
            Ver gastos ›
          </span>
        </BillCard>

        <section className="ed-cats" aria-label="Por categoría">
          <h2 className="lu-title" style={{ marginBottom: 12 }}>
            ¿En qué se fue?
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
              Cuando lleguen gastos, aquí se ve en qué se fue la plata.
            </p>
          )}
        </section>
      </div>

      <section className="ed-people" aria-label="Balance por persona">
        <div className="ed-sec">
          <h2 className="lu-title">¿Quién puso más?</h2>
          <span className="ed-legend lu-small">
            <i className="neg" /> debe <i className="pos" /> le deben
          </span>
        </div>
        {d.expense_count === 0 ? (
          <div className="ap-empty">
            <LottieSlot name="vacio" width={72} height={72} />
            <span className="lu-small lu-muted" style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
              Todavía no hay gastos en el evento.
              <Link href={`/c/${d.account.id}/subir`} className="lu-btn lu-btn--sm lu-btn--secondary">
                Subir el primero
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
                        pagó {formatCOP(p.paid)}
                      </span>
                    </span>
                  </span>
                  <span className="ed-track" aria-hidden="true">
                    <i className={p.balance >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(p.balance) / maxAbs) * 50}%` }} />
                  </span>
                  <span className="ed-bal">
                    <Amount value={p.balance} sign tone={p.balance >= 0 ? 'pos' : 'neg'} />
                    <span className="lu-muted">{p.balance === 0 ? 'a paz y salvo' : lucas(p.balance)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Link href={`/c/${d.account.id}/liquidar`} className="lu-btn lu-btn--secondary ed-cta">
              Ver quién le paga a quién
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
