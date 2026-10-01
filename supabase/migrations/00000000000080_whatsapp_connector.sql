-- ============================================================================
-- Lucas · 00000000000080_whatsapp_connector.sql
-- Fase 5: el connector de WhatsApp (services/connector).
--
--   · Sesiones de Baileys: la del número contador (una) y las personales
--     opcionales (una por usuario). Las credenciales y llaves de Signal se
--     guardan cifradas (AES-256-GCM en el connector): aquí solo hay bytes.
--   · Grupos: el connector anota cada grupo donde está; un grupo se enlaza a
--     una cuenta cuando alguien escribe en él «lucas CÓDIGO» con un código de
--     invitación vigente de esa cuenta.
--   · Ingesta: solo de grupos enlazados, sin repetir el mismo mensaje
--     (unique (group_id, wa_message_id)), y solo lo escrito después del enlace.
--   · Remitentes: cada número que escribe queda anotado por cuenta; los que no
--     son de nadie le aparecen a un admin con «¿Quién es este número?».
--   · Confirmaciones en el grupo (opcionales por grupo, con límite de
--     frecuencia en el connector).
--
-- Todo lo del connector va en RPC solo para el service role; lo de la web,
-- en RPC para authenticated que revisan el rol en la cuenta.
-- ============================================================================

-- ============================================================================
-- Sesiones
-- ============================================================================

alter table public.whatsapp_connections
  add column kind text not null default 'contador' check (kind in ('contador', 'personal')),
  add column owner_id uuid references public.profiles (id) on delete cascade,
  add column wa_jid text,               -- el JID propio cuando quedó vinculada
  add column wa_lid text,
  add column pairing_qr text,           -- texto del QR mientras se vincula (la web y la terminal lo dibujan)
  add column pairing_code text,         -- código de 8 letras para vincular con el número
  add column pairing_phone text,        -- número con el que se pidió el código
  add column pairing_expires_at timestamptz,
  add column stop_requested_at timestamptz, -- la web pidió cerrar la sesión
  add column last_seen_at timestamptz,  -- latido del connector
  add column connected_at timestamptz,
  add column disconnected_at timestamptz,
  add column disconnect_reason text,
  add column updated_at timestamptz not null default now(),
  add constraint whatsapp_connections_duenio check ((kind = 'personal') = (owner_id is not null)),
  add constraint whatsapp_connections_pairing_phone check (pairing_phone is null or pairing_phone ~ '^[0-9]{8,15}$');

create unique index whatsapp_connections_un_contador on public.whatsapp_connections ((true)) where kind = 'contador';
create unique index whatsapp_connections_una_personal on public.whatsapp_connections (owner_id) where kind = 'personal';

create trigger trg_whatsapp_connections_updated_at before update on public.whatsapp_connections
  for each row execute function public.set_updated_at();

-- Llaves de Signal de cada sesión (pre-keys, sesiones, sender keys…), cifradas
create table public.whatsapp_session_keys (
  connection_id uuid not null references public.whatsapp_connections (id) on delete cascade,
  key_type text not null,
  key_id text not null,
  ciphertext bytea not null,
  updated_at timestamptz not null default now(),
  primary key (connection_id, key_type, key_id)
);

alter table public.whatsapp_session_keys enable row level security;
alter table public.whatsapp_session_keys force row level security;
revoke all on public.whatsapp_session_keys from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_session_keys to service_role;

-- ============================================================================
-- Grupos, enlaces y mensajes
-- ============================================================================

alter table public.whatsapp_groups
  add column participants_count int,
  add column joined_at timestamptz not null default now(),
  add column left_at timestamptz,       -- sacaron a Lucas del grupo
  add column last_message_at timestamptz,
  add column hello_sent_at timestamptz;

alter table public.account_group_links
  add column confirm_in_group boolean not null default true,
  add column linked_by_wa_id text,
  add column last_reply_at timestamptz;

