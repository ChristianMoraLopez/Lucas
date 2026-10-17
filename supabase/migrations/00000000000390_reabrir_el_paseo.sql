-- ============================================================================
-- Lucas · 00000000000390_reabrir_el_paseo.sql
-- Un paseo se liquida y el grupo sigue: se reabre la misma cuenta, una y otra
-- vez, en vez de abrir otra («Paseo 2», como hacía la 370).
--
--   · Si a un paseo ya liquidado le llega un gasto nuevo (por el grupo o desde
--     la app), la liquidación se deshace sola y el paseo queda abierto otra
--     vez. Si llegó por el grupo, Mister Luks lo cuenta ahí.
--   · Lo que ya se pagó no se pierde: cada transferencia pagada queda como un
--     pago hecho (settlement_payments) y cuenta en los saldos. Al liquidar de
--     nuevo, las transferencias ya lo descuentan; lo que faltaba por pagar se
--     vuelve a calcular con todo lo nuevo.
--   · Reabrir a mano en Liquidar también se puede aunque haya transferencias
--     pagadas (quedan como pagos hechos).
--   · Un paseo cerrado sigue cerrado: no recibe gastos y su grupo queda libre
--     para conectarlo a otra cuenta (la 370).
-- ============================================================================

-- Lo que ya se pagó de una liquidación que se reabrió
create table public.settlement_payments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  period date check (period is null or extract(day from period) = 1),
  from_person_id uuid not null references public.people (id) deferrable initially deferred,
  to_person_id uuid not null references public.people (id) deferrable initially deferred,
  amount_cop bigint not null check (amount_cop > 0),
  paid_at timestamptz not null,
  paid_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_person_id <> to_person_id)
);

create index settlement_payments_cuenta_idx on public.settlement_payments (account_id, period);

-- Se lee como las transferencias (miembros de la cuenta); se escribe solo al reabrir
alter table public.settlement_payments enable row level security;
alter table public.settlement_payments force row level security;
revoke all on public.settlement_payments from anon, authenticated;
grant select on public.settlement_payments to authenticated;
grant select, insert, update, delete on public.settlement_payments to service_role;

