-- ============================================================================
-- Lucas · 00000000000090_categorias_propias.sql
-- Categorías propias: además de las 8 de siempre, cada cuenta puede crear las
-- suyas («Salud», «Mascotas», «Colegio»…). Cada categoría trae una
-- descripción de qué entra en ella: es lo que lee Laya para elegirla (sin
-- haberla visto nunca) y de donde salen palabras clave para clasificar.
--
--   · categories.description, con las de siempre ya descritas
--   · create_category / update_category / delete_category (owner y admin)
--   · el worker recibe las descripciones (worker_message_context) y la
--     exportación de entrenamiento incluye las categorías propias de cada
--     cuenta (worker_training_export)
-- ============================================================================

alter table public.categories
  add column description text check (length(description) <= 300);

-- Lo mismo que el worker (classify/categories.py, desc_es)
create or replace function public.default_category_description(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_name
    when 'Transporte' then 'taxis, Uber, buses, lanchas, peajes, gasolina, parqueaderos, vuelos'
    when 'Hospedaje' then 'hoteles, hostales, cabañas, Airbnb, glamping, fincas de alquiler'
    when 'Licor' then 'estancos, licoreras, cerveza, aguardiente, ron, vino, bares, discotecas'
    when 'Café' then 'cafeterías, panaderías, pastelerías, tinto, pandebono, onces'
    when 'Restaurante' then 'restaurantes, almuerzos, cenas, comidas rápidas, domicilios de comida'
    when 'Mercado' then 'mercado, supermercados, tiendas de barrio, fruver, carnicería, aseo del hogar'
    when 'Servicios' then 'servicios públicos: luz, agua, gas, internet, celular, administración, arriendo'
    when 'Otros' then 'todo lo demás: droguería, ropa, entretenimiento, regalos, entradas'
  end
$$;

update public.categories set description = public.default_category_description(name)
where is_default and description is null;

-- Las de siempre nacen descritas (create_account no cambia)
create or replace function public.categories_default_description()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_default and new.description is null then
    new.description := public.default_category_description(new.name);
  end if;
  return new;
end;
$$;

create trigger trg_categories_descripcion before insert on public.categories
  for each row execute function public.categories_default_description();

-- ============================================================================
-- Crear, editar y borrar (owner y admin)
-- ============================================================================

create or replace function public.create_category(p_account_id uuid, p_name text, p_description text default null, p_tone public.tone default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_tone public.tone := p_tone;
  v_id uuid;
begin
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta crean categorías';
  end if;
  if length(v_name) < 2 or length(v_name) > 30 then
    raise exception 'El nombre de la categoría va de 2 a 30 letras';
  end if;
  if exists (select 1 from public.categories c where c.account_id = p_account_id and lower(c.name) = lower(v_name)) then
    raise exception 'Ya hay una categoría «%» en esta cuenta', v_name;
  end if;
  if (select count(*) from public.categories c where c.account_id = p_account_id) >= 40 then
    raise exception 'Máximo 40 categorías por cuenta';
  end if;

  -- El tono que menos se ha usado en las categorías de la cuenta
  if v_tone is null then
    select t.tone::public.tone into v_tone
    from unnest(array['morado', 'verde', 'azul', 'turquesa', 'naranja', 'rosa', 'coral', 'amarillo']) with ordinality as t (tone, ord)
    order by (select count(*) from public.categories c where c.account_id = p_account_id and c.tone::text = t.tone), t.ord
    limit 1;
  end if;

  insert into public.categories (account_id, name, letter, tone, description, is_default)
  values (p_account_id, v_name, upper(left(v_name, 1)), v_tone, nullif(left(btrim(p_description), 300), ''), false)
  returning id into v_id;
  return v_id;
end;
$$;

-- Las de siempre no se renombran (Laya y las palabras clave las conocen por su
-- nombre); su descripción y su color sí se pueden cambiar.
create or replace function public.update_category(p_category_id uuid, p_name text default null, p_description text default null, p_tone public.tone default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.categories%rowtype;
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
begin
  select * into c from public.categories where id = p_category_id;
  if not found or not public.has_account_role(c.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta cambian categorías';
  end if;
  if v_name is not null and v_name <> c.name then
    if c.is_default then
      raise exception 'Las categorías de siempre no se renombran; puedes cambiar su descripción';
    end if;
    if length(v_name) < 2 or length(v_name) > 30 then
      raise exception 'El nombre de la categoría va de 2 a 30 letras';
    end if;
    if exists (select 1 from public.categories x where x.account_id = c.account_id and lower(x.name) = lower(v_name) and x.id <> c.id) then
      raise exception 'Ya hay una categoría «%» en esta cuenta', v_name;
    end if;
  end if;

  update public.categories
  set name = coalesce(v_name, name),
      letter = upper(left(coalesce(v_name, name), 1)),
      description = case when p_description is null then description else nullif(left(btrim(p_description), 300), '') end,
      tone = coalesce(p_tone, tone)
  where id = c.id;
end;
$$;

-- Lo que estaba en la categoría pasa a «Otros»; su memoria de comercios se olvida.
create or replace function public.delete_category(p_category_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.categories%rowtype;
  v_otros uuid;
  v_movidos int;
begin
  select * into c from public.categories where id = p_category_id;
  if not found or not public.has_account_role(c.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta borran categorías';
  end if;
  if c.is_default then
    raise exception 'Las categorías de siempre no se borran';
  end if;
  select id into v_otros from public.categories where account_id = c.account_id and name = 'Otros';

  update public.expenses set category_id = v_otros where category_id = c.id;
  get diagnostics v_movidos = row_count;
  delete from public.categories where id = c.id;
  return v_movidos;
end;
$$;

-- ============================================================================
-- El worker: descripciones en el contexto y categorías propias al exportar
-- ============================================================================

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
      'starts_on', a.starts_on, 'ends_on', a.ends_on
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

create or replace function public.worker_training_export(
  p_since timestamptz default null,
  p_include_confirmed boolean default false,
  p_only_new boolean default true,
  p_limit int default 5000
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ejemplos as (
    select 'te:' || t.id::text as id, t.id as training_id, t.source, t.account_id, t.created_at,
           c.name as category, coalesce(e.merchant, t.merchant_text) as merchant,
           e.description, e.id as expense_id, coalesce(m.text_body, t.raw_text) as message_text,
           m.extracted_text, m.kind
    from public.training_examples t
    join public.categories c on c.id = t.category_id
    left join public.expenses e on e.id = t.expense_id
    left join public.messages m on m.id = e.message_id
    where (p_since is null or t.created_at >= p_since)
      and (not p_only_new or t.exported_at is null)

    union all

    select 'ex:' || e.id::text, null, 'confirmed', e.account_id, e.updated_at,
           c.name, e.merchant, e.description, e.id, m.text_body, m.extracted_text, m.kind
    from public.expenses e
    join public.categories c on c.id = e.category_id
    left join public.messages m on m.id = e.message_id
    where p_include_confirmed
      and e.status = 'confirmed'
      and (p_since is null or e.updated_at >= p_since)
      -- las correcciones ya salen arriba; no repetir el mismo gasto
      and not exists (select 1 from public.training_examples t where t.expense_id = e.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id, 'training_id', x.training_id, 'source', x.source, 'account_id', x.account_id,
    'created_at', x.created_at, 'category', x.category, 'merchant', x.merchant,
    'description', x.description, 'message_text', x.message_text,
    'extracted_text', left(x.extracted_text, 2000), 'kind', x.kind,
    -- Las categorías propias de esa cuenta: entran como opciones de la pregunta
    'account_categories', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.name, 'description', c.description) order by c.name)
      from public.categories c where c.account_id = x.account_id and not c.is_default
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(i.name order by i.created_at) from public.expense_items i where i.expense_id = x.expense_id
    ), '[]'::jsonb)
  ) order by x.created_at), '[]'::jsonb)
  from (select * from ejemplos order by created_at limit greatest(1, p_limit)) x
$$;

revoke execute on function public.default_category_description(text) from public, anon;
revoke execute on function public.categories_default_description() from public, anon, authenticated, service_role;
revoke execute on function public.create_category(uuid, text, text, public.tone) from public, anon;
revoke execute on function public.update_category(uuid, text, text, public.tone) from public, anon;
revoke execute on function public.delete_category(uuid) from public, anon;
grant execute on function public.default_category_description(text) to authenticated, service_role;
grant execute on function public.create_category(uuid, text, text, public.tone) to authenticated;
grant execute on function public.update_category(uuid, text, text, public.tone) to authenticated;
grant execute on function public.delete_category(uuid) to authenticated;

revoke execute on function public.worker_message_context(uuid) from public, anon, authenticated;
revoke execute on function public.worker_training_export(timestamptz, boolean, boolean, int) from public, anon, authenticated;
grant execute on function public.worker_message_context(uuid) to service_role;
grant execute on function public.worker_training_export(timestamptz, boolean, boolean, int) to service_role;
