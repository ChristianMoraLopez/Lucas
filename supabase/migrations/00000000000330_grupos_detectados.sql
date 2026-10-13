-- ============================================================================
-- Lucas · 00000000000330_grupos_detectados.sql
-- Fase 5: conectar un grupo y crear su cuenta, por los dos caminos, sin código.
--
--   · Con Mister Luks: al entrar a un grupo, connector_group_detected guarda en
--     una sola transacción el grupo, su presencia, sus integrantes (con sus
--     identidades) y, si toca, el saludo. En un grupo sin cuenta el saludo
--     lleva un link mrluks.com/g/CÓDIGO: el código se crea al mandarlo
--     (connector_group_link_mint), es de 144 bits, se guarda solo su hash,
--     vence a las dos semanas y sirve una vez para crear la cuenta. Si el
--     grupo ya tiene cuenta, el link no se crea («ayuda» lo vuelve a mandar
--     mientras no la tenga).
--   · Quien tiene su número verificado y está en un grupo de Mister Luks sin
--     cuenta lo ve en el inicio («Nuevo grupo detectado», my_detected_groups),
--     hasta que lo cree, lo conecte o diga «Ahora no».
--   · Con WhatsApp vinculado: my_whatsapp_groups lista los grupos de su sesión
--     (solo el nombre). Al conectar uno, sus integrantes todavía no se conocen
--     (la 280 no los guarda sin cuenta): el connector los lee en su próxima
--     vuelta (connector_groups_pending_members) y quedan como personas.
--   · create_account_from_group y link_group_to_account: con el link /g/, con
--     el número verificado en el grupo o con la sesión vinculada en el grupo.
--     Bloquean el grupo (for update): si dos crean la cuenta a la vez, gana
--     uno, y el otro entra solo si su número verificado está en el grupo.
--     Mister Luks lo cuenta en el grupo («🎉 ¡Listo! Este grupo quedó
--     conectado…») por la bandeja de salida.
--   · Ninguna RPC de la web recibe un JID ni devuelve números completos (solo
--     los últimos 4).
-- ============================================================================

-- La bandeja sabe de qué grupo es un link /g/ (lo crea al mandarlo)
alter table public.whatsapp_outbox add column group_id uuid references public.whatsapp_groups (id) on delete cascade;

-- Un grupo conectado desde la web todavía no tiene integrantes guardados: el connector los lee
alter table public.account_group_links add column members_synced_at timestamptz;
update public.account_group_links set members_synced_at = created_at;

-- ============================================================================
-- Los links /g/ (crear la cuenta del grupo)
-- ============================================================================

create table public.group_links (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.whatsapp_groups (id) on delete cascade,
  -- sha256 del código; el código mismo solo va en el mensaje de WhatsApp
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_at timestamptz,
  used_by uuid references public.profiles (id) on delete set null
);

create index group_links_grupo_idx on public.group_links (group_id);

alter table public.group_links enable row level security;
alter table public.group_links force row level security;
revoke all on public.group_links from anon, authenticated;
grant select, insert, update, delete on public.group_links to service_role;

