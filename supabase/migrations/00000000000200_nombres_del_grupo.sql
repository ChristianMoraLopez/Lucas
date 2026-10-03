-- ============================================================================
-- Lucas · 00000000000200_nombres_del_grupo.sql
-- Las personas que vienen del grupo de WhatsApp se ven con su nombre, no con
-- «WhatsApp 4567».
--
--   · people.name_source: de dónde salió el nombre
--       auto      «WhatsApp 4567» / «Alguien del grupo»: todavía no se sabe
--       whatsapp  el que tiene en WhatsApp (su perfil o como lo guardó quien
--                 vinculó su WhatsApp)
--       manual    lo puso alguien que administra la cuenta (un alias)
--       user      tiene usuario en Luks: lo eligió esa persona
--   · aprender_nombre(): cuando se sabe el nombre de WhatsApp de alguien, se le
--     pone, solo si su nombre era el automático (o si era el de WhatsApp y
--     llega el de su perfil). Un alias o el que eligió la persona no se toca.
--     Se aprende de los integrantes del grupo (el connector los vuelve a mandar
--     cuando sabe un nombre nuevo) y de los mensajes que llegan.
--   · rename_person(): quien administra le pone un alias a quien no tiene
--     usuario; quien tiene usuario elige el suyo (nadie más se lo cambia).
--   · Lo que ya estaba: se completa con los nombres que ya se sabían
--     (mensajes, remitentes, integrantes).
-- ============================================================================

alter table public.people
  add column name_source text not null default 'manual'
  check (name_source in ('auto', 'whatsapp', 'manual', 'user'));

update public.people set name_source = 'user' where claimed_by is not null;
update public.people p set name_source = 'auto'
where p.claimed_by is null
  and p.display_name ~ '^(WhatsApp [0-9]{4}|Alguien del grupo)( [0-9]{4})?$'
  and exists (select 1 from public.person_whatsapp_ids w where w.person_id = p.id);

-- Para encontrar rápido a alguien en todos los grupos
create index if not exists whatsapp_group_members_wa_id_idx on public.whatsapp_group_members (wa_id);

-- ============================================================================
-- El nombre de quien tiene usuario lo cambia solo esa persona
-- ============================================================================

-- security invoker: current_user dice si el cambio vino directo de la API
-- (authenticated) o de una función de Luks
create or replace function public.people_nombre()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.claimed_by is not null then
      new.name_source := 'user';
    end if;
    return new;
  end if;

  if new.display_name is distinct from old.display_name then
    if old.claimed_by is not null and auth.uid() is not null and old.claimed_by <> auth.uid() then
      raise exception '«%» tiene cuenta en Luks: su nombre lo elige desde su perfil', old.display_name;
    end if;
    -- Cambiado a mano (no por una función de Luks): ya no es el de WhatsApp
    if current_user = 'authenticated' then
      new.name_source := 'manual';
    end if;
  end if;

  if new.claimed_by is not null then
    new.name_source := 'user';
  elsif old.claimed_by is not null then
    -- Salió de la cuenta: su nombre queda, y ahora lo cambia quien administra
    new.name_source := 'manual';
  end if;
  return new;
end;
$$;

create trigger trg_people_nombre
  before insert or update on public.people
  for each row execute function public.people_nombre();

-- ============================================================================
-- Aprender el nombre de WhatsApp
-- ============================================================================

