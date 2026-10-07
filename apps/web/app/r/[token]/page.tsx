import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { IdiomaProvider } from '@/components/idioma';
import { LogoLink } from '@/components/logo-link';
import { Amount, Avatar, BillCard, CategoryTag, Sticker } from '@/components/lucas-ui';
import { MenuPrincipal } from '@/components/menu-principal';
import { MonedaProvider } from '@/components/moneda';
import { formatDay, formatRange, monthName } from '@/lib/dates';
import { COOKIE_IDIOMA, crearT, esIdioma, type T } from '@/lib/i18n';
import { rico } from '@/lib/i18n/rico';
import { corto, dinero, esMoneda, type Moneda } from '@/lib/moneda';
import { personView, publicidad, transfersFor } from '@/lib/share';
import { asTone, plural, type SharedOverview } from '@/lib/types';
import { createClient } from '@/utils/supabase/server';

/*
 * Las cuentas que alguien compartió (/r/TOKEN). Las ve cualquiera con el link,
 * sin entrar: cuánto puso cada uno, cuánto le toca, en qué se fue la plata y
 * quién le paga a quién. Con ?p=persona, primero lo de esa persona: es el link
 * que llega en el mensaje de cobro. Nada de fotos, números ni correos.
 *
 * En la moneda de la cuenta. El idioma: el del link (?l=en, el del mensaje),
 * el que eligió quien la ve (cookie) o el de la cuenta.
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

/** Idioma y moneda de la página */
async function lectura(d: SharedOverview, l: string | undefined, conCookie: boolean) {
  const cookie = conCookie ? (await cookies()).get(COOKIE_IDIOMA)?.value : undefined;
  const idioma = esIdioma(l) ? l : esIdioma(cookie) ? cookie : esIdioma(d.language) ? d.language : 'es';
  const moneda: Moneda = esMoneda(d.currency) ? d.currency : 'COP';
  const t = crearT(idioma);
  return { t, moneda, fmt: (n: number) => dinero(n, moneda, idioma), cort: (n: number) => corto(n, moneda, idioma) };
}