-- «Ahora no» en la tarjeta «Nuevo grupo detectado»
create table public.group_detections_dismissed (
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid not null references public.whatsapp_groups (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

alter table public.group_detections_dismissed enable row level security;
alter table public.group_detections_dismissed force row level security;
revoke all on public.group_detections_dismissed from anon, authenticated;
grant select, insert, update, delete on public.group_detections_dismissed to service_role;

-- El hash de un código (como los de /v/)
create or replace function public.hash_codigo(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256')
$$;

-- ============================================================================
-- Mister Luks entra a un grupo
-- ============================================================================

-- El grupo, su presencia, sus integrantes y el saludo, en una sola transacción.
-- Solo Mister Luks (el contador). p_members como en connector_set_group_members.
-- Devuelve lo de connector_upsert_group, cuántos son y, en «hello», con qué
-- saludar (connector_group_hello) si es la primera vez.
create or replace function public.connector_group_detected(
  p_connection_id uuid,
  p_jid text,
  p_name text,
  p_participants int default null,
  p_members jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g jsonb;
  v_group uuid;
  v_m jsonb := '{}'::jsonb;
  v_hola jsonb := jsonb_build_object('say_hello', false);
begin
  if not exists (select 1 from public.whatsapp_connections c where c.id = p_connection_id and c.kind = 'contador') then
    raise exception 'Solo Mister Luks detecta grupos';
  end if;
  if p_jid !~ '@g\.us$' then
    raise exception 'No es un grupo: %', p_jid;
  end if;

  g := public.connector_upsert_group(p_connection_id, p_jid, p_name, p_participants);
  v_group := (g ->> 'group_id')::uuid;
  if jsonb_typeof(p_members) = 'array' and jsonb_array_length(p_members) > 0 then
    v_m := public.connector_set_group_members(v_group, p_members);
  end if;
  if (g ->> 'say_hello')::boolean then
    v_hola := public.connector_group_hello(v_group);
  end if;

  return g || jsonb_build_object(
    'members', coalesce((v_m ->> 'members')::int, public.group_member_count(v_group)),
    'people_added', coalesce((v_m ->> 'people_added')::int, 0),
    'hello', v_hola
  );
end;
$$;

-- Al mandar el saludo (o la guía) de un grupo sin cuenta: crea el código del link
-- /g/ y lo devuelve una sola vez. Si el grupo ya tiene cuenta, null (el
-- connector quita la línea del link).
create or replace function public.connector_group_link_mint(p_outbox_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.whatsapp_outbox%rowtype;
  v_token text;
begin
  select * into o from public.whatsapp_outbox
  where id = p_outbox_id and sent_at is null and dropped_at is null;
  if o.id is null or o.group_id is null then
    raise exception 'Ese mensaje no lleva el link de un grupo';
  end if;
  if exists (select 1 from public.account_group_links l where l.group_id = o.group_id) then
    return null;
  end if;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'), '=');
  insert into public.group_links (group_id, token_hash) values (o.group_id, public.hash_codigo(v_token));
  return v_token;
end;
$$;

-- La bandeja (como en la 310) también guarda de qué grupo es un link /g/
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
    insert into public.whatsapp_outbox (chat_jid, reason, body, image_url, document_url, document_name, dedupe_key, identity_id, group_id)
    values (x ->> 'chat_jid', x ->> 'reason', left(x ->> 'body', 4000), x ->> 'image_url', x ->> 'document_url',
            left(x ->> 'document_name', 120), x ->> 'dedupe_key', (x ->> 'identity_id')::uuid,
            -- Si no llega (la guía que pidieron con «ayuda»), el grupo del chat
            coalesce((x ->> 'group_id')::uuid,
                     (select g2.id from public.whatsapp_groups g2 where g2.wa_group_jid = x ->> 'chat_jid' and g2.chat_kind = 'grupo')))
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

-- Lo que falta mandar (como en la 290), con el grupo del link /g/
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
    'document_url', o.document_url, 'document_name', o.document_name, 'group_id', o.group_id, 'created_at', o.created_at
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

-- ============================================================================
-- Integrantes de los grupos conectados desde la web (camino del WhatsApp vinculado)
-- ============================================================================

-- Como en la 280; además marca que la cuenta ya tiene a la gente del grupo
create or replace function public.connector_set_group_members(p_group_id uuid, p_members jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lista jsonb := coalesce(p_members, '[]'::jsonb);
begin
  -- Un grupo sin cuenta de un WhatsApp vinculado: solo su nombre, nadie de adentro
  if not public.grupo_guarda_integrantes(p_group_id) then
    return jsonb_build_object('members', 0, 'people_added', 0, 'stored', false);
  end if;

  -- Sin lista no se sabe nada: no se marca a nadie como fuera del grupo
  if jsonb_typeof(v_lista) <> 'array' or jsonb_array_length(v_lista) = 0 then
    return jsonb_build_object('members', public.group_member_count(p_group_id), 'people_added', 0);
  end if;

  insert into public.whatsapp_group_members as g (group_id, wa_id, phone, lid, name, is_admin)
  select distinct on (x ->> 'id')
         p_group_id, x ->> 'id',
         case when (x ->> 'phone') ~ '^[0-9]{6,20}$' then x ->> 'phone' end,
         case when (x ->> 'lid') ~ '^[0-9]{6,30}$' then x ->> 'lid' end,
         left(nullif(btrim(x ->> 'name'), ''), 120),
         coalesce((x ->> 'admin')::boolean, false)
  from jsonb_array_elements(v_lista) x
  where (x ->> 'id') ~ '^([0-9]{6,20}|lid:[0-9]{6,30})$'
  on conflict (group_id, wa_id) do update
    set phone = coalesce(excluded.phone, g.phone),
        lid = coalesce(excluded.lid, g.lid),
        name = coalesce(excluded.name, g.name),
        is_admin = excluded.is_admin,
        joined_at = case when g.left_at is not null then now() else g.joined_at end,
        left_at = null,
        updated_at = now();

  update public.whatsapp_group_members g set left_at = now(), updated_at = now()
  where g.group_id = p_group_id and g.left_at is null
    and not exists (select 1 from jsonb_array_elements(v_lista) x where x ->> 'id' = g.wa_id);

  update public.whatsapp_groups set participants_count = public.group_member_count(p_group_id) where id = p_group_id;
  update public.account_group_links set members_synced_at = now() where group_id = p_group_id;

  return jsonb_build_object('members', public.group_member_count(p_group_id), 'people_added', public.sync_group_people(p_group_id));
end;
$$;

-- Los grupos conectados que todavía no tienen a su gente, de las sesiones que
-- maneja este connector: [{"group_id", "jid", "connection_id"}]. Mister Luks primero.
create or replace function public.connector_groups_pending_members(p_connection_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('group_id', x.group_id, 'jid', x.jid, 'connection_id', x.connection_id)), '[]'::jsonb)
  from (
    select distinct on (g.id) g.id as group_id, g.wa_group_jid as jid, s.connection_id
    from public.account_group_links l
    join public.whatsapp_groups g on g.id = l.group_id and g.chat_kind = 'grupo'
    join public.whatsapp_group_sessions s on s.group_id = g.id and s.left_at is null
    join public.whatsapp_connections c on c.id = s.connection_id
    where l.members_synced_at is null and s.connection_id = any (p_connection_ids)
    order by g.id, (c.kind = 'contador') desc
    limit 20
  ) x
$$;

-- ============================================================================
-- Quién puede conectar un grupo
-- ============================================================================

-- Uno de sus números verificados está en el grupo (ahora)
create or replace function public.mi_numero_en_el_grupo(p_uid uuid, p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.whatsapp_group_members m
    join public.whatsapp_identities i on i.id = m.identity_id
    where m.group_id = p_group_id and m.left_at is null and i.user_id = p_uid and i.verified_at is not null
  )
$$;

-- 'link' (trae un link /g/ vigente y sin usar de ese grupo), 'mi_whatsapp' (su
-- WhatsApp vinculado está en el grupo), 'detectado' (su número verificado está
-- en un grupo de Mister Luks) o null
create or replace function public.acceso_al_grupo(p_uid uuid, p_group_id uuid, p_token text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_token is not null and exists (
      select 1 from public.group_links k
      where k.token_hash = public.hash_codigo(p_token) and k.group_id = p_group_id and k.used_at is null and k.expires_at > now()
    ) then 'link'
    when exists (
      select 1
      from public.whatsapp_group_sessions s
      join public.whatsapp_connections c on c.id = s.connection_id
      where s.group_id = p_group_id and s.left_at is null and c.kind = 'personal' and c.owner_id = p_uid
    ) then 'mi_whatsapp'
    when public.mi_numero_en_el_grupo(p_uid, p_group_id) and exists (
      select 1
      from public.whatsapp_group_sessions s
      join public.whatsapp_connections c on c.id = s.connection_id
      where s.group_id = p_group_id and s.left_at is null and c.kind = 'contador'
    ) then 'detectado'
  end
$$;

-- ============================================================================
-- Lo que ve la web
-- ============================================================================

-- El grupo de un link /g/ (p_token) o uno de los míos (p_group_id): su nombre,
-- quiénes están (nombre y últimos 4), si ya tiene cuenta y las cuentas que
-- administro (para conectarlo a una de ellas)
create or replace function public.preview_group(p_token text default null, p_group_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  k public.group_links%rowtype;
  g public.whatsapp_groups%rowtype;
  v_via text;
  v_cuenta public.accounts%rowtype;
  v_miembro boolean;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if p_token is not null then
    select * into k from public.group_links where token_hash = public.hash_codigo(p_token);
    if k.id is null then
      return jsonb_build_object('status', 'invalid');
    end if;
  end if;
  select * into g from public.whatsapp_groups
  where id = coalesce(k.group_id, p_group_id) and chat_kind = 'grupo';
  if g.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  select a.* into v_cuenta
  from public.account_group_links l join public.accounts a on a.id = l.account_id
  where l.group_id = g.id;
  v_miembro := v_cuenta.id is not null and exists (
    select 1 from public.account_members am where am.account_id = v_cuenta.id and am.user_id = v_uid
  );

  v_via := public.acceso_al_grupo(v_uid, g.id, p_token);
  if v_via is null then
    -- Un link usado o vencido: el nombre del grupo y, si tiene cuenta, cuál (para pedir entrar)
    if k.id is not null then
      return jsonb_build_object(
        'status', case when k.used_at is not null or v_cuenta.id is not null then 'used' else 'expired' end,
        'name', g.name,
        'linked', case when v_cuenta.id is not null then jsonb_build_object('account_id', case when v_miembro then v_cuenta.id end,
                                                                            'account_name', v_cuenta.name, 'member', v_miembro) end
      );
    end if;
    return jsonb_build_object('status', 'invalid');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'via', v_via,
    'group_id', g.id,
    'name', g.name,
    'mister_luks', exists (
      select 1 from public.whatsapp_group_sessions s join public.whatsapp_connections c on c.id = s.connection_id
      where s.group_id = g.id and s.left_at is null and c.kind = 'contador'
    ),
    'member_count', public.group_member_count(g.id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'last4', x.last4, 'me', x.me, 'user', x.usuario) order by x.me desc, x.name)
      from (
        select coalesce(public.nombre_de_whatsapp(m.name), 'WhatsApp ' || right(coalesce(m.phone, m.lid, m.wa_id), 4)) as name,
               right(coalesce(m.phone, m.lid, m.wa_id), 4) as last4,
               coalesce(i.user_id = v_uid and i.verified_at is not null, false) as me,
               coalesce(i.user_id is not null and i.verified_at is not null, false) as usuario
        from public.whatsapp_group_members m
        left join public.whatsapp_identities i on i.id = m.identity_id
        where m.group_id = g.id and m.left_at is null
          and not exists (
            select 1 from public.whatsapp_connections c
            where c.kind = 'contador'
              and (c.phone_number in (m.phone, m.wa_id) or public.lid_wa_id(c.wa_lid) in (m.wa_id, 'lid:' || m.lid))
          )
        limit 60
      ) x
    ), '[]'::jsonb),
    'in_group', v_via = 'mi_whatsapp' or public.mi_numero_en_el_grupo(v_uid, g.id),
    'linked', case when v_cuenta.id is not null then jsonb_build_object('account_id', case when v_miembro then v_cuenta.id end,
                                                                        'account_name', v_cuenta.name, 'member', v_miembro) end,
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type) order by a.created_at desc)
      from public.account_members am
      join public.accounts a on a.id = am.account_id
      where am.user_id = v_uid and am.role in ('owner', 'admin') and a.status <> 'closed'
    ), '[]'::jsonb)
  );
