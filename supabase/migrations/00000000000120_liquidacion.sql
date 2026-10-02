-- ============================================================================
-- Lucas · 00000000000120_liquidacion.sql
-- Liquidar: cuánto puso cada uno, cuánto le tocaba y quién le paga a quién
-- para quedar a mano, con el mínimo de transferencias.
--
--   · Evento: se liquida todo el paseo. Mientras se liquida (status
--     'settling') no entran gastos nuevos; cuando todas las transferencias
--     están pagadas, se cierra.
--   · Hogar: se liquida mes a mes; la cuenta sigue abierta.
--
-- La app calcula las transferencias (lib/settlement.ts: el mínimo exacto) y
-- aquí se verifica que dejen a todos en cero. Lo liquidado queda congelado:
-- los montos, quién pagó, la fecha y la división de esos gastos no cambian
-- hasta reabrir (el comercio y la categoría sí se pueden corregir).
-- ============================================================================

alter table public.accounts drop constraint accounts_status_check;
alter table public.accounts add constraint accounts_status_check check (status in ('active', 'settling', 'closed'));

-- Una liquidación por paseo (period null) o por mes del hogar (period = día 1)
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  period date check (period is null or extract(day from period) = 1),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (account_id, period)
);

create table public.settlement_transfers (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  from_person_id uuid not null references public.people (id) deferrable initially deferred,
  to_person_id uuid not null references public.people (id) deferrable initially deferred,
  amount_cop bigint not null check (amount_cop > 0),
  position int not null,
  paid_at timestamptz,
  paid_by uuid references public.profiles (id) on delete set null,
  check (from_person_id <> to_person_id)
);

create index settlement_transfers_liquidacion_idx on public.settlement_transfers (settlement_id, position);
create index settlement_transfers_cuenta_idx on public.settlement_transfers (account_id);

alter table public.settlements enable row level security;
alter table public.settlements force row level security;
alter table public.settlement_transfers enable row level security;
alter table public.settlement_transfers force row level security;
revoke all on public.settlements, public.settlement_transfers from anon, authenticated;
grant select on public.settlements, public.settlement_transfers to authenticated;
grant select, insert, update, delete on public.settlements, public.settlement_transfers to service_role;

create policy settlements_select on public.settlements
  for select to authenticated using (public.is_account_member(account_id));
create policy settlement_transfers_select on public.settlement_transfers
  for select to authenticated using (public.is_account_member(account_id));

-- ============================================================================
-- Saldos de un periodo: lo que cada quien pagó y lo que le tocaba.
-- Cuentan los gastos con quién pagó y con la división completa (suma igual
-- al total); así lo pagado y lo que le tocaba suman lo mismo y los saldos
-- dan cero. p_month null = todo (un paseo).
-- ============================================================================

create or replace function public.period_balances(p_account_id uuid, p_month date)
returns table (person_id uuid, paid bigint, share bigint, expenses int)
language sql
stable
security definer
set search_path = ''
as $$
  with e as (
    select x.id, x.total_cop, x.payer_person_id
    from public.expenses x
    where x.account_id = p_account_id
      and x.payer_person_id is not null
      and (p_month is null or (x.expense_date >= p_month and x.expense_date < (p_month + interval '1 month')::date))
      and x.total_cop = (select coalesce(sum(s.amount_cop), 0) from public.expense_splits s where s.expense_id = x.id)
  )
  select p.id,
         coalesce((select sum(e.total_cop) from e where e.payer_person_id = p.id), 0)::bigint,
         coalesce((select sum(s.amount_cop) from public.expense_splits s join e on e.id = s.expense_id where s.person_id = p.id), 0)::bigint,
         (select count(*) from e where e.payer_person_id = p.id)::int
  from public.people p
  where p.account_id = p_account_id
$$;

-- ¿Ese día de la cuenta ya está liquidado? (el mes en el hogar, todo en un paseo)
create or replace function public.is_settled(p_account_id uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.settlements s
    join public.accounts a on a.id = s.account_id
    where s.account_id = p_account_id
      and (s.period is null or (a.type = 'hogar' and s.period = date_trunc('month', p_day)::date))
  )
$$;

-- ============================================================================
-- Lo liquidado no cambia: monto, quién pagó, fecha y división de esos gastos.
-- Un trigger (no solo las RPC) para que aplique igual al worker y a la web.
-- Si la cuenta ya no existe (se está borrando en cascada), no estorba.
-- ============================================================================