alter table public.messages
  add column sender_name text check (length(sender_name) <= 120),
  add column group_reply_at timestamptz; -- cuándo Lucas respondió (o decidió no responder) en el grupo

create index messages_por_responder_idx on public.messages (status)
  where source = 'whatsapp' and group_reply_at is null;

-- Lo que llegó antes de esta migración ya no se confirma en el grupo
update public.messages set group_reply_at = coalesce(processed_at, received_at) where source = 'whatsapp';

-- Quién ha escrito en los grupos de cada cuenta (para «¿Quién es este número?»)
create table public.whatsapp_senders (
  account_id uuid not null references public.accounts (id) on delete cascade,
  wa_id text not null,                  -- número sin «+» o «lid:…» si WhatsApp no lo muestra
  push_name text check (length(push_name) <= 120),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  message_count int not null default 1,
  dismissed_at timestamptz,             -- un admin dijo «no es de la cuenta»
  primary key (account_id, wa_id)
);

alter table public.whatsapp_senders enable row level security;
alter table public.whatsapp_senders force row level security;
revoke all on public.whatsapp_senders from anon, authenticated;
grant select on public.whatsapp_senders to authenticated;
grant select, insert, update, delete on public.whatsapp_senders to service_role;

create policy whatsapp_senders_select on public.whatsapp_senders
  for select to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

-- ============================================================================
-- Ayudas
-- ============================================================================

