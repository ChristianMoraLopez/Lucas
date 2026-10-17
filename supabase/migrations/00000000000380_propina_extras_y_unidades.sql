-- ============================================================================
-- Lucas · 00000000000380_propina_extras_y_unidades.sql
-- Dividir por consumo, como se paga de verdad:
--
--   · Propina aparte: en Chile (y en muchos sitios) la propina no viene en la
--     cuenta; se deja, por ejemplo, el 5 %. Se anota en porcentaje y suma al
--     total del gasto; se reparte según lo que consumió cada uno.
--   · Ítems extra: lo que no estaba en la factura (otra ronda que se pagó
--     aparte) también suma al total.
--   · Unidades: «3 Coca-Colas», Ana se tomó dos y Juan una. Cada quien marca
--     cuántas; el ítem se reparte en esa proporción.
--
-- El total del gasto queda en lo que se pagó: la factura + los extras + la
-- propina. Lo de la factura sale de restarle al total lo que se le sumó.
-- ============================================================================

alter table public.expenses
  add column tip_percent numeric(5, 2) check (tip_percent is null or (tip_percent >= 0 and tip_percent <= 100)),
  add column tip_cop bigint not null default 0 check (tip_cop >= 0);

comment on column public.expenses.tip_percent is 'Propina que se dejó aparte, en porcentaje (no venía en la factura)';
comment on column public.expenses.tip_cop is 'Esa propina en la moneda de la cuenta; ya está sumada en total_cop';

alter table public.expense_items add column extra boolean not null default false;
comment on column public.expense_items.extra is 'No estaba en la factura: su total ya está sumado en el total del gasto';

alter table public.expense_item_people
  add column units numeric(10, 3) not null default 1 check (units > 0 and units <= 1000);
comment on column public.expense_item_people.units is 'Cuántas unidades del ítem consumió (el ítem se reparte en esa proporción)';

-- ============================================================================
-- split_by_consumption: split_by_items con propina, extras y unidades.
-- p_items  = [{"id", "name", "quantity", "total_cop", "people": [uuid…],
--              "units": {"<person_id>": 2, …}, "extra": true|false}, …]
-- p_shares = como en split_by_items: tienen que sumar el total nuevo
--            (factura + extras + p_tip_cop)
-- p_tip_percent: la propina en porcentaje (null = sin propina aparte)
-- p_tip_cop: esa propina en la moneda de la cuenta (la calcula la app)
-- ============================================================================

create or replace function public.split_by_consumption(
  p_expense_id uuid,
  p_payer_person_id uuid,
  p_items jsonb,
  p_shares jsonb,
  p_tip_percent numeric default null,
  p_tip_cop bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses%rowtype;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_tip bigint := coalesce(p_tip_cop, 0);
  v_factura bigint;
  v_extras bigint;
  v_total bigint;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into e from public.expenses where id = p_expense_id for update;
  if not found or not public.is_account_member(e.account_id) then
    raise exception 'El gasto no existe';
  end if;
  if not public.has_account_role(e.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta dividen los gastos';
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Los ítems no llegaron bien';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_items) x
    where jsonb_typeof(x) <> 'object'
       or (x ? 'extra' and jsonb_typeof(x -> 'extra') not in ('boolean', 'null'))
       or (x ? 'units' and jsonb_typeof(x -> 'units') not in ('object', 'null'))
  ) then
    raise exception 'Los ítems no llegaron bien';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_items) x
    cross join lateral jsonb_each_text(case when jsonb_typeof(x -> 'units') = 'object' then x -> 'units' else '{}'::jsonb end) u (person_id, n)
    where u.n !~ '^[0-9]{1,4}([.][0-9]{1,3})?$' or u.n::numeric <= 0 or u.n::numeric > 1000
  ) then
    raise exception 'Las unidades de cada uno tienen que ser mayores que cero';
  end if;
  if p_tip_percent is not null and (p_tip_percent < 0 or p_tip_percent > 100) then
    raise exception 'La propina va de 0 %% a 100 %%';
  end if;
  if v_tip < 0 then
    raise exception 'La propina no puede ser negativa';
  end if;

  -- Lo de la factura: el total sin lo que ya se le había sumado
  v_factura := e.total_cop - e.tip_cop
    - coalesce((select sum(i.total_cop) from public.expense_items i where i.expense_id = e.id and i.extra), 0);
  if v_factura <= 0 then
    raise exception 'Primero escribe el total del gasto';
  end if;
  select coalesce(sum((x ->> 'total_cop')::bigint), 0) into v_extras
  from jsonb_array_elements(v_items) x
  where coalesce((x ->> 'extra')::boolean, false) and coalesce(x ->> 'total_cop', '') ~ '^[0-9]{1,12}$';
  if v_tip > v_factura + v_extras then
    raise exception 'La propina no puede ser más que la cuenta';
  end if;
  v_total := v_factura + v_extras + v_tip;

  -- El total pasa a ser lo que se pagó (y el del recibo original, en la misma proporción)
  if v_total <> e.total_cop then
    update public.expenses x
    set total_cop = v_total,
        original_total = case when x.original_total is not null then greatest(1, round(x.original_total::numeric * v_total / e.total_cop))::bigint end
    where x.id = e.id;
  end if;

  perform public.split_by_items(p_expense_id, p_payer_person_id, v_items, p_shares);

  -- Extras y unidades: los ítems quedaron en el orden en que llegaron
  with llegaron as (
    select x, n from jsonb_array_elements(v_items) with ordinality as t (x, n)
  ),
  guardados as (
    select i.id, row_number() over (order by i.created_at, i.id) as n
    from public.expense_items i
    where i.expense_id = e.id
  )
  update public.expense_items i
  set extra = coalesce((l.x ->> 'extra')::boolean, false)
  from llegaron l
  join guardados g on g.n = l.n
  where i.id = g.id and i.extra is distinct from coalesce((l.x ->> 'extra')::boolean, false);

  with llegaron as (
    select x, n from jsonb_array_elements(v_items) with ordinality as t (x, n)
  ),
  guardados as (
    select i.id, row_number() over (order by i.created_at, i.id) as n
    from public.expense_items i
    where i.expense_id = e.id
  )
  update public.expense_item_people ip
  set units = u.n::numeric
  from llegaron l
  join guardados g on g.n = l.n
  cross join lateral jsonb_each_text(case when jsonb_typeof(l.x -> 'units') = 'object' then l.x -> 'units' else '{}'::jsonb end) u (person_id, n)
  where ip.item_id = g.id and ip.person_id = public.try_uuid(u.person_id);

  update public.expenses x
  set tip_percent = case when v_tip > 0 or p_tip_percent > 0 then p_tip_percent end,
      tip_cop = v_tip
  where x.id = e.id;

  return jsonb_build_object('total_cop', v_total, 'tip_cop', v_tip, 'extras_cop', v_extras);
end;
$$;

revoke execute on function public.split_by_consumption(uuid, uuid, jsonb, jsonb, numeric, bigint) from public, anon;
grant execute on function public.split_by_consumption(uuid, uuid, jsonb, jsonb, numeric, bigint) to authenticated;
