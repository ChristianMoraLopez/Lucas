import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LiveRefresh } from '@/components/live-refresh';
import { formatCOP, type Tone } from '@/components/lucas-core';
import { Amount, Avatar, CategoryTag, LottieSlot } from '@/components/lucas-ui';
import { formatRecent, monthName, todayInBogota } from '@/lib/dates';
import { normalizarBusqueda, uuidOrNull } from '@/lib/search';
import { asTone, plural } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { GastosFiltros } from './filtros';

interface Row {
  id: string;
  merchant: string;
  expense_date: string;
  created_at: string;
  total_cop: number;
  status: 'pending_review' | 'confirmed';
  corrected_by: string | null;
  categories: { name: string; letter: string; tone: string } | null;
  people: { display_name: string; tone: string; claimed_by: string | null } | null;
  messages: { kind: 'photo' | 'pdf' | 'text' } | null;
  expense_splits: { person_id: string }[];
}

export default async function GastosPage({ params, searchParams }: PageProps<'/c/[accountId]/gastos'>) {
  const { accountId } = await params;
  const sp = await searchParams;
  const soloPendientes = sp.ver === 'pendientes';
  // ?mes=2026-09 (también desde la tarjeta del resumen): solo los gastos de ese mes
  const mes = typeof sp.mes === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : null;
  // ?q= busca en el comercio, sin tildes; ?cat= y ?quien= filtran por categoría y por quién pagó
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 60) : '';
  const busqueda = normalizarBusqueda(q);
  const cat = uuidOrNull(sp.cat);
  const quien = uuidOrNull(sp.quien);
  const { supabase } = await requireUser(`/c/${accountId}/gastos`);

  const [{ data: account }, { data: cats }, { data: gente }, { data: fechas }] = await Promise.all([
    supabase.from('accounts').select('id').eq('id', accountId).maybeSingle(),
    supabase.from('categories').select('id, name').eq('account_id', accountId).order('name'),
    supabase.from('people').select('id, display_name').eq('account_id', accountId).order('display_name'),
    supabase.from('expenses').select('expense_date').eq('account_id', accountId).order('expense_date', { ascending: false }).limit(2000),
  ]);
  if (!account) notFound();
  const meses = [...new Set((fechas ?? []).map((f) => (f.expense_date as string).slice(0, 7)))];

  let query = supabase
    .from('expenses')
    .select(
      'id, merchant, expense_date, created_at, total_cop, status, corrected_by, categories(name, letter, tone), people!expenses_payer_person_id_fkey(display_name, tone, claimed_by), messages(kind), expense_splits(person_id)',
    )
    .eq('account_id', accountId)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(TOPE);
  if (soloPendientes) query = query.eq('status', 'pending_review');
  if (mes) query = query.gte('expense_date', `${mes}-01`).lt('expense_date', mesSiguiente(mes));
  if (busqueda) query = query.ilike('merchant_normalized', `%${busqueda}%`);
  if (cat) query = query.eq('category_id', cat);
  if (quien) query = query.eq('payer_person_id', quien);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as Row[];

  // Agrupados por mes: «Septiembre 2026 · $2.395.200»
  const grupos = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.expense_date.slice(0, 7);
    grupos.set(k, [...(grupos.get(k) ?? []), r]);
  }
  const hoy = todayInBogota();
  const base = `/c/${accountId}/gastos`;
  const filtrando = Boolean(busqueda || cat || quien || mes || soloPendientes);

  return (
    <div className="gs">
      <LiveRefresh accountId={accountId} />
      <header className="gs-head">
        <div>
          <h1 className="lu-display">Gastos</h1>
          <span className="lu-small lu-muted">{plural(rows.length, 'gasto', 'gastos')}</span>
        </div>
        <div className="wa-row">
          <Link href={`/c/${accountId}/categorias`} className="lu-btn lu-btn--sm lu-btn--ghost">
            Categorías
          </Link>
          <Link href={`/c/${accountId}/subir`} className="lu-btn lu-btn--sm lu-btn--secondary">
            Subir gasto
          </Link>
        </div>
      </header>

      <GastosFiltros
        filtros={{ q, cat: cat ?? '', quien: quien ?? '', mes: mes ?? '', ver: soloPendientes ? 'pendientes' : '' }}
        categorias={(cats ?? []) as { id: string; name: string }[]}
        personas={(gente ?? []).map((p) => ({ id: p.id as string, name: p.display_name as string }))}
        meses={meses}
        total={rows.length}
        suma={rows.reduce((sum, r) => sum + r.total_cop, 0)}
        tope={rows.length === TOPE}
      />

      {rows.length === 0 ? (
        <div className="ap-empty">
          <LottieSlot name="vacio" width={72} height={72} />
          <span className="lu-small lu-muted">
            {busqueda || cat || quien
              ? 'Ningún gasto coincide con la búsqueda.'
              : soloPendientes
                ? 'No hay nada por revisar.'
                : mes
                  ? `No hay gastos en ${monthName(`${mes}-01`).toLowerCase()}.`
                  : 'Todavía no hay gastos. Manden fotos al grupo o súbanlas aquí.'}
          </span>
          {filtrando && (
            <Link href={base} className="lu-btn lu-btn--sm lu-btn--secondary">
              Quitar filtros
            </Link>
          )}
        </div>
      ) : (
        [...grupos.entries()].map(([mes, lista]) => (
          <section key={mes} className="gs-month" aria-label={`${monthName(`${mes}-01`)} ${mes.slice(0, 4)}`}>
            <div className="gs-month__head">
              <h2 className="lu-title">
                {monthName(`${mes}-01`)} {mes.slice(0, 4)}
              </h2>
              <span className="lu-amount lu-amount--sm">{formatCOP(lista.reduce((s, r) => s + r.total_cop, 0))}</span>
            </div>
            <ul className="hd-recent">
              {lista.map((r) => (
                <li key={r.id} className="gs-row">
                  <CategoryTag
                    name={r.categories?.name ?? 'Otros'}
                    letter={r.categories?.letter}
                    tone={r.categories?.tone as Tone | undefined}
                    showName={false}
                    size="lg"
                  />
                  <span className="hd-r__t">
                    {/* Toda la fila abre el gasto: verlo, corregirlo o eliminarlo */}
                    <Link href={`${base}/${r.id}`} className="hd-r__m gs-link">
                      {r.merchant}
                    </Link>
                    <span className="hd-r__s">
                      {formatRecent(r.expense_date, r.created_at, hoy)}
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
                      {r.corrected_by && <span className="gs-fix">corregido</span>}
                      {r.status === 'pending_review' && (
                        <Link href={`/c/${accountId}/revisar?gasto=${r.id}`} className="ap-pend">
                          por revisar
                        </Link>
                      )}
                    </span>
                  </span>
                  <Amount value={r.total_cop} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/** Cuántos gastos muestra la lista como máximo (los más recientes) */
const TOPE = 300;

/** «2026-09» → «2026-10-01» (primer día del mes siguiente) */
function mesSiguiente(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