-- La persona de la cuenta que tiene ese número (o null)
create or replace function public.wa_person(p_account_id uuid, p_wa_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.person_id
  from public.person_whatsapp_ids w
  join public.people p on p.id = w.person_id
  where p.account_id = p_account_id and w.wa_id = p_wa_id
  order by w.created_at
  limit 1
$$;

-- Código de invitación vigente de una cuenta activa → la cuenta
create or replace function public.wa_account_for_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.account_id
  from public.invitations i
  join public.accounts a on a.id = i.account_id
  where i.code = upper(btrim(p_code))
    and i.revoked_at is null
    and (i.expires_at is null or i.expires_at > now())
    and (i.max_uses is null or i.uses < i.max_uses)
    and a.status = 'active'
  limit 1
$$;

-- ============================================================================
-- RPC del connector (solo service role)
-- ============================================================================

-- Pedir (o volver a pedir) el número contador: el connector la arranca y deja
-- el QR (o el código de 8 letras si viene el número) para vincularla.
create or replace function public.connector_request_contador(p_phone text default null, p_label text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
begin
  select id into v_id from public.whatsapp_connections where kind = 'contador';
  if v_id is null then
    insert into public.whatsapp_connections (kind, label, status, pairing_phone)
    values ('contador', coalesce(p_label, 'Número contador'), 'connecting', v_phone)
    returning id into v_id;
  else
    update public.whatsapp_connections
    set status = case when status = 'connected' then status else 'connecting'::public.connection_status end,
        pairing_phone = v_phone, pairing_qr = null, pairing_code = null, pairing_expires_at = null,
        stop_requested_at = null, disconnect_reason = null, label = coalesce(p_label, label)
    where id = v_id;
  end if;
  return v_id;
end;
$$;

-- Sesiones que deberían estar corriendo (o cerrarse)
create or replace function public.connector_sessions()
returns table (
  id uuid, kind text, owner_id uuid, status public.connection_status, label text,
  has_creds boolean, pairing_phone text, stop_requested boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.kind, c.owner_id, c.status, c.label, c.session_ciphertext is not null,
         c.pairing_phone, c.stop_requested_at is not null
  from public.whatsapp_connections c
  where c.status in ('connecting', 'connected') or c.stop_requested_at is not null
  order by c.kind, c.created_at
$$;

create or replace function public.connector_get_creds(p_connection_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(c.session_ciphertext, 'base64') from public.whatsapp_connections c where c.id = p_connection_id
$$;

create or replace function public.connector_save_creds(p_connection_id uuid, p_ciphertext text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.whatsapp_connections
  set session_ciphertext = decode(p_ciphertext, 'base64')
  where id = p_connection_id
$$;

create or replace function public.connector_get_keys(p_connection_id uuid, p_type text, p_ids text[])
returns table (key_id text, ciphertext text)
language sql
stable
security definer
set search_path = ''
as $$
  select k.key_id, encode(k.ciphertext, 'base64')
  from public.whatsapp_session_keys k
  where k.connection_id = p_connection_id and k.key_type = p_type and k.key_id = any (p_ids)
$$;

-- p_items = [{"t": tipo, "i": id, "v": base64 o null para borrar}, …]
create or replace function public.connector_set_keys(p_connection_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.whatsapp_session_keys k
  using jsonb_array_elements(p_items) x
  where k.connection_id = p_connection_id
    and k.key_type = x ->> 't' and k.key_id = x ->> 'i'
    and (x -> 'v' is null or jsonb_typeof(x -> 'v') = 'null');

  insert into public.whatsapp_session_keys (connection_id, key_type, key_id, ciphertext, updated_at)
  select p_connection_id, x ->> 't', x ->> 'i', decode(x ->> 'v', 'base64'), now()
  from jsonb_array_elements(p_items) x
  where jsonb_typeof(x -> 'v') = 'string'
  on conflict (connection_id, key_type, key_id)
  do update set ciphertext = excluded.ciphertext, updated_at = now();
end;
$$;

-- Estado de una sesión. Al quedar conectada se borra lo del emparejamiento.
create or replace function public.connector_set_status(
  p_connection_id uuid,
  p_status public.connection_status,
  p_wa_jid text default null,
  p_wa_lid text default null,
  p_phone text default null,
  p_reason text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.whatsapp_connections c
  set status = p_status,
      wa_jid = coalesce(p_wa_jid, c.wa_jid),
      wa_lid = coalesce(p_wa_lid, c.wa_lid),
      phone_number = coalesce(p_phone, c.phone_number),
      last_seen_at = now(),
      connected_at = case when p_status = 'connected' and c.status <> 'connected' then now() else c.connected_at end,
      disconnected_at = case when p_status = 'disconnected' then now() else c.disconnected_at end,
      disconnect_reason = case when p_status = 'disconnected' then left(p_reason, 300) when p_status = 'connected' then null else c.disconnect_reason end,
      pairing_qr = case when p_status = 'connecting' then c.pairing_qr end,
      pairing_code = case when p_status = 'connecting' then c.pairing_code end,
      pairing_expires_at = case when p_status = 'connecting' then c.pairing_expires_at end
  where c.id = p_connection_id
$$;

create or replace function public.connector_set_pairing(p_connection_id uuid, p_qr text, p_code text, p_expires_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.whatsapp_connections
  set pairing_qr = p_qr, pairing_code = p_code, pairing_expires_at = p_expires_at, last_seen_at = now()
  where id = p_connection_id
$$;

create or replace function public.connector_heartbeat(p_connection_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.whatsapp_connections set last_seen_at = now() where id = any (p_connection_ids)
$$;

-- La sesión se cerró del todo (desde el teléfono, o la pidieron cerrar): se borran sus llaves
create or replace function public.connector_clear_session(p_connection_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.whatsapp_session_keys where connection_id = p_connection_id;
  update public.whatsapp_connections
  set session_ciphertext = null, status = 'disconnected', disconnected_at = now(),
      disconnect_reason = left(p_reason, 300), stop_requested_at = null,
      pairing_qr = null, pairing_code = null, pairing_expires_at = null
  where id = p_connection_id;
end;
$$;

-- Lucas está en este grupo. Devuelve el grupo, su cuenta (si está enlazado) y si toca saludar.
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
begin
  insert into public.whatsapp_groups (connection_id, wa_group_jid, name, participants_count)
  values (p_connection_id, p_jid, left(p_name, 200), p_participants)
  on conflict (wa_group_jid) do update
    set connection_id = excluded.connection_id,
        name = coalesce(excluded.name, public.whatsapp_groups.name),
        participants_count = coalesce(excluded.participants_count, public.whatsapp_groups.participants_count),
        left_at = null
  returning * into g;

  select l.account_id, a.name into v_account, v_name
  from public.account_group_links l join public.accounts a on a.id = l.account_id
  where l.group_id = g.id;

  return jsonb_build_object(
    'group_id', g.id, 'account_id', v_account, 'account_name', v_name,
    'say_hello', v_account is null and g.hello_sent_at is null
  );
end;
$$;

create or replace function public.connector_mark_hello(p_group_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.whatsapp_groups set hello_sent_at = now() where id = p_group_id
$$;

create or replace function public.connector_group_left(p_jid text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.whatsapp_groups set left_at = now() where wa_group_jid = p_jid
$$;

-- «lucas PASEO-7K2Q» escrito en el grupo
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
  v_user uuid;
begin
  v_account := public.wa_account_for_code(p_code);
  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'codigo_invalido');
  end if;

  v_group := (public.connector_upsert_group(p_connection_id, p_jid, p_name) ->> 'group_id')::uuid;
  perform 1 from public.whatsapp_groups where id = v_group for update;

  select l.account_id into v_current from public.account_group_links l where l.group_id = v_group;
  select a.name into v_name from public.accounts a where a.id = v_account;
  if v_current = v_account then
    return jsonb_build_object('ok', true, 'already', true, 'account_id', v_account, 'account_name', v_name, 'group_id', v_group);
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

  return jsonb_build_object('ok', true, 'already', false, 'account_id', v_account, 'account_name', v_name, 'group_id', v_group);
end;
$$;

-- ¿Este mensaje se guarda? Solo grupos enlazados a cuentas activas, mensajes
-- nuevos y escritos después del enlace. Devuelve la cuenta (para la carpeta de
-- Storage) o el motivo para no guardarlo.
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
  v_linked_at timestamptz;
begin
  select g.id, l.account_id, a.status, l.created_at into v_group, v_account, v_status, v_linked_at
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
  if p_sent_at < v_linked_at - interval '2 minutes' then
    return jsonb_build_object('ingest', false, 'reason', 'antes_del_enlace', 'account_id', v_account);
  end if;
  if exists (select 1 from public.messages m where m.group_id = v_group and m.wa_message_id = p_wa_message_id) then
    return jsonb_build_object('ingest', false, 'reason', 'repetido', 'account_id', v_account);
  end if;
  return jsonb_build_object('ingest', true, 'account_id', v_account, 'group_id', v_group);
end;
$$;

-- Guarda el mensaje y crea su trabajo (una sola vez por id de WhatsApp)
create or replace function public.connector_ingest_message(
  p_jid text,
  p_wa_message_id text,
  p_sender_wa_id text,
  p_sender_name text,
  p_kind public.message_kind,
  p_text text,
  p_media_path text,
  p_file_name text,
  p_mime_type text,
  p_sent_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb := public.connector_should_ingest(p_jid, p_wa_message_id, p_sent_at);
  v_account uuid := (v_check ->> 'account_id')::uuid;
  v_group uuid := (v_check ->> 'group_id')::uuid;
  v_person uuid;
  v_message uuid;
begin
  if not (v_check ->> 'ingest')::boolean then
    return v_check;
  end if;
  if p_kind = 'text' and nullif(btrim(p_text), '') is null then
    return jsonb_build_object('ingest', false, 'reason', 'vacio');
  end if;
  if p_kind <> 'text' and (p_media_path is null or p_media_path not like v_account::text || '/%') then
    return jsonb_build_object('ingest', false, 'reason', 'archivo_fuera_de_la_cuenta');
  end if;

  v_person := public.wa_person(v_account, p_sender_wa_id);

  insert into public.messages (
    account_id, group_id, source, wa_message_id, sender_wa_id, sender_name, sender_person_id,
    kind, text_body, media_path, file_name, mime_type, received_at
  )
  values (
    v_account, v_group, 'whatsapp', p_wa_message_id, p_sender_wa_id, left(p_sender_name, 120), v_person,
    p_kind, left(nullif(btrim(p_text), ''), 4000), p_media_path, left(p_file_name, 120), p_mime_type,
    coalesce(p_sent_at, now())
  )
  on conflict (group_id, wa_message_id) do nothing
  returning id into v_message;

  if v_message is null then
    return jsonb_build_object('ingest', false, 'reason', 'repetido');
  end if;

  insert into public.jobs (type, payload)
  values ('process_message', jsonb_build_object('message_id', v_message, 'account_id', v_account));

  update public.whatsapp_groups set last_message_at = now() where id = v_group;

  if p_sender_wa_id is not null then
    insert into public.whatsapp_senders (account_id, wa_id, push_name)
    values (v_account, p_sender_wa_id, left(p_sender_name, 120))
    on conflict (account_id, wa_id) do update
      set last_seen_at = now(),
          message_count = public.whatsapp_senders.message_count + 1,
          push_name = coalesce(excluded.push_name, public.whatsapp_senders.push_name);
  end if;

  return jsonb_build_object('ingest', true, 'message_id', v_message, 'account_id', v_account,
                            'known_sender', v_person is not null);
end;
$$;

-- Lo que ya procesó el worker y hay que contar en el grupo (si el grupo quiere).
-- Los de grupos sin confirmaciones se marcan como respondidos de una vez.
create or replace function public.connector_pending_replies(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  -- Sin confirmación: lo que no es gasto, lo que falló, los grupos que las
  -- apagaron y lo de hace más de un día (ya nadie espera la respuesta)
  update public.messages m
  set group_reply_at = now()
  from public.account_group_links l
  where l.group_id = m.group_id
    and m.source = 'whatsapp' and m.group_reply_at is null
    and m.status in ('done', 'not_expense', 'duplicate', 'failed')
    and (not l.confirm_in_group or m.status in ('not_expense', 'failed') or m.received_at < now() - interval '1 day');

  select coalesce(jsonb_agg(x order by x ->> 'received_at'), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
      'message_id', m.id,
      'group_jid', g.wa_group_jid,
      'wa_message_id', m.wa_message_id,
      'sender_wa_id', m.sender_wa_id,
      'status', m.status,
      'received_at', m.received_at,
      'expense', (
        select jsonb_build_object(
          'merchant', e.merchant, 'total_cop', e.total_cop, 'status', e.status,
          'payer', p.display_name,
          'split_count', (select count(*) from public.expense_splits s where s.expense_id = e.id)
        )
        from public.expenses e left join public.people p on p.id = e.payer_person_id
        where e.message_id = m.id
        limit 1
      ),
      'duplicate_of', (
        select jsonb_build_object('merchant', d.merchant, 'total_cop', d.total_cop, 'expense_date', d.expense_date)
        from public.expenses d where d.id = m.duplicate_of
      )
    ) as x
    from public.messages m
    join public.whatsapp_groups g on g.id = m.group_id
    join public.account_group_links l on l.group_id = m.group_id and l.confirm_in_group
    where m.source = 'whatsapp' and m.group_reply_at is null
      and m.status in ('done', 'duplicate')
      and g.left_at is null
    order by m.received_at
    limit p_limit
  ) t;
  return v_out;
end;
$$;

create or replace function public.connector_mark_replied(p_message_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messages set group_reply_at = now() where id = any (p_message_ids) and group_reply_at is null;
  update public.account_group_links l set last_reply_at = now()
  where l.group_id in (select m.group_id from public.messages m where m.id = any (p_message_ids));
end;
$$;

-- Para el monitoreo (Uptime Kuma): ¿la cola avanza?
create or replace function public.connector_queue_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'queued', count(*) filter (where j.status = 'queued' and j.run_at <= now()),
    'oldest_queued_s', coalesce(extract(epoch from now() - min(j.run_at) filter (where j.status = 'queued' and j.run_at <= now()))::int, 0),
    'running', count(*) filter (where j.status = 'running')
  )
  from public.jobs j
$$;

-- ============================================================================
-- RPC de la web
-- ============================================================================

-- Todo lo de la pantalla «Conecta el grupo de WhatsApp»
create or replace function public.whatsapp_overview(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
  c public.whatsapp_connections%rowtype;
begin
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  v_admin := public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]);
  select * into c from public.whatsapp_connections where kind = 'contador';

  return jsonb_build_object(
    'is_admin', v_admin,
    'contador', case when c.id is null then null else jsonb_build_object(
      'phone', c.phone_number,
      'connected', c.status = 'connected' and c.last_seen_at > now() - interval '3 minutes',
      'status', c.status,
      'last_seen_at', c.last_seen_at
    ) end,
    -- El código para escribir en el grupo: la invitación vigente más nueva (solo admins lo ven)
    'code', case when v_admin then (
      select i.code from public.invitations i
      where i.account_id = p_account_id and i.revoked_at is null
        and (i.expires_at is null or i.expires_at > now())
        and (i.max_uses is null or i.uses < i.max_uses)
      order by i.created_at desc limit 1
    ) end,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'group_id', g.id, 'name', g.name, 'linked_at', l.created_at,
        'confirm_in_group', l.confirm_in_group, 'participants', g.participants_count,
        'last_message_at', g.last_message_at, 'left_at', g.left_at,
        'connection_ok', wc.status = 'connected' and wc.last_seen_at > now() - interval '3 minutes',
        'connection_kind', wc.kind,
        'messages', (select count(*) from public.messages m where m.group_id = g.id),
        'expenses', (select count(*) from public.messages m where m.group_id = g.id and m.status = 'done'),
        'last_sender', (
          select coalesce(p.display_name, m.sender_name) from public.messages m
          left join public.people p on p.id = m.sender_person_id
          where m.group_id = g.id order by m.received_at desc limit 1
        )
      ) order by l.created_at)
      from public.account_group_links l
      join public.whatsapp_groups g on g.id = l.group_id
      left join public.whatsapp_connections wc on wc.id = g.connection_id
      where l.account_id = p_account_id
    ), '[]'::jsonb),
    'unknown_senders', case when v_admin then coalesce((
      select jsonb_agg(jsonb_build_object(
        'wa_id', s.wa_id, 'push_name', s.push_name, 'message_count', s.message_count,
        'last_seen_at', s.last_seen_at
      ) order by s.last_seen_at desc)
      from public.whatsapp_senders s
      where s.account_id = p_account_id and s.dismissed_at is null
        and public.wa_person(p_account_id, s.wa_id) is null
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

-- «¿Quién es este número?» → una persona de la cuenta (o una nueva)
create or replace function public.identify_wa_sender(
  p_account_id uuid,
  p_wa_id text,
  p_person_id uuid default null,
  p_new_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := p_person_id;
begin
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta identifican números';
  end if;
  if not exists (select 1 from public.whatsapp_senders s where s.account_id = p_account_id and s.wa_id = p_wa_id) then
    raise exception 'Ese número no ha escrito en los grupos de esta cuenta';
  end if;
  if public.wa_person(p_account_id, p_wa_id) is not null then
    raise exception 'Ese número ya es de alguien de la cuenta';
  end if;

  if v_person is null then
    if nullif(btrim(p_new_name), '') is null then
      raise exception 'Elige a la persona o escribe cómo le dicen';
    end if;
    insert into public.people (account_id, display_name) values (p_account_id, left(btrim(p_new_name), 40))
    returning id into v_person;
  elsif not exists (select 1 from public.people p where p.id = v_person and p.account_id = p_account_id) then
    raise exception 'Esa persona no es de esta cuenta';
  end if;

  insert into public.person_whatsapp_ids (person_id, wa_id) values (v_person, p_wa_id)
  on conflict (person_id, wa_id) do nothing;

  update public.messages m set sender_person_id = v_person
  where m.account_id = p_account_id and m.sender_wa_id = p_wa_id and m.sender_person_id is null;

  -- Lo que mandó y quedó sin pagador: pagó quien lo mandó (igual que hace el worker)
  update public.expenses e set payer_person_id = v_person
  from public.messages m
  where m.id = e.message_id and m.account_id = p_account_id and m.sender_wa_id = p_wa_id
    and e.payer_person_id is null and e.status = 'pending_review';

  update public.whatsapp_senders set dismissed_at = null where account_id = p_account_id and wa_id = p_wa_id;
  return v_person;
end;
$$;

create or replace function public.dismiss_wa_sender(p_account_id uuid, p_wa_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta pueden hacer esto';
  end if;
  update public.whatsapp_senders set dismissed_at = now()
  where account_id = p_account_id and wa_id = p_wa_id;
end;
$$;

create or replace function public.set_group_confirmations(p_group_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
begin
  select l.account_id into v_account from public.account_group_links l where l.group_id = p_group_id;
  if v_account is null or not public.has_account_role(v_account, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta cambian esto';
  end if;
  update public.account_group_links set confirm_in_group = p_on where group_id = p_group_id;
end;
$$;

-- Vincular el WhatsApp propio (opcional): Lucas lee los grupos de esa persona
-- sin tener que agregar el número contador. p_phone (solo dígitos, con indicativo)
-- pide un código de 8 letras en vez de QR, útil desde el mismo celular.
create or replace function public.request_personal_whatsapp(p_phone text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if v_phone is not null and v_phone !~ '^[0-9]{8,15}$' then
    raise exception 'Escribe el número con indicativo, por ejemplo 573001234567';
  end if;

  insert into public.whatsapp_connections (kind, owner_id, created_by, label, status, pairing_phone)
  values ('personal', v_uid, v_uid, 'personal', 'connecting', v_phone)
  on conflict (owner_id) where kind = 'personal' do update
    set status = case when public.whatsapp_connections.status = 'connected' then 'connected'::public.connection_status else 'connecting'::public.connection_status end,
        pairing_phone = excluded.pairing_phone,
        pairing_qr = null, pairing_code = null, pairing_expires_at = null,
        stop_requested_at = null, disconnect_reason = null
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.my_whatsapp_link()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', c.status,
    'qr', case when c.pairing_expires_at > now() then c.pairing_qr end,
    'code', case when c.pairing_expires_at > now() then c.pairing_code end,
    'expires_at', c.pairing_expires_at,
    'phone', c.phone_number,
    'connected_at', c.connected_at,
    'alive', c.last_seen_at > now() - interval '3 minutes',
    'disconnect_reason', c.disconnect_reason,
    'stopping', c.stop_requested_at is not null
  )
  from public.whatsapp_connections c
  where c.kind = 'personal' and c.owner_id = auth.uid()
$$;

create or replace function public.stop_personal_whatsapp()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  update public.whatsapp_connections
  set stop_requested_at = now()
  where kind = 'personal' and owner_id = auth.uid();
end;
$$;

-- ============================================================================
-- Tiempo real (la pantalla de conectar se entera del enlace al instante) y permisos
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.account_group_links, public.whatsapp_senders;
  end if;
end;
$$;

revoke execute on function public.wa_person(uuid, text) from public, anon, authenticated;
revoke execute on function public.wa_account_for_code(text) from public, anon, authenticated;
revoke execute on function public.connector_request_contador(text, text) from public, anon, authenticated;
revoke execute on function public.connector_sessions() from public, anon, authenticated;
revoke execute on function public.connector_get_creds(uuid) from public, anon, authenticated;
revoke execute on function public.connector_save_creds(uuid, text) from public, anon, authenticated;
revoke execute on function public.connector_get_keys(uuid, text, text[]) from public, anon, authenticated;
revoke execute on function public.connector_set_keys(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.connector_set_status(uuid, public.connection_status, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.connector_set_pairing(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.connector_heartbeat(uuid[]) from public, anon, authenticated;
revoke execute on function public.connector_clear_session(uuid, text) from public, anon, authenticated;
revoke execute on function public.connector_upsert_group(uuid, text, text, int) from public, anon, authenticated;
revoke execute on function public.connector_mark_hello(uuid) from public, anon, authenticated;
revoke execute on function public.connector_group_left(text) from public, anon, authenticated;
revoke execute on function public.connector_link_group(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.connector_should_ingest(text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.connector_ingest_message(text, text, text, text, public.message_kind, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.connector_pending_replies(int) from public, anon, authenticated;
revoke execute on function public.connector_mark_replied(uuid[]) from public, anon, authenticated;
revoke execute on function public.connector_queue_health() from public, anon, authenticated;

grant execute on function public.wa_person(uuid, text) to service_role;
grant execute on function public.wa_account_for_code(text) to service_role;
grant execute on function public.connector_request_contador(text, text) to service_role;
grant execute on function public.connector_sessions() to service_role;
grant execute on function public.connector_get_creds(uuid) to service_role;
grant execute on function public.connector_save_creds(uuid, text) to service_role;
grant execute on function public.connector_get_keys(uuid, text, text[]) to service_role;
grant execute on function public.connector_set_keys(uuid, jsonb) to service_role;
grant execute on function public.connector_set_status(uuid, public.connection_status, text, text, text, text) to service_role;
grant execute on function public.connector_set_pairing(uuid, text, text, timestamptz) to service_role;
grant execute on function public.connector_heartbeat(uuid[]) to service_role;
grant execute on function public.connector_clear_session(uuid, text) to service_role;
grant execute on function public.connector_upsert_group(uuid, text, text, int) to service_role;
grant execute on function public.connector_mark_hello(uuid) to service_role;
grant execute on function public.connector_group_left(text) to service_role;
grant execute on function public.connector_link_group(uuid, text, text, text, text) to service_role;
grant execute on function public.connector_should_ingest(text, text, timestamptz) to service_role;
grant execute on function public.connector_ingest_message(text, text, text, text, public.message_kind, text, text, text, text, timestamptz) to service_role;
grant execute on function public.connector_pending_replies(int) to service_role;
grant execute on function public.connector_mark_replied(uuid[]) to service_role;
grant execute on function public.connector_queue_health() to service_role;

revoke execute on function public.whatsapp_overview(uuid) from public, anon;
revoke execute on function public.identify_wa_sender(uuid, text, uuid, text) from public, anon;
revoke execute on function public.dismiss_wa_sender(uuid, text) from public, anon;
revoke execute on function public.set_group_confirmations(uuid, boolean) from public, anon;
revoke execute on function public.request_personal_whatsapp(text) from public, anon;
revoke execute on function public.my_whatsapp_link() from public, anon;
revoke execute on function public.stop_personal_whatsapp() from public, anon;

grant execute on function public.whatsapp_overview(uuid) to authenticated;
grant execute on function public.identify_wa_sender(uuid, text, uuid, text) to authenticated;
grant execute on function public.dismiss_wa_sender(uuid, text) to authenticated;
grant execute on function public.set_group_confirmations(uuid, boolean) to authenticated;
grant execute on function public.request_personal_whatsapp(text) to authenticated;
grant execute on function public.my_whatsapp_link() to authenticated;
grant execute on function public.stop_personal_whatsapp() to authenticated;

grant select, insert, update, delete on public.whatsapp_connections to service_role;
grant select, insert, update, delete on public.whatsapp_groups to service_role;
grant select, insert, update, delete on public.account_group_links to service_role;
