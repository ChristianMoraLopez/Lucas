import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LiveRefresh } from '@/components/live-refresh';
import { formatCOP } from '@/components/lucas-core';
import { Amount, Avatar, CategoryTag, LottieSlot } from '@/components/lucas-ui';
import { formatRecent, monthName, todayInBogota } from '@/lib/dates';
import { asTone, plural } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';

interface Row {
  id: string;
  merchant: string;
  expense_date: string;
  created_at: string;
  total_cop: number;
  status: 'pending_review' | 'confirmed';
  corrected_by: string | null;
  categories: { name: string } | null;
  people: { display_name: string; tone: string; claimed_by: string | null } | null;
  messages: { kind: 'photo' | 'pdf' | 'text' } | null;
  expense_splits: { person_id: string }[];
}

export default async function GastosPage({ params, searchParams }: PageProps<'/c/[accountId]/gastos'>) {
  const { accountId } = await params;
  const { ver } = await searchParams;
  const soloPendientes = ver === 'pendientes';
  const { supabase } = await requireUser(`/c/${accountId}/gastos`);

  const { data: account } = await supabase.from('accounts').select('id').eq('id', accountId).maybeSingle();
  if (!account) notFound();

  let query = supabase
    .from('expenses')
    .select(
      'id, merchant, expense_date, created_at, total_cop, status, corrected_by, categories(name), people!expenses_payer_person_id_fkey(display_name, tone, claimed_by), messages(kind), expense_splits(person_id)',
    )
    .eq('account_id', accountId)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(300);
  if (soloPendientes) query = query.eq('status', 'pending_review');
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

  return (
    <div className="gs">
      <LiveRefresh accountId={accountId} />
      <header className="gs-head">
        <div>
          <h1 className="lu-display">Gastos</h1>
          <span className="lu-small lu-muted">{plural(rows.length, 'gasto', 'gastos')}</span>
        </div>
        <Link href={`/c/${accountId}/subir`} className="lu-btn lu-btn--sm lu-btn--secondary">
          Subir gasto
        </Link>
      </header>

      <nav className="gs-filter" aria-label="Filtrar gastos">
        <Link href={base} className="lu-chip" aria-pressed={!soloPendientes} aria-current={!soloPendientes ? 'page' : undefined}>
          Todos
        </Link>
        <Link href={`${base}?ver=pendientes`} className="lu-chip" aria-pressed={soloPendientes} aria-current={soloPendientes ? 'page' : undefined}>
          Por revisar
        </Link>
      </nav>

      {rows.length === 0 ? (
        <div className="ap-empty">
          <LottieSlot name="vacio" width={72} height={72} />
          <span className="lu-small lu-muted">
            {soloPendientes ? 'No hay nada por revisar.' : 'Todavía no hay gastos. Manden fotos al grupo o súbanlas aquí.'}
          </span>
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
                <li key={r.id}>
                  <CategoryTag name={r.categories?.name ?? 'Otros'} showName={false} size="lg" />
                  <span className="hd-r__t">
                    <span className="hd-r__m">{r.merchant}</span>
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
