-- ============================================================================
-- Lucas · 00000000000160_integrantes_del_grupo.sql
-- Las personas de la cuenta son las del grupo de WhatsApp.
--
--   · whatsapp_group_members: quién está en cada grupo, como lo ve el
--     connector (número, o «lid:…» si WhatsApp no lo muestra; nombre si se
--     sabe). Se actualiza al conectar y cada vez que alguien entra o sale.
--   · Cuando el grupo está enlazado a una cuenta, cada integrante es una
--     persona de esa cuenta: si su número ya es de alguien, nada; si es el
--     WhatsApp vinculado de alguien de la cuenta, es esa persona; si hay
--     alguien agregado a mano con el mismo nombre y sin WhatsApp, se le pone
--     el número; si no, se crea (con su nombre de WhatsApp o «WhatsApp 4567»).
--     Lo que ya había mandado queda a su nombre.
--   · El número contador (Luks) no es persona. Quien sale del grupo no se
--     borra: sus gastos siguen contando.
-- ============================================================================

create table public.whatsapp_group_members (
  group_id uuid not null references public.whatsapp_groups (id) on delete cascade,
  wa_id text not null check (wa_id ~ '^([0-9]{6,20}|lid:[0-9]{6,30})$'),
  phone text check (phone is null or phone ~ '^[0-9]{6,20}$'),
  lid text check (lid is null or lid ~ '^[0-9]{6,30}$'),
  name text check (length(name) <= 120),
  is_admin boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (group_id, wa_id)
);

alter table public.whatsapp_group_members enable row level security;
alter table public.whatsapp_group_members force row level security;
revoke all on public.whatsapp_group_members from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_group_members to service_role;

