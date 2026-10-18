-- ============================================================================
-- Lucas · 00000000000400_liquidar_directo.sql
-- «¿Por qué le debo a Daniel si no estuve en su factura?»
--
--   · Al liquidar, cada quien le paga solo a alguien que pagó algo suyo. Antes
--     se cruzaban las deudas para hacer el mínimo de transferencias: daba cero
--     para todos, pero a uno le tocaba pagarle a alguien que no había pagado
--     nada suyo. Cruzarlas sigue siendo una opción de la cuenta.
--   · La base da las transferencias por pareja (lo que uno le debe al otro por
--     lo que pagó, menos lo que el otro le debe; siempre cuadran) y quién pagó
--     algo de quién. Con eso la app y Mister Luks buscan menos transferencias
--     (apps/web/lib/settlement.ts, aQuienPagoPor) y, si no cuadra, por pareja.
--   · Lo de Liquidar (y el link público) trae los ítems de los gastos
--     divididos por consumo: cada quien ve qué pidió y cuánto le costó.
-- ============================================================================

alter table public.accounts add column settle_direct boolean not null default true;
comment on column public.accounts.settle_direct is
  'Al liquidar, cada quien le paga a quien pagó por él (false: se cruzan las deudas para hacer menos transferencias)';

-- Quién le paga a quién, sin cruzar deudas: por cada pareja, lo que uno le
-- debe al otro por los gastos que pagó (completos, como en period_balances)
-- menos lo que el otro le debe a él y lo que ya le pagó
create or replace function public.transferencias_directas(p_account_id uuid, p_month date)
returns table (from_person_id uuid, to_person_id uuid, amount_cop bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with a as (
    select x.id, x.type from public.accounts x where x.id = p_account_id
  ),
  e as (
    select x.id, x.payer_person_id
    from public.expenses x, a
    where x.account_id = a.id
      and x.payer_person_id is not null
      and (p_month is null or a.type <> 'hogar'
           or (x.expense_date >= p_month and x.expense_date < (p_month + interval '1 month')::date))
      and x.total_cop = (select coalesce(sum(s.amount_cop), 0) from public.expense_splits s where s.expense_id = x.id)
  ),
  deudas as (
    -- de le debe a «a» su parte del gasto que «a» pagó
    select s.person_id as de, e.payer_person_id as a, s.amount_cop as monto
    from e join public.expense_splits s on s.expense_id = e.id
    where s.person_id <> e.payer_person_id
    union all
    -- lo que ya se pagó (liquidaciones que se reabrieron) descuenta
    select x.to_person_id, x.from_person_id, x.amount_cop
    from public.settlement_payments x
    where x.account_id = p_account_id and x.period is not distinct from p_month
  ),
  neto as (
    select least(d.de, d.a) as p1, greatest(d.de, d.a) as p2,
           sum(case when d.de < d.a then d.monto else -d.monto end) as v
    from deudas d
    group by 1, 2
  )
  select case when n.v > 0 then n.p1 else n.p2 end,
         case when n.v > 0 then n.p2 else n.p1 end,
         abs(n.v)::bigint
  from neto n
  where n.v <> 0
$$;

-- Cruzar las deudas o no (quien administra la cuenta)
create or replace function public.set_settle_mode(p_account_id uuid, p_direct boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta deciden cómo se liquida';
  end if;
  update public.accounts set settle_direct = coalesce(p_direct, true) where id = p_account_id;
end;
$$;

-- Lo que muestra Liquidar (como en la 390): con las transferencias directas y los ítems de cada gasto
create or replace function public.account_numbers(p_account_id uuid, p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_mes date;
  v_desde date;
  v_hasta date;
  s public.settlements%rowtype;
begin
  select * into a from public.accounts where id = p_account_id;
  if a.id is null then
    return null;
  end if;

  if a.type = 'hogar' then
    v_mes := date_trunc('month', coalesce(p_month, v_hoy))::date;
    v_desde := v_mes;
    v_hasta := (v_mes + interval '1 month')::date;
  else
    v_desde := '0001-01-01';
    v_hasta := '9999-12-31';
  end if;
  select * into s from public.settlements x where x.account_id = a.id and x.period is not distinct from v_mes;

  return jsonb_build_object(
    'account', jsonb_build_object(
      'id', a.id, 'name', a.name, 'type', a.type, 'status', a.status,
      'starts_on', a.starts_on, 'ends_on', a.ends_on
    ),
    'today', v_hoy,
    'month', v_mes,
    'pending_count', (
      select count(*) from public.expenses e
      where e.account_id = a.id and e.status = 'pending_review' and e.expense_date >= v_desde and e.expense_date < v_hasta
    ),
    'incomplete_count', (
      select count(*) from public.expenses e
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
        and (e.payer_person_id is null
             or e.total_cop <> (select coalesce(sum(x.amount_cop), 0) from public.expense_splits x where x.expense_id = e.id))
    ),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.display_name, 'tone', p.tone, 'registered', p.claimed_by is not null,
        'paid', b.paid, 'share', b.share, 'sent', b.sent, 'received', b.received,
        'balance', b.paid - b.share + b.sent - b.received, 'expenses', b.expenses
      ) order by b.paid - b.share + b.sent - b.received desc, p.display_name)
      from public.saldos(a.id, v_mes) b
      join public.people p on p.id = b.person_id
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'merchant', e.merchant, 'expense_date', e.expense_date, 'total_cop', e.total_cop,
        'status', e.status, 'payer_person_id', e.payer_person_id,
        'category', c.name, 'category_letter', c.letter, 'category_tone', c.tone,
        'split_method', e.split_method, 'tip_cop', e.tip_cop,
        'shares', coalesce((
          select jsonb_agg(jsonb_build_object('person_id', x.person_id, 'amount_cop', x.amount_cop))
          from public.expense_splits x where x.expense_id = e.id
        ), '[]'::jsonb),
        -- Dividido por consumo: qué pidió cada uno (para que cada quien vea lo suyo)
        'items', case when e.split_method = 'items' then coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', i.name, 'quantity', i.quantity, 'total', i.total_cop, 'extra', i.extra,
            'people', coalesce((
              select jsonb_agg(jsonb_build_object('id', ip.person_id, 'units', ip.units))
              from public.expense_item_people ip where ip.item_id = i.id
            ), '[]'::jsonb)
          ) order by i.created_at, i.id)
          from public.expense_items i where i.expense_id = e.id
        ), '[]'::jsonb) end
      ) order by e.expense_date desc, e.created_at desc)
      from public.expenses e
      left join public.categories c on c.id = e.category_id
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
    ), '[]'::jsonb),
    'settlement', case when s.id is null then null else jsonb_build_object(
      'id', s.id,
      'created_at', s.created_at,
      'created_by', (select pf.full_name from public.profiles pf where pf.id = s.created_by),
      'transfers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'from', t.from_person_id, 'to', t.to_person_id, 'amount', t.amount_cop,
          'paid_at', t.paid_at,
          'paid_by', (
            select coalesce(pp.display_name, pf.full_name)
            from public.profiles pf
            left join public.people pp on pp.account_id = a.id and pp.claimed_by = pf.id
            where pf.id = t.paid_by
          )
        ) order by t.position)
        from public.settlement_transfers t where t.settlement_id = s.id
      ), '[]'::jsonb)
    ) end,
    -- Cada quien le paga a quien pagó por él (o se cruzan las deudas para hacer menos transferencias)
    'direct', a.settle_direct,
    'direct_transfers', coalesce((
      select jsonb_agg(jsonb_build_object('from', x.from_person_id, 'to', x.to_person_id, 'amount', x.amount_cop)
                       order by x.amount_cop desc, x.from_person_id, x.to_person_id)
      from public.transferencias_directas(a.id, v_mes) x
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'from', x.from_person_id, 'to', x.to_person_id, 'amount', x.amount_cop, 'paid_at', x.paid_at
      ) order by x.paid_at, x.created_at)
      from public.settlement_payments x
      where x.account_id = a.id and x.period is not distinct from v_mes
    ), '[]'::jsonb),
    'settled_months', case when a.type = 'hogar' then coalesce((
      select jsonb_agg(x.period order by x.period desc) from public.settlements x where x.account_id = a.id
    ), '[]'::jsonb) end
  );
