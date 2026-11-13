import { notFound } from 'next/navigation';
import { esMoneda } from '@/lib/moneda';
import type { Dashboard } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import type { Entrada } from './entradas';
import { PresupuestoScreen } from './presupuesto-screen';

/** Cuántos días atrás se miran para saber a qué ritmo se está gastando */
const DIAS_RITMO = 14;

function restarDias(iso: string, n: number) {
  const f = new Date(`${iso}T12:00:00`);
  f.setDate(f.getDate() - n);
  return f.toISOString().slice(0, 10);
}

export default async function PresupuestosPage({ params }: PageProps<'/c/[accountId]/presupuestos'>) {
  const { accountId } = await params;
  const { supabase, userId } = await requireUser(`/c/${accountId}/presupuestos`);

  const [{ data, error }, { data: me }, { data: cuenta }] = await Promise.all([
    supabase.rpc('account_dashboard', { p_account_id: accountId, p_month: null }),
    supabase.from('account_members').select('role').eq('account_id', accountId).eq('user_id', userId).maybeSingle(),
    supabase.from('accounts').select('currency').eq('id', accountId).maybeSingle(),
  ]);
  if (error) throw error;
  if (!data) notFound();
  const d = data as Dashboard;

  const desde = restarDias(d.today, DIAS_RITMO - 1);
  const [{ data: recientes }, { data: ingresos }] = await Promise.all([
    supabase.from('expenses').select('total_cop').eq('account_id', accountId).gte('expense_date', desde).lte('expense_date', d.today),
    // Lo que entró este mes (migración 810)
    supabase
      .from('incomes')
      .select('id, amount_cop, income_date, description, source, created_by, person:people(display_name)')
      .eq('account_id', accountId)
      .gte('income_date', d.month)
      .order('income_date', { ascending: false })
      .order('created_at', { ascending: false }),
  ]);
  const entradas: Entrada[] = (ingresos ?? []).map(({ person, ...e }) => ({
    ...e,
    amount_cop: Number(e.amount_cop),
    source: e.source as Entrada['source'],
    person: (Array.isArray(person) ? person[0] : person)?.display_name ?? null,
  }));
  const gastoReciente = (recientes ?? []).reduce((s, e) => s + Number(e.total_cop), 0);

  return (
    <PresupuestoScreen
      accountId={accountId}
      today={d.today}
      month={d.month}
      spent={d.total}
      budget={d.budget}
      categories={d.categories.filter((c) => c.budget)}
      ritmo={Math.round(gastoReciente / DIAS_RITMO)}
      diasRitmo={DIAS_RITMO}
      puedeEditar={me?.role === 'owner' || me?.role === 'admin'}
      entradas={entradas}
      usuario={userId}
      moneda={esMoneda(cuenta?.currency) ? cuenta.currency : 'COP'}
    />
  );
}