create policy settlement_payments_select on public.settlement_payments
  for select to authenticated using (public.is_account_member(account_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.settlement_payments;
  end if;
end;
$$;

-- Los saldos del período (como period_balances) con lo que cada uno ya pagó o
-- ya recibió: saldo = paid − share + sent − received
create or replace function public.saldos(p_account_id uuid, p_month date)
returns table (person_id uuid, paid bigint, share bigint, expenses int, sent bigint, received bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select b.person_id, b.paid, b.share, b.expenses,
         coalesce((select sum(x.amount_cop) from public.settlement_payments x
                   where x.account_id = p_account_id and x.period is not distinct from p_month and x.from_person_id = b.person_id), 0)::bigint,
         coalesce((select sum(x.amount_cop) from public.settlement_payments x
                   where x.account_id = p_account_id and x.period is not distinct from p_month and x.to_person_id = b.person_id), 0)::bigint
  from public.period_balances(p_account_id, p_month) b
$$;

-- Lo que muestra Liquidar (como en la 150): saldos con lo ya pagado y la lista de pagos hechos
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
        'shares', coalesce((
          select jsonb_agg(jsonb_build_object('person_id', x.person_id, 'amount_cop', x.amount_cop))
          from public.expense_splits x where x.expense_id = e.id
        ), '[]'::jsonb)
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


-- Liquidar (como en la 120), contando lo que ya se pagó
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
  v_con_saldo int;
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

  -- Con n personas con saldo bastan n − 1 transferencias
  select count(*) into v_con_saldo from public.saldos(a.id, v_mes) b where b.paid - b.share + b.sent - b.received <> 0;
  if jsonb_array_length(v_t) > greatest(v_con_saldo - 1, 0) then
    raise exception 'Sobran transferencias: con % personas con saldo bastan %', v_con_saldo, greatest(v_con_saldo - 1, 0);
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


-- Las preguntas a Mister Luks (como en la 350), contando lo que ya se pagó
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


-- ============================================================================
-- Reabrir una liquidación: lo pagado queda como pago hecho, lo demás se borra
-- y el paseo vuelve a recibir gastos
-- ============================================================================

create or replace function public.reabrir_liquidacion(p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.settlements%rowtype;
begin
  select * into s from public.settlements where id = p_settlement_id for update;
  if s.id is null then
    return;
  end if;
  insert into public.settlement_payments (account_id, period, from_person_id, to_person_id, amount_cop, paid_at, paid_by)
  select t.account_id, s.period, t.from_person_id, t.to_person_id, t.amount_cop, t.paid_at, t.paid_by
  from public.settlement_transfers t
  where t.settlement_id = s.id and t.paid_at is not null
  order by t.position;
  delete from public.settlements where id = s.id;
  update public.accounts set status = 'active' where id = s.account_id and status = 'settling';
end;
$$;

-- Como en la 120, pero ya no hace falta desmarcar lo pagado
create or replace function public.reopen_settlement(p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.settlements%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into s from public.settlements where id = p_settlement_id;
  if not found or not public.has_account_role(s.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta pueden reabrir una liquidación';
  end if;
  if exists (select 1 from public.accounts a where a.id = s.account_id and a.status = 'closed') then
    raise exception 'La cuenta está cerrada: la liquidación ya no cambia';
  end if;
  perform public.reabrir_liquidacion(s.id);
end;
$$;

-- Un gasto nuevo en un paseo liquidado lo reabre (antes de que
-- trg_expenses_liquidado lo frene: los triggers van en orden alfabético)
create or replace function public.abrir_paseo_liquidado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  v_liquidacion uuid;
  v_grupo uuid;
  v_jid text;
begin
  select * into a from public.accounts where id = new.account_id;
  if a.id is null or a.type <> 'evento' or a.status <> 'settling' then
    return new;
  end if;
  select s.id into v_liquidacion from public.settlements s where s.account_id = a.id and s.period is null;
  perform public.reabrir_liquidacion(v_liquidacion);
  update public.accounts set status = 'active' where id = a.id and status = 'settling';

  -- Si llegó por el grupo, Mister Luks lo cuenta ahí (es_mensaje_de_luks lo reconoce)
  select m.group_id into v_grupo from public.messages m where m.id = new.message_id;
  select g.wa_group_jid into v_jid from public.whatsapp_groups g where g.id = v_grupo;
  if v_jid is not null then
    perform public.connector_outbox_enqueue(jsonb_build_array(jsonb_build_object(
      'chat_jid', v_jid,
      'reason', 'link',
      'group_id', v_grupo,
      'dedupe_key', 'reabierta:' || coalesce(v_liquidacion, a.id),
      'body', case when a.language = 'en' then
        '🔓 “' || a.name || '” was already settled and a new expense came in, so I reopened it. What you already paid stays logged; when you’re done, settle it again at mrluks.com.'
      else
        '🔓 «' || a.name || '» ya estaba liquidada y llegó un gasto nuevo, así que la reabrí. Lo que ya pagaron queda anotado; cuando terminen, la vuelven a liquidar en mrluks.com.'
      end
    )));
  end if;
  return new;
end;
$$;

create trigger trg_expenses_abre_paseo before insert on public.expenses
  for each row execute function public.abrir_paseo_liquidado();

-- Un paseo liquidado ya no rechaza mensajes: el primer gasto lo reabre
drop trigger trg_messages_liquidando on public.messages;
drop function public.guard_settling_messages();

-- ============================================================================
-- El grupo de un paseo liquidado sigue anotando en el mismo paseo
-- ============================================================================

-- Como en la 370: «cuenta_liquidada» solo si está cerrada (su grupo queda libre)
create or replace function public.connector_should_ingest(p_jid text, p_wa_message_id text, p_sent_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_account uuid;
  v_status text;
  v_desde timestamptz;
begin
  select g.id, l.account_id, a.status, l.ingest_from into v_group, v_account, v_status, v_desde
  from public.whatsapp_groups g
  join public.account_group_links l on l.group_id = g.id
  join public.accounts a on a.id = l.account_id
  where g.wa_group_jid = p_jid;

  if v_account is null then
    return jsonb_build_object('ingest', false, 'reason', 'grupo_sin_enlazar');
  end if;
  -- Un paseo liquidado sigue recibiendo (el primer gasto lo reabre); uno cerrado, no
  if v_status = 'closed' then
    return jsonb_build_object('ingest', false, 'reason', 'cuenta_liquidada', 'account_id', v_account, 'group_id', v_group);
  end if;
  if v_status not in ('active', 'settling') then
    return jsonb_build_object('ingest', false, 'reason', 'cuenta_cerrada', 'account_id', v_account);
  end if;
  if p_sent_at < v_desde - interval '2 minutes' then
    return jsonb_build_object('ingest', false, 'reason', 'antes_del_enlace', 'account_id', v_account);
  end if;
  if exists (select 1 from public.messages m where m.group_id = v_group and m.wa_message_id = p_wa_message_id) then
    return jsonb_build_object('ingest', false, 'reason', 'repetido', 'account_id', v_account);
  end if;
  return jsonb_build_object('ingest', true, 'account_id', v_account, 'group_id', v_group);
end;
$$;


-- Como en la 350: ya no se abre otra cuenta («Paseo 2») sola
create or replace function public.connector_should_ingest_sender(
  p_jid text,
  p_wa_message_id text,
  p_sent_at timestamptz,
  p_sender_wa_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := public.connector_should_ingest(p_jid, p_wa_message_id, p_sent_at);
begin
  if (v ->> 'ingest')::boolean and p_sender_wa_id is not null
     and public.no_lo_cuentes((v ->> 'account_id')::uuid, p_sender_wa_id) then
    return jsonb_build_object('ingest', false, 'reason', 'no_me_cuentes', 'account_id', v ->> 'account_id');
  end if;
  return v;
end;
$$;


drop function public.cuenta_siguiente(uuid, timestamptz);

-- ============================================================================
-- Permisos: lo nuevo es interno
-- ============================================================================

revoke execute on function public.saldos(uuid, date) from public, anon, authenticated;
revoke execute on function public.reabrir_liquidacion(uuid) from public, anon, authenticated;
revoke execute on function public.abrir_paseo_liquidado() from public, anon, authenticated;
grant execute on function public.saldos(uuid, date) to service_role;
