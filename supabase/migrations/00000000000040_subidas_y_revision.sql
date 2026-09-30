-- ============================================================================
-- Lucas · 00000000000040_subidas_y_revision.sql
-- Fase 2: subidas manuales (foto, PDF, texto), bucket privado de evidencias,
-- procesador simulado (hasta que exista el worker de Python), bandeja de
-- revisión con memoria de comercios y ejemplos de entrenamiento, y la lectura
-- que alimenta los resúmenes de hogar y evento.
-- ============================================================================

-- ============================================================================
-- Mensajes: ahora también llegan desde la web, no solo del grupo de WhatsApp
-- ============================================================================

alter table public.messages add column account_id uuid references public.accounts (id) on delete cascade;
update public.messages m
set account_id = agl.account_id
from public.account_group_links agl
where agl.group_id = m.group_id;
alter table public.messages alter column account_id set not null;

alter table public.messages alter column group_id drop not null;
alter table public.messages alter column wa_message_id drop not null;
alter table public.messages add column source text not null default 'whatsapp' check (source in ('whatsapp', 'web'));
alter table public.messages add column uploaded_by uuid references public.profiles (id) on delete set null;
alter table public.messages add column sender_person_id uuid references public.people (id) on delete set null;
alter table public.messages add column file_name text;
alter table public.messages add column mime_type text;
alter table public.messages add column status text not null default 'queued'
  check (status in ('queued', 'processing', 'done', 'not_expense', 'failed'));
update public.messages set status = 'done' where processed_at is not null;
alter table public.messages add constraint messages_origen check (
  (source = 'whatsapp' and group_id is not null and wa_message_id is not null)
  or (source = 'web' and group_id is null and uploaded_by is not null)
);

create index messages_cuenta_idx on public.messages (account_id, received_at desc);
create index messages_en_proceso_idx on public.messages (account_id) where status in ('queued', 'processing');

drop policy messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (public.is_account_member(account_id));

-- ============================================================================
-- Gastos: lo que leyó la IA (para marcar correcciones campo por campo) y la
-- confianza de cada campo (Seguro · Casi seguro · Revísalo)
-- ============================================================================

alter table public.expenses add column ai_snapshot jsonb;
alter table public.expenses add column field_confidence jsonb;
alter table public.expenses add column split_note text;

create index expenses_mensaje_idx on public.expenses (message_id) where message_id is not null;

-- ============================================================================
-- Auxiliares
-- ============================================================================

create or replace function public.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

-- «Panadería  La Espiga» → «panaderia la espiga». Sin extensiones (unaccent
-- no está en todos lados): translate para tildes y eñes.
create or replace function public.normalize_merchant(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(
    lower(translate(coalesce(p_text, ''),
      'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
      'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun')),
    '[^a-z0-9&]+', ' ', 'g')), '');
$$;

-- ============================================================================
-- parse_cop_amount: montos como los escribe la gente en Colombia.
--   «100 lucas» 100.000 · «132,5 lucas» 132.500 · «84 mil» 84.000
--   «1,2 palos» 1.200.000 · «2 millones» 2.000.000 · «$84.300» 84.300
--   «1.014.500» 1.014.500 · «84300» 84.300 · «pagué 38 el taxi» 38.000
-- Lo usa el procesador simulado; el worker (fase 3) tendrá sus propias reglas.
-- ============================================================================

