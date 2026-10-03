import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { LogoLink } from '@/components/logo-link';
import { formatCOP, lucas } from '@/components/lucas-core';
import { Amount, Avatar, BillCard, CategoryTag, Sticker } from '@/components/lucas-ui';
import { formatDay, formatRange, monthName } from '@/lib/dates';
import { MARCA, personView, transfersFor } from '@/lib/share';
import { asTone, plural, type SharedOverview } from '@/lib/types';
import { createClient } from '@/utils/supabase/server';

/*
 * Las cuentas que alguien compartió (/r/TOKEN). Las ve cualquiera con el link,
 * sin entrar: cuánto puso cada uno, cuánto le toca, en qué se fue la plata y
 * quién le paga a quién. Con ?p=persona, primero lo de esa persona: es el link
 * que llega en el mensaje de cobro. Nada de fotos, números ni correos.
 */

const uno = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/** La misma consulta para los metadatos y la página */
const leer = cache(async (token: string, mes: string | undefined) => {
  const month = mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? `${mes}-01` : null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('shared_overview', { p_token: token, p_month: month });
  if (error) throw error;
  return data as SharedOverview | null;
});

export async function generateMetadata({ params, searchParams }: PageProps<'/r/[token]'>): Promise<Metadata> {
  const { token } = await params;
  const sp = await searchParams;
  const d = await leer(token, uno(sp.mes));
  // Son las cuentas de un grupo de amigos: que los buscadores no las guarden
  const robots = { index: false, follow: false };
  if (!d) return { title: 'Luks', robots };

  const total = d.people.reduce((s, p) => s + p.paid, 0);
  const yo = d.people.find((p) => p.id === uno(sp.p));
  const ts = transfersFor(d);
  let title: string;
  let description: string;
  if (yo) {
    const { debe, recibe } = personView(yo.id, ts);
    title = `${yo.name}, te toca ${formatCOP(yo.share)} · ${d.account.name}`;
    description = debe.length
      ? `Le debes ${formatCOP(debe.reduce((s, t) => s + t.amount, 0))} a ${nombres(
          d,
          debe.map((t) => t.to),
        )}. Mira en qué se fue la plata.`
      : recibe.length
        ? `Te deben ${formatCOP(recibe.reduce((s, t) => s + t.amount, 0))}. Mira cuánto puso cada uno.`
        : 'Estás a paz y salvo. Mira cuánto puso cada uno.';
  } else {
    title = `Las cuentas de «${d.account.name}»`;
    description = `Gastaron ${formatCOP(total)} entre ${plural(d.people.length, 'persona', 'personas')}. Mira cuánto le toca a cada uno.`;
  }
  // La vista previa en WhatsApp: una imagen con cuánto fue y quién le paga a quién
  const q = new URLSearchParams();
  if (yo) q.set('p', yo.id);
  if (d.month && d.account.type !== 'evento') q.set('mes', d.month.slice(0, 7));
  const image = { url: `/r/${token}/imagen${q.size ? `?${q}` : ''}`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    robots,
    openGraph: { type: 'website', siteName: 'Luks', title, description, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

function nombres(d: SharedOverview, ids: string[]) {
  const ns = ids.map((id) => d.people.find((p) => p.id === id)?.name ?? 'alguien');
  return ns.length <= 1 ? (ns[0] ?? '') : `${ns.slice(0, -1).join(', ')} y ${ns.at(-1)}`;
}

/** «2026-09-01» ± n meses → «2026-08» */
function otroMes(mes: string, n: number) {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export default async function CuentasCompartidas({ params, searchParams }: PageProps<'/r/[token]'>) {
  const { token } = await params;
  const sp = await searchParams;
  const d = await leer(token, uno(sp.mes));
  if (!d) notFound();

  const evento = d.account.type === 'evento';
  const people = new Map(d.people.map((p) => [p.id, p]));
  const nombre = (id: string | null) => (id && people.get(id)?.name) || 'Alguien';
  const yo = d.people.find((p) => p.id === uno(sp.p)) ?? null;
  const ts = transfersFor(d);
  const total = d.people.reduce((s, p) => s + p.paid, 0);
  const partes = new Set(d.people.map((p) => p.share));
  const porCabeza = partes.size === 1 && total > 0 ? d.people[0].share : null;
  const liquidada = Boolean(d.settlement);
  const mes = d.month ? d.month.slice(0, 7) : null;
  // Los links de la página conservan el mes (hogar) y la persona
  const aqui = (o: { p?: string | null; mes?: string | null }) => {
    const q = new URLSearchParams();
    const p = o.p === undefined ? yo?.id : o.p;
    const m = o.mes === undefined ? mes : o.mes;
    if (p) q.set('p', p);
    if (m && !evento) q.set('mes', m);
    const s = q.toString();
    return `/r/${token}${s ? `?${s}` : ''}`;
  };
  const vista = yo ? personView(yo.id, ts) : null;
  const gastos = yo ? d.expenses.filter((e) => e.shares.some((x) => x.person_id === yo.id) || e.payer_person_id === yo.id) : d.expenses;

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
        <Link href="/" className="lu-btn lu-btn--sm lu-btn--secondary sh-bar-cta">
          Hacer mis cuentas
        </Link>
      </header>

      <main className="sh">
        <header className="sh-head">
          <span className="lu-label">
            {evento
              ? `Evento${d.account.starts_on ? ` · ${formatRange(d.account.starts_on, d.account.ends_on)}` : ''}`
              : `Hogar · ${monthName(d.month as string)} ${(d.month as string).slice(0, 4)}`}
          </span>
          <h1 className="lu-display">{d.account.name}</h1>
          {!evento && mes && (
            <nav className="st-mes" aria-label="Mes">
              <Link href={aqui({ mes: otroMes(`${mes}-01`, -1) })} className="st-mes__btn" aria-label="Mes anterior">
                ‹
              </Link>
              <span className="st-mes__now">{`${monthName(`${mes}-01`)} ${mes.slice(0, 4)}`}</span>
              {`${mes}-01` < `${d.today.slice(0, 7)}-01` ? (
                <Link href={aqui({ mes: otroMes(`${mes}-01`, 1) })} className="st-mes__btn" aria-label="Mes siguiente">
                  ›
                </Link>
              ) : (
                <span className="st-mes__btn is-off" aria-hidden="true">
                  ›
                </span>
              )}
            </nav>
          )}
        </header>

        {yo && vista ? (
          <section className="sh-yo" aria-label={`Lo de ${yo.name}`}>
            <BillCard label={`${yo.name}, te toca`} amount={yo.share} tone="morado" denom={liquidada ? 'LIQUIDADO' : 'CUENTAS'}>
              <span>
                Pusiste <b>{formatCOP(yo.paid)}</b>
              </span>
              <span>{porCabeza ? 'igual que a todos' : 'tu parte de lo que compartiste'}</span>
            </BillCard>
            {vista.debe.length > 0 ? (
              <ul className="sh-deudas">
                {vista.debe.map((t) => (
                  <li key={`${t.from}-${t.to}`} className={`sh-deuda${t.paid_at ? ' is-paid' : ''}`}>
                    <span>
                      {t.paid_at ? 'Le pagaste' : 'Págale'} <Amount value={t.amount} size="md" /> a <b>{nombre(t.to)}</b>
                    </span>
                    {t.paid_at ? (
                      <Sticker tone="pagado" size="sm" rotate={-4}>
                        Pagado
                      </Sticker>
                    ) : (
                      <span className="lu-small lu-muted">{lucas(t.amount)}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : vista.recibe.length > 0 ? (
              <p className="sh-nota sh-nota--ok">
                Te deben {formatCOP(vista.recibe.reduce((s, t) => s + t.amount, 0))}:{' '}
                {nombres(
                  d,
                  vista.recibe.map((t) => t.from),
                )}
                .
              </p>
            ) : (
              <p className="sh-nota sh-nota--ok">Estás a paz y salvo: no le debes a nadie.</p>
            )}
            <Link href={aqui({ p: null })} className="sh-link">
              Ver las cuentas de todos
            </Link>
          </section>
        ) : (
          <section className="sh-yo" aria-label="Resumen">
            <BillCard
              label={evento ? 'Gastaron en total' : 'Gastaron este mes'}
              amount={total}
              denom={`${d.people.length} ${d.people.length === 1 ? 'PERSONA' : 'PERSONAS'}`}
            >
              <span>{porCabeza ? `${formatCOP(porCabeza)} a cada uno` : 'cada quien su parte'}</span>
              <span>{plural(d.expenses.length, 'gasto', 'gastos')}</span>
            </BillCard>
            {d.people.length > 1 && (
              <div className="sh-quien">
                <span className="lu-label">¿Quién eres? Toca tu nombre y ve lo tuyo</span>
                <div className="lu-chips">
                  {d.people.map((p) => (
                    <Link key={p.id} href={aqui({ p: p.id })} className="lu-chip sh-chip">
                      <Avatar name={p.name} tone={asTone(p.tone, p.name)} size="xs" registered={p.registered} />
                      {p.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {d.pending_count > 0 && (
          <p className="sh-nota" role="note">
            Ojo: {d.pending_count === 1 ? 'un gasto todavía está' : `${d.pending_count} gastos todavía están`} por revisar. Las cifras pueden cambiar un poco.
          </p>
        )}

        <section className="sh-sec" aria-labelledby="sh-ts">
          <h2 id="sh-ts" className="lu-title">
            ¿Quién le paga a quién?
          </h2>
          {ts.length ? (
            <ol className="st-list">
              {ts.map((t) => (
                <li
                  key={`${t.from}-${t.to}`}
                  className={`st-t is-previa${t.paid_at ? ' is-paid' : ''}${yo && (t.from === yo.id || t.to === yo.id) ? ' sh-mia' : ''}`}
                >
                  <div className="st-pair" aria-hidden="true">
                    <Avatar
                      name={nombre(t.from)}
                      tone={asTone(people.get(t.from)?.tone, nombre(t.from))}
                      registered={people.get(t.from)?.registered}
                      size="sm"
                    />
                    <svg className="st-arrow" viewBox="0 0 40 16" aria-hidden="true">
                      <path d="M2 8h32M28 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <Avatar name={nombre(t.to)} tone={asTone(people.get(t.to)?.tone, nombre(t.to))} registered={people.get(t.to)?.registered} size="sm" />
                  </div>
                  <div className="st-txt">
                    <span className="st-sent">
                      <b>{nombre(t.from)}</b> le paga a <b>{nombre(t.to)}</b>
                    </span>
                    <span className="st-lucas">{t.paid_at ? `pagado el ${formatDay(new Date(t.paid_at))}` : lucas(t.amount)}</span>
                  </div>
                  <Amount value={t.amount} size="lg" className="st-amt" />
                </li>
              ))}
            </ol>
          ) : (
            <p className="sh-nota sh-nota--ok">{total ? 'Nadie le debe a nadie: cada quien puso lo suyo.' : 'Todavía no hay gastos.'}</p>
          )}
        </section>

        <section className="sh-sec" aria-labelledby="sh-pp">
          <h2 id="sh-pp" className="lu-title">
            ¿Cuánto puso cada uno?
          </h2>
          <ul className="st-pp">
            {d.people.map((p) => (
              <li key={p.id} className={p.id === yo?.id ? 'sh-mia' : undefined}>
                <Link href={aqui({ p: p.id })} className="sh-p">
                  <Avatar name={p.name} tone={asTone(p.tone, p.name)} size="sm" registered={p.registered} />
                  <span className="st-p__who">
                    <b>{p.name}</b>
                    <span className="lu-muted st-p__sub">
                      puso {formatCOP(p.paid)} · le toca {formatCOP(p.share)}
                    </span>
                  </span>
                  <span className="st-p__bal">
                    <Amount value={p.balance} sign tone={p.balance >= 0 ? 'pos' : 'neg'} />
                    <span className="lu-muted">{p.balance === 0 ? 'a paz y salvo' : p.balance > 0 ? 'le deben' : 'debe'}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="sh-sec" aria-labelledby="sh-gs">
          <h2 id="sh-gs" className="lu-title">
            {yo ? `En qué gastaste, ${yo.name}` : 'En qué se fue la plata'}
          </h2>
          {gastos.length ? (
            <ul className="sh-gastos">
              {gastos.map((e) => {
                const parte = yo ? (e.shares.find((x) => x.person_id === yo.id)?.amount_cop ?? 0) : null;
                return (
                  <li key={e.id} className="sh-gasto">
                    {e.category ? (
                      <CategoryTag name={e.category} showName={false} letter={e.category_letter ?? undefined} tone={asTone(e.category_tone)} />
                    ) : (
                      <span className="sh-sin" aria-hidden="true" />
                    )}
                    <span className="sh-g">
                      <b>{e.merchant}</b>
                      <span className="lu-muted">
                        {formatDay(e.expense_date)} · pagó {nombre(e.payer_person_id)}
                        {e.status === 'pending_review' ? ' · por revisar' : ''}
                      </span>
                    </span>
                    <span className="sh-g__amt">
                      <Amount value={e.total_cop} size="md" />
                      <span className="lu-muted">{parte !== null ? (parte ? `tu parte ${formatCOP(parte)}` : 'no te toca') : `entre ${e.shares.length}`}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="sh-nota">No hay gastos {yo ? 'tuyos' : ''} todavía.</p>
          )}
        </section>

        <aside className="sh-promo" aria-label="Luks">
          <b className="sh-promo__t">¿Les sirvió? Así hacen las cuentas con Luks</b>
          <p className="lu-small" style={{ margin: 0 }}>
            Manden la foto del recibo al grupo de WhatsApp y Luks anota el gasto, lo divide y les dice quién le paga a quién. Sin Excel y sin peleas.
          </p>
          <Link href="/" className="lu-btn lu-btn--primary">
            Probar Luks gratis
          </Link>
          <span className="sh-promo__url">{MARCA}</span>
        </aside>
      </main>
    </div>
  );
}
