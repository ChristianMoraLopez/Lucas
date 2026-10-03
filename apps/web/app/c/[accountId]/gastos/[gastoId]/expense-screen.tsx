'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EvidenceViewer } from '@/components/evidence-viewer';
import { ExpenseForm } from '@/components/expense-form';
import { formatCOP } from '@/components/lucas-core';
import { Sticker } from '@/components/lucas-ui';
import { formatWhen } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { type AccountCategory, type AccountPerson, asTone, type ReviewExpense, type Role } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

/** Lo que el detalle muestra además de lo que se puede editar */
type Detalle = ReviewExpense & {
  corrected_at: string | null;
  cufe: string | null;
  expense_items: { id: string; name: string; quantity: number | null; total_cop: number }[];
  messages: (NonNullable<ReviewExpense['messages']> & { uploaded_by: string | null }) | null;
};

const ORIGEN = { whatsapp: 'El grupo de WhatsApp', web: 'Subido en la web', import: 'Importado' } as const;

/** Un gasto cualquiera (confirmado o por revisar): la foto, todo su detalle y, para admins, corregirlo o eliminarlo. */
export function ExpenseScreen({ accountId, expenseId, myRole }: { accountId: string; expenseId: string; myRole: Role }) {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const canEdit = myRole === 'owner' || myRole === 'admin';

  const data = useQuery({
    queryKey: ['gasto', expenseId],
    queryFn: async () => {
      const [exp, people, cats] = await Promise.all([
        supabase
          .from('expenses')
          .select(
            'id, merchant, expense_date, total_cop, category_id, payer_person_id, status, confidence, field_confidence, ai_snapshot, split_note, corrected_by, corrected_at, cufe, evidence_path, created_at, source, messages(kind, text_body, file_name, received_at, sender_person_id, uploaded_by), split_method, expense_splits(person_id, amount_cop, fixed), expense_items(id, name, quantity, total_cop)',
          )
          .eq('id', expenseId)
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase.from('people').select('id, display_name, tone, claimed_by').eq('account_id', accountId).order('created_at'),
        supabase.from('categories').select('id, name, letter, tone, description, is_default').eq('account_id', accountId).order('name'),
      ]);
      const error = exp.error ?? people.error ?? cats.error;
      if (error) throw error;
      return {
        expense: exp.data as unknown as Detalle | null,
        people: people.data as AccountPerson[],
        categories: cats.data as AccountCategory[],
      };
    },
  });

  const back = (
    <Link href={`/c/${accountId}/gastos`} className="lu-btn lu-btn--sm lu-btn--ghost">
      ← Gastos
    </Link>
  );

  if (data.isPending || data.isError || !data.data.expense) {
    return (
      <div className="rv">
        {back}
        <p className={data.isError ? 'lu-error' : 'lu-small lu-muted'} role={data.isError ? 'alert' : undefined}>
          {data.isPending ? 'Cargando…' : data.isError ? humanError(data.error) : 'Ese gasto ya no existe: puede que lo hayan eliminado.'}
        </p>
      </div>
    );
  }

  const { expense, people, categories } = data.data;
  const sender = people.find((p) => p.id === (expense.messages?.sender_person_id ?? expense.payer_person_id));
  const quienSubio =
    people.find((p) => p.id === expense.messages?.sender_person_id) ?? people.find((p) => p.claimed_by && p.claimed_by === expense.messages?.uploaded_by);
  const corrector = people.find((p) => p.claimed_by && p.claimed_by === expense.corrected_by);

  return (
    <div className="rv">
      <div className="rv-top">
        {back}
        <Sticker tone={expense.status === 'confirmed' ? 'confirmado' : 'revisar'} size="sm" rotate={-4} />
      </div>
      <h1 className="lu-display" style={{ margin: 0 }}>
        {expense.merchant}
      </h1>

      <div className="rv-split">
        <section className="rv-evi" aria-label="Evidencia">
          <EvidenceViewer
            kind={expense.messages?.kind ?? null}
            path={expense.evidence_path}
            text={expense.messages?.text_body ?? null}
            fileName={expense.messages?.file_name ?? null}
            sender={sender?.display_name ?? 'Alguien'}
            senderTone={sender ? asTone(sender.tone, sender.display_name) : undefined}
            when={formatWhen(expense.messages?.received_at ?? expense.created_at)}
            source={expense.source}
          />
          <dl className="gd-facts">
            <div>
              <dt>Llegó por</dt>
              <dd>{ORIGEN[expense.source] ?? expense.source}</dd>
            </div>
            <div>
              <dt>Lo mandó</dt>
              <dd>
                {quienSubio?.display_name ?? 'Alguien'} · {formatWhen(expense.messages?.received_at ?? expense.created_at)}
              </dd>
            </div>
            {expense.confidence != null && (
              <div>
                <dt>Luks lo leyó</dt>
                <dd>con {Math.round(Number(expense.confidence) * 100)} % de confianza</dd>
              </div>
            )}
            {expense.corrected_by && (
              <div>
                <dt>Lo corrigió</dt>
                <dd className="gd-fix">
                  {corrector?.display_name ?? 'Un admin'}
                  {expense.corrected_at ? ` · ${formatWhen(expense.corrected_at)}` : ''}
                </dd>
              </div>
            )}
            {expense.cufe && (
              <div>
                <dt>Factura electrónica</dt>
                <dd className="lu-num" title={expense.cufe}>
                  CUFE …{expense.cufe.slice(-8)}
                </dd>
              </div>
            )}
          </dl>
          {expense.expense_items.length > 0 && (
            <section aria-label="Ítems del recibo">
              <h2 className="lu-label" style={{ margin: '0 0 6px' }}>
                Ítems
              </h2>
              <ul className="gd-items">
                {expense.expense_items.map((it) => (
                  <li key={it.id}>
                    <span>
                      {it.quantity && Number(it.quantity) !== 1 ? `${Number(it.quantity)} × ` : ''}
                      {it.name}
                    </span>
                    <span className="lu-num">{formatCOP(it.total_cop)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
        <section className="rv-data" aria-label="Datos del gasto">
          <ExpenseForm
            key={`${expense.id}-${expense.status}`}
            accountId={accountId}
            onCategoriesChanged={() => queryClient.invalidateQueries({ queryKey: ['gasto', expenseId] })}
            mode="edit"
            expense={expense}
            people={people}
            categories={categories}
            canEdit={canEdit}
            onSaved={() => {
              setSaved(true);
              queryClient.invalidateQueries({ queryKey: ['gasto', expenseId] });
              router.refresh();
            }}
            onDeleted={() => {
              router.push(`/c/${accountId}/gastos`);
              router.refresh();
            }}
          />
          {saved && (
            <p className="lu-success" role="status">
              Cambios guardados. Ya cuentan en el resumen.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
