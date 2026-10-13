-- ============================================================================
-- Lucas · 00000000000340_desde_cuando_e_importar.sql
-- Fase 6: ¿desde cuándo anoto? e importar el chat exportado.
--
--   · account_group_links.ingest_from: desde cuándo se anota lo que llega al
--     grupo. Se llena con created_at (lo de siempre) y reemplaza esa regla en
--     connector_should_ingest (el motivo sigue llamándose 'antes_del_enlace').
--   · account_group_links.history: la respuesta a «¿Desde cuándo anoto?»:
--     'pendiente' (se preguntó, nadie ha dicho), 'desde_ya' o 'todo' (que le
--     manden el chat exportado). Cualquiera del grupo la da o la cambia
--     («1»/«2» justo después de la pregunta, o «luks desde ya» / «luks lee
--     todo» cuando quiera) y Mister Luks anuncia quién lo decidió. En la web,
--     quien administra. Los grupos que ya estaban quedan en 'desde_ya'.
--   · chat_imports: cada chat exportado (.zip o .txt de «Exportar chat»), que
--     llega por WhatsApp (en el grupo, o por privado si se sabe de qué grupo
--     es) o se sube en la web (solo quien administra). Queda en el bucket
--     privado «importaciones» y lo lee el worker (trabajo 'import_chat'): solo
--     lo anterior a ingest_from, solo lo que parece gasto, y cada mensaje
--     queda con source 'import' y su import_id. La detección de repetidos del
--     worker es la red de seguridad.
--   · Lo importado va a la cola con prioridad más baja (jobs.priority): lo
--     que llega en vivo no espera detrás de un chat de meses.
--   · undo_chat_import: quien administra deshace una importación (sus gastos y
--     sus mensajes), salvo que algo de eso ya esté en una liquidación.
--   · Mister Luks no puede leer lo que se escribió antes de que lo agregaran:
--     lo de antes solo entra con el chat exportado.
-- ============================================================================

-- ============================================================================
-- Desde cuándo anota Luks en cada grupo
-- ============================================================================

alter table public.account_group_links
  add column ingest_from timestamptz,
  add column history text not null default 'pendiente' check (history in ('pendiente', 'desde_ya', 'todo')),
  add column history_by text check (length(history_by) <= 120),
  add column history_at timestamptz;

-- Los grupos que ya estaban: desde que se enlazaron, y sin preguntar
update public.account_group_links set ingest_from = created_at, history = 'desde_ya';

alter table public.account_group_links
  alter column ingest_from set default now(),
  alter column ingest_from set not null;

-- Como en la 080, con ingest_from en vez de la fecha del enlace
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
  if v_status <> 'active' then
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

