-- ============================================================================
-- Lucas · 00000000000360_recibos_en_otra_moneda.sql
-- Recibos de viaje: una boleta de Chile en una cuenta en pesos colombianos.
--
--   · El gasto sigue en la moneda de la cuenta (total_cop, los ítems y las
--     partes de cada uno): el resumen, la división y la liquidación no cambian.
--     Del recibo original quedan la moneda, el monto (en su unidad chica:
--     pesos o centavos), la tasa (cuánto vale una unidad del recibo en la
--     moneda de la cuenta), el día de la tasa y de dónde salió.
--   · worker_save_expense (como en la 240) guarda eso cuando el worker detectó
--     otra moneda y convirtió con la tasa del día del recibo.
--   · set_expense_currency: quien administra dice en qué moneda está un recibo
--     (o que era de la cuenta) y cuánto queda en la moneda de la cuenta. El
--     total, los ítems y las partes de cada uno cambian juntos, en la misma
--     proporción: la división por consumo sigue cuadrando.
-- ============================================================================

alter table public.expenses
  add column original_currency text check (original_currency in ('COP', 'CLP', 'BOB', 'USD', 'EUR', 'PEN', 'MXN', 'ARS', 'BRL')),
  add column original_total bigint check (original_total > 0 and original_total < 1000000000000),
  add column fx_rate numeric check (fx_rate > 0 and fx_rate < 100000000),
  add column fx_date date,
  add column fx_source text check (length(fx_source) <= 40),
  add constraint expenses_moneda_original check (original_currency is not null or (original_total is null and fx_rate is null));

