-- ============================================================================
-- Dividir un gasto por consumo: quién pidió qué de la factura.
--
-- Una persona paga la cuenta del restaurante y la divide: dos pidieron
-- hamburguesa, otros solo algo de tomar y alguien pone más de lo suyo. Los
-- ítems (los que leyó Luks de la foto o los que se escriben a mano) dicen
-- quién los consumió; lo que no está en los ítems (propina, servicio) se
-- reparte en proporción a lo que consumió cada uno; quien fija un monto lo
-- pone, y el resto se reparte entre los demás.
--
-- La web calcula los montos (apps/web/lib/consumo.ts) y aquí se validan y se
-- guardan: la parte de cada uno queda en expense_splits (sin ítem), como en
-- cualquier división, así los saldos y la liquidación no cambian.
-- ============================================================================

-- Quién consumió cada ítem (sin nadie = entre todos los del gasto)
create table public.expense_item_people (
  item_id uuid not null references public.expense_items (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  primary key (item_id, person_id)
);

create index expense_item_people_persona_idx on public.expense_item_people (person_id);

-- Se lee como los ítems (miembros de la cuenta); se escribe solo con split_by_items
alter table public.expense_item_people enable row level security;
alter table public.expense_item_people force row level security;
revoke all on public.expense_item_people from anon, authenticated;
grant select on public.expense_item_people to authenticated;
grant select, insert, update, delete on public.expense_item_people to service_role;

create policy expense_item_people_select on public.expense_item_people
  for select to authenticated
  using (exists (select 1 from public.expense_items i where i.id = item_id and public.is_expense_member(i.expense_id)));

-- La parte que alguien fijó a mano («Juan pone $150.000»): al volver a
-- dividir se respeta y el resto se reparte entre los demás
alter table public.expense_splits add column fixed boolean not null default false;

-- «$590.000»
create or replace function public.format_cop(p_value bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select '$' || replace(to_char(p_value, 'FM999,999,999,999,990'), ',', '.')
$$;

-- ============================================================================
-- split_by_items: guarda la división por consumo de un gasto.
-- p_items  = [{"id": uuid|null, "name": "Hamburguesa", "quantity": 2, "total_cop": 64000, "people": [uuid, …]}, …]
-- p_shares = [{"person_id": uuid, "amount_cop": 150000, "fixed": true}, …]  (suman el total del gasto)
-- p_payer_person_id: quién pagó la cuenta (null = el que ya tiene)
-- ============================================================================

create or replace function public.split_by_items(
  p_expense_id uuid,
  p_payer_person_id uuid,
  p_items jsonb,
  p_shares jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses%rowtype;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_suma bigint;
  v_viejos uuid[];
  v_item uuid;
  v_cantidad numeric;
  v_ahora timestamptz := now();
  it jsonb;
  k bigint;
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
  if exists (select 1 from public.accounts a where a.id = e.account_id and a.status = 'closed') then
    raise exception 'La cuenta está cerrada: ya no cambia';
  end if;
  if e.total_cop <= 0 then
    raise exception 'Primero escribe el total del gasto';
  end if;
  if p_payer_person_id is not null
     and not exists (select 1 from public.people p where p.id = p_payer_person_id and p.account_id = e.account_id) then
    raise exception 'Quien pagó no es de esta cuenta';
  end if;

  -- Los ítems
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Los ítems no llegaron bien';
  end if;
  if jsonb_array_length(v_items) > 200 then
    raise exception 'Son demasiados ítems (máximo 200)';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_items) x
    where jsonb_typeof(x) <> 'object'
       or nullif(btrim(x ->> 'name'), '') is null
       or coalesce(x ->> 'total_cop', '') !~ '^[0-9]{1,12}$'
       or (x ? 'quantity' and jsonb_typeof(x -> 'quantity') <> 'null' and coalesce(x ->> 'quantity', '') !~ '^[0-9]{1,6}([.][0-9]{1,3})?$')
       or (x ? 'people' and jsonb_typeof(x -> 'people') <> 'array')
  ) then
    raise exception 'Cada ítem necesita nombre y precio';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_items) x
    cross join lateral jsonb_array_elements_text(coalesce(x -> 'people', '[]'::jsonb)) q (id)
    where not exists (select 1 from public.people p where p.id = public.try_uuid(q.id) and p.account_id = e.account_id)
  ) then
    raise exception 'Alguien de los ítems no es de esta cuenta';
  end if;

  -- La parte de cada uno: personas de la cuenta, sin repetir, y que sumen el total
  if jsonb_typeof(coalesce(p_shares, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'Falta la parte de cada uno';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_shares) x
    where jsonb_typeof(x) <> 'object' or coalesce(x ->> 'amount_cop', '') !~ '^[0-9]{1,12}$'
  ) then
    raise exception 'Cada parte tiene que ser un monto en pesos';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_shares) x
    where not exists (select 1 from public.people p where p.id = public.try_uuid(x ->> 'person_id') and p.account_id = e.account_id)
  ) then
    raise exception 'Alguien de la división no es de esta cuenta';
  end if;
  if (select count(*) <> count(distinct x ->> 'person_id') from jsonb_array_elements(p_shares) x) then
    raise exception 'Alguien está dos veces en la división';
  end if;
  select coalesce(sum((x ->> 'amount_cop')::bigint), 0) into v_suma from jsonb_array_elements(p_shares) x;
  if v_suma <> e.total_cop then
    raise exception 'Las partes suman % y el gasto es de %: tienen que dar lo mismo', public.format_cop(v_suma), public.format_cop(e.total_cop);
  end if;

  if p_payer_person_id is not null and p_payer_person_id is distinct from e.payer_person_id then
    update public.expenses x set payer_person_id = p_payer_person_id where x.id = e.id;
  end if;

  -- Los ítems se reemplazan por los que llegan (conservan su id si ya eran de este gasto)
  select coalesce(array_agg(i.id), '{}') into v_viejos from public.expense_items i where i.expense_id = e.id;
  delete from public.expense_splits s where s.expense_id = e.id;
  delete from public.expense_items i where i.expense_id = e.id;

  for it, k in select x, n from jsonb_array_elements(v_items) with ordinality as t (x, n) loop
    v_item := public.try_uuid(it ->> 'id');
    if v_item is null or not (v_item = any (v_viejos)) then
      v_item := gen_random_uuid();
    end if;
    v_cantidad := coalesce(nullif(it ->> 'quantity', '')::numeric, 1);
    if v_cantidad <= 0 then
      v_cantidad := 1;
    end if;
    -- created_at en el orden en que llegan: así se muestran
    insert into public.expense_items (id, expense_id, name, quantity, unit_price_cop, total_cop, created_at)
    values (v_item, e.id, left(btrim(it ->> 'name'), 80), v_cantidad, round((it ->> 'total_cop')::bigint / v_cantidad)::bigint,
            (it ->> 'total_cop')::bigint, v_ahora + k * interval '1 millisecond');
    insert into public.expense_item_people (item_id, person_id)
    select distinct v_item, public.try_uuid(q.id)
    from jsonb_array_elements_text(coalesce(it -> 'people', '[]'::jsonb)) q (id);
  end loop;

  insert into public.expense_splits (expense_id, person_id, amount_cop, fixed)
  select e.id, public.try_uuid(x ->> 'person_id'), (x ->> 'amount_cop')::bigint, coalesce(x ->> 'fixed', 'false') = 'true'
  from jsonb_array_elements(p_shares) x
  where (x ->> 'amount_cop')::bigint > 0;

  update public.expenses x set split_method = 'items' where x.id = e.id;
