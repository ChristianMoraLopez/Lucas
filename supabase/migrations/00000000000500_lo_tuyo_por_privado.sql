-- ============================================================================
-- Lucas · 00000000000500_lo_tuyo_por_privado.sql
-- Responden la lista de «¿quién pidió qué?» en el grupo: además de la línea en
-- el grupo, Mister Luks le manda por privado lo suyo (si ya le escribió),
-- ítem por ítem y con la fecha, para que lo confirme. Para eso la respuesta
-- de connector_items_respuesta trae el gasto, la cuenta, la fecha, lo de cada
-- ítem en plata y su chat privado. Es la de la 440 con eso.
--
-- Y el worker: una foto o un PDF que no dice en qué moneda está, en un viaje
-- con recibos de estos días en otra moneda, se lee en esa (moneda_del_viaje).
-- ============================================================================

create or replace function public.connector_items_respuesta(
  p_jid text,
  p_quoted_wa_id text,
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_name text,
  p_claims jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.item_prompts%rowtype;
  e public.expenses%rowtype;
  a public.accounts%rowtype;
  v_me uuid;
  v_n int;
  c jsonb;
  v_item uuid;
  v_units numeric;
begin
  select p.* into pr
  from public.item_prompts p
  join public.whatsapp_outbox o on o.id = p.outbox_id
  where o.chat_jid = p_jid and o.wa_message_id = p_quoted_wa_id;
  if pr.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_es_pregunta');
  end if;
  select * into e from public.expenses where id = pr.expense_id;
  select * into a from public.accounts where id = e.account_id;
  perform public.wa_identidad(p_wa_id, p_phone, p_lid, p_name);
  v_me := coalesce(
    public.wa_person(a.id, p_wa_id),
    case when p_phone is not null then public.wa_person(a.id, p_phone) end,
    case when p_lid is not null then public.wa_person(a.id, 'lid:' || p_lid) end
  );
  if a.status = 'closed' or public.is_settled(a.id, e.expense_date) then
    return jsonb_build_object('ok', false, 'reason', 'liquidado', 'language', a.language, 'merchant', e.merchant);
  end if;
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'no_te_conozco', 'language', a.language, 'account_name', a.name);
  end if;
  v_n := coalesce(array_length(pr.items, 1), 0);
  -- Si alguien cambió los ítems en la app, la lista ya no sirve
  if exists (select 1 from unnest(pr.items) x where not exists (select 1 from public.expense_items i where i.id = x)) then
    return jsonb_build_object('ok', false, 'reason', 'cambio', 'language', a.language, 'merchant', e.merchant);
  end if;
  if exists (select 1 from public.expense_splits s where s.expense_id = e.id and s.fixed) then
    return jsonb_build_object('ok', false, 'reason', 'fijos', 'language', a.language, 'merchant', e.merchant);
  end if;

  for c in select x from jsonb_array_elements(coalesce(p_claims, '[]'::jsonb)) x loop
    if coalesce(c ->> 'n', '') !~ '^[0-9]{1,3}$' or (c ->> 'n')::int < 1 or (c ->> 'n')::int > v_n then
      return jsonb_build_object('ok', false, 'reason', 'no_existe', 'n', c ->> 'n', 'total_items', v_n, 'language', a.language);
    end if;
    v_item := pr.items[(c ->> 'n')::int];
    v_units := case when coalesce(c ->> 'units', '') ~ '^[0-9]{1,3}([.][0-9]{1,3})?$' then least(greatest((c ->> 'units')::numeric, 0.001), 1000) else 1 end;
    insert into public.expense_item_people (item_id, person_id, units)
    values (v_item, v_me, v_units)
    on conflict (item_id, person_id) do update set units = excluded.units;
  end loop;
  perform public.repartir_por_consumo(e.id);

  return jsonb_build_object(
    'ok', true,
    'language', a.language,
    'currency', a.currency,
    'merchant', e.merchant,
    -- Para mandarle lo suyo por privado (si ya le escribió a Mister Luks) y que lo confirme
    'expense_id', e.id,
    'account_id', a.id,
    'account_name', a.name,
    'expense_date', e.expense_date,
    'total', e.total_cop,
    'privado', public.chat_privado_de(v_me),
    'name', (select p.display_name from public.people p where p.id = v_me),
    'parte', coalesce((select s.amount_cop from public.expense_splits s where s.expense_id = e.id and s.person_id = v_me), 0),
    'mios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'n', k.n, 'name', i.name, 'quantity', i.quantity, 'units', ip.units,
        -- Lo suyo del ítem, según las unidades de cada quien
        'amount', round(i.total_cop * ip.units / nullif((select sum(x.units) from public.expense_item_people x where x.item_id = i.id), 0))::bigint
      ) order by k.n)
      from unnest(pr.items) with ordinality as k (item_id, n)
      join public.expense_items i on i.id = k.item_id
      join public.expense_item_people ip on ip.item_id = i.id and ip.person_id = v_me
    ), '[]'::jsonb),
    'sin_nadie', (
      select count(*) from unnest(pr.items) x
      where not exists (select 1 from public.expense_item_people ip where ip.item_id = x)
    )
  );
end;
$$;

