'use client';

import Link from 'next/link';
import { useState } from 'react';
import { lanzarChispas } from '@/components/chispas';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useT } from '@/components/idioma';
import { nombreCategoria } from '@/components/lucas-core';
import { Button, Chip, Field } from '@/components/lucas-ui';
import { useDinero } from '@/components/moneda';
import { formatDateCO } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { notifyAccountChanged } from '@/lib/realtime';
import { type AccountCategory, type AccountPerson, asTone, type FieldKey, plural, type ReviewExpense } from '@/lib/types';
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
  /** Quedó dividido por consumo (cada uno su parte, no por igual) */
  porConsumo?: boolean;
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
  const t = useT();
  const cop = useDinero().fmt;
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
  // Dividido por consumo (quién pidió qué): se respeta al guardar, salvo que lo vuelvan a dividir igual
  const [porConsumo, setPorConsumo] = useState(expense.split_method === 'items');
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
  const dividirHref = `/c/${accountId}/gastos/${expense.id}/dividir${mode === 'review' ? '?volver=revisar' : ''}`;
  const toggle = (id: string) =>
    setSplit((s) => (s.includes(id) ? s.filter((x) => x !== id) : people.map((p) => p.id).filter((x) => s.includes(x) || x === id)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    // El botón que lo envió (también con Enter): ahí salen las chispas si queda guardado
    const boton = (e.nativeEvent as SubmitEvent).submitter ?? null;
    if (!canEdit || busy) return;
    if (!porConsumo && !split.length) return setError(t('Elige al menos una persona para dividir el gasto'));
    if (!payerId) return setError(t('Elige quién pagó'));
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('review_expense', {
      p_expense_id: expense.id,
      p_merchant: merchant,
      p_expense_date: date,
      p_total_cop: total,
      p_category_id: categoryId || null,
      p_payer_person_id: payerId,
      // null: se queda la división por consumo (la base revisa que siga sumando el total)
      p_split_person_ids: porConsumo ? null : split,
      p_confirm: true,
    });
    setBusy(false);
    if (error) return setError(humanError(error));
    if (boton) {
      const r = boton.getBoundingClientRect();
      lanzarChispas({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, currentTarget: null });
    }
    notifyAccountChanged(accountId);
    onSaved({
      merchant: merchant.trim(),
      category: catOf(categoryId) || null,
      total,
      payer: nameOf(payerId),
      each,
      n: porConsumo ? expense.expense_splits.length : split.length,
      date,
      porConsumo,
    });
  };

  const remove = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('discard_expense', { p_expense_id: expense.id });
    setBusy(false);
    setDeleting(false);
    if (error) return setError(humanError(error));
    notifyAccountChanged(accountId);
    onDeleted();
  };

  return (
    <form className="rv-sheet" onSubmit={save}>
      <div className="rv-data__top">
        <span className="lu-title">{mode === 'review' ? t('Lo que leímos') : t('Datos del gasto')}</span>
        {position && <span className="lu-small lu-muted">{position}</span>}
      </div>

      <fieldset className="rv-fields" disabled={!canEdit}>
        <Field
          label={t('Comercio')}
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
            label={t('Fecha')}
            id="rv-fecha"
            num
            confidence={conf.date}
            original={ai.expense_date ? formatDateCO(ai.expense_date, t.idioma) : undefined}
            corrected={changed.date}
            correctedBy={savedBy('date', expense.expense_date, date)}
          >
            <input id="rv-fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field
            label={t('Total')}
            id="rv-total"
            num
            inputMode="numeric"
            value={cop(total)}
            onChange={(v) => setTotal(Number(v.replace(/\D/g, '')) || 0)}
            confidence={conf.total}
            original={ai.total_cop != null ? cop(ai.total_cop) : undefined}
            corrected={changed.total}
            correctedBy={savedBy('total', expense.total_cop, total)}
          />
        </div>
        <div className="rv-2">
          <Field
            label={t('Categoría')}
            id="rv-categoria"
            confidence={conf.category}
            original={ai.category_id !== undefined ? nombreCategoria(catOf(ai.category_id), t) || t('Sin categoría') : undefined}
            corrected={changed.category}
            correctedBy={savedBy('category', expense.category_id ?? '', categoryId)}
          >
            <select id="rv-categoria" value={categoryId} onChange={(e) => (e.target.value === NUEVA ? setCreando(true) : setCategoryId(e.target.value))}>
              <option value="">{t('Sin categoría')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {nombreCategoria(c.name, t)}
                </option>
              ))}
              {canEdit && <option value={NUEVA}>{t('+ Nueva categoría…')}</option>}
            </select>
          </Field>
          <Field
            label={t('Quién pagó')}
            id="rv-pagador"
            confidence={conf.payer}
            original={ai.payer_person_id !== undefined ? nameOf(ai.payer_person_id) || t('Nadie') : undefined}
            corrected={changed.payer}
            correctedBy={savedBy('payer', expense.payer_person_id ?? '', payerId)}
          >
            <select id="rv-pagador" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
              <option value="" disabled>
                {t('Elige quién pagó')}
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
        {porConsumo ? (
          <div className="lu-field">
            <div className="lu-field__top">
              <span className="lu-label">
                {t('Dividido por consumo')} · {plural(expense.expense_splits.length, t('persona'), t('personas'))}
              </span>
            </div>
            <ul className="rv-consumo">
              {[...expense.expense_splits]
                .sort((a, b) => b.amount_cop - a.amount_cop)
                .map((x) => (
                  <li key={x.person_id}>
                    <span>
                      {nameOf(x.person_id) || t('Alguien')}
                      {x.fixed && <span className="rv-consumo__fijo">{t('puso su monto')}</span>}
                    </span>
                    <b className="lu-num">{cop(x.amount_cop)}</b>
                  </li>
                ))}
            </ul>
            <div className="rv-consumo__acts">
              <Link href={dividirHref} className="lu-btn lu-btn--sm lu-btn--secondary">
                {t('Cambiar quién pidió qué')}
              </Link>
              <button type="button" className="st-undo" onClick={() => setPorConsumo(false)}>
                {t('Mejor dividir por igual')}
              </button>
            </div>
          </div>
        ) : (
          <div className="lu-field">
            <div className="lu-field__top">
              <span className="lu-label">{t('Entre quiénes · {n} de {total}', { n: split.length, total: people.length })}</span>
              <span className="lu-amount lu-amount--sm">{t('{monto} c/u', { monto: cop(each) })}</span>
            </div>
            <div className="lu-chips">
              {people.map((p) => (
                <Chip key={p.id} name={p.display_name} tone={asTone(p.tone, p.display_name)} pressed={split.includes(p.id)} onToggle={() => toggle(p.id)} />
              ))}
            </div>
            {expense.split_note && <span className="rv-note">{expense.split_note}</span>}
            {canEdit &&
              (expense.expense_items?.length ? (
                // Luks leyó los ítems: marcar quién pidió qué es un toque por ítem
                <Link href={dividirHref} className="rv-dividir rv-dividir--items">
                  <b>{t('Luks leyó {n} de la factura.', { n: plural(expense.expense_items.length, t('ítem'), t('ítems')) })}</b>{' '}
                  {t('¿No pidieron lo mismo? Marquen quién pidió qué →')}
                </Link>
              ) : (
                <Link href={dividirHref} className="rv-dividir">
                  <b>{t('¿No pidieron lo mismo?')}</b> {t('Dividir por consumo: quién pidió qué de la factura →')}
                </Link>
              ))}
          </div>
        )}
      </fieldset>

      {pending && ai.possible_duplicate_of && (
        <p className="rv-note" role="note">
          {t('Se parece a otro gasto del mismo comercio, día y valor. Revisa que no esté repetido antes de confirmar.')}
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
            {busy ? t('Guardando…') : pending ? t('Confirmar gasto') : t('Guardar cambios')}
          </Button>
          <Button variant="ghost" onClick={() => setDeleting(true)} disabled={busy}>
            {mode === 'review' ? t('No es un gasto') : t('Eliminar gasto')}
          </Button>
        </div>
      ) : (
        <p className="rv-member lu-small">
          {t('Solo quienes administran la cuenta confirman, corrigen o eliminan gastos. Si ves algo mal, avísales por el grupo.')}
        </p>
      )}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={mode === 'review' ? t('¿No es un gasto?') : t('¿Eliminar este gasto?')}
        confirmLabel={mode === 'review' ? t('Descartar') : t('Eliminar')}
        busy={busy}
        onConfirm={remove}
      >
        {mode === 'review'
          ? t('Lo quitamos de la cuenta. La foto o el mensaje quedan guardados como evidencia, pero ya no cuentan.')
          : t('Deja de contar en el resumen y en la liquidación de todos. La foto o el mensaje quedan guardados como evidencia.')}
      </ConfirmDialog>
    </form>
  );
}