export async function generateMetadata({ params, searchParams }: PageProps<'/r/[token]'>): Promise<Metadata> {
  const { token } = await params;
  const sp = await searchParams;
  const d = await leer(token, uno(sp.mes));
  // Son las cuentas de un grupo de amigos: que los buscadores no las guarden
  const robots = { index: false, follow: false };
  if (!d) return { title: 'Luks', robots };

  // WhatsApp pide la vista previa sin cookies: el idioma del link o el de la cuenta
  const { t, fmt } = await lectura(d, uno(sp.l), false);
  const total = d.people.reduce((s, p) => s + p.paid, 0);
  const yo = d.people.find((p) => p.id === uno(sp.p));
  const ts = transfersFor(d);
  let title: string;
  let description: string;
  if (yo) {
    const { debe, recibe } = personView(yo.id, ts);
    title = t('{nombre}, te toca {monto} · {cuenta}', { nombre: yo.name, monto: fmt(yo.share), cuenta: d.account.name });
    description = debe.length
      ? t('Le debes {monto} a {nombres}. Mira en qué se fue la plata.', {
          monto: fmt(debe.reduce((s, x) => s + x.amount, 0)),
          nombres: nombres(
            d,
            debe.map((x) => x.to),
            t,
          ),
        })
      : recibe.length
        ? t('Te deben {monto}. Mira cuánto puso cada uno.', { monto: fmt(recibe.reduce((s, x) => s + x.amount, 0)) })
        : t('Estás a paz y salvo. Mira cuánto puso cada uno.');
  } else {
    title = t('Las cuentas de «{cuenta}»', { cuenta: d.account.name });
    description = t('Gastaron {monto} entre {personas}. Mira cuánto le toca a cada uno.', {
      monto: fmt(total),
      personas: plural(d.people.length, t('persona'), t('personas')),
    });
  }
  // La vista previa en WhatsApp: una imagen con cuánto fue y quién le paga a quién
  const q = new URLSearchParams();
  if (yo) q.set('p', yo.id);
  if (d.month && d.account.type !== 'evento') q.set('mes', d.month.slice(0, 7));
  if (esIdioma(uno(sp.l))) q.set('l', uno(sp.l) as string);
  const image = { url: `/r/${token}/imagen${q.size ? `?${q}` : ''}`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    robots,
    openGraph: { type: 'website', siteName: 'Luks', title, description, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

function nombres(d: SharedOverview, ids: string[], t: T) {
  const ns = ids.map((id) => d.people.find((p) => p.id === id)?.name ?? t('alguien'));
  return ns.length <= 1 ? (ns[0] ?? '') : `${ns.slice(0, -1).join(', ')}${t(' y ')}${ns.at(-1)}`;
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

  const l = uno(sp.l);
  const { t, moneda, fmt, cort } = await lectura(d, l, true);
  const idioma = t.idioma;
  const evento = d.account.type === 'evento';
  const people = new Map(d.people.map((p) => [p.id, p]));
  const nombre = (id: string | null) => (id && people.get(id)?.name) || t('Alguien');
  const yo = d.people.find((p) => p.id === uno(sp.p)) ?? null;
  const ts = transfersFor(d);
  const total = d.people.reduce((s, p) => s + p.paid, 0);
  const partes = new Set(d.people.map((p) => p.share));
  const porCabeza = partes.size === 1 && total > 0 ? d.people[0].share : null;
  const liquidada = Boolean(d.settlement);
  const mes = d.month ? d.month.slice(0, 7) : null;
  const dia = (v: string | Date) => formatDay(v, undefined, idioma);
  // Los links de la página conservan el mes (hogar), la persona y el idioma del link
  const aqui = (o: { p?: string | null; mes?: string | null }) => {
    const q = new URLSearchParams();
    const p = o.p === undefined ? yo?.id : o.p;
    const m = o.mes === undefined ? mes : o.mes;
    if (p) q.set('p', p);
    if (m && !evento) q.set('mes', m);
    if (esIdioma(l)) q.set('l', l);
    const s = q.toString();
    return `/r/${token}${s ? `?${s}` : ''}`;
  };
  const vista = yo ? personView(yo.id, ts) : null;
  const gastos = yo ? d.expenses.filter((e) => e.shares.some((x) => x.person_id === yo.id) || e.payer_person_id === yo.id) : d.expenses;
  const mesLargo = (m: string) => `${monthName(`${m}-01`, idioma)} ${m.slice(0, 4)}`;

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
        <Link href="/" className="lu-btn lu-btn--sm lu-btn--secondary sh-bar-cta">
          {t('Hacer mis cuentas')}
        </Link>
        <MenuPrincipal sesion={false} />
      </header>

      {/* Los montos (componentes de cliente) en el idioma y la moneda de la página */}
      <IdiomaProvider idioma={idioma}>
        <MonedaProvider moneda={moneda}>
          <main className="sh" lang={idioma}>
            <header className="sh-head">
              <span className="lu-label">
                {evento
                  ? `${t('Evento')}${d.account.starts_on ? ` · ${formatRange(d.account.starts_on, d.account.ends_on, idioma)}` : ''}`
                  : `${t('Hogar')} · ${mesLargo((d.month as string).slice(0, 7))}`}
              </span>
              <h1 className="lu-display">{d.account.name}</h1>
              {!evento && mes && (
                <nav className="st-mes" aria-label={t('Mes')}>
                  <Link href={aqui({ mes: otroMes(`${mes}-01`, -1) })} className="st-mes__btn" aria-label={t('Mes anterior')}>
                    ‹
                  </Link>
                  <span className="st-mes__now">{mesLargo(mes)}</span>
                  {`${mes}-01` < `${d.today.slice(0, 7)}-01` ? (
                    <Link href={aqui({ mes: otroMes(`${mes}-01`, 1) })} className="st-mes__btn" aria-label={t('Mes siguiente')}>
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
              <section className="sh-yo" aria-label={t('Lo de {nombre}', { nombre: yo.name })}>
                <BillCard label={t('{nombre}, te toca', { nombre: yo.name })} amount={yo.share} tone="morado" denom={liquidada ? t('LIQUIDADO') : t('CUENTAS')}>
                  <span>{rico(t('Pusiste {monto}'), { monto: <b>{fmt(yo.paid)}</b> })}</span>
                  <span>{porCabeza ? t('igual que a todos') : t('tu parte de lo que compartiste')}</span>
                </BillCard>
                {vista.debe.length > 0 ? (
                  <ul className="sh-deudas">
                    {vista.debe.map((x) => (
                      <li key={`${x.from}-${x.to}`} className={`sh-deuda${x.paid_at ? ' is-paid' : ''}`}>
                        <span>
                          {rico(x.paid_at ? t('Le pagaste {monto} a {nombre}') : t('Págale {monto} a {nombre}'), {
                            monto: <Amount value={x.amount} size="md" />,
                            nombre: <b>{nombre(x.to)}</b>,
                          })}
                        </span>
                        {x.paid_at ? (
                          <Sticker tone="pagado" size="sm" rotate={-4}>
                            {t('Pagado')}
                          </Sticker>
                        ) : (
                          <span className="lu-small lu-muted">{cort(x.amount)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : vista.recibe.length > 0 ? (
                  <p className="sh-nota sh-nota--ok">
                    {t('Te deben {monto}: {nombres}.', {
                      monto: fmt(vista.recibe.reduce((s, x) => s + x.amount, 0)),
                      nombres: nombres(
                        d,
                        vista.recibe.map((x) => x.from),
                        t,
                      ),
                    })}
                  </p>
                ) : (
                  <p className="sh-nota sh-nota--ok">{t('Estás a paz y salvo: no le debes a nadie.')}</p>
                )}
                <Link href={aqui({ p: null })} className="sh-link">
                  {t('Ver las cuentas de todos')}
                </Link>
              </section>
            ) : (
              <section className="sh-yo" aria-label={t('Resumen')}>
                <BillCard
                  label={evento ? t('Gastaron en total') : t('Gastaron este mes')}
                  amount={total}
                  denom={d.people.length === 1 ? t('1 PERSONA') : t('{n} PERSONAS', { n: d.people.length })}
                >
                  <span>{porCabeza ? t('{monto} a cada uno', { monto: fmt(porCabeza) }) : t('cada quien su parte')}</span>
                  <span>{plural(d.expenses.length, t('gasto'), t('gastos'))}</span>
                </BillCard>
                {d.people.length > 1 && (
                  <div className="sh-quien">
                    <span className="lu-label">{t('¿Quién eres? Toca tu nombre y ve lo tuyo')}</span>
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
                {d.pending_count === 1
                  ? t('Ojo: un gasto todavía está por revisar. Las cifras pueden cambiar un poco.')
                  : t('Ojo: {n} gastos todavía están por revisar. Las cifras pueden cambiar un poco.', { n: d.pending_count })}
              </p>
            )}

            <section className="sh-sec" aria-labelledby="sh-ts">
              <h2 id="sh-ts" className="lu-title">
                {t('¿Quién le paga a quién?')}
              </h2>
              {ts.length ? (
                <ol className="st-list">
                  {ts.map((x) => (
                    <li
                      key={`${x.from}-${x.to}`}
                      className={`st-t is-previa${x.paid_at ? ' is-paid' : ''}${yo && (x.from === yo.id || x.to === yo.id) ? ' sh-mia' : ''}`}
                    >
                      <div className="st-pair" aria-hidden="true">
                        <Avatar
                          name={nombre(x.from)}
                          tone={asTone(people.get(x.from)?.tone, nombre(x.from))}
                          registered={people.get(x.from)?.registered}
                          size="sm"
                        />
                        <svg className="st-arrow" viewBox="0 0 40 16" aria-hidden="true">
                          <path d="M2 8h32M28 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <Avatar name={nombre(x.to)} tone={asTone(people.get(x.to)?.tone, nombre(x.to))} registered={people.get(x.to)?.registered} size="sm" />
                      </div>
                      <div className="st-txt">
                        <span className="st-sent">{rico(t('{de} le paga a {para}'), { de: <b>{nombre(x.from)}</b>, para: <b>{nombre(x.to)}</b> })}</span>
                        <span className="st-lucas">{x.paid_at ? t('pagado el {dia}', { dia: dia(new Date(x.paid_at)) }) : cort(x.amount)}</span>
                      </div>
                      <Amount value={x.amount} size="lg" className="st-amt" />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="sh-nota sh-nota--ok">{total ? t('Nadie le debe a nadie: cada quien puso lo suyo.') : t('Todavía no hay gastos.')}</p>
              )}
            </section>

            <section className="sh-sec" aria-labelledby="sh-pp">
              <h2 id="sh-pp" className="lu-title">
                {t('¿Cuánto puso cada uno?')}
              </h2>
              <ul className="st-pp">
                {d.people.map((p) => (
                  <li key={p.id} className={p.id === yo?.id ? 'sh-mia' : undefined}>
                    <Link href={aqui({ p: p.id })} className="sh-p">
                      <Avatar name={p.name} tone={asTone(p.tone, p.name)} size="sm" registered={p.registered} />
                      <span className="st-p__who">
                        <b>{p.name}</b>
                        <span className="lu-muted st-p__sub">{t('puso {pago} · le toca {parte}', { pago: fmt(p.paid), parte: fmt(p.share) })}</span>
                      </span>
                      <span className="st-p__bal">
                        <Amount value={p.balance} sign tone={p.balance >= 0 ? 'pos' : 'neg'} />
                        <span className="lu-muted">{p.balance === 0 ? t('a paz y salvo') : p.balance > 0 ? t('le deben') : t('debe')}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className="sh-sec" aria-labelledby="sh-gs">
              <h2 id="sh-gs" className="lu-title">
                {yo ? t('En qué gastaste, {nombre}', { nombre: yo.name }) : t('En qué se fue la plata')}
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
                            {dia(e.expense_date)} · {t('pagó {nombre}', { nombre: nombre(e.payer_person_id) })}
                            {e.status === 'pending_review' ? ` · ${t('por revisar')}` : ''}
                          </span>
                        </span>
                        <span className="sh-g__amt">
                          <Amount value={e.total_cop} size="md" />
                          <span className="lu-muted">
                            {parte !== null ? (parte ? t('tu parte {monto}', { monto: fmt(parte) }) : t('no te toca')) : t('entre {n}', { n: e.shares.length })}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="sh-nota">{yo ? t('No hay gastos tuyos todavía.') : t('No hay gastos todavía.')}</p>
              )}
            </section>

            <aside className="sh-promo" aria-label="Luks">
              <b className="sh-promo__t">{t('¿Les sirvió? Así hacen las cuentas con Luks')}</b>
              <p className="lu-small" style={{ margin: 0 }}>
                {t('Manden la foto del recibo al grupo de WhatsApp y Luks anota el gasto, lo divide y les dice quién le paga a quién. Sin Excel y sin peleas.')}
              </p>
              <Link href="/" className="lu-btn lu-btn--primary">
                {t('Probar Luks gratis')}
              </Link>
              <span className="sh-promo__url">{publicidad(t)}</span>
            </aside>
          </main>
        </MonedaProvider>
      </IdiomaProvider>
    </div>
  );
}
