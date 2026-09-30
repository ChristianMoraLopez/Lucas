'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EvidenceViewer } from '@/components/evidence-viewer';
import { formatCOP } from '@/components/lucas-core';
import { Avatar, Button, Chip, ExpenseCard, Field, LottieSlot, Sticker } from '@/components/lucas-ui';
import { formatDateCO, formatWhen } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { useAccountChanges } from '@/lib/realtime';
import { type AccountCategory, type AccountPerson, asTone, type FieldKey, type ReviewExpense, type Role } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

const KIND_LABEL = { photo: 'Foto', pdf: 'PDF', text: 'Mensaje' } as const;

interface Processing {
  id: string;
  kind: 'photo' | 'pdf' | 'text';
  sender_person_id: string | null;
  status: string;
}

interface Done {
  merchant: string;
  category: string | null;
  total: number;
  payer: string;
  each: number;
  n: number;
  date: string;
}

export function ReviewScreen({ accountId, myRole, focus }: { accountId: string; myRole: Role; focus: string | null }) {
  const [supabase] = useState(() => createClient());
  const queryClient = useQueryClient();
  const canReview = myRole === 'owner' || myRole === 'admin';

  const data = useQuery({
    queryKey: ['revisar', accountId],
    queryFn: async () => {
      const [pend, proc, people, cats] = await Promise.all([
        supabase
          .from('expenses')
          .select(
            'id, merchant, expense_date, total_cop, category_id, payer_person_id, status, confidence, field_confidence, ai_snapshot, split_note, corrected_by, evidence_path, created_at, source, messages(kind, text_body, file_name, received_at, sender_person_id), expense_splits(person_id, amount_cop)',
          )
          .eq('account_id', accountId)
          .eq('status', 'pending_review')
          .order('created_at'),
        supabase
          .from('messages')
          .select('id, kind, sender_person_id, status')
          .eq('account_id', accountId)
          .in('status', ['queued', 'processing'])
          .order('created_at'),
        supabase.from('people').select('id, display_name, tone, claimed_by').eq('account_id', accountId).order('created_at'),
        supabase.from('categories').select('id, name, letter, tone').eq('account_id', accountId).order('name'),
      ]);
      const error = pend.error ?? proc.error ?? people.error ?? cats.error;
      if (error) throw error;
      return {
        pending: pend.data as unknown as ReviewExpense[],
        processing: proc.data as Processing[],
        people: people.data as AccountPerson[],
        categories: cats.data as AccountCategory[],
      };
    },
  });
  useAccountChanges(accountId, () => queryClient.invalidateQueries({ queryKey: ['revisar', accountId] }));

  const [selected, setSelected] = useState<string | null>(focus);
  const [done, setDone] = useState<Record<string, Done>>({});

  if (data.isPending) {
    return (
      <div className="rv">
        <h1 className="lu-display">Por revisar</h1>
        <p className="lu-small lu-muted">Cargando…</p>
      </div>
    );
  }
  if (data.isError) {
    return (
      <div className="rv">
        <h1 className="lu-display">Por revisar</h1>
        <p className="lu-error" role="alert">
          {humanError(data.error)}
        </p>
      </div>
    );
  }

  const { pending, processing, people, categories } = data.data;
  // Los que se confirmaron en esta visita siguen en la cola, con su sticker
  const doneIds = Object.keys(done).filter((id) => !pending.some((p) => p.id === id));
  const queue = [...pending.map((p) => p.id), ...doneIds];
  const current = selected && (queue.includes(selected) || done[selected]) ? selected : (pending[0]?.id ?? doneIds[0] ?? null);
  const item = pending.find((p) => p.id === current);
  const personName = (id: string | null | undefined) => people.find((p) => p.id === id)?.display_name ?? 'Alguien';
  const personTone = (id: string | null | undefined) => {
    const p = people.find((x) => x.id === id);
    return p ? asTone(p.tone, p.display_name) : undefined;
  };
  const nextPending = pending.find((p) => p.id !== current && !done[p.id]);

  return (
    <div className="rv">
      <div className="rv-top">
        <div className="rv-head">
          <h1 className="lu-display">Por revisar</h1>
          {pending.length > 0 && <span className="rv-count lu-num">{pending.length}</span>}
        </div>
        <Link href={`/c/${accountId}/subir`} className="lu-btn lu-btn--sm lu-btn--secondary">
          Subir gasto
        </Link>
      </div>
      <p className="lu-small lu-muted" style={{ margin: '-8px 0 0' }}>
        Lo que llegó al grupo o subieron aquí y todavía no es gasto.
      </p>

      {(queue.length > 0 || processing.length > 0) && (
        <ol className="rv-queue" aria-label="Cola de revisión">
          {queue.map((id) => {
            const q = pending.find((p) => p.id === id);
            const d = done[id];
            const sender = q?.messages?.sender_person_id ?? q?.payer_person_id;
            const low = q && Math.min(...Object.values(q.field_confidence ?? { x: q.confidence ?? 1 })) < 0.75;
            return (
              <li key={id}>
                <button
                  type="button"
                  className={`rv-q${id === current ? ' is-on' : ''}${d ? ' is-done' : ''}`}
                  onClick={() => setSelected(id)}
                  aria-current={id === current}
                >
                  <Avatar name={q ? personName(sender) : d.payer} tone={q ? personTone(sender) : undefined} size="sm" />
                  <span className="rv-q__txt">
                    <span className="rv-q__m">{q?.merchant ?? d.merchant}</span>
                    <span className="rv-q__s">
                      {q ? KIND_LABEL[q.messages?.kind ?? 'text'] : 'Listo'} · <span className="lu-num">{formatCOP(q?.total_cop ?? d.total)}</span>
                    </span>
                  </span>
                  {d ? (
                    <Sticker tone="confirmado" size="sm" rotate={-8} className="rv-q__st" />
                  ) : low ? (
                    <span className="rv-q__dot" title="Tiene datos por revisar" />
                  ) : null}
                </button>
              </li>
            );
          })}
          {processing.map((m) => (
            <li key={m.id}>
              <div className="rv-q rv-q--proc">
                <LottieSlot name="escaneo" width={32} height={32} label="Procesando" />
                <span className="rv-q__txt">
                  <span className="rv-q__m">{m.kind === 'photo' ? 'Leyendo foto…' : m.kind === 'pdf' ? 'Leyendo PDF…' : 'Leyendo mensaje…'}</span>
                  <span className="rv-q__s">de {personName(m.sender_person_id)}</span>
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}

      {!item && !(current && done[current]) ? (
        <div className="rv-empty">
          <LottieSlot name="vacio" width={96} height={96} />
          <div>
            <p className="lu-title" style={{ margin: 0 }}>
              {processing.length ? 'Lucas está leyendo lo último' : 'Todo revisado'}
            </p>
            <p className="lu-small lu-muted" style={{ margin: '4px 0 var(--space-4)' }}>
              {processing.length
                ? 'En unos segundos aparece aquí para que lo revises.'
                : 'Cuando manden fotos al grupo o suban un gasto, llega aquí si Lucas no lo leyó seguro.'}
            </p>
            <Link href={`/c/${accountId}/subir`} className="lu-btn lu-btn--primary">
              Subir un gasto
            </Link>
          </div>
        </div>
      ) : (
        <div className="rv-split">
          {item ? (
            <section className="rv-evi" aria-label="Evidencia">
              <EvidenceViewer
                kind={item.messages?.kind ?? null}
                path={item.evidence_path}
                text={item.messages?.text_body ?? null}
                fileName={item.messages?.file_name ?? null}
                sender={personName(item.messages?.sender_person_id ?? item.payer_person_id)}
                senderTone={personTone(item.messages?.sender_person_id ?? item.payer_person_id)}
                when={formatWhen(item.messages?.received_at ?? item.created_at)}
                source={item.source}
              />
            </section>
          ) : (
            <div />
          )}

          <section className="rv-data" aria-label="Datos extraídos">
            {current && done[current] ? (
              <DoneCard
                d={done[current]}
                next={nextPending ? () => setSelected(nextPending.id) : null}
                nextLabel={nextPending ? `Siguiente · quedan ${pending.filter((p) => !done[p.id]).length}` : null}
                accountId={accountId}
              />
            ) : (
              item && (
                <ReviewForm
                  key={item.id}
                  expense={item}
                  people={people}
                  categories={categories}
                  canReview={canReview}
                  position={`${pending.indexOf(item) + 1} de ${pending.length}`}
                  onDone={(d) => {
                    setDone((x) => ({ ...x, [item.id]: d }));
                    setSelected(item.id);
                    queryClient.invalidateQueries({ queryKey: ['revisar', accountId] });
                  }}
                  onDiscarded={() => {
                    setSelected(null);
                    queryClient.invalidateQueries({ queryKey: ['revisar', accountId] });
                  }}
                />
              )
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function DoneCard({ d, next, nextLabel, accountId }: { d: Done; next: (() => void) | null; nextLabel: string | null; accountId: string }) {
  return (
    <div className="rv-done">
      <ExpenseCard
        appear
        merchant={d.merchant}
        category={d.category ?? undefined}
        meta={`${formatDateCO(d.date)} · pagó ${d.payer}`}
        total={d.total}
        each={`÷ ${d.n} · ${formatCOP(d.each)}`}
        sticker={<Sticker tone="confirmado" animate rotate={-6} />}
      />
      <div className="rv-done__row">
        <LottieSlot name="gasto-registrado" width={64} height={64} />
        <div>
          <p className="lu-title" style={{ margin: 0 }}>
            Quedó registrado
          </p>
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            Ya cuenta en el resumen y en la liquidación.
          </p>
        </div>
      </div>
      {next ? (
        <Button onClick={next}>{nextLabel}</Button>
      ) : (
        <Link href={`/c/${accountId}/resumen`} className="lu-btn lu-btn--primary">
          Ver el resumen
        </Link>
      )}
    </div>
  );
}

function ReviewForm({
  expense,
  people,
  categories,
  canReview,
  position,
  onDone,
  onDiscarded,
}: {
  expense: ReviewExpense;
  people: AccountPerson[];
  categories: AccountCategory[];
  canReview: boolean;
  position: string;
  onDone: (d: Done) => void;
  onDiscarded: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const ai = expense.ai_snapshot ?? {};
  const conf = expense.field_confidence ?? {};

  const [merchant, setMerchant] = useState(expense.merchant);
  const [date, setDate] = useState(expense.expense_date);
  const [total, setTotal] = useState(expense.total_cop);
  const [categoryId, setCategoryId] = useState(expense.category_id ?? '');
  const [payerId, setPayerId] = useState(expense.payer_person_id ?? '');
  const [split, setSplit] = useState<string[]>(() => {
    const ids = expense.expense_splits.map((s) => s.person_id);
    return ids.length ? ids : people.map((p) => p.id);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const nameOf = (id: string | null | undefined) => people.find((p) => p.id === id)?.display_name ?? '';
  const catOf = (id: string | null | undefined) => categories.find((c) => c.id === id)?.name ?? '';
  const corrector = people.find((p) => p.claimed_by === expense.corrected_by)?.display_name;

  // ¿El campo quedó distinto de lo que leyó la IA? Entonces es corrección de una persona (morado)
  const changed: Record<FieldKey, boolean> = {
    merchant: ai.merchant != null && merchant !== ai.merchant,
    date: ai.expense_date != null && date !== ai.expense_date,
    total: ai.total_cop != null && total !== ai.total_cop,
    category: ai.category_id !== undefined && (categoryId || null) !== (ai.category_id ?? null),
    payer: ai.payer_person_id !== undefined && (payerId || null) !== (ai.payer_person_id ?? null),
  };
  // Si lo que se ve es lo que ya guardó alguien, se le atribuye; si lo está cambiando uno, «Tu corrección»
  const savedBy = (field: FieldKey, saved: unknown, now: unknown) => (changed[field] && saved === now ? corrector : undefined);

  const each = split.length ? Math.floor(total / split.length) : 0;
  const toggle = (id: string) =>
    setSplit((s) => (s.includes(id) ? s.filter((x) => x !== id) : people.map((p) => p.id).filter((x) => s.includes(x) || x === id)));

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canReview || busy) return;
    if (!split.length) return setError('Elige al menos una persona para dividir el gasto');
    if (!payerId) return setError('Elige quién pagó');
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('review_expense', {
      p_expense_id: expense.id,
      p_merchant: merchant,
      p_expense_date: date,
      p_total_cop: total,
      p_category_id: categoryId || null,
      p_payer_person_id: payerId,
      p_split_person_ids: split,
      p_confirm: true,
    });
    setBusy(false);
    if (error) return setError(humanError(error));
    onDone({ merchant: merchant.trim(), category: catOf(categoryId) || null, total, payer: nameOf(payerId), each, n: split.length, date });
  };

  const discard = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('discard_expense', { p_expense_id: expense.id });
    setBusy(false);
    setDiscarding(false);
    if (error) return setError(humanError(error));
    onDiscarded();
  };

  return (
    <form className="rv-sheet" onSubmit={confirm}>
      <div className="rv-data__top">
        <span className="lu-title">Lo que leímos</span>
        <span className="lu-small lu-muted">{position}</span>
      </div>

      <fieldset className="rv-fields" disabled={!canReview}>
        <Field
          label="Comercio"
          id="rv-comercio"
          value={merchant}
          onChange={setMerchant}
          confidence={conf.merchant}
          original={ai.merchant}
          corrected={changed.merchant}
          correctedBy={savedBy('merchant', expense.merchant, merchant)}
        />
        <div className="rv-2">
          <Field
            label="Fecha"
            id="rv-fecha"
            num
            confidence={conf.date}
            original={ai.expense_date ? formatDateCO(ai.expense_date) : undefined}
            corrected={changed.date}
            correctedBy={savedBy('date', expense.expense_date, date)}
          >
            <input id="rv-fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field
            label="Total"
            id="rv-total"
            num
            inputMode="numeric"
            value={formatCOP(total)}
            onChange={(v) => setTotal(Number(v.replace(/\D/g, '')) || 0)}
            confidence={conf.total}
            original={ai.total_cop != null ? formatCOP(ai.total_cop) : undefined}
            corrected={changed.total}
            correctedBy={savedBy('total', expense.total_cop, total)}
          />
        </div>
        <div className="rv-2">
          <Field
            label="Categoría"
            id="rv-categoria"
            confidence={conf.category}
            original={ai.category_id !== undefined ? catOf(ai.category_id) || 'Sin categoría' : undefined}
            corrected={changed.category}
            correctedBy={savedBy('category', expense.category_id ?? '', categoryId)}
          >
            <select id="rv-categoria" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Quién pagó"
            id="rv-pagador"
            confidence={conf.payer}
            original={ai.payer_person_id !== undefined ? nameOf(ai.payer_person_id) || 'Nadie' : undefined}
            corrected={changed.payer}
            correctedBy={savedBy('payer', expense.payer_person_id ?? '', payerId)}
          >
            <select id="rv-pagador" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
              <option value="" disabled>
                Elige quién pagó
              </option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="lu-field">
          <div className="lu-field__top">
            <span className="lu-label">
              Entre quiénes · {split.length} de {people.length}
            </span>
            <span className="lu-amount lu-amount--sm">{formatCOP(each)} c/u</span>
          </div>
          <div className="lu-chips">
            {people.map((p) => (
              <Chip key={p.id} name={p.display_name} tone={asTone(p.tone, p.display_name)} pressed={split.includes(p.id)} onToggle={() => toggle(p.id)} />
            ))}
          </div>
          {expense.split_note && <span className="rv-note">{expense.split_note}</span>}
        </div>
      </fieldset>

      {error && (
        <p className="lu-error" role="alert">
          {error}
        </p>
      )}

      {canReview ? (
        <div className="rv-actions">
          <Button type="submit" disabled={busy} kbd="Enter">
            {busy ? 'Guardando…' : 'Confirmar gasto'}
          </Button>
          <Button variant="ghost" onClick={() => setDiscarding(true)} disabled={busy}>
            No es un gasto
          </Button>
        </div>
      ) : (
        <p className="rv-member lu-small">Solo quienes administran la cuenta confirman gastos. Si ves algo mal, avísales por el grupo.</p>
      )}

      <ConfirmDialog open={discarding} onOpenChange={setDiscarding} title="¿No es un gasto?" confirmLabel="Descartar" busy={busy} onConfirm={discard}>
        Lo quitamos de la cuenta. La foto o el mensaje quedan guardados como evidencia, pero ya no cuentan.
      </ConfirmDialog>
    </form>
  );
}
