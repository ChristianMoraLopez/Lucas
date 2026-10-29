import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LiveRefresh } from '@/components/live-refresh';
import { nombreCategoria, type Tone } from '@/components/lucas-core';
import { Amount, Avatar, BillCard, CategoryTag, LottieSlot, Sticker } from '@/components/lucas-ui';
import { formatRecent, monthName, todayInBogota } from '@/lib/dates';
import { aParams, aplicarFiltros, filtrando, leerFiltros, MARGEN, ordenarPorCercania, porCercania, porValor } from '@/lib/gastos-filtros';
import { getT } from '@/lib/i18n/server';
import { conCodigo, DECIMALES, dinero, esMoneda, esMonedaRecibo } from '@/lib/moneda';
import { asTone, plural } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { GastosFiltros } from './filtros';
import { BotonExcel, MesesBarras, MesPlegable, Reparto } from './vistas';

interface Row {
  id: string;
  merchant: string;
  expense_date: string;
  created_at: string;
  total_cop: number;
  status: 'pending_review' | 'confirmed';
  corrected_by: string | null;
  category_id: string | null;
  categories: { name: string; letter: string; tone: string } | null;
  people: { display_name: string; tone: string; claimed_by: string | null } | null;
  messages: { kind: 'photo' | 'pdf' | 'text' } | null;
  expense_splits: { person_id: string }[];
  /** Un recibo de viaje (migración 360): lo que decía, en su moneda */
  original_currency: string | null;
  original_total: number | null;
}

