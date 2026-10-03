'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Cargando } from '@/components/cargando';
import { EvidenceViewer } from '@/components/evidence-viewer';
import { ExpenseForm, type SavedExpense } from '@/components/expense-form';
import { formatCOP } from '@/components/lucas-core';
import { Avatar, Button, ExpenseCard, LottieSlot, Sticker } from '@/components/lucas-ui';
import { formatDateCO, formatWhen } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { useAccountChanges } from '@/lib/realtime';
import { type AccountCategory, type AccountPerson, asTone, type ReviewExpense, type Role } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

const KIND_LABEL = { photo: 'Foto', pdf: 'PDF', text: 'Mensaje' } as const;

interface Processing {
  id: string;
  kind: 'photo' | 'pdf' | 'text';
  sender_person_id: string | null;
  status: string;
}

type Done = SavedExpense;

export function ReviewScreen({
  accountId,
  myRole,
  focus,
  unknownSenders = 0,
}: {
  accountId: string;
  myRole: Role;
  focus: string | null;
  unknownSenders?: number;
}) {
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
            'id, merchant, expense_date, total_cop, category_id, payer_person_id, status, confidence, field_confidence, ai_snapshot, split_note, corrected_by, evidence_path, created_at, source, messages(kind, text_body, file_name, received_at, sender_person_id), split_method, expense_splits(person_id, amount_cop, fixed)',
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
        supabase.from('categories').select('id, name, letter, tone, description, is_default').eq('account_id', accountId).order('name'),
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
        <Cargando />
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

      {unknownSenders > 0 && (
        <div className="ed-alert" role="status">
          <Sticker tone="revisar" rotate={-5}>
            {unknownSenders === 1 ? '1 número' : `${unknownSenders} números`}
          </Sticker>
          <span className="lu-small" style={{ flex: 1, minWidth: 160 }}>
            Escribieron en el grupo y no sabemos de quién {unknownSenders === 1 ? 'es' : 'son'}: sus gastos quedan sin pagador.
          </span>
          <Link href={`/c/${accountId}/whatsapp`} className="lu-btn lu-btn--sm lu-btn--secondary">
            ¿Quién es?
          </Link>
        </div>
      )}

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
          <LottieSlot name={processing.length ? 'escaneo' : 'todo-revisado'} width={96} height={96} />
          <div>
            <p className="lu-title" style={{ margin: 0 }}>
              {processing.length ? 'Luks está leyendo lo último' : 'Todo revisado'}
            </p>
            <p className="lu-small lu-muted" style={{ margin: '4px 0 var(--space-4)' }}>
              {processing.length
                ? 'En unos segundos aparece aquí para que lo revises.'
                : 'Cuando manden fotos al grupo o suban un gasto, llega aquí si Luks no lo leyó seguro.'}
            </p>
            <div className="wa-row">
              <Link href={`/c/${accountId}/subir`} className="lu-btn lu-btn--primary">
                Subir un gasto
              </Link>
              <Link href={`/c/${accountId}/whatsapp`} className="lu-btn lu-btn--ghost">
                Conectar el grupo de WhatsApp
              </Link>
            </div>
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
                <ExpenseForm
                  key={item.id}
                  accountId={accountId}
                  onCategoriesChanged={() => queryClient.invalidateQueries({ queryKey: ['revisar', accountId] })}
                  mode="review"
                  expense={item}
                  people={people}
                  categories={categories}
                  canEdit={canReview}
                  position={`${pending.indexOf(item) + 1} de ${pending.length}`}
                  onSaved={(d) => {
                    setDone((x) => ({ ...x, [item.id]: d }));
                    setSelected(item.id);
                    queryClient.invalidateQueries({ queryKey: ['revisar', accountId] });
                  }}
                  onDeleted={() => {
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
        each={d.porConsumo ? `÷ ${d.n} · por consumo` : `÷ ${d.n} · ${formatCOP(d.each)}`}
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