-- Como en la 240, con el recibo original si el worker convirtió
create or replace function public.worker_save_expense(
  p_message_id uuid,
  p_data jsonb,
  p_max_distance int default 12
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  v_dup uuid;
  v_parecido uuid;
  v_expense uuid;
  v_category uuid := public.try_uuid(p_data ->> 'category_id');
  v_payer uuid := public.try_uuid(p_data ->> 'payer_person_id');
  v_total bigint := greatest(coalesce((p_data ->> 'total_cop')::bigint, 0), 0);
  v_date date := coalesce((p_data ->> 'expense_date')::date, (now() at time zone 'America/Bogota')::date);
  v_merchant text := left(coalesce(nullif(btrim(p_data ->> 'merchant'), ''), 'Gasto sin nombre'), 80);
  v_status public.expense_status := case
    when p_data ->> 'status' = 'confirmed' then 'confirmed' else 'pending_review'
  end::public.expense_status;
  v_snapshot jsonb := coalesce(p_data -> 'ai_snapshot', '{}'::jsonb);
  v_people uuid[];
  -- El recibo original (otra moneda): lo que no cuadre se ignora, el gasto igual se guarda
  v_moneda text := upper(nullif(btrim(p_data ->> 'original_currency'), ''));
  v_original bigint;
  v_tasa numeric;
  v_dia_tasa date;
begin
  select * into m from public.messages where id = p_message_id for update;
  if not found then
    raise exception 'El mensaje % no existe', p_message_id;
  end if;
  if m.status in ('done', 'not_expense', 'duplicate') then
    return jsonb_build_object('skipped', true, 'status', m.status);
  end if;

  if v_moneda is not null and (
    v_moneda not in ('COP', 'CLP', 'BOB', 'USD', 'EUR', 'PEN', 'MXN', 'ARS', 'BRL')
    or v_moneda = (select a.currency from public.accounts a where a.id = m.account_id)
  ) then
    v_moneda := null;
  end if;
  if v_moneda is not null then
    if coalesce(p_data ->> 'original_total', '') ~ '^[0-9]{1,12}$' and (p_data ->> 'original_total')::bigint > 0 then
      v_original := (p_data ->> 'original_total')::bigint;
    end if;
    if coalesce(p_data ->> 'fx_rate', '') ~ '^[0-9]{1,8}([.][0-9]{1,20})?$' and (p_data ->> 'fx_rate')::numeric > 0 then
      v_tasa := (p_data ->> 'fx_rate')::numeric;
    end if;
    if coalesce(p_data ->> 'fx_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then
      v_dia_tasa := (p_data ->> 'fx_date')::date;
    end if;
  end if;

  -- Un candado por cuenta mientras se revisa y se guarda: si llegan dos fotos
  -- iguales a la vez, la segunda ve la primera.
  perform pg_advisory_xact_lock(hashtextextended('lucas-dedup:' || m.account_id::text, 0));

  v_dup := public.worker_buscar_repetido(
    m.account_id, p_data ->> 'cufe', p_data ->> 'image_hash', p_max_distance,
    v_total, v_date, p_data ->> 'extracted_text'
  );
  if v_dup is not null then
    update public.messages
    set status = 'duplicate', duplicate_of = v_dup, processed_at = now(),
        extracted_text = left(p_data ->> 'extracted_text', 20000)
    where id = m.id;
    return jsonb_build_object('duplicate_of', v_dup);
  end if;

  -- Nada de categorías ni personas de otra cuenta
  if v_category is not null and not exists (
    select 1 from public.categories c where c.id = v_category and c.account_id = m.account_id
  ) then
    v_category := null;
  end if;
  if v_payer is not null and not exists (
    select 1 from public.people p where p.id = v_payer and p.account_id = m.account_id
  ) then
    v_payer := null;
  end if;

  -- Mismo comercio, día y valor que otro gasto: puede ser la misma compra en
  -- otra foto. No se descarta (podría ser real), pero va sí o sí a revisión.
  if v_total > 0 then
    select e.id into v_parecido
    from public.expenses e
    where e.account_id = m.account_id
      and e.total_cop = v_total
      and e.expense_date = v_date
      and e.merchant_normalized = public.normalize_merchant(v_merchant)
    order by e.created_at
    limit 1;
    if v_parecido is not null then
      v_status := 'pending_review';
      v_snapshot := v_snapshot || jsonb_build_object('possible_duplicate_of', v_parecido);
    end if;
  end if;

  -- Sin pagador no se confirma solo
  if v_payer is null or v_total = 0 then
    v_status := 'pending_review';
  end if;

  insert into public.expenses (
    account_id, merchant, merchant_normalized, description, expense_date, total_cop, category_id,
    payer_person_id, status, confidence, source, message_id, evidence_path, cufe, image_hash,
    created_by, ai_snapshot, field_confidence, split_note,
    original_currency, original_total, fx_rate, fx_date, fx_source
  )
  values (
    m.account_id, v_merchant, public.normalize_merchant(v_merchant),
    left(nullif(btrim(p_data ->> 'description'), ''), 160),
    v_date, v_total, v_category, v_payer, v_status,
    round(least(greatest(coalesce((p_data ->> 'confidence')::numeric, 0), 0), 1), 2),
    m.source, m.id, m.media_path,
    lower(nullif(p_data ->> 'cufe', '')), lower(nullif(p_data ->> 'image_hash', '')),
    m.uploaded_by, v_snapshot, p_data -> 'field_confidence',
    left(nullif(btrim(p_data ->> 'split_note'), ''), 200),
    v_moneda, v_original, v_tasa, case when v_tasa is not null then v_dia_tasa end,
    case when v_tasa is not null then left(nullif(btrim(p_data ->> 'fx_source'), ''), 40) end
  )
  returning id into v_expense;

  -- created_at en el orden del recibo: así se muestran al dividir por consumo
  insert into public.expense_items (expense_id, name, quantity, unit_price_cop, total_cop, created_at)
  select v_expense,
         left(btrim(i ->> 'name'), 80),
         least(greatest(coalesce((i ->> 'quantity')::numeric, 1), 0.001), 9999999),
         greatest(coalesce((i ->> 'unit_price_cop')::bigint, 0), 0),
         greatest(coalesce((i ->> 'total_cop')::bigint, 0), 0),
         now() + x.n * interval '1 millisecond'
  from jsonb_array_elements(coalesce(p_data -> 'items', '[]'::jsonb)) with ordinality as x (i, n)
  where nullif(btrim(i ->> 'name'), '') is not null and x.n <= 60;

  -- Entre quiénes: los que nombró el mensaje («entre Vale y Santi») o todos
  select array_agg(p.id order by p.created_at, p.id) into v_people
  from public.people p
  where p.account_id = m.account_id
    and p.id in (
      select public.try_uuid(x) from jsonb_array_elements_text(coalesce(p_data -> 'split_person_ids', '[]'::jsonb)) x
    );
  if coalesce(array_length(v_people, 1), 0) = 0 then
    select array_agg(p.id order by p.created_at, p.id) into v_people
    from public.people p where p.account_id = m.account_id;
  end if;
  if coalesce(array_length(v_people, 1), 0) > 0 then
    perform public.replace_equal_split(v_expense, v_people);
  end if;

  -- La memoria de comercios acertó: suma un uso
  if public.try_uuid(p_data ->> 'memory_id') is not null then
    update public.merchant_memory mm
    set hits = mm.hits + 1
    where mm.id = public.try_uuid(p_data ->> 'memory_id') and mm.account_id = m.account_id;
  end if;

  update public.messages
  set status = 'done', processed_at = now(), duplicate_of = null,
      extracted_text = left(p_data ->> 'extracted_text', 20000)
  where id = m.id;

  return jsonb_build_object('expense_id', v_expense, 'status', v_status, 'possible_duplicate_of', v_parecido);
end;
$$;

-- Quien administra dice en qué moneda está el recibo (p_currency null o la de la
-- cuenta: era de la cuenta) y cuánto queda en la moneda de la cuenta
-- (p_total_cop: la conversión con la tasa del día, o lo que de verdad cobró el
-- banco). El total, los ítems y las partes de cada uno cambian en la misma
-- proporción. La web lo llama antes de review_expense, con el mismo total.
create or replace function public.set_expense_currency(
  p_expense_id uuid,
  p_currency text,
  p_original_total bigint,
  p_rate numeric,
  p_rate_date date,
  p_total_cop bigint,
  p_rate_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  e public.expenses%rowtype;
  v_cuenta text;
  v_estado text;
  v_moneda text := upper(nullif(btrim(p_currency), ''));
  v_viejo bigint;
  v_cambio boolean;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into e from public.expenses where id = p_expense_id for update;
  if not found or not public.is_account_member(e.account_id) then
    raise exception 'El gasto no existe';
  end if;
  if not public.has_account_role(e.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta corrigen gastos';
  end if;
  select a.currency, a.status into v_cuenta, v_estado from public.accounts a where a.id = e.account_id;
  if v_estado = 'closed' then
    raise exception 'La cuenta está cerrada: ya no cambia';
  end if;
  if v_moneda = v_cuenta then
    v_moneda := null;
  end if;
  if v_moneda is not null and v_moneda not in ('COP', 'CLP', 'BOB', 'USD', 'EUR', 'PEN', 'MXN', 'ARS', 'BRL') then
    raise exception 'Esa moneda no está disponible';
  end if;
  if p_total_cop is null or p_total_cop <= 0 or p_total_cop >= 1000000000000 then
    raise exception 'El total tiene que ser mayor que cero';
  end if;
  if v_moneda is not null then
    if p_original_total is null or p_original_total <= 0 or p_original_total >= 1000000000000 then
      raise exception 'Escribe cuánto dice el recibo';
    end if;
    if p_rate is null or p_rate <= 0 or p_rate >= 100000000 then
      raise exception 'Falta la tasa de cambio';
    end if;
    if p_rate_date is null or p_rate_date > (now() at time zone 'America/Bogota')::date + 1 then
      raise exception 'Revisa la fecha de la tasa de cambio';
    end if;
  end if;

  v_viejo := e.total_cop;
  v_cambio := p_total_cop is distinct from e.total_cop
    or v_moneda is distinct from e.original_currency
    or (v_moneda is not null and (p_original_total is distinct from e.original_total or p_rate is distinct from e.fx_rate));

  -- Los ítems y las partes de cada uno, en la misma proporción que el total
  if v_viejo > 0 and v_viejo <> p_total_cop then
    update public.expense_items i
    set unit_price_cop = round(i.unit_price_cop::numeric * p_total_cop / v_viejo)::bigint,
        total_cop = round(i.total_cop::numeric * p_total_cop / v_viejo)::bigint
    where i.expense_id = e.id;
    -- Las partes: con el resto a las que más perdieron al redondear, para que sumen justo el total
    if (select coalesce(sum(s.amount_cop), 0) from public.expense_splits s where s.expense_id = e.id) = v_viejo then
      with partes as (
        select s.id, s.amount_cop::numeric * p_total_cop / v_viejo as exacto
        from public.expense_splits s
        where s.expense_id = e.id
      ),
      orden as (
        select p.id,
               floor(p.exacto)::bigint as piso,
               row_number() over (order by p.exacto - floor(p.exacto) desc, p.id) as n,
               p_total_cop - sum(floor(p.exacto)::bigint) over () as faltan
        from partes p
      )
      update public.expense_splits s
      set amount_cop = o.piso + case when o.n <= o.faltan then 1 else 0 end
      from orden o
      where s.id = o.id;
    end if;
  end if;

  update public.expenses x
  set total_cop = p_total_cop,
      original_currency = v_moneda,
      original_total = case when v_moneda is not null then p_original_total end,
      fx_rate = case when v_moneda is not null then p_rate end,
      fx_date = case when v_moneda is not null then p_rate_date end,
      fx_source = case when v_moneda is not null then left(coalesce(nullif(btrim(p_rate_source), ''), 'manual'), 40) end,
      corrected_by = case when v_cambio then v_uid else x.corrected_by end,
      corrected_at = case when v_cambio then now() else x.corrected_at end
  where x.id = e.id;

  return jsonb_build_object('total_cop', p_total_cop, 'currency', coalesce(v_moneda, v_cuenta));
end;
$$;

revoke execute on function public.set_expense_currency(uuid, text, bigint, numeric, date, bigint, text) from public, anon;
grant execute on function public.set_expense_currency(uuid, text, bigint, numeric, date, bigint, text) to authenticated;