export default async function GastosPage({ params, searchParams }: PageProps<'/c/[accountId]/gastos'>) {
  const { accountId } = await params;
  // ?mes=2026-09 (también desde la tarjeta del resumen), ?q= (el comercio, sin tildes), ?cat=, ?quien=, ?ver=pendientes y ?orden=
  const sp = await searchParams;
  const { supabase } = await requireUser(`/c/${accountId}/gastos`);
  const t = await getT();

  const [{ data: account }, { data: cats }, { data: gente }, { data: fechas }] = await Promise.all([
    supabase.from('accounts').select('id, name, type, currency').eq('id', accountId).maybeSingle(),
    supabase.from('categories').select('id, name, letter, tone').eq('account_id', accountId).order('name'),
    supabase.from('people').select('id, display_name').eq('account_id', accountId).order('display_name'),
    supabase.from('expenses').select('expense_date, total_cop').eq('account_id', accountId).order('expense_date', { ascending: false }).limit(5000),
  ]);
  if (!account) notFound();
  const moneda = esMoneda(account.currency) ? account.currency : 'COP';
  // En la moneda de la cuenta: «105 mil» busca gastos de más o menos $105.000
  const f = leerFiltros(sp, moneda);
  const { q, busqueda, cat, quien, mes, soloPendientes, orden } = f;
  const mesLargo = (m: string) => monthName(`${m}-01`, t.idioma);
  // Cada mes con cuántos gastos y cuánto (de toda la cuenta): los botones de arriba
  const meses = [
    ...(fechas ?? [])
      .reduce((m, x) => {
        const k = (x.expense_date as string).slice(0, 7);
        const prev = m.get(k) ?? { n: 0, total: 0 };
        return m.set(k, { n: prev.n + 1, total: prev.total + Number(x.total_cop) });
      }, new Map<string, { n: number; total: number }>())
      .entries(),
  ];

  const { data, error } = await aplicarFiltros(
    supabase
      .from('expenses')
      .select(
        'id, merchant, expense_date, created_at, total_cop, status, corrected_by, category_id, categories(name, letter, tone), people!expenses_payer_person_id_fkey(display_name, tone, claimed_by), messages(kind), expense_splits(person_id), original_currency, original_total',
      )
      .eq('account_id', accountId)
      .limit(TOPE),
    f,
  );
  if (error) throw error;
  const rows = porCercania(f) && f.monto ? ordenarPorCercania((data ?? []) as unknown as Row[], f.monto) : ((data ?? []) as unknown as Row[]);

  // Por fecha, agrupados por mes: «Septiembre 2026 · $2.395.200». Por valor, una sola lista
  const grupos = new Map<string, Row[]>();
  for (const r of rows) {
    const k = porCercania(f) ? 'cerca' : porValor(f) ? orden : r.expense_date.slice(0, 7);
    grupos.set(k, [...(grupos.get(k) ?? []), r]);
  }
  const titulo = (k: string) =>
    k === 'cerca' && f.monto
      ? t('Cerca de {monto} (±{margen} %)', { monto: fmt(f.monto), margen: MARGEN * 100 })
      : k === 'mayor'
        ? t('De mayor a menor valor')
        : k === 'menor'
          ? t('De menor a mayor valor')
          : `${mesLargo(k)} ${k.slice(0, 4)}`;
  // Así no es una lista infinita: en «Todos» cada mes se pliega y solo el más reciente queda abierto
  const abierto = (i: number) => i === 0 || Boolean(mes) || porValor(f) || porCercania(f) || filtrando(f);
  const hoy = todayInBogota();
  const anio = hoy.slice(0, 4);
  const base = `/c/${accountId}/gastos`;
  const conFiltros = (o: Record<string, string | null>) => {
    const s = aParams(f, o).toString();
    return s ? `${base}?${s}` : base;
  };
  const excel = `${base}/excel${aParams(f).size ? `?${aParams(f)}` : ''}`;
  const fmt = (n: number) => dinero(n, moneda, t.idioma);
  // Encima de cada barra: «1,5 M», «820 mil» (en pesos); en dólares, el monto
  const fmtCorto = (n: number) => (DECIMALES[moneda] ? fmt(n) : lucasCortas(n, t.idioma));
  // Viendo una categoría: su detalle arriba (cuánto, cuántos y quién pagó)
  const categoria = cat ? (cats ?? []).find((c) => c.id === cat) : undefined;
  const suma = rows.reduce((s, r) => s + r.total_cop, 0);
  const pendientes = rows.filter((r) => r.status === 'pending_review').length;
  const tono = account.type === 'evento' ? 'morado' : 'verde';
  // «¿En qué se fue?» de lo que se ve, de la categoría que más a la que menos
  const enQue = [
    ...rows
      .reduce((m, r) => {
        const k = r.category_id ?? 'sin';
        const prev = m.get(k) ?? { id: k, name: r.categories?.name ?? 'Otros', letter: r.categories?.letter, tone: asTone(r.categories?.tone, k), total: 0 };
        return m.set(k, { ...prev, total: prev.total + r.total_cop });
      }, new Map<string, { id: string; name: string; letter?: string; tone: Tone; total: number }>())
      .values(),
  ].sort((a, b) => b.total - a.total);
  const porPersona = [
    ...rows.reduce((m, r) => {
      const k = r.people?.display_name ?? t('Sin pagador');
      const prev = m.get(k) ?? { total: 0, tone: r.people?.tone, registrado: r.people?.claimed_by != null };
      return m.set(k, { ...prev, total: prev.total + r.total_cop });
    }, new Map<string, { total: number; tone?: string; registrado: boolean }>()),
  ].sort((a, b) => b[1].total - a[1].total);

  const periodo = mes ? `${mesLargo(mes)} ${mes.slice(0, 4)}` : t('Todos los meses');
  const nombreExcel = `Luks - ${account.name} - ${mes ? periodo : t('Todos los gastos')}.xlsx`.replace(/[\\/:*?"<>|]/g, '');

  return (
    <div className="gs lu-pantalla">
      <LiveRefresh accountId={accountId} />
      <header className="gs-head">
        <h1 className="lu-display gs-head__t">{t('Gastos')}</h1>
        <div className="wa-row gs-acciones">
          <Link href={`/c/${accountId}/categorias`} className="lu-btn lu-btn--sm lu-btn--ghost">
            {t('Categorías')}
          </Link>
          {/* Lo que se ve (con sus filtros), en un Excel con las cuentas hechas */}
          <BotonExcel href={excel} nombre={nombreExcel} />
          <Link href={`/c/${accountId}/subir`} className="lu-btn lu-btn--sm lu-btn--secondary">
            {t('Subir gasto')}
          </Link>
        </div>
      </header>

      {/* La cifra de lo que se ve: el billete (verde en la casa, morado en un paseo) */}
      <BillCard
        label={categoria ? `${nombreCategoria(categoria.name, t)} · ${periodo}` : periodo}
        amount={suma}
        tone={tono}
        denom={rows.length === 1 ? t('1 GASTO') : t('{n} GASTOS', { n: rows.length })}
        roll
      >
        <span>{rows.length ? t('promedio {monto}', { monto: fmt(Math.round(suma / rows.length)) }) : t('Nada por aquí todavía')}</span>
        {pendientes > 0 && !soloPendientes ? (
          <Link href={conFiltros({ ver: 'pendientes' })} scroll={false} className="gs-bill-pend" aria-label={t('Ver los {n} por revisar', { n: pendientes })}>
            <Sticker tone="revisar" size="sm" rotate={-6} sub={String(pendientes)} />
          </Link>
        ) : null}
      </BillCard>

      {meses.length > 1 && (
        <MesesBarras
          tono={tono}
          actual={mes}
          todos={{
            href: conFiltros({ mes: null }),
            label: t('Todos'),
            detalle: plural(
              meses.reduce((s, [, x]) => s + x.n, 0),
              t('gasto'),
              t('gastos'),
            ),
          }}
          meses={meses.map(([m, x]) => ({
            mes: m,
            corto: `${mesLargo(m).slice(0, 3)}${m.slice(0, 4) !== anio ? ` ’${m.slice(2, 4)}` : ''}`,
            largo: `${mesLargo(m)} ${m.slice(0, 4)}`,
            total: x.total,
            monto: fmtCorto(x.total),
            href: conFiltros({ mes: m }),
          }))}
        />
      )}

      {enQue.length > 1 && !cat && (
        <section className="gs-enque" aria-label={t('Por categoría')}>
          <h2 className="lu-title">{t('¿En qué se fue?')}</h2>
          <Reparto tramos={enQue.map((c) => ({ id: c.id, tono: c.tone, total: c.total }))} />
          <ul className="gs-enque__lista">
            {enQue.slice(0, 6).map((c) => (
              <li key={c.id}>
                {c.id === 'sin' ? (
                  <span className="gs-enque__cat">
                    <CategoryTag name={c.name} letter={c.letter} tone={c.tone} size="sm" />
                    <span className="lu-num">{fmt(c.total)}</span>
                  </span>
                ) : (
                  <Link
                    href={conFiltros({ cat: c.id })}
                    scroll={false}
                    className="gs-enque__cat"
                    aria-label={t('Ver los gastos de {categoria}', { categoria: nombreCategoria(c.name, t) })}
                  >
                    <CategoryTag name={c.name} letter={c.letter} tone={c.tone} size="sm" />
                    <span className="lu-num">{fmt(c.total)}</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <GastosFiltros
        filtros={{ q, cat: cat ?? '', quien: quien ?? '', mes: mes ?? '', ver: soloPendientes ? 'pendientes' : '', orden: orden === 'recientes' ? '' : orden }}
        categorias={(cats ?? []) as { id: string; name: string }[]}
        personas={(gente ?? []).map((p) => ({ id: p.id as string, name: p.display_name as string }))}
        total={rows.length}
        suma={suma}
        tope={rows.length === TOPE}
      />

      {categoria && rows.length > 0 && porPersona.length > 1 && (
        <section className="gs-cat" aria-label={t('Detalle de {categoria}', { categoria: nombreCategoria(categoria.name, t) })}>
          <div className="gs-cat__head">
            <CategoryTag name={categoria.name} letter={categoria.letter} tone={categoria.tone as Tone} showName={false} size="lg" />
            <h2 className="lu-title" style={{ margin: 0 }}>
              {t('¿Quién pagó?')}
            </h2>
          </div>
          <ul className="gs-cat__quien" aria-label={t('Quién pagó')}>
            {porPersona.map(([nombre, x]) => (
              <li key={nombre}>
                <span className="gs-cat__p">
                  <Avatar name={nombre} tone={asTone(x.tone, nombre)} size="xs" registered={x.registrado} /> {nombre}
                </span>
                <span className="gs-cat__bar" aria-hidden="true">
                  <i style={{ width: `${(x.total / porPersona[0][1].total) * 100}%`, background: `var(--tono-${asTone(categoria.tone)})` }} />
                </span>
                <span className="lu-num">{fmt(x.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length === 0 ? (
        <div className="ap-empty">
          <LottieSlot name={busqueda || cat || quien ? 'buscar' : soloPendientes ? 'todo-revisado' : 'vacio'} width={96} height={96} />
          <span className="lu-small lu-muted">
            {f.monto
              ? t('Ningún gasto de más o menos {monto}.', { monto: fmt(f.monto) })
              : busqueda || cat || quien
                ? t('Ningún gasto coincide con la búsqueda.')
                : soloPendientes
                  ? t('No hay nada por revisar.')
                  : mes
                    ? t('No hay gastos en {mes}.', { mes: t.idioma === 'en' ? mesLargo(mes) : mesLargo(mes).toLowerCase() })
                    : t('Todavía no hay gastos. Manden fotos al grupo o súbanlas aquí.')}
          </span>
          {(filtrando(f) || mes || orden !== 'recientes') && (
            <Link href={base} className="lu-btn lu-btn--sm lu-btn--secondary">
              {t('Quitar filtros')}
            </Link>
          )}
        </div>
      ) : (
        <div className="gs-meses-lista">
          {[...grupos.entries()].map(([grupo, lista], g) => (
            <MesPlegable
              key={grupo}
              titulo={titulo(grupo)}
              detalle={plural(lista.length, t('gasto'), t('gastos'))}
              monto={<span className="lu-amount lu-amount--sm">{fmt(lista.reduce((s, r) => s + r.total_cop, 0))}</span>}
              abierto={abierto(g)}
            >
              <ul className="hd-recent lu-stagger">
                {lista.map((r, i) => (
                  <li
                    key={r.id}
                    className={`gs-row${r.status === 'pending_review' ? ' gs-row--pend' : ''}`}
                    style={{ '--i': Math.min(i, 12) } as React.CSSProperties}
                  >
                    {/* La categoría lleva a todos los gastos de esa categoría */}
                    {r.category_id && r.category_id !== cat ? (
                      <Link
                        href={conFiltros({ cat: r.category_id, q: null, quien: null, ver: null })}
                        aria-label={t('Ver los gastos de {categoria}', { categoria: nombreCategoria(r.categories?.name ?? 'Otros', t) })}
                        className="gs-tag"
                      >
                        <CategoryTag
                          name={r.categories?.name ?? 'Otros'}
                          letter={r.categories?.letter}
                          tone={r.categories?.tone as Tone | undefined}
                          showName={false}
                          size="lg"
                        />
                      </Link>
                    ) : (
                      <CategoryTag
                        name={r.categories?.name ?? 'Otros'}
                        letter={r.categories?.letter}
                        tone={r.categories?.tone as Tone | undefined}
                        showName={false}
                        size="lg"
                      />
                    )}
                    <span className="hd-r__t">
                      {/* Toda la fila abre el gasto: verlo, corregirlo o eliminarlo */}
                      <Link href={`${base}/${r.id}`} className="hd-r__m gs-link">
                        {r.merchant}
                      </Link>
                      <span className="hd-r__s">
                        {formatRecent(r.expense_date, r.created_at, hoy, t.idioma)}
                        {r.people && (
                          <>
                            {' · '}
                            <Avatar
                              name={r.people.display_name}
                              tone={asTone(r.people.tone, r.people.display_name)}
                              size="xs"
                              registered={r.people.claimed_by != null}
                            />{' '}
                            {r.people.display_name}
                          </>
                        )}
                        {r.expense_splits.length ? ` · ÷ ${r.expense_splits.length}` : ''}
                        {r.messages?.kind === 'pdf' ? ' · PDF' : ''}
                        {r.original_total && esMonedaRecibo(r.original_currency) ? ` · ${conCodigo(r.original_total, r.original_currency, t.idioma)}` : ''}
                        {r.corrected_by && <span className="gs-fix">{t('corregido')}</span>}
                      </span>
                    </span>
                    <span className="gs-row__fin">
                      {r.status === 'pending_review' && (
                        <Link
                          href={`/c/${accountId}/revisar?gasto=${r.id}`}
                          className="gs-row__st"
                          aria-label={t('Revisar {comercio}', { comercio: r.merchant })}
                        >
                          <Sticker tone="revisar" size="sm" rotate={i % 2 ? 5 : -5} />
                        </Link>
                      )}
                      <Amount value={r.total_cop} tone={f.monto && r.total_cop === f.monto ? 'pos' : undefined} />
                    </span>
                  </li>
                ))}
              </ul>
            </MesPlegable>
          ))}
        </div>
      )}
    </div>
  );
}

/** Cuántos gastos muestra la lista como máximo (los primeros según el orden) */
const TOPE = 300;

/** «1,5 M», «820 mil», «$9.800»: lo que cabe encima de una barra */
function lucasCortas(n: number, idioma: 'es' | 'en') {
  const coma = (v: number) => v.toLocaleString(idioma === 'en' ? 'en-US' : 'es-CO', { maximumFractionDigits: 1 });
  if (n >= 1_000_000) return `${coma(n / 1_000_000)} M`;
  if (n >= 10_000) return idioma === 'en' ? `${Math.round(n / 1000)}k` : `${Math.round(n / 1000)} mil`;
  return `$${coma(n)}`;
}
