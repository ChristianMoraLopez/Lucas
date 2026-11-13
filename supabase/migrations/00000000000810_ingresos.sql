-- ============================================================================
-- Lucas · 00000000000810_ingresos.sql
-- Lo que entra, no solo lo que sale: el sueldo, una prima, un pago que les
-- hicieron. Se anota en la app (pestaña Presupuesto) o en el grupo de
-- WhatsApp: «hoy entraron 200 lucas», «me pagaron la quincena 1.600.000»,
-- «gané 3 palos». Con lo que entra y lo que sale, Presupuesto calcula el saldo
-- y hasta cuándo les alcanza.
--
--   · Un ingreso es de la cuenta y, si se sabe, de la persona que lo recibió.
--   · Lo ven todos los de la cuenta; lo anota cualquiera de la cuenta; lo
--     borra quien lo anotó o quien administra.
--   · Desde WhatsApp entra por connector_registrar_ingreso, que reconoce a
--     quien escribe por su número o su LID (personas_de_wa, migración 420) y
--     no lo anota dos veces si el mensaje llega repetido.
-- ============================================================================

create table public.incomes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  person_id uuid references public.people (id) on delete set null deferrable initially deferred,
  amount_cop bigint not null check (amount_cop > 0),
  income_date date not null default current_date,
  description text check (char_length(description) <= 120),
  source text not null default 'web' check (source in ('whatsapp', 'web')),
  wa_message_id text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

comment on table public.incomes is 'Lo que entra al hogar (sueldo, primas, pagos recibidos); la contraparte de expenses';
comment on column public.incomes.amount_cop is 'En la unidad chica de la moneda de la cuenta, como expenses.total_cop';
comment on column public.incomes.wa_message_id is 'El id del mensaje de WhatsApp que lo anotó (para no anotarlo dos veces)';

create index incomes_cuenta_fecha_idx on public.incomes (account_id, income_date desc);
create unique index incomes_mensaje_unico on public.incomes (account_id, wa_message_id) where wa_message_id is not null;

grant select, insert, delete on public.incomes to authenticated;
grant select, insert, update, delete on public.incomes to service_role;

alter table public.incomes enable row level security;
alter table public.incomes force row level security;

create policy incomes_select on public.incomes
  for select to authenticated
  using (public.is_account_member(account_id));

create policy incomes_insert on public.incomes
  for insert to authenticated
  with check (public.is_account_member(account_id) and created_by = (select auth.uid()) and source = 'web');

create policy incomes_delete on public.incomes
  for delete to authenticated
  using (
    created_by = (select auth.uid())
    or public.has_account_role(account_id, array['owner', 'admin']::public.member_role[])
  );

-- ============================================================================
-- connector_registrar_ingreso: «hoy entraron 200 lucas» en el grupo
-- ============================================================================
create or replace function public.connector_registrar_ingreso(
  p_jid text,
  p_wa_message_id text,
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_amount numeric,
  p_description text default null,
  p_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  v_person uuid;
  v_id uuid;
  v_nuevo boolean := true;
  v_desde date;
  v_monto bigint;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'monto');
  end if;

  -- La cuenta del grupo
  select a2.* into a
  from public.whatsapp_groups g
  join public.account_group_links l on l.group_id = g.id
  join public.accounts a2 on a2.id = l.account_id
  where g.wa_group_jid = p_jid and g.chat_kind = 'grupo';
  if a.id is null then
    return jsonb_build_object('ok', false, 'reason', 'sin_cuenta');
  end if;
  if a.status = 'closed' then
    return jsonb_build_object('ok', false, 'reason', 'cerrada');
  end if;
  -- El connector manda la unidad grande («200 lucas» = 200000, «$85» = 85): se guarda en la chica
  v_monto := round(p_amount * case when a.currency in ('USD', 'BOB') then 100 else 1 end);

  -- Quién lo recibió, si se sabe (en esa cuenta)
  select y.person_id into v_person
  from public.personas_de_wa(p_jid, p_wa_id, p_phone, p_lid) y
  where y.account_id = a.id
  limit 1;

  insert into public.incomes (account_id, person_id, amount_cop, income_date, description, source, wa_message_id)
  values (a.id, v_person, v_monto, coalesce(p_date, (now() at time zone 'America/Bogota')::date),
          nullif(left(trim(coalesce(p_description, '')), 120), ''), 'whatsapp', p_wa_message_id)
  on conflict (account_id, wa_message_id) where wa_message_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    v_nuevo := false;
    select i.id into v_id from public.incomes i where i.account_id = a.id and i.wa_message_id = p_wa_message_id;
  end if;

  v_desde := date_trunc('month', (now() at time zone 'America/Bogota'))::date;
  return jsonb_build_object(
    'ok', true,
    'nuevo', v_nuevo,
    'id', v_id,
    'monto', (select i.amount_cop from public.incomes i where i.id = v_id),
    'account', jsonb_build_object('id', a.id, 'name', a.name, 'language', a.language, 'currency', a.currency),
    -- Lo que ha entrado y salido este mes, para la respuesta
    'entro_mes', (select coalesce(sum(i.amount_cop), 0) from public.incomes i where i.account_id = a.id and i.income_date >= v_desde),
    'salio_mes', (select coalesce(sum(e.total_cop), 0) from public.expenses e where e.account_id = a.id and e.expense_date >= v_desde)
  );
end;
$$;

revoke execute on function public.connector_registrar_ingreso(text, text, text, text, text, numeric, text, date) from public, anon, authenticated;
grant execute on function public.connector_registrar_ingreso(text, text, text, text, text, numeric, text, date) to service_role;
