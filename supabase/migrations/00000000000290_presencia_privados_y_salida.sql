-- ============================================================================
-- Lucas · 00000000000290_presencia_privados_y_salida.sql
-- Mister Luks (el número contador) y los WhatsApp vinculados pueden estar en el
-- mismo grupo sin pisarse; Mister Luks atiende chats privados, y todo lo que
-- escribe que no es la confirmación de un recibo pasa por una bandeja de salida.
--
--   · whatsapp_group_sessions: qué sesión está en qué grupo y desde cuándo.
--     whatsapp_groups.connection_id queda como «quién lo lee principalmente»:
--     Mister Luks si está; si no, el WhatsApp vinculado que llegó primero.
--     whatsapp_groups.left_at: ya no lo lee ninguna sesión.
--   · whatsapp_groups.chat_kind: 'grupo' o 'privado'. Un chat privado con
--     Mister Luks se guarda como un «grupo» con el JID del chat, sin nombre: así
--     queda constancia de que esa persona le escribió primero. Nunca se enlaza
--     a una cuenta y sus mensajes no se guardan.
--   · whatsapp_outbox: la bienvenida, el saludo del grupo, la guía y las
--     respuestas a los links de grupo y a «luks CÓDIGO». dedupe_key es única:
--     lo mismo no se manda dos veces. A un chat privado solo si esa persona
--     escribió primero.
--   · es_mensaje_de_luks también reconoce los saludos de Mister Luks (traen
--     montos de ejemplo): un WhatsApp vinculado en el mismo grupo no los anota.
--   · El saludo va en todo grupo nuevo de Mister Luks (antes solo en los que no
--     tenían cuenta). connector_group_hello lo marca y dice quiénes del grupo
--     ya usan Luks, para nombrarlos en el saludo.
-- ============================================================================

-- ============================================================================
-- Presencia de cada sesión en cada grupo
-- ============================================================================