create or replace function public.guard_settled_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_fechas date[];
  v_expense uuid;
  v_paseo boolean;
begin
  if tg_table_name = 'expense_splits' then
    v_expense := case when tg_op = 'DELETE' then old.expense_id else new.expense_id end;
    select e.account_id, array[e.expense_date] into v_account, v_fechas from public.expenses e where e.id = v_expense;
    if v_account is null then
      return case when tg_op = 'DELETE' then old else new end; -- el gasto se está borrando
    end if;
  elsif tg_op = 'INSERT' then
    v_account := new.account_id;
    v_fechas := array[new.expense_date];
  elsif tg_op = 'DELETE' then
    v_account := old.account_id;
    v_fechas := array[old.expense_date];
  else
    -- Corregir el comercio o la categoría (o que se borre el usuario que lo creó) no cambia la plata
    if new.account_id = old.account_id
       and new.total_cop is not distinct from old.total_cop
       and new.payer_person_id is not distinct from old.payer_person_id
       and new.expense_date is not distinct from old.expense_date then
      return new;
    end if;
    v_account := old.account_id;
    v_fechas := array[old.expense_date, new.expense_date];
  end if;

  if exists (select 1 from public.accounts a where a.id = v_account)
     and exists (select 1 from unnest(v_fechas) f where public.is_settled(v_account, f)) then
    select a.type = 'evento' into v_paseo from public.accounts a where a.id = v_account;
    if v_paseo then
      raise exception 'El paseo ya se liquidó: sus gastos quedaron congelados. Para cambiar algo, reábranlo en Liquidar';
    end if;
    raise exception 'Ese mes ya se liquidó: sus gastos quedaron congelados. Para cambiar algo, reábranlo en Liquidar';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger trg_expenses_liquidado before insert or update or delete on public.expenses
  for each row execute function public.guard_settled_period();
create trigger trg_expense_splits_liquidado before insert or update or delete on public.expense_splits
  for each row execute function public.guard_settled_period();

-- Un paseo que se liquida no recibe gastos nuevos (la web lo dice al subir;
-- el connector ya no lee los grupos de cuentas que no están activas)
create or replace function public.guard_settling_messages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.accounts a where a.id = new.account_id and a.status = 'settling') then
    raise exception 'El paseo se está liquidando: ya no recibe gastos. Para agregar uno, reábranlo en Liquidar';
  end if;
  return new;
end;
$$;

create trigger trg_messages_liquidando before insert on public.messages
  for each row execute function public.guard_settling_messages();

-- ============================================================================
-- settlement_overview: todo lo que muestra la pantalla Liquidar
-- ============================================================================

create or replace function public.settlement_overview(p_account_id uuid, p_month date default null)
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
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  select * into a from public.accounts where id = p_account_id;

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
    'is_admin', public.has_account_role(a.id, array['owner', 'admin']::public.member_role[]),
    'my_person_id', (select p.id from public.people p where p.account_id = a.id and p.claimed_by = auth.uid()),
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
        'paid', b.paid, 'share', b.share, 'balance', b.paid - b.share, 'expenses', b.expenses
      ) order by b.paid - b.share desc, p.display_name)
      from public.period_balances(a.id, v_mes) b
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
    'settled_months', case when a.type = 'hogar' then coalesce((
      select jsonb_agg(x.period order by x.period desc) from public.settlements x where x.account_id = a.id
    ), '[]'::jsonb) end
  );
end;
$$;