end;
$$;

-- Los grupos de Mister Luks sin cuenta donde está uno de mis números verificados
-- (la tarjeta «Nuevo grupo detectado» del inicio), menos los que dejé para después
create or replace function public.my_detected_groups()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'group_id', g.id,
    'name', g.name,
    'member_count', public.group_member_count(g.id),
    'names', (
      select coalesce(jsonb_agg(x.n), '[]'::jsonb)
      from (
        select split_part(btrim(public.nombre_de_whatsapp(m.name)), ' ', 1) as n
        from public.whatsapp_group_members m
        left join public.whatsapp_identities i on i.id = m.identity_id
        where m.group_id = g.id and m.left_at is null and public.nombre_de_whatsapp(m.name) is not null
          and (i.user_id is distinct from auth.uid())
        order by m.joined_at
        limit 4
      ) x
    )
  ) order by g.joined_at desc), '[]'::jsonb)
  from public.whatsapp_groups g
  where auth.uid() is not null
    and g.chat_kind = 'grupo' and g.left_at is null
    and not exists (select 1 from public.account_group_links l where l.group_id = g.id)
    and not exists (select 1 from public.group_detections_dismissed d where d.group_id = g.id and d.user_id = auth.uid())
    and public.acceso_al_grupo(auth.uid(), g.id, null) = 'detectado'