create table public.whatsapp_group_sessions (
  group_id uuid not null references public.whatsapp_groups (id) on delete cascade,
  connection_id uuid not null references public.whatsapp_connections (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (group_id, connection_id)
);

create index whatsapp_group_sessions_conexion_idx on public.whatsapp_group_sessions (connection_id) where left_at is null;

alter table public.whatsapp_group_sessions enable row level security;
alter table public.whatsapp_group_sessions force row level security;
revoke all on public.whatsapp_group_sessions from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_group_sessions to service_role;

-- Lo que ya había: cada grupo con la sesión que lo leía
insert into public.whatsapp_group_sessions (group_id, connection_id, joined_at, left_at)
select g.id, g.connection_id, g.joined_at, g.left_at
from public.whatsapp_groups g;

alter table public.whatsapp_groups
  add column chat_kind text not null default 'grupo' check (chat_kind in ('grupo', 'privado'));

-- Quién lee el grupo principalmente: Mister Luks si está, si no el primero que llegó
create or replace function public.lector_principal(p_group_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.connection_id
  from public.whatsapp_group_sessions s
  join public.whatsapp_connections c on c.id = s.connection_id
  where s.group_id = p_group_id and s.left_at is null
  order by (c.kind = 'contador') desc, s.joined_at
  limit 1
$$;

-- Una sesión está en este grupo. Devuelve el grupo, su cuenta (si está enlazado), el
-- idioma de la cuenta y si toca saludar (lo hace Mister Luks, una vez por grupo).
create or replace function public.connector_upsert_group(
  p_connection_id uuid,
  p_jid text,
  p_name text,
  p_participants int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.whatsapp_groups%rowtype;
  v_account uuid;
  v_name text;
  v_language text;
begin
  insert into public.whatsapp_groups (connection_id, wa_group_jid, name, participants_count)
  values (p_connection_id, p_jid, left(p_name, 200), p_participants)
  on conflict (wa_group_jid) do update
    set name = coalesce(excluded.name, public.whatsapp_groups.name),
        participants_count = coalesce(excluded.participants_count, public.whatsapp_groups.participants_count),
        left_at = null
  returning * into g;

  insert into public.whatsapp_group_sessions as s (group_id, connection_id)
  values (g.id, p_connection_id)
  on conflict (group_id, connection_id) do update
    set joined_at = case when s.left_at is not null then now() else s.joined_at end,
        left_at = null;

  -- Que lo lea otra sesión no le quita el grupo a Mister Luks
  update public.whatsapp_groups set connection_id = public.lector_principal(g.id)
  where id = g.id
  returning * into g;

  select l.account_id, a.name, a.language into v_account, v_name, v_language
  from public.account_group_links l join public.accounts a on a.id = l.account_id
  where l.group_id = g.id;

  return jsonb_build_object(
    'group_id', g.id, 'account_id', v_account, 'account_name', v_name, 'language', v_language,
    'say_hello', g.hello_sent_at is null
  );
end;
$$;

-- Sacaron a una sesión del grupo (o se salió): el grupo sigue con las demás
create or replace function public.connector_group_left(p_jid text, p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_lector uuid;
begin
  select id into v_group from public.whatsapp_groups where wa_group_jid = p_jid;
  if v_group is null then
    return;
  end if;
  update public.whatsapp_group_sessions set left_at = now()
  where group_id = v_group and connection_id = p_connection_id and left_at is null;

  v_lector := public.lector_principal(v_group);
  update public.whatsapp_groups
  set connection_id = coalesce(v_lector, connection_id),
      left_at = case when v_lector is null then coalesce(left_at, now()) else null end
  where id = v_group;
end;
$$;

-- La regla de la 280, con la presencia: el grupo es de una cuenta o Mister Luks está en él
create or replace function public.grupo_guarda_integrantes(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.account_group_links l where l.group_id = p_group_id)
      or exists (
        select 1
        from public.whatsapp_group_sessions s
        join public.whatsapp_connections c on c.id = s.connection_id
        where s.group_id = p_group_id and s.left_at is null and c.kind = 'contador'
      )
$$;

-- Mister Luks saluda una sola vez en cada grupo: lo marca y dice con qué saludar.
-- La cuenta (si el grupo ya es de una) y quiénes del grupo ya usan Luks, por su
-- primer nombre (nunca el número). En un grupo con cuenta, sus personas con
-- usuario que están en el grupo; sin cuenta, quien tiene su WhatsApp vinculado a
-- Luks (ese número es suyo de verdad).
create or replace function public.connector_group_hello(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.whatsapp_groups%rowtype;
  v_account uuid;
  v_name text;
  v_language text;
  v_usuarios text[];
begin
  update public.whatsapp_groups set hello_sent_at = now()
  where id = p_group_id and hello_sent_at is null
  returning * into g;
  if g.id is null then
    return jsonb_build_object('say_hello', false);
  end if;

  select l.account_id, a.name, a.language into v_account, v_name, v_language
  from public.account_group_links l join public.accounts a on a.id = l.account_id
  where l.group_id = g.id;

  if v_account is not null then
    select array_agg(x.n order by x.n) into v_usuarios
    from (
      select distinct split_part(btrim(p.display_name), ' ', 1) as n
      from public.people p
      join public.person_whatsapp_ids w on w.person_id = p.id
      join public.whatsapp_group_members m on m.group_id = g.id and m.left_at is null and m.wa_id = w.wa_id
      where p.account_id = v_account and p.claimed_by is not null
      limit 6
    ) x;
  else
    select array_agg(x.n order by x.n) into v_usuarios
    from (
      select distinct split_part(btrim(pr.full_name), ' ', 1) as n
      from public.whatsapp_group_members m
      join public.whatsapp_connections c
        on c.kind = 'personal' and c.phone_number is not null and c.phone_number in (m.phone, m.wa_id)
      join public.profiles pr on pr.id = c.owner_id
      where m.group_id = g.id and m.left_at is null and nullif(btrim(pr.full_name), '') is not null
      limit 6
    ) x;
  end if;

  return jsonb_build_object(
    'say_hello', true, 'account_name', v_name, 'language', v_language,
    'luks_users', coalesce(to_jsonb(v_usuarios), '[]'::jsonb)
  );
end;
$$;

-- ============================================================================
-- Chats privados con Mister Luks
-- ============================================================================

-- Alguien le escribió por privado a Mister Luks: queda el chat (sin nombre ni mensajes)
create or replace function public.connector_private_chat(p_connection_id uuid, p_jid text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.whatsapp_connections where id = p_connection_id and kind = 'contador') then
    raise exception 'Solo Mister Luks atiende chats privados';
  end if;
  if p_jid !~ '^([0-9]{6,20}@s\.whatsapp\.net|[0-9]{6,30}@lid)$' then
    raise exception 'No es un chat privado: %', p_jid;
  end if;

  insert into public.whatsapp_groups (connection_id, wa_group_jid, chat_kind, last_message_at)
  values (p_connection_id, p_jid, 'privado', now())
  on conflict (wa_group_jid) do update set last_message_at = now(), left_at = null
  returning id into v_id;

  insert into public.whatsapp_group_sessions (group_id, connection_id)
  values (v_id, p_connection_id)
  on conflict (group_id, connection_id) do update set left_at = null;
  return v_id;
end;
$$;

-- «luks CÓDIGO» solo enlaza grupos (como en la 260, más esa revisión)
create or replace function public.connector_link_group(
  p_connection_id uuid,
  p_jid text,
  p_name text,
  p_code text,
  p_sender_wa_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_account uuid;
  v_current uuid;
  v_name text;
  v_language text;
  v_user uuid;
  v_added int;
begin
  if p_jid !~ '@g\.us$' then
    return jsonb_build_object('ok', false, 'error', 'no_es_grupo');
  end if;
  v_account := public.wa_account_for_code(p_code);
  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'codigo_invalido');
  end if;

  v_group := (public.connector_upsert_group(p_connection_id, p_jid, p_name) ->> 'group_id')::uuid;
  perform 1 from public.whatsapp_groups where id = v_group for update;

  select l.account_id into v_current from public.account_group_links l where l.group_id = v_group;
  select a.name, a.language into v_name, v_language from public.accounts a where a.id = v_account;
  if v_current = v_account then
    return jsonb_build_object('ok', true, 'already', true, 'account_id', v_account, 'account_name', v_name, 'group_id', v_group,
                              'language', v_language);
  end if;
  if v_current is not null then
    return jsonb_build_object('ok', false, 'error', 'otra_cuenta');
  end if;

  -- Si quien escribió el código ya tiene usuario en la cuenta, queda como quien enlazó
  select p.claimed_by into v_user
  from public.people p
  where p.id = public.wa_person(v_account, p_sender_wa_id);

  insert into public.account_group_links (group_id, account_id, linked_by, linked_by_wa_id)
  values (v_group, v_account, v_user, p_sender_wa_id);

  -- Los integrantes del grupo pasan a ser las personas de la cuenta
  v_added := public.sync_group_people(v_group);

  return jsonb_build_object('ok', true, 'already', false, 'account_id', v_account, 'account_name', v_name, 'group_id', v_group,
                            'people_added', v_added, 'members', public.group_member_count(v_group), 'language', v_language);
end;
$$;

-- Lo que escribe Luks no es un gasto (como en la 260, con los emojis de las
-- confirmaciones nuevas, «✅ Anotado: …», y los saludos de Mister Luks)
create or replace function public.es_mensaje_de_luks(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~* '(esto se hizo en mrluks\.com|made with mrluks\.com|cuentas hechas con luks|hecho con luks|(mrluks\.com|\.vercel\.app)/r/[A-Za-z0-9_-]{20,64})'
      or coalesce(p_text, '') ~* '^\s*\W{0,4}\s*(anotad[oa]s?|recibido|ya estaba anotado|logged|received|already logged)[\s:].*·\s*(\$|bs\s?)\d'
      or coalesce(p_text, '') ~* '(soy|i[’'']m) \*?mister luks|(listo[:!]?|done[:!]?)\s*(este grupo quedó conectado|this group is now connected)'
$$;

-- ============================================================================
-- Bandeja de salida de Mister Luks
-- ============================================================================

create table public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  chat_jid text not null,
  reason text not null check (reason in ('welcome', 'group_hello', 'guide', 'invite', 'link')),
  -- Texto (o pie de la imagen), una imagen y un documento, por URL; al menos uno
  body text check (length(body) <= 4000),
  image_url text check (image_url ~ '^https://'),
  document_url text check (document_url ~ '^https://'),
  document_name text check (length(document_name) <= 120),
  -- Lo mismo no se manda dos veces: «welcome:573001234567», «group_hello:<grupo>»…
  dedupe_key text not null unique check (length(dedupe_key) <= 200),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  wa_message_id text,
  attempts int not null default 0,
  last_error text check (length(last_error) <= 300),
  dropped_at timestamptz,
  check (body is not null or image_url is not null or document_url is not null),
  check (document_url is null or document_name is not null)
);

create index whatsapp_outbox_pendientes_idx on public.whatsapp_outbox (created_at)
  where sent_at is null and dropped_at is null;

alter table public.whatsapp_outbox enable row level security;
alter table public.whatsapp_outbox force row level security;
revoke all on public.whatsapp_outbox from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_outbox to service_role;

-- Encola mensajes de Mister Luks. A un chat privado solo si esa persona escribió
-- primero; a un grupo, solo si Mister Luks está en él. Devuelve las dedupe_key
-- que quedaron nuevas (las repetidas no se encolan otra vez).
-- p_items = [{"chat_jid": "…", "reason": "welcome", "body": "…", "image_url": "https://…",
--             "document_url": "https://…", "document_name": "Guía.pdf", "dedupe_key": "…"}, …]
create or replace function public.connector_outbox_enqueue(p_items jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  x jsonb;
  v_key text;
  v_nuevas text[] := '{}';
begin
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if not exists (
      select 1
      from public.whatsapp_groups g
      join public.whatsapp_group_sessions s on s.group_id = g.id and s.left_at is null
      join public.whatsapp_connections c on c.id = s.connection_id and c.kind = 'contador'
      where g.wa_group_jid = x ->> 'chat_jid'
    ) then
      continue;
    end if;
    insert into public.whatsapp_outbox (chat_jid, reason, body, image_url, document_url, document_name, dedupe_key)
    values (x ->> 'chat_jid', x ->> 'reason', left(x ->> 'body', 4000), x ->> 'image_url', x ->> 'document_url',
            left(x ->> 'document_name', 120), x ->> 'dedupe_key')
    on conflict (dedupe_key) do nothing
    returning dedupe_key into v_key;
    if v_key is not null then
      v_nuevas := v_nuevas || v_key;
      v_key := null;
    end if;
  end loop;
  return v_nuevas;
end;
$$;

-- Lo que falta mandar, del más viejo al más nuevo. Lo de hace más de un día ya
-- no se manda (nadie lo está esperando).
create or replace function public.connector_outbox_pending(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  update public.whatsapp_outbox set dropped_at = now(), last_error = coalesce(last_error, 'Venció sin mandarse')
  where sent_at is null and dropped_at is null and created_at < now() - interval '1 day';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'chat_jid', o.chat_jid, 'reason', o.reason, 'body', o.body, 'image_url', o.image_url,
    'document_url', o.document_url, 'document_name', o.document_name, 'created_at', o.created_at
  ) order by o.created_at), '[]'::jsonb) into v_out
  from (
    select * from public.whatsapp_outbox
    where sent_at is null and dropped_at is null
    order by created_at
    limit p_limit
  ) o;
  return v_out;
end;
$$;

-- Se mandó (con el id del mensaje en WhatsApp), o falló: a los tres intentos se deja
create or replace function public.connector_outbox_result(p_id uuid, p_wa_message_id text, p_error text default null, p_drop boolean default false)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.whatsapp_outbox
  set sent_at = case when p_error is null and not p_drop then now() end,
      wa_message_id = coalesce(p_wa_message_id, wa_message_id),
      attempts = attempts + 1,
      last_error = left(p_error, 300),
      dropped_at = case when p_drop or (p_error is not null and attempts + 1 >= 3) then now() end
  where id = p_id and sent_at is null and dropped_at is null
$$;

-- ============================================================================
-- Permisos
-- ============================================================================

revoke execute on function public.lector_principal(uuid) from public, anon, authenticated;
revoke execute on function public.connector_group_left(text, uuid) from public, anon, authenticated;
revoke execute on function public.connector_group_hello(uuid) from public, anon, authenticated;
revoke execute on function public.connector_private_chat(uuid, text) from public, anon, authenticated;
revoke execute on function public.connector_outbox_enqueue(jsonb) from public, anon, authenticated;
revoke execute on function public.connector_outbox_pending(int) from public, anon, authenticated;
revoke execute on function public.connector_outbox_result(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.lector_principal(uuid) to service_role;
grant execute on function public.connector_group_left(text, uuid) to service_role;
grant execute on function public.connector_group_hello(uuid) to service_role;
grant execute on function public.connector_private_chat(uuid, text) to service_role;
grant execute on function public.connector_outbox_enqueue(jsonb) to service_role;
grant execute on function public.connector_outbox_pending(int) to service_role;
grant execute on function public.connector_outbox_result(uuid, text, text, boolean) to service_role;