-- «123:4@lid» → «lid:123» (como identifica el connector a quien escribe)
create or replace function public.lid_wa_id(p_lid text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when nullif(p_lid, '') is null then null
              else 'lid:' || split_part(split_part(p_lid, '@', 1), ':', 1) end
$$;

-- Integrantes del grupo sin contar el número de Luks
create or replace function public.group_member_count(p_group_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.whatsapp_group_members m
  where m.group_id = p_group_id and m.left_at is null
    and not exists (
      select 1 from public.whatsapp_connections c
      where c.kind = 'contador'
        and (c.phone_number in (m.phone, m.wa_id) or public.lid_wa_id(c.wa_lid) in (m.wa_id, 'lid:' || m.lid))
    )
$$;

-- ============================================================================
-- Cada integrante del grupo es una persona de la cuenta
-- ============================================================================

create or replace function public.sync_group_people(p_group_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_added int := 0;
  m record;
  v_person uuid;
  v_name text;
  v_parecidos uuid[];
begin
  select l.account_id into v_account
  from public.account_group_links l
  join public.accounts a on a.id = l.account_id
  where l.group_id = p_group_id and a.status <> 'closed';
  if v_account is null then
    return 0;
  end if;

  for m in
    select * from public.whatsapp_group_members x
    where x.group_id = p_group_id and x.left_at is null
    order by x.joined_at, x.wa_id
  loop
    -- Ya es de alguien (por su número o por el LID con que escribió antes)
    v_person := coalesce(
      public.wa_person(v_account, m.wa_id),
      case when m.lid is not null then public.wa_person(v_account, 'lid:' || m.lid) end,
      case when m.phone is not null then public.wa_person(v_account, m.phone) end
    );
    if v_person is not null then
      insert into public.person_whatsapp_ids (person_id, wa_id) values (v_person, m.wa_id)
      on conflict (person_id, wa_id) do nothing;
      v_person := null;
      continue;
    end if;
    -- El número de Luks no es una persona
    if exists (
      select 1 from public.whatsapp_connections c
      where c.kind = 'contador'
        and (c.phone_number in (m.phone, m.wa_id) or public.lid_wa_id(c.wa_lid) in (m.wa_id, 'lid:' || m.lid))
    ) then
      continue;
    end if;

    -- El WhatsApp vinculado de alguien de la cuenta: es esa persona
    select p.id into v_person
    from public.whatsapp_connections c
    join public.people p on p.account_id = v_account and p.claimed_by = c.owner_id
    where c.kind = 'personal'
      and (c.phone_number in (m.phone, m.wa_id) or public.lid_wa_id(c.wa_lid) in (m.wa_id, 'lid:' || m.lid))
    limit 1;

    -- Alguien agregado a mano con el mismo nombre y sin WhatsApp (solo si es uno)
    if v_person is null and m.name is not null then
      select array_agg(p.id) into v_parecidos
      from public.people p
      where p.account_id = v_account
        and translate(lower(btrim(p.display_name)), 'áéíóúüñ', 'aeiouun') = translate(lower(btrim(m.name)), 'áéíóúüñ', 'aeiouun')
        and not exists (select 1 from public.person_whatsapp_ids w where w.person_id = p.id);
      if cardinality(v_parecidos) = 1 then
        v_person := v_parecidos[1];
      end if;
    end if;

    if v_person is null then
      v_name := left(coalesce(nullif(btrim(regexp_replace(m.name, '[[:space:]]+', ' ', 'g')), ''),
                              case when m.phone is not null then 'WhatsApp ' || right(m.phone, 4) else 'Alguien del grupo' end), 34);
      if exists (select 1 from public.people p where p.account_id = v_account and lower(p.display_name) = lower(v_name)) then
        v_name := v_name || ' ' || right(coalesce(m.phone, m.wa_id), 4);
      end if;
      insert into public.people (account_id, display_name) values (v_account, v_name) returning id into v_person;
      v_added := v_added + 1;
    end if;

    insert into public.person_whatsapp_ids (person_id, wa_id) values (v_person, m.wa_id)
    on conflict (person_id, wa_id) do nothing;

    -- Lo que ya había mandado ese número queda a su nombre (como en identify_wa_sender)
    update public.messages x set sender_person_id = v_person
    where x.account_id = v_account and x.sender_wa_id = m.wa_id and x.sender_person_id is null;
    update public.expenses e set payer_person_id = v_person
    from public.messages x
    where x.id = e.message_id and x.account_id = v_account and x.sender_wa_id = m.wa_id
      and e.payer_person_id is null and e.status = 'pending_review';
    v_person := null;
  end loop;
  return v_added;
end;
$$;

-- El connector manda la lista completa de integrantes de un grupo
-- p_members = [{"id": "573001234567" | "lid:…", "phone": "573001234567", "lid": "1234…", "name": "Mafe", "admin": false}, …]
create or replace function public.connector_set_group_members(p_group_id uuid, p_members jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lista jsonb := coalesce(p_members, '[]'::jsonb);
begin
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

  return jsonb_build_object('members', public.group_member_count(p_group_id), 'people_added', public.sync_group_people(p_group_id));
end;
$$;

-- ============================================================================
-- Enlazar el grupo también trae a sus integrantes
-- ============================================================================

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
  v_added int;
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

  -- Los integrantes del grupo pasan a ser las personas de la cuenta
  v_added := public.sync_group_people(v_group);

  return jsonb_build_object('ok', true, 'already', false, 'account_id', v_account, 'account_name', v_name, 'group_id', v_group,
                            'people_added', v_added, 'members', public.group_member_count(v_group));
end;
$$;

-- ============================================================================
-- La pantalla de WhatsApp: integrantes de cada grupo y personas de la cuenta
-- ============================================================================

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
    'people_count', (select count(*) from public.people p where p.account_id = p_account_id),
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
        'members', public.group_member_count(g.id),
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
    -- Quién más lee los grupos de esta cuenta: los WhatsApp personales
    -- vinculados (y vivos) de sus miembros. Cada uno lee los grupos donde está.
    'lectores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(p.display_name, pr.full_name, 'Alguien'),
        'is_me', wc.owner_id = auth.uid()
      ) order by wc.connected_at)
      from public.whatsapp_connections wc
      join public.account_members am on am.user_id = wc.owner_id and am.account_id = p_account_id
      left join public.people p on p.id = am.person_id
      left join public.profiles pr on pr.id = wc.owner_id
      where wc.kind = 'personal' and wc.status = 'connected'
        and wc.last_seen_at > now() - interval '3 minutes'
        and wc.stop_requested_at is null
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

-- ============================================================================
-- Permisos
-- ============================================================================

revoke execute on function public.lid_wa_id(text) from public, anon, authenticated;
revoke execute on function public.group_member_count(uuid) from public, anon, authenticated;
revoke execute on function public.sync_group_people(uuid) from public, anon, authenticated;
revoke execute on function public.connector_set_group_members(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lid_wa_id(text) to service_role;
grant execute on function public.group_member_count(uuid) to service_role;
grant execute on function public.sync_group_people(uuid) to service_role;
grant execute on function public.connector_set_group_members(uuid, jsonb) to service_role;