create or replace function public.parse_cop_amount(p_text text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := lower(translate(coalesce(p_text, ''), 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou'));
  m text[];
  v numeric;
begin
  -- 1. Millones: «1,2 palos», «2 millones», «3 palitos»
  m := regexp_match(t, '(\d+(?:[.,]\d+)?)\s*(?:palos?|palitos?|millones|millon\M|mm\M)');
  if m is not null then
    v := replace(m[1], ',', '.')::numeric * 1000000;
    return round(v);
  end if;

  -- 2. Miles: «100 lucas», «132,5 lucas», «84 mil», «50k»
  m := regexp_match(t, '(\d+(?:[.,]\d+)?)\s*(?:lucas?|luquitas?|mil\M|k\M)');
  if m is not null then
    v := replace(m[1], ',', '.')::numeric * 1000;
    return round(v);
  end if;

  -- 3. Con punto de miles: «$84.300», «1.014.500», «84.300,50» (los centavos se ignoran)
  m := regexp_match(t, '(\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?');
  if m is not null then
    return replace(m[1], '.', '')::bigint;
  end if;

  -- 4. Número pegado de 4 o más cifras: «84300», «$120000»
  m := regexp_match(t, '(?:^|[^\d/])(\d{4,9})(?:[^\d/]|$)');
  if m is not null then
    return m[1]::bigint;
  end if;

  -- 5. Número suelto de 1 a 3 cifras que no sea parte de una fecha: se leen como miles
  m := regexp_match(t, '(?:^|[^\d/.,])(\d{1,3})(?:[^\d/.,]|$)');
  if m is not null and m[1]::int > 0 then
    return m[1]::bigint * 1000;
  end if;

  return null;
end;
$$;

-- «La lancha la pagó Santi», «Vale pagó el almuerzo» → la persona de la cuenta.
-- Sin coincidencia devuelve null y el pagador es quien mandó el mensaje.
create or replace function public.detect_payer(p_account_id uuid, p_text text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t text := public.normalize_merchant(p_text);
  v_tok text;
  v_id uuid;
begin
  if t is null then
    return null;
  end if;
  -- Dos formas: «pagó Santi» / «la pagó Santi» y «Santi pagó» / «Vale pagó el almuerzo»
  foreach v_tok in array array[
    (regexp_match(t, 'pago\s+(?:el\s+|la\s+|los\s+|las\s+)?([a-z]{3,})'))[1],
    (regexp_match(t, '([a-z]{3,})\s+pago'))[1]
  ] loop
    continue when v_tok is null or v_tok in ('con', 'por', 'para', 'todo', 'todos', 'que', 'las', 'los', 'quien');
    select p.id into v_id
    from public.people p
    where p.account_id = p_account_id
      and public.normalize_merchant(p.display_name) like v_tok || '%'
    order by length(p.display_name)
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end loop;
  return null;
end;
$$;

-- Nombre del comercio a partir de un mensaje: se quitan el monto y el «la pagó X».
create or replace function public.merchant_from_text(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := coalesce(p_text, '');
begin
  t := regexp_replace(t, '\$?\s*\d[\d.,]*\s*(lucas?|luquitas?|mil|palos?|palitos?|millones|millon|k)?\M', ' ', 'gi');
  t := regexp_replace(t, '\s*(la|lo|los|las)?\s*pag[oó]\s+[[:alpha:]]+', ' ', 'gi');
  t := regexp_replace(t, '^\s*((yo|hoy|ayer|pagu[eé]|compr[eé]|gast[eé]|de|el|la|en)\s+)+', '', 'gi');
  t := regexp_replace(t, '\s+', ' ', 'g');
  t := btrim(t, ' :;,.-·');
  if t = '' then
    return 'Gasto sin nombre';
  end if;
  return left(upper(left(t, 1)) || substr(t, 2), 40);
end;
$$;

-- Clasificación por palabras mientras no esté Laya (fase 3)
create or replace function public.guess_category(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when t ~ '(taxi|uber|bus|lancha|peaje|gasolina|parqueadero|transmilenio|pasaje|tiquete|vuelo)' then 'Transporte'
    when t ~ '(hotel|hostal|cabana|airbnb|posada|arriendo del|alojamiento)' then 'Hospedaje'
    when t ~ '(cerveza|aguardiente|guaro|ron|licor|estanco|licorera|vino)' then 'Licor'
    when t ~ '(cafe|tinto|panaderia|pan |pandebono|bunuelo)' then 'Café'
    when t ~ '(almuerzo|cena|desayuno|restaurante|empanada|pizza|asadero|hamburguesa|pescado|arepa)' then 'Restaurante'
    when t ~ '(mercado|tienda|supermercado|fruver|carniceria|verdura|huevos|leche)' then 'Mercado'
    when t ~ '(luz|energia|agua|acueducto|gas natural|internet|celular|factura)' then 'Servicios'
    else 'Otros'
  end
  from (select coalesce(public.normalize_merchant(p_text), '') || ' ' as t) x;
$$;

-- Reparte un total en partes iguales entre personas; los pesos que sobran
-- (el residuo) van uno a uno a las primeras, así la suma siempre cuadra.
create or replace function public.replace_equal_split(p_expense_id uuid, p_person_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_n int := coalesce(array_length(p_person_ids, 1), 0);
begin
  if v_n = 0 then
    raise exception 'Elige al menos una persona para dividir el gasto';
  end if;
  select e.total_cop into v_total from public.expenses e where e.id = p_expense_id;

  delete from public.expense_splits s where s.expense_id = p_expense_id and s.item_id is null;

  insert into public.expense_splits (expense_id, person_id, amount_cop)
  select p_expense_id, x.person_id,
         v_total / v_n + case when x.k <= v_total % v_n then 1 else 0 end
  from unnest(p_person_ids) with ordinality as x (person_id, k);

  update public.expenses e set split_method = 'equal' where e.id = p_expense_id;
end;
$$;

-- ============================================================================
-- Evidencias: bucket privado. Ruta: {account_id}/{archivo}. Fotos ya
-- comprimidas en el navegador (~1600 px, WebP o JPEG); PDFs de hasta 6 MB.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencias', 'evidencias', false, 6291456, array['image/webp', 'image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy evidencias_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidencias'
    and public.is_account_member(public.try_uuid((storage.foldername(objects.name))[1]))
  );

create policy evidencias_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evidencias'
    and public.is_account_member(public.try_uuid((storage.foldername(objects.name))[1]))
    and exists (
      select 1 from public.accounts a
      where a.id = public.try_uuid((storage.foldername(objects.name))[1]) and a.status = 'active'
    )
  );

create policy evidencias_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'evidencias'
    and public.has_account_role(public.try_uuid((storage.foldername(objects.name))[1]), array['owner', 'admin']::public.member_role[])
  );

-- ============================================================================
-- submit_upload: registra lo que alguien subió desde la web (o escribió) como
-- un mensaje de la cuenta y encola el trabajo para procesarlo.
-- ============================================================================

create or replace function public.submit_upload(
  p_account_id uuid,
  p_kind public.message_kind,
  p_text text default null,
  p_media_path text default null,
  p_file_name text default null,
  p_mime_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_person uuid;
  v_message uuid;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  if exists (select 1 from public.accounts a where a.id = p_account_id and a.status = 'closed') then
    raise exception 'La cuenta está cerrada: ya no recibe gastos';
  end if;

  if p_kind = 'text' then
    if nullif(btrim(p_text), '') is null then
      raise exception 'Escribe el gasto, por ejemplo «taxis al aeropuerto 100 lucas»';
    end if;
    if length(p_text) > 1000 then
      raise exception 'El mensaje es muy largo (máximo 1.000 letras)';
    end if;
  else
    if p_media_path is null
       or p_media_path not like p_account_id::text || '/%'
       or p_media_path like '%..%' then
      raise exception 'El archivo no está en la carpeta de esta cuenta';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'evidencias' and o.name = p_media_path) then
      raise exception 'No encontramos el archivo subido. Intenta subirlo otra vez';
    end if;
    if p_kind = 'pdf' and coalesce(p_mime_type, 'application/pdf') <> 'application/pdf' then
      raise exception 'Ese archivo no es un PDF';
    end if;
  end if;

  select p.id into v_person
  from public.people p
  where p.account_id = p_account_id and p.claimed_by = v_uid;

  insert into public.messages (account_id, source, kind, text_body, media_path, file_name, mime_type, uploaded_by, sender_person_id)
  values (
    p_account_id, 'web', p_kind,
    case when p_kind = 'text' then btrim(p_text) else nullif(btrim(p_text), '') end,
    case when p_kind = 'text' then null else p_media_path end,
    left(p_file_name, 120), p_mime_type, v_uid, v_person
  )
  returning id into v_message;

  insert into public.jobs (type, payload)
  values ('process_message', jsonb_build_object('message_id', v_message, 'account_id', p_account_id));

  return v_message;
end;
$$;

-- ============================================================================
-- Procesador simulado. Llena gastos verosímiles con distintos niveles de
-- confianza para poder probar la bandeja de revisión. Lo reemplaza el worker
-- de Python (fase 3): basta con `select cron.unschedule('lucas-procesador-simulado')`.
-- ============================================================================

create or replace function public.simulate_process_message(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  v_seed bigint;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_merchant text;
  v_cat_name text;
  v_total bigint;
  v_date date;
  v_payer uuid;
  v_category uuid;
  v_memory uuid;
  v_tier numeric;
  v_conf jsonb;
  v_min numeric;
  v_expense uuid;
  v_note text;
  v_people uuid[];
  v_desc text;
  v_catalogo jsonb;
  v_item jsonb;
  v_min_cop bigint;
  v_max_cop bigint;
begin
  select * into m from public.messages where id = p_message_id for update;
  if not found or m.status in ('done', 'not_expense') then
    return null;
  end if;
  update public.messages set status = 'processing' where id = m.id;

  v_seed := ('x' || substr(md5(m.id::text), 1, 12))::bit(48)::bigint;
  v_tier := (array[0.97, 0.93, 0.86, 0.78, 0.71, 0.64])[(v_seed % 6) + 1];

  -- Quién pagó: quien lo mandó (web) o el dueño del número (WhatsApp)
  v_payer := m.sender_person_id;
  if v_payer is null and m.sender_wa_id is not null then
    select w.person_id into v_payer
    from public.person_whatsapp_ids w
    join public.people p on p.id = w.person_id
    where w.wa_id = m.sender_wa_id and p.account_id = m.account_id
    limit 1;
  end if;

  if m.kind = 'text' then
    v_total := public.parse_cop_amount(m.text_body);
    v_merchant := public.merchant_from_text(m.text_body);
    v_cat_name := public.guess_category(m.text_body);
    v_payer := coalesce(public.detect_payer(m.account_id, m.text_body), v_payer);
    v_date := case when public.normalize_merchant(m.text_body) ~ '\mayer\M' then v_hoy - 1 else v_hoy end;
    v_conf := jsonb_build_object(
      'merchant', 0.62,
      'date', 0.88,
      'total', case when v_total is null then 0.3 else 0.84 end,
      'category', case when v_cat_name = 'Otros' then 0.55 else 0.8 end,
      'payer', 0.97
    );
    v_note := case
      when public.normalize_merchant(m.text_body) ~ 'entre (los|las) \d+' then
        'Leído del mensaje: «' || (regexp_match(public.normalize_merchant(m.text_body), 'entre (?:los|las) \d+'))[1] || '»'
      when public.normalize_merchant(m.text_body) ~ 'entre [a-z]+ y [a-z]+' then
        'Leído del mensaje: «' || (regexp_match(public.normalize_merchant(m.text_body), '(entre [a-z]+ y [a-z]+)'))[1] || '»'
    end;
  else
    -- Foto o PDF: un comercio verosímil del catálogo, elegido según el mensaje
    v_catalogo := case when m.kind = 'pdf' then jsonb_build_array(
        jsonb_build_array('Factura de energía', 'Servicios', 90000, 260000),
        jsonb_build_array('Internet y TV Conecta', 'Servicios', 99000, 149000),
        jsonb_build_array('Factura acueducto', 'Servicios', 60000, 140000),
        jsonb_build_array('Hostal Brisas del Rodadero', 'Hospedaje', 280000, 720000),
        jsonb_build_array('Lanchas Taganga Azul', 'Transporte', 180000, 420000)
      ) else jsonb_build_array(
        jsonb_build_array('Panadería La Espiga', 'Café', 6000, 32000),
        jsonb_build_array('Tienda Don Beto', 'Mercado', 15000, 95000),
        jsonb_build_array('Supermercado La Economía', 'Mercado', 60000, 420000),
        jsonb_build_array('Estanco El Paisa', 'Licor', 40000, 250000),
        jsonb_build_array('Parqueadero Calle 85', 'Transporte', 6000, 26000),
        jsonb_build_array('Asadero Los Cerros', 'Restaurante', 45000, 190000),
        jsonb_build_array('Café de la Esquina', 'Café', 8000, 36000),
        jsonb_build_array('Pizzería Don Vito', 'Restaurante', 40000, 125000),
        jsonb_build_array('Droguería San Jorge', 'Otros', 12000, 85000)
      ) end;
    v_item := v_catalogo -> ((v_seed / 7) % jsonb_array_length(v_catalogo))::int;
    v_merchant := v_item ->> 0;
    v_cat_name := v_item ->> 1;
    v_min_cop := (v_item ->> 2)::bigint;
    v_max_cop := (v_item ->> 3)::bigint;
    v_total := round((v_min_cop + (v_seed / 13) % (v_max_cop - v_min_cop)) / 100.0) * 100;
    v_date := v_hoy;
    v_conf := jsonb_build_object(
      'merchant', least(0.99, v_tier + 0.04),
      'date', least(0.99, v_tier + 0.02),
      'total', v_tier,
      'category', greatest(0.5, v_tier - 0.03),
      'payer', 0.99
    );
  end if;

  -- Capa 1 de clasificación: la memoria de comercios de la cuenta
  select mm.category_id into v_memory
  from public.merchant_memory mm
  where mm.account_id = m.account_id and mm.normalized = public.normalize_merchant(v_merchant);

  if v_memory is not null then
    v_category := v_memory;
    v_conf := v_conf || jsonb_build_object('category', 0.96);
    update public.merchant_memory mm
    set hits = mm.hits + 1
    where mm.account_id = m.account_id and mm.normalized = public.normalize_merchant(v_merchant);
  else
    select c.id into v_category
    from public.categories c
    where c.account_id = m.account_id and c.name = v_cat_name;
  end if;

  select min(value::numeric) into v_min from jsonb_each_text(v_conf);

  v_desc := case (select c.name from public.categories c where c.id = v_category)
    when 'Café' then 'Coffee and bakery'
    when 'Licor' then 'Liquor'
    when 'Mercado' then 'Groceries'
    when 'Transporte' then 'Transport'
    when 'Hospedaje' then 'Lodging'
    when 'Restaurante' then 'Restaurant meal'
    when 'Servicios' then 'Utility bill'
    else 'Other expense'
  end;

  insert into public.expenses (
    account_id, merchant, merchant_normalized, description, expense_date, total_cop, category_id,
    payer_person_id, status, confidence, source, message_id, evidence_path, created_by,
    ai_snapshot, field_confidence, split_note
  )
  values (
    m.account_id, v_merchant, public.normalize_merchant(v_merchant), v_desc, v_date, coalesce(v_total, 0), v_category,
    v_payer,
    -- Capa 3: lo que la IA no leyó seguro pasa por revisión humana
    case when v_memory is not null and v_min >= 0.9 then 'confirmed' else 'pending_review' end::public.expense_status,
    round(v_min, 2), m.source, m.id, m.media_path, m.uploaded_by,
    jsonb_build_object(
      'merchant', v_merchant, 'expense_date', v_date, 'total_cop', coalesce(v_total, 0),
      'category_id', v_category, 'payer_person_id', v_payer
    ),
    v_conf, v_note
  )
  returning id into v_expense;

  -- Partes iguales entre todas las personas de la cuenta
  select array_agg(p.id order by p.created_at, p.id) into v_people
  from public.people p where p.account_id = m.account_id;
  perform public.replace_equal_split(v_expense, v_people);

  update public.messages set status = 'done', processed_at = now() where id = m.id;
  return v_expense;
end;
$$;

create or replace function public.run_simulated_worker(p_limit int default 20)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs%rowtype;
  n int := 0;
begin
  for j in
    select * from public.jobs
    where status = 'queued' and type = 'process_message' and run_at <= now()
    order by run_at
    limit p_limit
    for update skip locked
  loop
    update public.jobs
    set status = 'running', locked_at = now(), locked_by = 'simulador', attempts = attempts + 1
    where id = j.id;
    begin
      perform public.simulate_process_message((j.payload ->> 'message_id')::uuid);
      update public.jobs set status = 'done' where id = j.id;
    exception when others then
      update public.jobs set status = 'failed', last_error = sqlerrm where id = j.id;
      update public.messages set status = 'failed' where id = (j.payload ->> 'message_id')::uuid;
    end;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ============================================================================
-- review_expense: owner/admin revisa un gasto. En una sola transacción:
-- guarda los cambios (y quién corrigió), divide en partes iguales entre las
-- personas elegidas, alimenta la memoria de comercios y, si cambió la
-- categoría que puso la IA, deja un ejemplo para reentrenar a Laya.
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

  perform public.replace_equal_split(e.id, p_split_person_ids);

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

-- «No es un gasto»: se borra el gasto y el mensaje queda marcado.
create or replace function public.discard_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into e from public.expenses where id = p_expense_id;
  if not found or not public.is_account_member(e.account_id) then
    raise exception 'El gasto no existe';
  end if;
  if not public.has_account_role(e.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta descartan gastos';
  end if;

  delete from public.expenses where id = e.id;
  if e.message_id is not null then
    update public.messages set status = 'not_expense' where id = e.message_id;
  end if;
end;
$$;

-- ============================================================================
-- account_dashboard: todo lo que muestran los resúmenes, en una sola lectura.
-- Hogar: el mes pedido (o el actual) + tendencia de 6 meses + presupuestos.
-- Evento: todo el evento + lo que cada quien pagó contra lo que le toca.
-- Cuenta los gastos pendientes también (el aviso de «por revisar» los señala).
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
begin
  select * into a from public.accounts where id = p_account_id;
  if not found then
    return null;
  end if;

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
        from generate_series(v_mes - interval '5 months', v_mes::timestamp, interval '1 month') as g (mes)
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

-- ============================================================================
-- Tiempo real: la bandeja y los resúmenes se actualizan solos.
-- (Realtime respeta RLS: cada quien solo recibe los cambios de sus cuentas.)
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.expenses, public.messages;
  end if;
end;
$$;

-- ============================================================================
-- Cron del procesador simulado: cada 10 segundos procesa lo que esté en cola.
-- Solo donde exista pg_cron (Supabase); en las pruebas se llama a mano.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('lucas-procesador-simulado', '10 seconds', 'select public.run_simulated_worker()');
  end if;
end;
$$;

-- ============================================================================
-- Permisos: los RPC nuevos para authenticated; lo interno, fuera del API.
-- ============================================================================

revoke execute on all functions in schema public from public, anon;
grant execute on function public.submit_upload(uuid, public.message_kind, text, text, text, text) to authenticated;
grant execute on function public.review_expense(uuid, text, date, bigint, uuid, uuid, uuid[], boolean) to authenticated;
grant execute on function public.discard_expense(uuid) to authenticated;
grant execute on function public.account_dashboard(uuid, date) to authenticated;
grant execute on function public.try_uuid(text) to authenticated;
revoke execute on function public.simulate_process_message(uuid) from authenticated;
revoke execute on function public.run_simulated_worker(int) from authenticated;
revoke execute on function public.replace_equal_split(uuid, uuid[]) from authenticated;
revoke execute on function public.detect_payer(uuid, text) from authenticated;
grant execute on function public.run_simulated_worker(int) to service_role;