$$;

-- «Ahora no»
create or replace function public.dismiss_detected_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  insert into public.group_detections_dismissed (user_id, group_id) values (auth.uid(), p_group_id)
  on conflict do nothing;
end;
$$;

-- Los grupos de mi WhatsApp vinculado (solo el nombre) y si ya están conectados
create or replace function public.my_whatsapp_groups()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'group_id', x.id,
    'name', x.name,
    'account_id', case when x.miembro then x.account_id end,
    'account_name', case when x.miembro then x.account_name end,
    'linked_elsewhere', x.account_id is not null and not x.miembro,
    'mister_luks', x.mister_luks
  ) order by x.account_id is not null, x.last_message_at desc nulls last, x.name), '[]'::jsonb)
  from (
    select distinct on (g.id) g.id, g.name, g.last_message_at, l.account_id, a.name as account_name,
           exists (select 1 from public.account_members am where am.account_id = l.account_id and am.user_id = auth.uid()) as miembro,
           exists (
             select 1 from public.whatsapp_group_sessions s2 join public.whatsapp_connections c2 on c2.id = s2.connection_id
             where s2.group_id = g.id and s2.left_at is null and c2.kind = 'contador'
           ) as mister_luks
    from public.whatsapp_group_sessions s
    join public.whatsapp_connections c on c.id = s.connection_id and c.kind = 'personal' and c.owner_id = auth.uid()
    join public.whatsapp_groups g on g.id = s.group_id and g.chat_kind = 'grupo'
    left join public.account_group_links l on l.group_id = g.id
    left join public.accounts a on a.id = l.account_id
    where s.left_at is null and auth.uid() is not null
  ) x