end;
$$;

-- ============================================================================
-- review_expense: con p_split_person_ids null se queda la división que ya
-- tiene (por consumo), siempre que siga sumando el total.
-- ============================================================================

create or replace function public.review_expense(
  p_expense_id uuid,
  p_merchant text,
  p_expense_date date,
  p_total_cop bigint,
  p_category_id uuid,
  p_payer_person_id uuid,
  p_split_person_ids uuid[],
  p_confirm boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  e public.expenses%rowtype;
  v_changed boolean;
  v_raw text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;

  select * into e from public.expenses where id = p_expense_id for update;
  if not found or not public.is_account_member(e.account_id) then
    raise exception 'El gasto no existe';
  end if;
  if not public.has_account_role(e.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta confirman gastos';
  end if;
  if nullif(btrim(p_merchant), '') is null then
    raise exception 'Escribe el comercio';
  end if;
  if p_total_cop is null or p_total_cop <= 0 then
    raise exception 'El total tiene que ser mayor que cero';
  end if;
  if p_expense_date is null or p_expense_date > (now() at time zone 'America/Bogota')::date + 1 then
    raise exception 'Revisa la fecha: no puede ser en el futuro';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories c where c.id = p_category_id and c.account_id = e.account_id
  ) then
    raise exception 'Esa categoría no es de esta cuenta';
  end if;
  if p_payer_person_id is null or not exists (
    select 1 from public.people p where p.id = p_payer_person_id and p.account_id = e.account_id
  ) then
    raise exception 'Elige quién pagó';
  end if;
  if exists (
    select 1 from unnest(p_split_person_ids) x (id)
    where not exists (select 1 from public.people p where p.id = x.id and p.account_id = e.account_id)
  ) then
    raise exception 'Alguien de la división no es de esta cuenta';
  end if;
  -- Se queda la división por consumo: tiene que seguir sumando el total
  if p_split_person_ids is null
     and p_total_cop <> coalesce((select sum(s.amount_cop) from public.expense_splits s where s.expense_id = e.id), 0) then
    raise exception 'El total cambió: vuelve a dividir el gasto por consumo o divídelo igual entre todos';
  end if;

  v_changed := btrim(p_merchant) is distinct from e.merchant
    or p_expense_date is distinct from e.expense_date
    or p_total_cop is distinct from e.total_cop
    or p_category_id is distinct from e.category_id
    or p_payer_person_id is distinct from e.payer_person_id;

  update public.expenses x
  set merchant = btrim(p_merchant),
      merchant_normalized = public.normalize_merchant(p_merchant),
      expense_date = p_expense_date,
      total_cop = p_total_cop,
      category_id = p_category_id,
      payer_person_id = p_payer_person_id,
      status = case when p_confirm then 'confirmed'::public.expense_status else x.status end,
      corrected_by = case when v_changed then v_uid else x.corrected_by end,
      corrected_at = case when v_changed then now() else x.corrected_at end
  where x.id = e.id;

  if p_split_person_ids is not null then
    perform public.replace_equal_split(e.id, p_split_person_ids);
  end if;

  -- Memoria de comercios: la próxima vez este comercio cae solo en su categoría
  if p_category_id is not null and p_confirm then
    insert into public.merchant_memory (account_id, merchant_text, normalized, category_id, hits)
    values (e.account_id, btrim(p_merchant), public.normalize_merchant(p_merchant), p_category_id, 1)
    on conflict (account_id, normalized) do update
      set category_id = excluded.category_id,
          merchant_text = excluded.merchant_text,
          hits = public.merchant_memory.hits + 1;
  end if;

  -- Ejemplo de entrenamiento cuando la persona cambia la categoría de la IA
  if p_category_id is not null and p_category_id is distinct from e.category_id then
    select m.text_body into v_raw from public.messages m where m.id = e.message_id;
    insert into public.training_examples (account_id, expense_id, merchant_text, raw_text, category_id, source, created_by)
    values (e.account_id, e.id, btrim(p_merchant), coalesce(v_raw, e.description), p_category_id, 'correction', v_uid);
  end if;
end;
$$;

-- ============================================================================
-- Permisos
-- ============================================================================

revoke execute on function public.split_by_items(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.split_by_items(uuid, uuid, jsonb, jsonb) to authenticated;
