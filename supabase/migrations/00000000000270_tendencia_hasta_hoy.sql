-- ============================================================================
-- Lucas · 00000000000270_tendencia_hasta_hoy.sql
-- En el resumen del hogar, las barras de «Últimos seis meses» terminaban en el
-- mes elegido: al tocar septiembre desaparecía octubre y no había cómo volver
-- desde las barras. Ahora la tendencia termina en el mes actual (o, si el mes
-- elegido es de hace más de seis meses, cinco meses después de él), y el mes
-- elegido se resalta dentro. Lo demás de account_dashboard queda igual.
-- Misma firma: los permisos de la 040 se mantienen.
-- ============================================================================

create or replace function public.account_dashboard(p_account_id uuid, p_month date default null)
returns json
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_mes date := date_trunc('month', coalesce(p_month, (now() at time zone 'America/Bogota')::date))::date;
  v_desde date;
  v_hasta date;
  -- Los seis meses de la tendencia terminan en el mes actual (o cinco meses
  -- después del elegido, si es muy viejo): elegir septiembre no esconde octubre
  v_fin date;
begin
  select * into a from public.accounts where id = p_account_id;
  if not found then
    return null;
  end if;

  v_fin := greatest(v_mes, least(date_trunc('month', v_hoy)::date, (v_mes + interval '5 months')::date));

  if a.type = 'hogar' then
    v_desde := v_mes;
    v_hasta := (v_mes + interval '1 month')::date;
  else
    v_desde := '0001-01-01';
    v_hasta := '9999-12-31';
  end if;

  return json_build_object(
    'account', json_build_object(
      'id', a.id, 'name', a.name, 'type', a.type, 'status', a.status,
      'starts_on', a.starts_on, 'ends_on', a.ends_on
    ),
    'today', v_hoy,
    'month', v_mes,
    'total', (
      select coalesce(sum(e.total_cop), 0) from public.expenses e
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
    ),
    'expense_count', (
      select count(*) from public.expenses e
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
    ),
    'pending_count', (
      select count(*) from public.expenses e where e.account_id = a.id and e.status = 'pending_review'
    ),
    'all_equal', not exists (
      select 1 from public.expenses e where e.account_id = a.id and e.split_method <> 'equal'
    ),
    'budget', case when a.type = 'hogar' then coalesce(
      (select b.amount_cop from public.budgets b where b.account_id = a.id and b.category_id is null and b.period = v_mes),
      (select sum(b.amount_cop) from public.budgets b where b.account_id = a.id and b.category_id is not null and b.period = v_mes)
    ) end,
    'prev_total', case when a.type = 'hogar' then (
      select coalesce(sum(e.total_cop), 0) from public.expenses e
      where e.account_id = a.id
        and e.expense_date >= (v_mes - interval '1 month')::date and e.expense_date < v_mes
    ) end,
    'categories', coalesce((
      select json_agg(json_build_object(
        'id', x.id, 'name', x.name, 'letter', x.letter, 'tone', x.tone, 'total', x.total, 'budget', x.budget
      ) order by x.total desc, x.name)
      from (
        select c.id, c.name, c.letter, c.tone,
               coalesce(sum(e.total_cop), 0) as total,
               (select b.amount_cop from public.budgets b
                where b.category_id = c.id and b.period = v_mes and a.type = 'hogar') as budget
        from public.categories c
        left join public.expenses e
          on e.category_id = c.id and e.expense_date >= v_desde and e.expense_date < v_hasta
        where c.account_id = a.id
        group by c.id
      ) x
      where x.total > 0 or x.budget is not null
    ), '[]'::json),
    'trend', case when a.type = 'hogar' then (
      select json_agg(json_build_object('month', t.mes, 'total', t.total) order by t.mes)
      from (
        select g.mes::date as mes,
               (select coalesce(sum(e.total_cop), 0) from public.expenses e
                where e.account_id = a.id and e.expense_date >= g.mes::date
                  and e.expense_date < (g.mes + interval '1 month')::date) as total
        from generate_series(v_fin - interval '5 months', v_fin::timestamp, interval '1 month') as g (mes)
      ) t
    ) end,
    'people', coalesce((
      select json_agg(json_build_object(
        'id', x.id, 'name', x.display_name, 'tone', x.tone, 'registered', x.registered,
        'paid', x.paid, 'share', x.share, 'balance', x.paid - x.share
      ) order by x.paid - x.share desc, x.display_name)
      from (
        select p.id, p.display_name, p.tone, p.claimed_by is not null as registered,
               (select coalesce(sum(e.total_cop), 0) from public.expenses e
                where e.payer_person_id = p.id and e.expense_date >= v_desde and e.expense_date < v_hasta) as paid,
               (select coalesce(sum(s.amount_cop), 0) from public.expense_splits s
                join public.expenses e on e.id = s.expense_id
                where s.person_id = p.id and e.expense_date >= v_desde and e.expense_date < v_hasta) as share
        from public.people p
        where p.account_id = a.id
      ) x
    ), '[]'::json),
    'recent', coalesce((
      select json_agg(r order by r.expense_date desc, r.created_at desc)
      from (
        select e.id, e.merchant, e.expense_date, e.created_at, e.total_cop, e.status, e.source,
               m.kind, c.name as category, p.display_name as payer, p.tone as payer_tone,
               p.claimed_by is not null as payer_registered
        from public.expenses e
        left join public.messages m on m.id = e.message_id
        left join public.categories c on c.id = e.category_id
        left join public.people p on p.id = e.payer_person_id
        where e.account_id = a.id
        order by e.expense_date desc, e.created_at desc
        limit 6
      ) r
    ), '[]'::json)
  );
end;
$$;