-- ============================================================================
-- start_settlement: liquidar el paseo o un mes del hogar. Exige que no quede
-- nada por revisar, verifica que las transferencias dejen a todos en cero y
-- congela lo liquidado.
-- p_transfers = [{"from": person_id, "to": person_id, "amount": pesos}, …]
-- ============================================================================

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
  select count(*) into v_con_saldo from public.period_balances(a.id, v_mes) b where b.paid <> b.share;
  if jsonb_array_length(v_t) > greatest(v_con_saldo - 1, 0) then
    raise exception 'Sobran transferencias: con % personas con saldo bastan %', v_con_saldo, greatest(v_con_saldo - 1, 0);
  end if;

  -- Lo que pagó − lo que le tocaba + lo que transfiere − lo que recibe = 0 para todos
  if exists (
    select 1 from public.period_balances(a.id, v_mes) b
    where b.paid - b.share
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

-- ============================================================================
-- mark_transfer: marcar (o desmarcar) una transferencia como pagada. Pueden
-- quienes administran, quien paga y quien recibe.
-- ============================================================================

create or replace function public.mark_transfer(p_transfer_id uuid, p_paid boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  t public.settlement_transfers%rowtype;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into t from public.settlement_transfers where id = p_transfer_id for update;
  if not found or not public.is_account_member(t.account_id) then
    raise exception 'La transferencia no existe';
  end if;
  if exists (select 1 from public.accounts a where a.id = t.account_id and a.status = 'closed') then
    raise exception 'La cuenta está cerrada: la liquidación ya no cambia';
  end if;
  if not (
    public.has_account_role(t.account_id, array['owner', 'admin']::public.member_role[])
    or exists (select 1 from public.people p where p.id in (t.from_person_id, t.to_person_id) and p.claimed_by = v_uid)
  ) then
    raise exception 'Solo quien paga, quien recibe o quienes administran la marcan';
  end if;

  update public.settlement_transfers
  set paid_at = case when p_paid then coalesce(paid_at, now()) end,
      paid_by = case when p_paid then coalesce(paid_by, v_uid) end
  where id = t.id;
end;
$$;

-- ============================================================================
-- reopen_settlement: deshacer una liquidación (faltaba un gasto, hubo un
-- error). Solo si no se ha pagado nada; el paseo vuelve a recibir gastos.
-- ============================================================================

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
  if exists (select 1 from public.settlement_transfers t where t.settlement_id = s.id and t.paid_at is not null) then
    raise exception 'Ya hay transferencias pagadas: desmárquenlas antes de reabrir';
  end if;

  delete from public.settlements where id = s.id;
  update public.accounts set status = 'active' where id = s.account_id and status = 'settling';
end;
$$;

-- ============================================================================
-- close_account: un paseo con gastos se cierra cuando ya se liquidó y todo
-- está pagado; un hogar (o un paseo sin gastos) se cierra cuando quieran.
-- ============================================================================

create or replace function public.close_account(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  v_faltan int;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'No tienes permisos de administrador en esta cuenta';
  end if;
  select * into a from public.accounts where id = p_account_id for update;
  if not found or a.status = 'closed' then
    raise exception 'La cuenta no existe o ya está cerrada';
  end if;

  if a.type = 'evento' and exists (select 1 from public.expenses e where e.account_id = a.id) then
    if a.status <> 'settling' then
      raise exception 'Primero liquiden el paseo';
    end if;
    select count(*) into v_faltan from public.settlement_transfers t where t.account_id = a.id and t.paid_at is null;
    if v_faltan > 0 then
      raise exception 'Faltan % por pagar', case when v_faltan = 1 then '1 transferencia' else v_faltan || ' transferencias' end;
    end if;
  end if;

  update public.accounts set status = 'closed', closed_at = now() where id = a.id;
  -- Una cuenta cerrada no recibe a nadie más
  update public.invitations inv set revoked_at = now() where inv.account_id = a.id and inv.revoked_at is null;
end;
$$;

-- ============================================================================
-- Tiempo real (otra persona marca una transferencia) y permisos
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.settlements, public.settlement_transfers;
  end if;
end;
$$;

revoke execute on function public.period_balances(uuid, date) from public, anon, authenticated;
revoke execute on function public.is_settled(uuid, date) from public, anon, authenticated;
revoke execute on function public.guard_settled_period() from public, anon, authenticated;
revoke execute on function public.guard_settling_messages() from public, anon, authenticated;
grant execute on function public.period_balances(uuid, date) to service_role;
grant execute on function public.is_settled(uuid, date) to service_role;

revoke execute on function public.settlement_overview(uuid, date) from public, anon;
revoke execute on function public.start_settlement(uuid, date, jsonb) from public, anon;
revoke execute on function public.mark_transfer(uuid, boolean) from public, anon;
revoke execute on function public.reopen_settlement(uuid) from public, anon;
revoke execute on function public.close_account(uuid) from public, anon;
grant execute on function public.settlement_overview(uuid, date) to authenticated;
grant execute on function public.start_settlement(uuid, date, jsonb) to authenticated;
grant execute on function public.mark_transfer(uuid, boolean) to authenticated;
grant execute on function public.reopen_settlement(uuid) to authenticated;
grant execute on function public.close_account(uuid) to authenticated;
