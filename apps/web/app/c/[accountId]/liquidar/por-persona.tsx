'use client';

import type { ReactNode } from 'react';
import { useT } from '@/components/idioma';
import { ItemsDeUno } from '@/components/items-de-uno';
import { Amount, Avatar, CategoryTag, Sticker } from '@/components/lucas-ui';
import { useDinero } from '@/components/moneda';
import { formatDay } from '@/lib/dates';
import type { Deuda, Tarjeta } from '@/lib/deudas';
import { rico } from '@/lib/i18n/rico';
import { asTone, type SettlementExpense, type SettlementPerson, type SettlementTransfer } from '@/lib/types';

const flecha = (
  <svg className="st-arrow" viewBox="0 0 40 16" aria-hidden="true">
    <path d="M2 8h32M28 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Quién le paga a quién, una tarjeta por persona: al abrir su nombre ve a
 * quién le paga, cuánto y por qué (lo que esa persona pagó por ella, ítem por
 * ítem), lo que ya pagó y lo que se cruzó. La tuya va primero y abierta.
 */
export function PorPersona({
  tarjetas,
  people,
  yo,
  cruza,
  liquidada,
  acciones,
}: {
  tarjetas: Tarjeta[];
  people: Map<string, SettlementPerson>;
  yo: string | null;
  cruza: boolean;
  /** Ya se liquidó (si no, así quedarían) */
  liquidada: boolean;
  /** Los botones de una transferencia: cobrar, marcar pagada, deshacer */
  acciones: (x: SettlementTransfer, i: number) => ReactNode;
}) {
  const t = useT();
  const nombre = (id: string) => people.get(id)?.name ?? t('Alguien');
  const lista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ${t('y')} ${xs.at(-1)}` : (xs[0] ?? ''));

  return (
    <ol className="st-cards lu-stagger" aria-label={liquidada ? t('Transferencias') : t('Así quedarían las transferencias')}>
      {tarjetas.map((tj, i) => {
        const p = people.get(tj.person);
        const mia = tj.person === yo;
        const pendientes = tj.deudas.filter((d) => d.estado === 'pendiente').map((d) => nombre(d.to));
        const pagadas = tj.deudas.filter((d) => d.estado === 'pagada' || d.estado === 'ya_pagada').map((d) => nombre(d.to));
        const resumen = [
          pendientes.length ? t('le paga a {lista}', { lista: lista(pendientes) }) : null,
          pagadas.length ? t('ya le pagó a {lista}', { lista: lista(pagadas) }) : null,
          tj.cobros.length === 1
            ? t('{nombre} le paga', { nombre: nombre(tj.cobros[0].from) })
            : tj.cobros.length
              ? t('{n} le pagan', { n: tj.cobros.length })
              : null,
        ].filter(Boolean);
        return (
          <li key={tj.person} className={`st-c${mia ? ' is-mia' : ''}${tj.pendiente === 0 ? ' is-done' : ''}`} style={{ '--i': i } as React.CSSProperties}>
            <details className="st-c__d" open={mia || tarjetas.length === 1}>
              <summary className="st-c__s">
                <Avatar name={nombre(tj.person)} tone={asTone(p?.tone, nombre(tj.person))} registered={p?.registered} size="sm" />
                <span className="st-c__who">
                  <b>
                    {nombre(tj.person)}
                    {mia ? ` ${t('(tú)')}` : ''}
                  </b>
                  <span className="lu-muted st-c__sub">{resumen.join(' · ')}</span>
                </span>
                <span className="st-c__bal">
                  {tj.pendiente > 0 ? (
                    <>
                      <Amount value={tj.pendiente} size="lg" />
                      <span className="lu-muted">{liquidada ? t('le falta pagar') : t('debe')}</span>
                    </>
                  ) : tj.porRecibir > 0 ? (
                    <>
                      <Amount value={tj.porRecibir} size="lg" tone="pos" />
                      <span className="lu-muted">{t('le deben')}</span>
                    </>
                  ) : (
                    <span className="st-c__ok">{tj.deudas.some((d) => d.estado !== 'a_mano') ? t('ya pagó todo') : t('a paz y salvo')}</span>
                  )}
                </span>
                <span className="st-c__chev" aria-hidden="true" />
              </summary>

              <div className="st-c__body">
                {tj.deudas.map((d) => (
                  <DeudaDe key={d.to} d={d} de={tj.person} people={people} liquidada={liquidada} acciones={acciones} i={i} />
                ))}
                {cruza && tj.deudas.length > 0 && (
                  <p className="lu-small lu-muted st-c__nota">
                    {t('Se cruzaron las deudas para hacer menos transferencias: puede que le pague a alguien que no pagó lo suyo.')}
                  </p>
                )}
                {tj.cobros.length > 0 && (
                  <section className="st-d st-d--cobros" aria-label={t('Le pagan')}>
                    <h4 className="lu-label st-d__h">{t('Le pagan')}</h4>
                    <ul className="st-c__cobros">
                      {tj.cobros.map((x) => {
                        const de = people.get(x.from);
                        return (
                          <li key={x.id} className={`st-c__li${x.paid_at ? ' is-paid' : ''}`}>
                            <Avatar name={nombre(x.from)} tone={asTone(de?.tone, nombre(x.from))} registered={de?.registered} size="sm" />
                            <span className="st-c__cobro">
                              {nombre(x.from)}
                              {x.paid_at && (
                                <span className="lu-muted"> · {t('pagada {fecha}', { fecha: formatDay(new Date(x.paid_at), undefined, t.idioma) })}</span>
                              )}
                            </span>
                            <Amount value={x.amount} size="sm" tone={x.paid_at ? 'pos' : undefined} />
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

/** A quién le paga, cuánto, los botones y por qué: lo que esa persona pagó por ella */
function DeudaDe({
  d,
  de,
  people,
  liquidada,
  acciones,
  i,
}: {
  d: Deuda;
  de: string;
  people: Map<string, SettlementPerson>;
  liquidada: boolean;
  acciones: (x: SettlementTransfer, i: number) => ReactNode;
  i: number;
}) {
  const t = useT();
  const fmt = useDinero().fmt;
  const nombre = (id: string) => people.get(id)?.name ?? t('Alguien');
  const para = people.get(d.to);
  const dia = (s: string) => formatDay(new Date(s), undefined, t.idioma);
  const estado =
    d.estado === 'pendiente'
      ? liquidada
        ? t('falta pagarle')
        : t('así quedaría')
      : d.estado === 'pagada'
        ? t('pagada')
        : d.estado === 'ya_pagada'
          ? t('ya se lo pagó')
          : t('a mano: se cruza con lo que {nombre} le debía', { nombre: nombre(d.to) });
  const tag = (e: SettlementExpense) =>
    e.category ? (
      <CategoryTag name={e.category} showName={false} size="sm" letter={e.category_letter ?? undefined} tone={asTone(e.category_tone)} />
    ) : (
      <span className="st-p__sin" aria-hidden="true" />
    );

  return (
    <section className={`st-d is-${d.estado}`} aria-label={t('{de} le paga a {para}', { de: nombre(de), para: nombre(d.to) })}>
      <div className="st-d__head">
        {flecha}
        <Avatar name={nombre(d.to)} tone={asTone(para?.tone, nombre(d.to))} registered={para?.registered} size="sm" />
        <span className="st-d__who">
          <span>{rico(t('A {nombre}'), { nombre: <b>{nombre(d.to)}</b> })}</span>
          <span className="lu-small lu-muted">{estado}</span>
        </span>
        {d.monto > 0 && <Amount value={d.monto} className="st-d__amt" tone={d.estado === 'pendiente' ? undefined : 'pos'} />}
      </div>
      {d.transfer ? (
        <div className="st-act st-d__act">{acciones(d.transfer, i)}</div>
      ) : (
        d.estado === 'ya_pagada' && (
          <div className="st-act st-d__act">
            <Sticker tone="pagado" rotate={-4} sub={d.paidAt ? dia(d.paidAt) : undefined} />
          </div>
        )
      )}
      {(d.gastos.length > 0 || d.cruce > 0 || d.devuelto > 0) && (
        <ul className="st-p__gastos st-d__gastos" aria-label={t('Por qué')}>
          {d.gastos.map(({ e, r }) => (
            <li key={e.id} className="st-p__g">
              {tag(e)}
              <span className="st-p__m">
                {e.merchant}
                <span className="lu-muted"> · {formatDay(e.expense_date, undefined, t.idioma)}</span>
              </span>
              <Amount value={r.parte} size="sm" />
              <ItemsDeUno recibo={r} label={t('Lo que pidió {nombre} en {comercio}', { nombre: nombre(de), comercio: e.merchant })} fmt={fmt} t={t} />
            </li>
          ))}
          {d.cruce > 0 && (
            <li className="st-d__ajuste">
              <span>{t('Menos lo que {nombre} le debía', { nombre: nombre(d.to) })}</span>
              <span className="lu-num">−{fmt(d.cruce)}</span>
            </li>
          )}
          {d.pagado > 0 && d.estado !== 'ya_pagada' && (
            <li className="st-d__ajuste">
              <span>{t('Menos lo que ya le pagó')}</span>
              <span className="lu-num">−{fmt(d.pagado)}</span>
            </li>
          )}
          {d.devuelto > 0 && (
            <li className="st-d__ajuste">
              <span>{t('Más lo que {nombre} ya le había pagado', { nombre: nombre(d.to) })}</span>
              <span className="lu-num">+{fmt(d.devuelto)}</span>
            </li>
          )}
        </ul>
      )}
      {d.transfer && !d.gastos.length && (
        <p className="lu-small lu-muted st-c__nota">
          {t('{nombre} no pagó nada suyo: se cruzaron las deudas para hacer menos transferencias.', { nombre: nombre(d.to) })}
        </p>
      )}
    </section>
  );
}