$$;

-- ============================================================================
-- Crear la cuenta del grupo o conectarlo a una que ya existe
-- ============================================================================

-- El grupo queda conectado a la cuenta: su gente pasa a ser personas de ella (si
-- ya se conoce) y Mister Luks lo cuenta en el grupo (si está)
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
    else
      '🎉 ¡Listo! Este grupo quedó conectado a «' || a.name || '»'
        || case when v_n > 0 then ' y sus ' || v_n || ' integrantes ya están en la cuenta 🙌' else '' end || '.'
        || E'\n\nManden fotos de recibos, PDFs o mensajes con el monto (por ejemplo «taxi al aeropuerto 45 lucas») y yo los anoto ✅'
    end
  )));
end;
$$;

-- El grupo ya tiene cuenta (otra persona la creó primero): entro si mi número
-- verificado está en el grupo, como la persona de ese número
create or replace function public.entrar_por_el_grupo(p_uid uuid, p_group_id uuid, p_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pp public.people%rowtype;
  v_nombre text;
begin
  if exists (select 1 from public.account_members am where am.account_id = p_account_id and am.user_id = p_uid) then
    return p_account_id;
  end if;
  select a.name into v_nombre from public.accounts a where a.id = p_account_id;

  select p.* into pp
  from public.whatsapp_group_members m
  join public.whatsapp_identities i on i.id = m.identity_id and i.user_id = p_uid and i.verified_at is not null
  join public.person_whatsapp_ids w on w.wa_id = m.wa_id
  join public.people p on p.id = w.person_id and p.account_id = p_account_id
  where m.group_id = p_group_id and m.left_at is null
  order by p.claimed_by is null desc
  limit 1;
  if pp.id is null then
    raise exception 'Este grupo ya tiene cuenta («%»). Para entrar, escribe «luks soy yo» en el grupo y abre el link que te manda Mister Luks', v_nombre;
  end if;
  if pp.claimed_by is not null and pp.claimed_by <> p_uid then
    raise exception 'En «%» tu número ya es de otra persona. Pídele a quien la administra que lo arregle', v_nombre;
  end if;

  update public.people set claimed_by = p_uid where id = pp.id and claimed_by is null;
  insert into public.account_members (account_id, user_id, role, person_id)
  values (p_account_id, p_uid, 'member', pp.id)
  on conflict (account_id, user_id) do nothing;
  return p_account_id;
end;
$$;

-- Crear la cuenta del grupo: con el link /g/, con mi número verificado en un grupo de
-- Mister Luks o con mi WhatsApp vinculado en el grupo. Si ya la crearon, entro (si
-- mi número verificado está en el grupo). Devuelve la cuenta.
create or replace function public.create_account_from_group(
  p_group_id uuid,
  p_token text,
  p_name text,
  p_type public.account_type,
  p_starts_on date default null,
  p_ends_on date default null,
  p_display_name text default null,
  p_currency text default null,
  p_language text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  k public.group_links%rowtype;
  g public.whatsapp_groups%rowtype;
  v_cuenta uuid;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para crear una cuenta';
  end if;
  if p_token is not null then
    select * into k from public.group_links where token_hash = public.hash_codigo(p_token);
  end if;
  -- Uno a la vez por grupo
  select * into g from public.whatsapp_groups
  where id = coalesce(k.group_id, p_group_id) and chat_kind = 'grupo'
  for update;
  if g.id is null then
    raise exception 'Ese grupo no existe o el link no sirve';
  end if;

  select l.account_id into v_cuenta from public.account_group_links l where l.group_id = g.id;
  if v_cuenta is not null then
    return public.entrar_por_el_grupo(v_uid, g.id, v_cuenta);
  end if;
  if public.acceso_al_grupo(v_uid, g.id, p_token) is null then
    raise exception 'Este link ya no sirve (dura dos semanas). Escriban «ayuda» en el grupo y Mister Luks manda uno nuevo';
  end if;

  v_cuenta := public.create_account(coalesce(nullif(btrim(p_name), ''), g.name, 'Grupo'), p_type, p_starts_on, p_ends_on, p_display_name);
  if p_currency is not null or p_language is not null then
    perform public.set_account_settings(v_cuenta, p_currency, p_language);
  end if;
  perform public.conectar_grupo(g.id, v_cuenta, v_uid, case when public.acceso_al_grupo(v_uid, g.id, p_token) = 'link' then k.id end);
  return v_cuenta;
end;
$$;

-- Conectar el grupo a una cuenta que ya administro
create or replace function public.link_group_to_account(p_group_id uuid, p_token text, p_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  k public.group_links%rowtype;
  g public.whatsapp_groups%rowtype;
  v_actual uuid;
  v_via text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran esa cuenta pueden conectarle un grupo';
  end if;
  if exists (select 1 from public.accounts a where a.id = p_account_id and a.status = 'closed') then
    raise exception 'Esa cuenta está cerrada: ya no se le conectan grupos';
  end if;
  if p_token is not null then
    select * into k from public.group_links where token_hash = public.hash_codigo(p_token);
  end if;
  select * into g from public.whatsapp_groups
  where id = coalesce(k.group_id, p_group_id) and chat_kind = 'grupo'
  for update;
  if g.id is null then
    raise exception 'Ese grupo no existe o el link no sirve';
  end if;

  select l.account_id into v_actual from public.account_group_links l where l.group_id = g.id;
  if v_actual = p_account_id then
    return p_account_id;
  end if;
  if v_actual is not null then
    raise exception 'Este grupo ya está conectado a otra cuenta de Luks';
  end if;
  v_via := public.acceso_al_grupo(v_uid, g.id, p_token);
  if v_via is null then
    raise exception 'Este link ya no sirve (dura dos semanas). Escriban «ayuda» en el grupo y Mister Luks manda uno nuevo';
  end if;

  perform public.conectar_grupo(g.id, p_account_id, v_uid, case when v_via = 'link' then k.id end);
  return p_account_id;
end;
$$;

-- ============================================================================
-- Permisos
-- ============================================================================

revoke execute on function public.hash_codigo(text) from public, anon, authenticated;
revoke execute on function public.connector_group_detected(uuid, text, text, int, jsonb) from public, anon, authenticated;
revoke execute on function public.connector_group_link_mint(uuid) from public, anon, authenticated;
revoke execute on function public.connector_groups_pending_members(uuid[]) from public, anon, authenticated;
revoke execute on function public.acceso_al_grupo(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.mi_numero_en_el_grupo(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.conectar_grupo(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.entrar_por_el_grupo(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.preview_group(text, uuid) from public, anon;
revoke execute on function public.my_detected_groups() from public, anon;
revoke execute on function public.dismiss_detected_group(uuid) from public, anon;
revoke execute on function public.my_whatsapp_groups() from public, anon;
revoke execute on function public.create_account_from_group(uuid, text, text, public.account_type, date, date, text, text, text) from public, anon;
revoke execute on function public.link_group_to_account(uuid, text, uuid) from public, anon;

grant execute on function public.connector_group_detected(uuid, text, text, int, jsonb) to service_role;
grant execute on function public.connector_group_link_mint(uuid) to service_role;
grant execute on function public.connector_groups_pending_members(uuid[]) to service_role;
grant execute on function public.preview_group(text, uuid) to authenticated;
grant execute on function public.my_detected_groups() to authenticated;
grant execute on function public.dismiss_detected_group(uuid) to authenticated;
grant execute on function public.my_whatsapp_groups() to authenticated;
grant execute on function public.create_account_from_group(uuid, text, text, public.account_type, date, date, text, text, text) to authenticated;
grant execute on function public.link_group_to_account(uuid, text, uuid) to authenticated;