-- El nombre de WhatsApp limpio (sin espacios de más, máximo 34 para que quepa
-- « 4567» si se repite); null si no hay o si es solo un número
create or replace function public.nombre_de_whatsapp(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when v = '' or v ~ '^[-0-9+() .]*$' then null else btrim(left(v, 34)) end
  from (select btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'), '[[:space:]]+', ' ', 'g')) as v) x
$$;

-- p_perfil: el nombre es el que la persona se puso en WhatsApp (no como la
-- guardó alguien). Ese reemplaza también a un nombre de WhatsApp anterior.
create or replace function public.aprender_nombre(p_account uuid, p_wa_id text, p_name text, p_perfil boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.nombre_de_whatsapp(p_name);
  v_person uuid;
  p public.people%rowtype;
begin
  if v_name is null or p_account is null or p_wa_id is null then
    return false;
  end if;
  v_person := public.wa_person(p_account, p_wa_id);
  if v_person is null then
    return false;
  end if;
  select * into p from public.people x where x.id = v_person for update;
  if p.claimed_by is not null or not (p.name_source = 'auto' or (p.name_source = 'whatsapp' and p_perfil)) then
    return false;
  end if;

  -- Si ya hay alguien con ese nombre, se le ponen los últimos cuatro números
  if exists (select 1 from public.people o where o.account_id = p.account_id and o.id <> p.id and lower(o.display_name) = lower(v_name)) then
    v_name := v_name || ' ' || right(regexp_replace(p_wa_id, '[^0-9]', '', 'g'), 4);
    if exists (select 1 from public.people o where o.account_id = p.account_id and o.id <> p.id and lower(o.display_name) = lower(v_name)) then
      return false;
    end if;
  end if;
  if p.display_name = v_name and p.name_source = 'whatsapp' then
    return false;
  end if;

  update public.people set display_name = v_name, name_source = 'whatsapp' where id = p.id;
  return true;
end;
$$;

-- Lo que llega al grupo trae el nombre que la persona se puso en WhatsApp
create or replace function public.messages_aprender_nombre()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.aprender_nombre(new.account_id, new.sender_wa_id, new.sender_name, true);
  return null;
end;
$$;

create trigger trg_messages_aprender_nombre
  after insert on public.messages
  for each row
  when (new.source = 'whatsapp' and new.sender_wa_id is not null and new.sender_name is not null)
  execute function public.messages_aprender_nombre();

-- ============================================================================
-- Cada integrante del grupo es una persona de la cuenta (como en la 160),
-- ahora con su nombre de WhatsApp cuando se sabe
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
  v_wa_name text;
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
    -- Su nombre de WhatsApp: el del grupo o, si ya escribió, el que traían sus mensajes
    v_wa_name := coalesce(
      public.nombre_de_whatsapp(m.name),
      (select public.nombre_de_whatsapp(s.push_name) from public.whatsapp_senders s
       where s.account_id = v_account and s.wa_id in (m.wa_id, m.phone, 'lid:' || m.lid)
         and public.nombre_de_whatsapp(s.push_name) is not null
       order by s.last_seen_at desc limit 1)
    );

    -- Ya es de alguien (por su número o por el LID con que escribió antes)
    v_person := coalesce(
      public.wa_person(v_account, m.wa_id),
      case when m.lid is not null then public.wa_person(v_account, 'lid:' || m.lid) end,
      case when m.phone is not null then public.wa_person(v_account, m.phone) end
    );
    if v_person is not null then
      insert into public.person_whatsapp_ids (person_id, wa_id) values (v_person, m.wa_id)
      on conflict (person_id, wa_id) do nothing;
      -- Si todavía se llamaba «WhatsApp 4567», ahora con su nombre
      perform public.aprender_nombre(v_account, m.wa_id, v_wa_name, false);
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
    if v_person is null and v_wa_name is not null then
      select array_agg(p.id) into v_parecidos
      from public.people p
      where p.account_id = v_account
        and translate(lower(btrim(p.display_name)), 'áéíóúüñ', 'aeiouun') = translate(lower(v_wa_name), 'áéíóúüñ', 'aeiouun')
        and not exists (select 1 from public.person_whatsapp_ids w where w.person_id = p.id);
      if cardinality(v_parecidos) = 1 then
        v_person := v_parecidos[1];
      end if;
    end if;

    if v_person is null then
      v_name := coalesce(v_wa_name, case when m.phone is not null then 'WhatsApp ' || right(m.phone, 4) else 'Alguien del grupo' end);
      if exists (select 1 from public.people p where p.account_id = v_account and lower(p.display_name) = lower(v_name)) then
        v_name := v_name || ' ' || right(coalesce(m.phone, m.wa_id), 4);
      end if;
      insert into public.people (account_id, display_name, name_source)
      values (v_account, v_name, case when v_wa_name is null then 'auto' else 'whatsapp' end)
      returning id into v_person;
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

-- ============================================================================
-- Un alias para quien no tiene usuario; quien tiene usuario elige el suyo
-- ============================================================================

create or replace function public.rename_person(p_person_id uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  p public.people%rowtype;
  v_nombre text := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into p from public.people x where x.id = p_person_id for update;
  if p.id is null or not public.is_account_member(p.account_id) then
    raise exception 'Esa persona no está en tus cuentas';
  end if;
  if p.claimed_by is not null and p.claimed_by <> v_uid then
    raise exception '«%» tiene cuenta en Luks: su nombre lo elige desde su perfil', p.display_name;
  end if;
  if p.claimed_by is null and not public.has_account_role(p.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quien administra la cuenta le cambia el nombre a los demás';
  end if;
  if length(v_nombre) < 1 or length(v_nombre) > 40 then
    raise exception 'El nombre va de 1 a 40 letras';
  end if;
  if exists (select 1 from public.people o where o.account_id = p.account_id and o.id <> p.id and lower(o.display_name) = lower(v_nombre)) then
    raise exception 'Ya hay alguien que se llama «%» en la cuenta', v_nombre;
  end if;

  update public.people
  set display_name = v_nombre, name_source = case when p.claimed_by is null then 'manual' else 'user' end
  where id = p.id;
  return v_nombre;
end;
$$;

-- ============================================================================
-- Lo que ya estaba: «WhatsApp 4567» con el nombre que ya se sabía
-- ============================================================================

do $$
declare
  r record;
begin
  for r in
    select p.account_id, w.wa_id, coalesce(
      (select x.sender_name from public.messages x
       where x.account_id = p.account_id and x.sender_wa_id = w.wa_id and public.nombre_de_whatsapp(x.sender_name) is not null
       order by x.received_at desc limit 1),
      (select s.push_name from public.whatsapp_senders s
       where s.account_id = p.account_id and s.wa_id = w.wa_id and public.nombre_de_whatsapp(s.push_name) is not null),
      (select m.name from public.whatsapp_group_members m
       join public.account_group_links l on l.group_id = m.group_id
       where l.account_id = p.account_id and m.wa_id = w.wa_id and public.nombre_de_whatsapp(m.name) is not null
       limit 1)
    ) as nombre
    from public.people p
    join public.person_whatsapp_ids w on w.person_id = p.id
    where p.name_source = 'auto'
  loop
    perform public.aprender_nombre(r.account_id, r.wa_id, r.nombre, true);
  end loop;
end;
$$;

-- ============================================================================
-- Permisos
-- ============================================================================

revoke execute on function public.people_nombre() from public, anon, authenticated;
revoke execute on function public.nombre_de_whatsapp(text) from public, anon, authenticated;
revoke execute on function public.aprender_nombre(uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.messages_aprender_nombre() from public, anon, authenticated;
revoke execute on function public.rename_person(uuid, text) from public, anon;
grant execute on function public.nombre_de_whatsapp(text) to service_role;
grant execute on function public.aprender_nombre(uuid, text, text, boolean) to service_role;
grant execute on function public.rename_person(uuid, text) to authenticated;
