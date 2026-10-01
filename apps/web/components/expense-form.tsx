'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { formatCOP } from '@/components/lucas-core';
import { Button, Chip, Field } from '@/components/lucas-ui';
import { formatDateCO } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { type AccountCategory, type AccountPerson, asTone, type FieldKey, type ReviewExpense } from '@/lib/types';
import { NuevaCategoria } from './new-category';

const NUEVA = '__nueva';

import { createClient } from '@/utils/supabase/client';

/** Lo que se muestra en la tarjeta de «Quedó registrado» */
export interface SavedExpense {
  merchant: string;
  category: string | null;
  total: number;
  payer: string;
  each: number;
  n: number;
  date: string;
}

/**
 * Los datos de un gasto y entre quiénes se divide. En la bandeja (`review`)
 * confirma lo que leyó Luks; en el detalle (`edit`) un admin corrige o
 * elimina cualquier gasto, aunque ya esté confirmado. Lo que alguien cambia
 * respecto a lo que leyó la IA se marca en morado (corrección humana).
 */
export function ExpenseForm({
  accountId,
  expense,
  people,
  categories: categoriasCuenta,
  canEdit,
  mode,
  position,
  onSaved,
  onDeleted,
  onCategoriesChanged,
}: {
  accountId: string;
  expense: ReviewExpense;
  people: AccountPerson[];
  categories: AccountCategory[];
  canEdit: boolean;
  mode: 'review' | 'edit';
  position?: string;
  onSaved: (d: SavedExpense) => void;
  onDeleted: () => void;
  onCategoriesChanged?: () => void;
}) {
  const [supabase] = useState(() => createClient());
  // Las que se crean aquí mismo se suman mientras la lista se vuelve a pedir
  const [nuevas, setNuevas] = useState<AccountCategory[]>([]);
  const categories = [...categoriasCuenta, ...nuevas.filter((n) => !categoriasCuenta.some((c) => c.id === n.id))];
  const [creando, setCreando] = useState(false);
  const ai = expense.ai_snapshot ?? {};
  const pending = expense.status === 'pending_review';
  // La confianza de la IA solo ayuda mientras está por revisar
  const conf = pending ? (expense.field_confidence ?? {}) : {};

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
  const [deleting, setDeleting] = useState(false);

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

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || busy) return;
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
    onSaved({ merchant: merchant.trim(), category: catOf(categoryId) || null, total, payer: nameOf(payerId), each, n: split.length, date });
  };

  const remove = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('discard_expense', { p_expense_id: expense.id });
    setBusy(false);
    setDeleting(false);
    if (error) return setError(humanError(error));
    onDeleted();
  };

  return (
    <form className="rv-sheet" onSubmit={save}>
      <div className="rv-data__top">
        <span className="lu-title">{mode === 'review' ? 'Lo que leímos' : 'Datos del gasto'}</span>
        {position && <span className="lu-small lu-muted">{position}</span>}
      </div>

      <fieldset className="rv-fields" disabled={!canEdit}>
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
            <select id="rv-categoria" value={categoryId} onChange={(e) => (e.target.value === NUEVA ? setCreando(true) : setCategoryId(e.target.value))}>
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {canEdit && <option value={NUEVA}>+ Nueva categoría…</option>}
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
        {creando && (
          <NuevaCategoria
            accountId={accountId}
            onCancel={() => setCreando(false)}
            onCreated={(c) => {
              setNuevas((x) => [...x, c]);
              setCategoryId(c.id);
              setCreando(false);
              onCategoriesChanged?.();
            }}
          />
        )}
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

      {pending && ai.possible_duplicate_of && (
        <p className="rv-note" role="note">
          Se parece a otro gasto del mismo comercio, día y valor. Revisa que no esté repetido antes de confirmar.
        </p>
      )}

      {error && (
        <p className="lu-error" role="alert">
          {error}
        </p>
      )}

      {canEdit ? (
        <div className="rv-actions">
          <Button type="submit" disabled={busy} kbd="Enter">
            {busy ? 'Guardando…' : pending ? 'Confirmar gasto' : 'Guardar cambios'}
          </Button>
          <Button variant="ghost" onClick={() => setDeleting(true)} disabled={busy}>
            {mode === 'review' ? 'No es un gasto' : 'Eliminar gasto'}
          </Button>
        </div>
      ) : (
        <p className="rv-member lu-small">Solo quienes administran la cuenta confirman, corrigen o eliminan gastos. Si ves algo mal, avísales por el grupo.</p>
      )}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={mode === 'review' ? '¿No es un gasto?' : '¿Eliminar este gasto?'}
        confirmLabel={mode === 'review' ? 'Descartar' : 'Eliminar'}
        busy={busy}
        onConfirm={remove}
      >
        {mode === 'review'
          ? 'Lo quitamos de la cuenta. La foto o el mensaje quedan guardados como evidencia, pero ya no cuentan.'
          : 'Deja de contar en el resumen y en la liquidación de todos. La foto o el mensaje quedan guardados como evidencia.'}
      </ConfirmDialog>
    </form>
  );
}