-- «12 oct» / «Oct 12» (en hora de Bogotá, como el resto de Luks)
create or replace function public.dia_corto(p_ts timestamptz, p_language text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_language = 'en'
    then (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[extract(month from p_ts at time zone 'America/Bogota')::int]
         || ' ' || extract(day from p_ts at time zone 'America/Bogota')::int
    else extract(day from p_ts at time zone 'America/Bogota')::int || ' '
         || (array['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'])[extract(month from p_ts at time zone 'America/Bogota')::int]
  end
$$;

-- Mister Luks cuenta en el grupo quién decidió desde cuándo anota (si está ahí)
create or replace function public.anunciar_desde_cuando(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.account_group_links%rowtype;
  v_jid text;
  v_lang text;
  v_quien text;
begin
  select * into l from public.account_group_links where group_id = p_group_id;
  if l.group_id is null or l.history = 'pendiente' then
    return;
  end if;
  select g.wa_group_jid into v_jid from public.whatsapp_groups g where g.id = p_group_id;
  select a.language into v_lang from public.accounts a where a.id = l.account_id;
  v_quien := coalesce(nullif(btrim(l.history_by), ''), case when v_lang = 'en' then 'Someone' else 'Alguien' end);
  perform public.connector_outbox_enqueue(jsonb_build_array(jsonb_build_object(
    'chat_jid', v_jid,
    'reason', 'history',
    'group_id', p_group_id,
    'dedupe_key', 'history:' || p_group_id || ':' || l.history || ':' || to_char(l.history_at, 'YYYYMMDDHH24MI'),
    'body', case
      when l.history = 'desde_ya' and v_lang = 'en' then
        '👍 Done: ' || v_quien || ' said to log *from now on*. I won’t touch anything from before ' || public.dia_corto(l.ingest_from, 'en') || '.'
      when l.history = 'desde_ya' then
        '👍 Listo: ' || v_quien || ' dijo que anote *desde ahora*. Lo de antes del ' || public.dia_corto(l.ingest_from, 'es') || ' no lo toco.'
      when v_lang = 'en' then
        '📚 Done: ' || v_quien || ' said to read *the whole chat*. I can’t see what was written before I got here, so send me the exported chat: Group info → More → Export chat → Include media. Send it here or privately (it can also be uploaded at mrluks.com). Meanwhile I’ll keep logging what’s new 😉'
      else
        '📚 Listo: ' || v_quien || ' dijo que lea *todo el chat*. Lo de antes de que llegara no lo alcanzo a ver, así que mándenme el chat exportado: Info del grupo → Más → Exportar chat → Incluir archivos. Me lo mandan aquí o por privado (también se sube en mrluks.com). Mientras tanto sigo anotando lo nuevo 😉'
    end
  )));
end;
$$;

-- Alguien del grupo respondió (o cambió) desde cuándo anotar. p_only_pending: un «1»
-- o «2» suelto solo cuenta como respuesta si la pregunta sigue abierta (y es de
-- los últimos 3 días); «luks desde ya» o «luks lee todo» cambian cuando sea.
create or replace function public.connector_history_answer(p_jid text, p_mode text, p_name text, p_only_pending boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.account_group_links%rowtype;
begin
  if p_mode not in ('desde_ya', 'todo') then
    raise exception 'Modo desconocido: %', p_mode;
  end if;
  select x.* into l
  from public.account_group_links x
  join public.whatsapp_groups g on g.id = x.group_id
  join public.accounts a on a.id = x.account_id
  where g.wa_group_jid = p_jid and a.status = 'active'
  for update of x;
  if l.group_id is null then
    return jsonb_build_object('changed', false, 'reason', 'grupo_sin_enlazar');
  end if;
  if p_only_pending and (l.history <> 'pendiente' or l.created_at < now() - interval '3 days') then
    return jsonb_build_object('changed', false, 'reason', 'ya_respondida');
  end if;
  if l.history = p_mode then
    return jsonb_build_object('changed', false, 'reason', 'igual', 'mode', p_mode);
  end if;
  update public.account_group_links
  set history = p_mode, history_by = left(nullif(btrim(public.nombre_de_whatsapp(p_name)), ''), 120), history_at = now()
  where group_id = l.group_id;
  perform public.anunciar_desde_cuando(l.group_id);
  return jsonb_build_object('changed', true, 'mode', p_mode);
end;
$$;

-- Lo mismo desde la web (quien administra la cuenta)
create or replace function public.set_group_history(p_group_id uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_nombre text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if p_mode not in ('desde_ya', 'todo') then
    raise exception 'Elige desde ahora o todo el chat';
  end if;
  select l.account_id into v_account from public.account_group_links l where l.group_id = p_group_id;
  if v_account is null or not public.has_account_role(v_account, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta cambian esto';
  end if;
  select split_part(btrim(coalesce(pp.display_name, pr.full_name, '')), ' ', 1) into v_nombre
  from public.profiles pr
  left join public.people pp on pp.account_id = v_account and pp.claimed_by = pr.id
  where pr.id = auth.uid();
  update public.account_group_links
  set history = p_mode, history_by = left(nullif(v_nombre, ''), 120), history_at = now()
  where group_id = p_group_id and history <> p_mode;
  if found then
    perform public.anunciar_desde_cuando(p_group_id);
  end if;
end;
$$;

-- «luks CÓDIGO» (como en la 290): al enlazar, el grupo queda con la pregunta abierta
-- (el connector la hace en el mensaje de «¡Listo!»). Sin cambios: la columna
-- history nace en 'pendiente'.

-- Como en la 330, con la pregunta «¿Desde cuándo anoto?» al final del «¡Listo!»
create or replace function public.conectar_grupo(p_group_id uuid, p_account_id uuid, p_uid uuid, p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.whatsapp_groups%rowtype;
  a public.accounts%rowtype;
  v_n int;
begin
  select * into g from public.whatsapp_groups where id = p_group_id;
  select * into a from public.accounts where id = p_account_id;
  insert into public.account_group_links (group_id, account_id, linked_by)
  values (p_group_id, p_account_id, p_uid);
  if p_link_id is not null then
    update public.group_links set used_at = now(), used_by = p_uid where id = p_link_id;
  end if;

  -- Si Mister Luks está, ya se sabe quién está en el grupo
  if exists (select 1 from public.whatsapp_group_members m where m.group_id = p_group_id and m.left_at is null) then
    perform public.sync_group_people(p_group_id);
    update public.account_group_links set members_synced_at = now() where group_id = p_group_id;
  end if;

  v_n := public.group_member_count(p_group_id);
  -- Como MSG.linked del connector (y así es_mensaje_de_luks lo reconoce)
  perform public.connector_outbox_enqueue(jsonb_build_array(jsonb_build_object(
    'chat_jid', g.wa_group_jid,
    'reason', 'link',
    'group_id', p_group_id,
    'dedupe_key', 'link:' || p_group_id || ':' || p_account_id,
    'body', case when a.language = 'en' then
      '🎉 Done! This group is now connected to “' || a.name || '”'
        || case when v_n > 0 then ' and its ' || v_n || ' members are already in the account 🙌' else '' end || '.'
        || E'\n\nSend receipt photos, PDFs or messages with the amount (for example “airport taxi $45”) and I’ll log them ✅'
        || E'\n\n🗓️ Since when do I log? Reply *1* for *from now on* or *2* for *the whole chat* (you send it to me exported).'
    else
      '🎉 ¡Listo! Este grupo quedó conectado a «' || a.name || '»'
        || case when v_n > 0 then ' y sus ' || v_n || ' integrantes ya están en la cuenta 🙌' else '' end || '.'
        || E'\n\nManden fotos de recibos, PDFs o mensajes con el monto (por ejemplo «taxi al aeropuerto 45 lucas») y yo los anoto ✅'
        || E'\n\n🗓️ ¿Desde cuándo anoto? Respondan *1* para *desde ahora* o *2* para *todo el chat* (me lo mandan exportado).'
    end
  )));
end;
$$;

-- ============================================================================
-- Importar el chat exportado
-- ============================================================================

-- Lo que llega desde un chat exportado: de un grupo, con su id dentro del chat («import:…»)
alter table public.messages drop constraint messages_source_check;
alter table public.messages add constraint messages_source_check check (source in ('whatsapp', 'web', 'import'));
alter table public.messages drop constraint messages_origen;
alter table public.messages add constraint messages_origen check (
  (source = 'whatsapp' and group_id is not null and wa_message_id is not null)
  or (source = 'web' and group_id is null and uploaded_by is not null)
  or (source = 'import' and group_id is not null and wa_message_id like 'import:%')
);

create table public.chat_imports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  group_id uuid not null references public.whatsapp_groups (id) on delete cascade,
  source text not null check (source in ('web', 'whatsapp')),
  -- En el bucket «importaciones»
  file_path text not null check (length(file_path) <= 300),
  file_name text check (length(file_name) <= 200),
  -- Por WhatsApp: el mensaje que lo trajo (no se importa dos veces) y quién lo mandó
  wa_message_id text,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_name text check (length(requested_name) <= 120),
  -- Solo lo anterior a esto (el ingest_from del grupo al pedirlo)
  before_ts timestamptz not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'failed', 'undone')),
  stats jsonb not null default '{}'::jsonb,
  error text check (length(error) <= 500),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  undone_at timestamptz,
  undone_by uuid references public.profiles (id) on delete set null,
  unique (group_id, wa_message_id)
);

create index chat_imports_cuenta_idx on public.chat_imports (account_id, created_at desc);

alter table public.chat_imports enable row level security;
alter table public.chat_imports force row level security;
revoke all on public.chat_imports from anon, authenticated;
grant select, insert, update, delete on public.chat_imports to service_role;

alter table public.messages add column import_id uuid references public.chat_imports (id) on delete set null;
create index messages_importacion_idx on public.messages (import_id) where import_id is not null;

-- Lo de un chat de meses no se cuela delante de lo que llega en vivo
alter table public.jobs add column priority smallint not null default 0;

-- Bucket privado para los chats exportados. Ruta desde la web: {account_id}/{archivo};
-- desde WhatsApp la pone el connector (service role). Hasta 50 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('importaciones', 'importaciones', false, 52428800,
        array['application/zip', 'application/x-zip-compressed', 'application/octet-stream', 'text/plain'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy importaciones_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'importaciones'
    and public.has_account_role(public.try_uuid((storage.foldername(objects.name))[1]), array['owner', 'admin']::public.member_role[])
    and exists (
      select 1 from public.accounts a
      where a.id = public.try_uuid((storage.foldername(objects.name))[1]) and a.status = 'active'
    )
  );

create policy importaciones_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'importaciones'
    and public.has_account_role(public.try_uuid((storage.foldername(objects.name))[1]), array['owner', 'admin']::public.member_role[])
  );

-- Crea la importación y su trabajo
create or replace function public.nueva_importacion(
  p_group_id uuid,
  p_source text,
  p_path text,
  p_file_name text,
  p_wa_message_id text,
  p_requested_by uuid,
  p_requested_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.account_group_links%rowtype;
  v_id uuid;
begin
  select * into l from public.account_group_links where group_id = p_group_id for update;
  insert into public.chat_imports (account_id, group_id, source, file_path, file_name, wa_message_id, requested_by, requested_name, before_ts)
  values (l.account_id, p_group_id, p_source, p_path, left(p_file_name, 200), p_wa_message_id, p_requested_by,
          left(nullif(btrim(p_requested_name), ''), 120), l.ingest_from)
  on conflict (group_id, wa_message_id) do nothing
  returning id into v_id;
  if v_id is null then
    return null;
  end if;
  insert into public.jobs (type, payload, priority) values ('import_chat', jsonb_build_object('import_id', v_id), 0);
  -- Mandar el chat es decir «todo el chat»
  update public.account_group_links set history = 'todo', history_by = left(nullif(btrim(p_requested_name), ''), 120), history_at = now()
  where group_id = p_group_id and history = 'pendiente';
  return v_id;
end;
$$;

-- Desde la web: quien administra la cuenta sube el .zip o el .txt (ya en el bucket)
create or replace function public.request_chat_import(p_account_id uuid, p_group_id uuid, p_path text, p_file_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid := p_group_id;
  v_nombre text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta importan el chat';
  end if;
  if exists (select 1 from public.accounts a where a.id = p_account_id and a.status <> 'active') then
    raise exception 'La cuenta está cerrada: ya no recibe gastos';
  end if;
  if p_path is null or p_path not like p_account_id::text || '/%' then
    raise exception 'Ese archivo no es de esta cuenta';
  end if;
  if v_group is null then
    select l.group_id into v_group from public.account_group_links l where l.account_id = p_account_id;
    if (select count(*) from public.account_group_links l where l.account_id = p_account_id) > 1 then
      raise exception 'Elige de qué grupo es el chat';
    end if;
  end if;
  if v_group is null or not exists (select 1 from public.account_group_links l where l.group_id = v_group and l.account_id = p_account_id) then
    raise exception 'Primero conecta el grupo a la cuenta';
  end if;
  select split_part(btrim(coalesce(pp.display_name, pr.full_name, '')), ' ', 1) into v_nombre
  from public.profiles pr
  left join public.people pp on pp.account_id = p_account_id and pp.claimed_by = pr.id
  where pr.id = auth.uid();
  return public.nueva_importacion(v_group, 'web', p_path, p_file_name, null, auth.uid(), v_nombre);
end;
$$;

-- Desde WhatsApp, en el grupo: alguien mandó el chat exportado (el connector ya lo subió)
create or replace function public.connector_request_import(
  p_jid text,
  p_path text,
  p_file_name text,
  p_wa_message_id text,
  p_sender_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_lang text;
  v_id uuid;
begin
  select g.id, a.language into v_group, v_lang
  from public.whatsapp_groups g
  join public.account_group_links l on l.group_id = g.id
  join public.accounts a on a.id = l.account_id
  where g.wa_group_jid = p_jid and a.status = 'active';
  if v_group is null then
    return jsonb_build_object('ok', false, 'reason', 'grupo_sin_enlazar');
  end if;
  v_id := public.nueva_importacion(v_group, 'whatsapp', p_path, p_file_name, p_wa_message_id, null, public.nombre_de_whatsapp(p_sender_name));
  return jsonb_build_object('ok', true, 'already', v_id is null, 'import_id', v_id, 'language', v_lang);
end;
$$;

-- Por privado: de cuál de sus grupos es. Los grupos conectados donde está quien lo
-- manda; si el nombre del archivo trae el del grupo («Chat de WhatsApp con
-- Paseo.zip»), el de ese nombre. Solo si queda uno.
create or replace function public.connector_request_import_private(
  p_path text,
  p_file_name text,
  p_wa_message_id text,
  p_sender_phone text,
  p_sender_lid text,
  p_sender_name text,
  p_chat_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identidad uuid := public.wa_identidad(coalesce(p_sender_phone, 'lid:' || p_sender_lid), p_sender_phone, p_sender_lid, null);
  v_grupos uuid[];
  v_nombres text[];
  v_id uuid;
  v_group uuid;
  v_lang text;
  v_norm text := public.normalizar_nombre(p_chat_name);
begin
  select array_agg(g.id order by g.name), array_agg(g.name order by g.name) into v_grupos, v_nombres
  from public.whatsapp_groups g
  join public.account_group_links l on l.group_id = g.id
  join public.accounts a on a.id = l.account_id and a.status = 'active'
  where exists (
      select 1 from public.whatsapp_group_members m
      where m.group_id = g.id and m.left_at is null and m.identity_id = v_identidad
    )
    and (v_norm is null or public.normalizar_nombre(g.name) = v_norm);
  if coalesce(cardinality(v_grupos), 0) <> 1 then
    return jsonb_build_object('ok', false, 'reason', case when coalesce(cardinality(v_grupos), 0) = 0 then 'sin_grupo' else 'varios' end,
                              'groups', coalesce(to_jsonb(v_nombres[1:5]), '[]'::jsonb));
  end if;
  v_group := v_grupos[1];
  select a.language into v_lang from public.account_group_links l join public.accounts a on a.id = l.account_id where l.group_id = v_group;
  v_id := public.nueva_importacion(v_group, 'whatsapp', p_path, p_file_name, p_wa_message_id, null, public.nombre_de_whatsapp(p_sender_name));
  return jsonb_build_object('ok', true, 'already', v_id is null, 'import_id', v_id, 'group_name', v_nombres[1], 'language', v_lang);
end;
$$;

-- «Christian Mora», «Vale 🌻», «+57 300 123 4567»: el nombre con que sale alguien en
-- el chat exportado (como lo tiene guardado quien lo exportó) → la persona de la
-- cuenta, si es una sola: por su número, por su nombre en Luks o por su nombre de
-- WhatsApp (en el grupo o en lo que ya mandó)
create or replace function public.normalizar_nombre(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(regexp_replace(translate(lower(coalesce(p, '')), 'áéíóúüñàèìòù', 'aeiouunaeiou'),
                                                    '[^[:alnum:][:space:]]', '', 'g'), '\s+', ' ', 'g')), '')
$$;

create or replace function public.persona_por_nombre(p_account_id uuid, p_group_id uuid, p_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_digitos text := regexp_replace(coalesce(p_name, ''), '[^0-9]', '', 'g');
  v_norm text := public.normalizar_nombre(p_name);
  v_ids uuid[];
begin
  -- Un número (quien exportó no tenía a esa persona guardada)
  if coalesce(p_name, '') ~ '^[\s+0-9()\-‎‪‬]+$' and length(v_digitos) between 8 and 15 then
    if length(v_digitos) = 10 and left(v_digitos, 1) = '3' then
      v_digitos := '57' || v_digitos;
    end if;
    return public.wa_person(p_account_id, v_digitos);
  end if;
  if v_norm is null then
    return null;
  end if;
  select array_agg(distinct x.id) into v_ids
  from (
    select p.id from public.people p
    where p.account_id = p_account_id and public.normalizar_nombre(p.display_name) = v_norm
    union
    select p.id
    from public.whatsapp_group_members m
    join public.person_whatsapp_ids w on w.wa_id = m.wa_id
    join public.people p on p.id = w.person_id and p.account_id = p_account_id
    where m.group_id = p_group_id and public.normalizar_nombre(m.name) = v_norm
    union
    select p.id
    from public.whatsapp_senders s
    join public.person_whatsapp_ids w on w.wa_id = s.wa_id
    join public.people p on p.id = w.person_id and p.account_id = p_account_id
    where s.account_id = p_account_id and public.normalizar_nombre(s.push_name) = v_norm
  ) x;
  return case when cardinality(v_ids) = 1 then v_ids[1] end;
end;
$$;

-- ============================================================================
-- Lo que usa el worker (trabajo 'import_chat')
-- ============================================================================

-- La importación a leer (y queda «leyéndose»)
create or replace function public.worker_import_context(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.chat_imports%rowtype;
  a public.accounts%rowtype;
begin
  update public.chat_imports set status = 'processing'
  where id = p_import_id and status in ('queued', 'processing', 'failed')
  returning * into i;
  if i.id is null then
    return null;
  end if;
  select * into a from public.accounts where id = i.account_id;
  return jsonb_build_object(
    'import', jsonb_build_object('id', i.id, 'account_id', i.account_id, 'group_id', i.group_id, 'source', i.source,
                                 'file_path', i.file_path, 'file_name', i.file_name, 'before', i.before_ts),
    'account', jsonb_build_object('id', a.id, 'status', a.status, 'currency', a.currency, 'language', a.language)
  );
end;
$$;

-- Una tanda de mensajes del chat: cada uno queda en la cola (con prioridad baja).
-- p_items = [{"key": "…", "sender": "Vale", "kind": "text" | "photo" | "pdf",
--             "text": "…", "media_path": "{cuenta}/import/…", "file_name": "…",
--             "mime_type": "…", "sent_at": "2026-09-25T10:11:00-05:00"}, …]
-- «key» identifica el mensaje dentro del chat: importar dos veces el mismo chat no repite nada.
create or replace function public.worker_import_messages(p_import_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.chat_imports%rowtype;
  x jsonb;
  v_sent timestamptz;
  v_person uuid;
  v_message uuid;
  v_nuevos int := 0;
  v_conocidos int := 0;
  v_fuera int := 0;
  v_luks int := 0;
begin
  select * into i from public.chat_imports where id = p_import_id and status = 'processing';
  if i.id is null then
    raise exception 'Esa importación no se está leyendo';
  end if;
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_sent := (x ->> 'sent_at')::timestamptz;
    -- Solo lo de antes de que Luks empezara a anotar (lo de después ya entró en vivo)
    if v_sent is null or v_sent >= i.before_ts - interval '2 minutes' then
      v_fuera := v_fuera + 1;
      continue;
    end if;
    if public.es_mensaje_de_luks(x ->> 'text') then
      v_luks := v_luks + 1;
      continue;
    end if;
    if (x ->> 'kind') <> 'text' and coalesce(x ->> 'media_path', '') not like i.account_id::text || '/%' then
      continue;
    end if;
    if (x ->> 'kind') = 'text' and nullif(btrim(x ->> 'text'), '') is null then
      continue;
    end if;
    v_person := public.persona_por_nombre(i.account_id, i.group_id, x ->> 'sender');

    insert into public.messages (
      account_id, group_id, source, import_id, wa_message_id, sender_name, sender_person_id,
      kind, text_body, media_path, file_name, mime_type, received_at
    )
    values (
      i.account_id, i.group_id, 'import', i.id, 'import:' || left(x ->> 'key', 120), left(public.nombre_de_whatsapp(x ->> 'sender'), 120), v_person,
      (x ->> 'kind')::public.message_kind, left(nullif(btrim(x ->> 'text'), ''), 4000), x ->> 'media_path',
      left(x ->> 'file_name', 120), x ->> 'mime_type', v_sent
    )
    on conflict (group_id, wa_message_id) do nothing
    returning id into v_message;
    if v_message is null then
      continue;
    end if;
    insert into public.jobs (type, payload, priority)
    values ('process_message', jsonb_build_object('message_id', v_message, 'account_id', i.account_id), -1);
    v_nuevos := v_nuevos + 1;
    if v_person is not null then
      v_conocidos := v_conocidos + 1;
    end if;
    v_message := null;
  end loop;
  return jsonb_build_object('inserted', v_nuevos, 'known_sender', v_conocidos, 'after', v_fuera, 'luks', v_luks);
end;
$$;

-- Terminó de leerlo (bien o con error). Si llegó por WhatsApp, Mister Luks lo cuenta en el grupo.
create or replace function public.worker_finish_import(p_import_id uuid, p_stats jsonb, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.chat_imports%rowtype;
  v_jid text;
  v_lang text;
  v_n int;
begin
  update public.chat_imports
  set status = case when p_error is null then 'done' else 'failed' end,
      stats = coalesce(p_stats, '{}'::jsonb), error = left(p_error, 500), finished_at = now()
  where id = p_import_id and status = 'processing'
  returning * into i;
  if i.id is null or i.source <> 'whatsapp' then
    return;
  end if;
  select g.wa_group_jid into v_jid from public.whatsapp_groups g where g.id = i.group_id;
  select a.language into v_lang from public.accounts a where a.id = i.account_id;
  v_n := coalesce((i.stats ->> 'inserted')::int, 0);
  perform public.connector_outbox_enqueue(jsonb_build_array(jsonb_build_object(
    'chat_jid', v_jid,
    'reason', 'import',
    'group_id', i.group_id,
    'dedupe_key', 'import:' || i.id,
    'body', case
      when p_error is not null and v_lang = 'en' then
        '🤔 I couldn’t read that file: ' || left(p_error, 200) || E'\n\nExport it again (Group info → More → Export chat → Include media) and send it to me.'
      when p_error is not null then
        '🤔 No pude leer ese archivo: ' || left(p_error, 200) || E'\n\nExpórtenlo otra vez (Info del grupo → Más → Exportar chat → Incluir archivos) y me lo mandan.'
      when v_lang = 'en' then
        '📥 I read the exported chat: ' || case when v_n = 1 then 'I found 1 expense' when v_n > 1 then 'I found ' || v_n || ' expenses' else 'I didn’t find any expenses' end
          || ' from before ' || public.dia_corto(i.before_ts, 'en') || '.'
          || case when v_n > 0 then ' I’m logging them now and they’ll be in Luks for review 👀' else '' end
      else
        '📥 Leí el chat exportado: ' || case when v_n = 1 then 'encontré 1 gasto' when v_n > 1 then 'encontré ' || v_n || ' gastos' else 'no encontré gastos' end
          || ' de antes del ' || public.dia_corto(i.before_ts, 'es') || '.'
          || case when v_n > 0 then ' Los voy anotando y quedan en Luks para revisar 👀' else '' end
    end
  )));
end;
$$;

-- Como en la 070: también toma las importaciones, y lo de prioridad más alta primero
create or replace function public.worker_claim_jobs(
  p_worker text,
  p_limit int default 1,
  p_stale_after interval default interval '15 minutes'
)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs%rowtype;
begin
  -- 1. Trabajos que un worker tomó y nunca soltó (se reinició, se quedó sin
  --    memoria…). Cuentan como un intento fallido.
  for j in
    select * from public.jobs
    where status = 'running' and locked_at < now() - p_stale_after
    for update skip locked
  loop
    insert into public.job_errors (job_id, message_id, attempt, worker, error, retryable)
    values (
      j.id, public.try_uuid(j.payload ->> 'message_id'), j.attempts, j.locked_by,
      'El worker no terminó el trabajo en ' || p_stale_after::text, j.attempts < j.max_attempts
    );
    update public.jobs
    set status = case when j.attempts < j.max_attempts then 'queued' else 'failed' end::public.job_status,
        last_error = 'El worker no terminó el trabajo',
        locked_at = null, locked_by = null, run_at = now()
    where id = j.id;
    update public.messages
    set status = case when j.attempts < j.max_attempts then 'queued' else 'failed' end
    where id = public.try_uuid(j.payload ->> 'message_id') and status = 'processing';
  end loop;

  -- 2. Los siguientes en la cola
  for j in
    with siguientes as (
      select id from public.jobs
      where status = 'queued' and type in ('process_message', 'import_chat') and run_at <= now()
      order by priority desc, run_at, created_at
      limit greatest(1, least(p_limit, 50))
      for update skip locked
    )
    update public.jobs x
    set status = 'running', locked_at = now(), locked_by = left(p_worker, 120), attempts = x.attempts + 1
    from siguientes s
    where x.id = s.id
    returning x.*
  loop
    update public.messages
    set status = 'processing'
    where id = public.try_uuid(j.payload ->> 'message_id') and status in ('queued', 'failed');
    return next j;
  end loop;
end;
$$;

-- ============================================================================
-- Lo que ve la web
-- ============================================================================

-- Desde cuándo anota cada grupo de la cuenta y sus importaciones
create or replace function public.account_history(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  return jsonb_build_object(
    'is_admin', public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'group_id', g.id, 'name', g.name, 'history', l.history, 'history_by', l.history_by, 'history_at', l.history_at,
        'ingest_from', l.ingest_from,
        'mister_luks', exists (
          select 1 from public.whatsapp_group_sessions s join public.whatsapp_connections c on c.id = s.connection_id
          where s.group_id = g.id and s.left_at is null and c.kind = 'contador'
        )
      ) order by l.created_at)
      from public.account_group_links l
      join public.whatsapp_groups g on g.id = l.group_id
      where l.account_id = p_account_id
    ), '[]'::jsonb),
    'imports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'group_name', g.name, 'source', i.source, 'file_name', i.file_name, 'requested_name', i.requested_name,
        'status', i.status, 'stats', i.stats, 'error', i.error, 'before', i.before_ts,
        'created_at', i.created_at, 'finished_at', i.finished_at, 'undone_at', i.undone_at,
        'messages', (select count(*) from public.messages m where m.import_id = i.id),
        'expenses', (select count(*) from public.expenses e join public.messages m on m.id = e.message_id where m.import_id = i.id)
      ) order by i.created_at desc)
      from public.chat_imports i
      join public.whatsapp_groups g on g.id = i.group_id
      where i.account_id = p_account_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Deshacer una importación: se van sus gastos y sus mensajes (los archivos se quedan en
-- el bucket). No si algo de eso ya quedó en una liquidación.
create or replace function public.undo_chat_import(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.chat_imports%rowtype;
  v_gastos int;
  v_mensajes int;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into i from public.chat_imports where id = p_import_id for update;
  if i.id is null or not public.has_account_role(i.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta deshacen una importación';
  end if;
  if i.status = 'undone' then
    raise exception 'Esa importación ya se deshizo';
  end if;
  if i.status in ('queued', 'processing') then
    raise exception 'Luks todavía está leyendo ese chat: espera a que termine';
  end if;
  if exists (select 1 from public.accounts a where a.id = i.account_id and a.status <> 'active') then
    raise exception 'La cuenta está cerrada o liquidándose: reábranla antes de deshacer';
  end if;
  if exists (
    select 1
    from public.expenses e
    join public.messages m on m.id = e.message_id and m.import_id = i.id
    join public.settlements s on s.account_id = i.account_id
      and (s.period is null or s.period = date_trunc('month', e.expense_date)::date)
  ) then
    raise exception 'Algunos de esos gastos ya están en una liquidación: reábranla antes de deshacer';
  end if;

  -- Lo que todavía estaba en la cola ya no se procesa
  update public.jobs j set status = 'done', last_error = 'Se deshizo la importación'
  where j.type = 'process_message' and j.status in ('queued', 'failed')
    and public.try_uuid(j.payload ->> 'message_id') in (select m.id from public.messages m where m.import_id = i.id);

  delete from public.expenses e
  using public.messages m
  where m.id = e.message_id and m.import_id = i.id;
  get diagnostics v_gastos = row_count;
  delete from public.messages m where m.import_id = i.id;
  get diagnostics v_mensajes = row_count;

  update public.chat_imports set status = 'undone', undone_at = now(), undone_by = auth.uid() where id = i.id;
  return jsonb_build_object('expenses', v_gastos, 'messages', v_mensajes);
end;
$$;

-- Lo que escribe Luks no es un gasto (como en la 290), con los avisos nuevos: quién
-- decidió desde cuándo anotar y cuántos gastos traía el chat importado
create or replace function public.es_mensaje_de_luks(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~* '(esto se hizo en mrluks\.com|made with mrluks\.com|cuentas hechas con luks|hecho con luks|(mrluks\.com|\.vercel\.app)/r/[A-Za-z0-9_-]{20,64})'
      or coalesce(p_text, '') ~* '^\s*\W{0,4}\s*(anotad[oa]s?|recibido|ya estaba anotado|logged|received|already logged)[\s:].*·\s*(\$|bs\s?)\d'
      or coalesce(p_text, '') ~* '(soy|i[’'']m) \*?mister luks|(listo[:!]?|done[:!]?)\s*(este grupo quedó conectado|this group is now connected)'
      or coalesce(p_text, '') ~* 'dijo que (anote|lea)\M|said to (log|read)\M|le[ií] el chat exportado|i read the exported chat'
$$;

-- La bandeja de Mister Luks: dos motivos nuevos
alter table public.whatsapp_outbox drop constraint whatsapp_outbox_reason_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_reason_check
  check (reason in ('welcome', 'group_hello', 'guide', 'invite', 'link', 'verify', 'soy_yo', 'history', 'import'));

-- ============================================================================
-- Permisos
-- ============================================================================

revoke execute on function public.dia_corto(timestamptz, text) from public, anon, authenticated;
revoke execute on function public.anunciar_desde_cuando(uuid) from public, anon, authenticated;
revoke execute on function public.connector_history_answer(text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.nueva_importacion(uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.connector_request_import(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.connector_request_import_private(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.normalizar_nombre(text) from public, anon, authenticated;
revoke execute on function public.persona_por_nombre(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.worker_import_context(uuid) from public, anon, authenticated;
revoke execute on function public.worker_import_messages(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.worker_finish_import(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.set_group_history(uuid, text) from public, anon;
revoke execute on function public.request_chat_import(uuid, uuid, text, text) from public, anon;
revoke execute on function public.account_history(uuid) from public, anon;
revoke execute on function public.undo_chat_import(uuid) from public, anon;

grant execute on function public.connector_history_answer(text, text, text, boolean) to service_role;
grant execute on function public.connector_request_import(text, text, text, text, text) to service_role;
grant execute on function public.connector_request_import_private(text, text, text, text, text, text, text) to service_role;
grant execute on function public.worker_import_context(uuid) to service_role;
grant execute on function public.worker_import_messages(uuid, jsonb) to service_role;
grant execute on function public.worker_finish_import(uuid, jsonb, text) to service_role;
grant execute on function public.set_group_history(uuid, text) to authenticated;
grant execute on function public.request_chat_import(uuid, uuid, text, text) to authenticated;
grant execute on function public.account_history(uuid) to authenticated;
grant execute on function public.undo_chat_import(uuid) to authenticated;