end;
$$;


-- Liquidar (como en la 390): directo puede necesitar más de n − 1 transferencias
create or replace function public.start_settlement(p_account_id uuid, p_month date, p_transfers jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_mes date;
  v_desde date;
  v_hasta date;
  v_t jsonb := coalesce(p_transfers, '[]'::jsonb);
  v_n int;
  v_personas int;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta pueden liquidar';
  end if;
  select * into a from public.accounts where id = p_account_id for update;
  if a.status <> 'active' then
    raise exception 'La cuenta ya se está liquidando o está cerrada';
  end if;

  if a.type = 'hogar' then
    if p_month is null then
      raise exception 'Elige qué mes liquidar';
    end if;
    v_mes := date_trunc('month', p_month)::date;
    if v_mes > date_trunc('month', v_hoy)::date then
      raise exception 'Ese mes todavía no ha empezado';
    end if;
    v_desde := v_mes;
    v_hasta := (v_mes + interval '1 month')::date;
  else
    v_desde := '0001-01-01';
    v_hasta := '9999-12-31';
  end if;
  if exists (select 1 from public.settlements s where s.account_id = a.id and s.period is not distinct from v_mes) then
    raise exception '%', case when a.type = 'hogar' then 'Ese mes ya está liquidado' else 'El paseo ya está liquidado' end;
  end if;

  select count(*) into v_n from public.expenses e
  where e.account_id = a.id and e.status = 'pending_review' and e.expense_date >= v_desde and e.expense_date < v_hasta;
  if v_n > 0 then
    raise exception 'Primero revisen % %', v_n, case when v_n = 1 then 'gasto pendiente' else 'gastos pendientes' end;
  end if;
  select count(*) into v_n from public.expenses e
  where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
    and (e.payer_person_id is null
         or e.total_cop <> (select coalesce(sum(x.amount_cop), 0) from public.expense_splits x where x.expense_id = e.id));
  if v_n > 0 then
    raise exception 'Hay % sin quién pagó o sin dividir: corríjanlos antes de liquidar', case when v_n = 1 then '1 gasto' else v_n || ' gastos' end;
  end if;

  if jsonb_typeof(v_t) <> 'array' then
    raise exception 'Las transferencias no tienen el formato esperado';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_t) t
    where jsonb_typeof(t -> 'amount') <> 'number'
       or (t ->> 'amount')::numeric <= 0
       or (t ->> 'amount')::numeric <> trunc((t ->> 'amount')::numeric)
       or public.try_uuid(t ->> 'from') is null or public.try_uuid(t ->> 'to') is null
       or t ->> 'from' = t ->> 'to'
       or not exists (select 1 from public.people p where p.id = public.try_uuid(t ->> 'from') and p.account_id = a.id)
       or not exists (select 1 from public.people p where p.id = public.try_uuid(t ->> 'to') and p.account_id = a.id)
  ) then
    raise exception 'Alguna transferencia no es válida';
  end if;

  -- Directo, a lo sumo una transferencia por pareja; cruzando deudas, menos
  select count(*) into v_personas from public.people p where p.account_id = a.id;
  if jsonb_array_length(v_t) > greatest(v_personas * (v_personas - 1) / 2, 0) then
    raise exception 'Sobran transferencias: con % personas bastan %', v_personas, greatest(v_personas * (v_personas - 1) / 2, 0);
  end if;

  -- Lo que pagó − lo que le tocaba (+ lo que ya pagó − lo que ya recibió) + lo que transfiere − lo que recibe = 0 para todos
  if exists (
    select 1 from public.saldos(a.id, v_mes) b
    where b.paid - b.share + b.sent - b.received
      + coalesce((select sum((t ->> 'amount')::bigint) from jsonb_array_elements(v_t) t where (t ->> 'from')::uuid = b.person_id), 0)
      - coalesce((select sum((t ->> 'amount')::bigint) from jsonb_array_elements(v_t) t where (t ->> 'to')::uuid = b.person_id), 0)
      <> 0
  ) then
    raise exception 'Las transferencias no dejan a todos a paz y salvo. Recarguen la página y vuelvan a intentar';
  end if;

  insert into public.settlements (account_id, period, created_by)
  values (a.id, v_mes, auth.uid())
  returning id into v_id;

  insert into public.settlement_transfers (settlement_id, account_id, from_person_id, to_person_id, amount_cop, position)
  select v_id, a.id, (t ->> 'from')::uuid, (t ->> 'to')::uuid, (t ->> 'amount')::bigint, x.ord::int
  from jsonb_array_elements(v_t) with ordinality as x (t, ord);

  if a.type = 'evento' then
    update public.accounts set status = 'settling' where id = a.id;
  end if;
  return v_id;