-- Como en la 250, con la moneda de los recibos de estos días del viaje
create or replace function public.worker_message_context(p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  a public.accounts%rowtype;
  v_sender uuid;
begin
  select * into m from public.messages where id = p_message_id;
  if not found then
    return null;
  end if;
  select * into a from public.accounts where id = m.account_id;

  -- Quién lo mandó: la persona que subió desde la web o el dueño del número
  v_sender := m.sender_person_id;
  if v_sender is null and m.sender_wa_id is not null then
    select w.person_id into v_sender
    from public.person_whatsapp_ids w
    join public.people p on p.id = w.person_id
    where w.wa_id = m.sender_wa_id and p.account_id = m.account_id
    limit 1;
  end if;

  return jsonb_build_object(
    'message', jsonb_build_object(
      'id', m.id, 'account_id', m.account_id, 'kind', m.kind, 'source', m.source, 'status', m.status,
      'text_body', m.text_body, 'media_path', m.media_path, 'file_name', m.file_name,
      'mime_type', m.mime_type, 'received_at', m.received_at, 'uploaded_by', m.uploaded_by
    ),
    'sender_person_id', v_sender,
    'account', jsonb_build_object(
      'id', a.id, 'name', a.name, 'type', a.type, 'status', a.status,
      'starts_on', a.starts_on, 'ends_on', a.ends_on,
      'currency', a.currency, 'language', a.language,
      -- La moneda de los recibos de estos días en otra moneda (un viaje): para la
      -- foto o el PDF que no dice de dónde es (migración 500)
      'moneda_del_viaje', (
        select e.original_currency
        from public.expenses e
        where e.account_id = a.id and e.original_currency is not null and e.original_currency <> a.currency
          and e.created_at > now() - interval '10 days'
        group by e.original_currency
        order by count(*) desc, max(e.created_at) desc
        limit 1
      )
    ),
    'today', (now() at time zone 'America/Bogota')::date,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name) order by p.created_at, p.id)
      from public.people p where p.account_id = a.id
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'is_default', c.is_default) order by c.name)
      from public.categories c where c.account_id = a.id
    ), '[]'::jsonb),
    'memory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mm.id, 'merchant_text', mm.merchant_text, 'normalized', mm.normalized,
        'category_id', mm.category_id, 'hits', mm.hits
      ) order by mm.hits desc)
      from public.merchant_memory mm where mm.account_id = a.id
    ), '[]'::jsonb)
  );
end;
$$;

-- ============================================================================
-- connector_items_cantidad: «la 1 son 3» respondiendo la lista. El ítem 1 eran
-- 3 (3 limonadas que valen lo del renglón, no cada una): cambia la cantidad,
-- no el total. Así después cada quien dice «1x1» si fue una de las tres.
-- ============================================================================

create or replace function public.connector_items_cantidad(
  p_jid text,
  p_quoted_wa_id text,
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_name text,
  p_n int,
  p_cantidad numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.item_prompts%rowtype;
  e public.expenses%rowtype;
  a public.accounts%rowtype;
  i public.expense_items%rowtype;
  v_me uuid;
begin
  select p.* into pr
  from public.item_prompts p
  join public.whatsapp_outbox o on o.id = p.outbox_id
  where o.chat_jid = p_jid and o.wa_message_id = p_quoted_wa_id;
  if pr.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_es_pregunta');
  end if;
  select * into e from public.expenses where id = pr.expense_id;
  select * into a from public.accounts where id = e.account_id;
  perform public.wa_identidad(p_wa_id, p_phone, p_lid, p_name);
  v_me := coalesce(
    public.wa_person(a.id, p_wa_id),
    case when p_phone is not null then public.wa_person(a.id, p_phone) end,
    case when p_lid is not null then public.wa_person(a.id, 'lid:' || p_lid) end
  );
  if a.status = 'closed' or public.is_settled(a.id, e.expense_date) then
    return jsonb_build_object('ok', false, 'reason', 'liquidado', 'language', a.language, 'merchant', e.merchant);
  end if;
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'no_te_conozco', 'language', a.language, 'account_name', a.name);
  end if;
  if p_n is null or p_n < 1 or p_n > coalesce(array_length(pr.items, 1), 0) then
    return jsonb_build_object('ok', false, 'reason', 'no_existe', 'n', p_n, 'total_items', coalesce(array_length(pr.items, 1), 0), 'language', a.language);
  end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 99 then
    return jsonb_build_object('ok', false, 'reason', 'cantidad', 'language', a.language);
  end if;

  update public.expense_items
  set quantity = p_cantidad, unit_price_cop = round(total_cop / p_cantidad)::bigint
  where id = pr.items[p_n]
  returning * into i;
  if i.id is null then
    return jsonb_build_object('ok', false, 'reason', 'cambio', 'language', a.language, 'merchant', e.merchant);
  end if;

  return jsonb_build_object(
    'ok', true,
    'language', a.language,
    'currency', a.currency,
    'merchant', e.merchant,
    'n', p_n,
    'item', i.name,
    'quantity', i.quantity,
    'total', i.total_cop
  );
end;
$$;

revoke execute on function public.connector_items_cantidad(text, text, text, text, text, text, int, numeric) from public, anon, authenticated;
grant execute on function public.connector_items_cantidad(text, text, text, text, text, text, int, numeric) to service_role;