end;
$$;


-- Las preguntas a Mister Luks (como en la 390), con las transferencias directas
create or replace function public.connector_question(
  p_jid text,
  p_wa_id text,
  p_phone text default null,
  p_lid text default null,
  p_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.whatsapp_groups%rowtype;
  a public.accounts%rowtype;
  v_ident uuid;
  v_pref text;
  v_contador boolean;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_mes date;
  v_desde date;
  v_hasta date;
  v_person uuid;
  s public.settlements%rowtype;
  v_base jsonb;
begin
  select * into g from public.whatsapp_groups where wa_group_jid = p_jid and chat_kind = 'grupo';
  if g.id is null then
    return jsonb_build_object('ok', false, 'reason', 'sin_grupo');
  end if;
  v_ident := public.wa_identidad(p_wa_id, p_phone, p_lid, p_name);
  select x.mode into v_pref from public.whatsapp_answer_prefs x where x.identity_id = v_ident;
  v_contador := exists (
    select 1 from public.whatsapp_group_sessions s2
    join public.whatsapp_connections c on c.id = s2.connection_id
    where s2.group_id = g.id and s2.left_at is null and c.kind = 'contador'
  );
  v_base := jsonb_build_object('identity_id', v_ident, 'pref', v_pref, 'contador_en_grupo', v_contador);

  select a2.* into a
  from public.account_group_links l join public.accounts a2 on a2.id = l.account_id
  where l.group_id = g.id;
  if a.id is null then
    return v_base || jsonb_build_object('ok', false, 'reason', 'sin_cuenta');
  end if;

  if a.type = 'hogar' then
    v_mes := date_trunc('month', v_hoy)::date;
    v_desde := v_mes;
    v_hasta := (v_mes + interval '1 month')::date;
  else
    v_desde := '0001-01-01';
    v_hasta := '9999-12-31';
  end if;
  select * into s from public.settlements x where x.account_id = a.id and x.period is not distinct from v_mes;
  v_person := coalesce(
    public.wa_person(a.id, p_wa_id),
    case when p_phone is not null then public.wa_person(a.id, p_phone) end,
    case when p_lid is not null then public.wa_person(a.id, 'lid:' || p_lid) end
  );

  return v_base || jsonb_build_object(
    'ok', true,
    'account', jsonb_build_object(
      'name', a.name, 'type', a.type, 'status', a.status, 'currency', a.currency, 'language', a.language, 'month', v_mes
    ),
    'optout', public.no_lo_cuentes(a.id, p_wa_id),
    'total', (
      select coalesce(sum(e.total_cop), 0) from public.expenses e
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
    ),
    'count', (
      select count(*) from public.expenses e
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
    ),
    'pending', (
      select count(*) from public.expenses e
      where e.account_id = a.id and e.status = 'pending_review' and e.expense_date >= v_desde and e.expense_date < v_hasta
    ),
    'incomplete', (
      select count(*) from public.expenses e
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
        and (e.payer_person_id is null
             or e.total_cop <> (select coalesce(sum(x.amount_cop), 0) from public.expense_splits x where x.expense_id = e.id))
    ),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'paid', b.paid, 'share', b.share,
                                          'balance', b.paid - b.share + b.sent - b.received)
                       order by b.paid - b.share + b.sent - b.received desc, p.display_name)
      from public.saldos(a.id, v_mes) b
      join public.people p on p.id = b.person_id
      where b.paid <> 0 or b.share <> 0 or b.sent <> 0 or b.received <> 0
    ), '[]'::jsonb),
    -- Si se liquidara hoy sin cruzar deudas: por pareja, y quién pagó algo de quién
    -- (con eso el connector busca menos transferencias, como la app)
    'direct', a.settle_direct,
    'paid_for', case when a.settle_direct then coalesce((
      select jsonb_agg(distinct jsonb_build_object('from_id', s2.person_id, 'to_id', e.payer_person_id))
      from public.expenses e
      join public.expense_splits s2 on s2.expense_id = e.id
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
        and e.payer_person_id is not null and s2.person_id <> e.payer_person_id and s2.amount_cop > 0
    ), '[]'::jsonb) end,
    'direct_transfers', case when a.settle_direct then coalesce((
      select jsonb_agg(jsonb_build_object(
        'from', pf.display_name, 'to', pt.display_name, 'amount', x.amount_cop, 'from_id', x.from_person_id, 'to_id', x.to_person_id
      ) order by x.amount_cop desc, x.from_person_id, x.to_person_id)
      from public.transferencias_directas(a.id, v_mes) x
      join public.people pf on pf.id = x.from_person_id
      join public.people pt on pt.id = x.to_person_id
    ), '[]'::jsonb) end,
    'settlement', case when s.id is null then null else coalesce((
      select jsonb_agg(jsonb_build_object(
        'from', pf.display_name, 'to', pt.display_name, 'amount', t.amount_cop, 'paid', t.paid_at is not null,
        'from_id', t.from_person_id, 'to_id', t.to_person_id
      ) order by t.position)
      from public.settlement_transfers t
      join public.people pf on pf.id = t.from_person_id
      join public.people pt on pt.id = t.to_person_id
      where t.settlement_id = s.id
    ), '[]'::jsonb) end,
    'me', case when v_person is null then null else (
      select jsonb_build_object(
        'id', p.id,
        'name', p.display_name,
        'expenses', coalesce((
          select jsonb_agg(jsonb_build_object('merchant', x.merchant, 'total', x.total_cop, 'date', x.expense_date) order by x.expense_date desc, x.created_at desc)
          from (
            select e.merchant, e.total_cop, e.expense_date, e.created_at
            from public.expenses e
            where e.account_id = a.id and e.payer_person_id = p.id and e.expense_date >= v_desde and e.expense_date < v_hasta
            order by e.expense_date desc, e.created_at desc
            limit 5
          ) x
        ), '[]'::jsonb),
        'paid_total', (
          select coalesce(sum(e.total_cop), 0) from public.expenses e
          where e.account_id = a.id and e.payer_person_id = p.id and e.expense_date >= v_desde and e.expense_date < v_hasta
        ),
        'paid_count', (
          select count(*) from public.expenses e
          where e.account_id = a.id and e.payer_person_id = p.id and e.expense_date >= v_desde and e.expense_date < v_hasta
        )
      )
      from public.people p where p.id = v_person
    ) end
  );
end;
$$;


revoke execute on function public.transferencias_directas(uuid, date) from public, anon, authenticated;
grant execute on function public.transferencias_directas(uuid, date) to service_role;
revoke execute on function public.set_settle_mode(uuid, boolean) from public, anon;
grant execute on function public.set_settle_mode(uuid, boolean) to authenticated;
