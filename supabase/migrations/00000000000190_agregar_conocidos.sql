-- ============================================================================
-- Agregar a alguien que ya está conmigo en otra cuenta, sin código.
--
-- Christian crea la cuenta «Fiesta» y su esposa ya está con él en «Hogar»: en
-- Personas la elige de «De tus otras cuentas» y queda de una vez como persona
-- de la cuenta (ya se pueden dividir gastos con ella). A ella le llega en su
-- home de Luks: «Christian te agregó a Fiesta» → Aceptar (entra como miembro
-- con esa persona) o Ahora no.
-- ============================================================================

create table public.account_invites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  -- A quién: un usuario de Luks
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- La persona que ya quedó en la cuenta con su nombre; al aceptar, es la suya
  person_id uuid not null references public.people (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (account_id, user_id),
  unique (person_id)
);

create index account_invites_usuario_idx on public.account_invites (user_id);

-- La ve quien la recibe y quien administra la cuenta; se escribe solo por RPC
alter table public.account_invites enable row level security;
alter table public.account_invites force row level security;
revoke all on public.account_invites from anon, authenticated;
grant select on public.account_invites to authenticated;
grant select, insert, update, delete on public.account_invites to service_role;

create policy account_invites_select on public.account_invites
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_account_role(account_id, array['owner', 'admin']::public.member_role[])
  );

-- ¿Los dos están juntos en alguna cuenta (que no sea esta)?
create or replace function public.share_an_account(p_a uuid, p_b uuid, p_except uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_members x
    join public.account_members y on y.account_id = x.account_id and y.user_id = p_b
    where x.user_id = p_a and x.account_id is distinct from p_except
  )
$$;

-- Cómo se llama alguien para mí: su nombre en la cuenta que compartimos más
-- reciente (o el de su perfil), y su color
create or replace function public.known_as(p_me uuid, p_user uuid)
returns table (name text, tone public.tone)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
           (select p.display_name
            from public.account_members am
            join public.people p on p.id = am.person_id
            join public.account_members yo on yo.account_id = am.account_id and yo.user_id = p_me
            where am.user_id = p_user
            order by am.joined_at desc
            limit 1),
           nullif(btrim(pf.full_name), ''),
           'Alguien'
         ),
         (select p.tone
          from public.account_members am
          join public.people p on p.id = am.person_id
          join public.account_members yo on yo.account_id = am.account_id and yo.user_id = p_me
          where am.user_id = p_user
          order by am.joined_at desc
          limit 1)
  from public.profiles pf
  where pf.id = p_user
$$;

-- ============================================================================
-- Quiénes se pueden agregar: los de mis otras cuentas que no están en esta
-- (ni tienen ya la invitación). Solo para quien administra la cuenta.
-- ============================================================================

create or replace function public.people_to_add(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quien administra la cuenta puede agregar personas';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', u.user_id,
      'name', k.name,
      'tone', k.tone,
      'accounts', u.accounts
    ) order by k.name)
    from (
      select o.user_id, array_agg(distinct a.name order by a.name) as accounts
      from public.account_members yo
      join public.account_members o on o.account_id = yo.account_id and o.user_id <> v_uid
      join public.accounts a on a.id = yo.account_id
      where yo.user_id = v_uid
        and yo.account_id <> p_account_id
        and not exists (select 1 from public.account_members m where m.account_id = p_account_id and m.user_id = o.user_id)
        and not exists (select 1 from public.account_invites i where i.account_id = p_account_id and i.user_id = o.user_id)
      group by o.user_id
    ) u
    cross join lateral public.known_as(v_uid, u.user_id) k
  ), '[]'::jsonb);
end;
$$;

-- ============================================================================
-- Agregarlos: cada uno queda como persona de la cuenta (o se usa la que ya
-- estaba con su nombre y sin usuario) y le llega la invitación.
-- ============================================================================

create or replace function public.invite_people(p_account_id uuid, p_user_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user uuid;
  v_name text;
  v_tone public.tone;
  v_person uuid;
  v_personas uuid[] := '{}';
begin
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quien administra la cuenta puede agregar personas';
  end if;
  if exists (select 1 from public.accounts a where a.id = p_account_id and a.status = 'closed') then
    raise exception 'La cuenta está cerrada: ya no entran personas';
  end if;
  if coalesce(cardinality(p_user_ids), 0) = 0 then
    raise exception 'Elige a quién agregar';
  end if;

  foreach v_user in array (select array_agg(distinct x) from unnest(p_user_ids) x) loop
    -- Solo alguien que ya está conmigo en otra cuenta
    if v_user = v_uid or not public.share_an_account(v_uid, v_user, p_account_id) then
      raise exception 'Esa persona no está en tus otras cuentas';
    end if;
    continue when exists (select 1 from public.account_members m where m.account_id = p_account_id and m.user_id = v_user);
    continue when exists (select 1 from public.account_invites i where i.account_id = p_account_id and i.user_id = v_user);

    select k.name, k.tone into v_name, v_tone from public.known_as(v_uid, v_user) k;
    v_name := left(v_name, 40);

    -- ¿Ya estaba con su nombre y sin usuario (la agregaron a mano o vino del grupo)? Esa es
    select p.id into v_person
    from public.people p
    where p.account_id = p_account_id and p.claimed_by is null
      and lower(btrim(p.display_name)) = lower(btrim(v_name))
      and not exists (select 1 from public.account_invites i where i.person_id = p.id)
    order by p.created_at
    limit 1;

    if v_person is null then
      if exists (select 1 from public.people p where p.account_id = p_account_id and lower(p.display_name) = lower(v_name)) then
        v_name := left(v_name, 37) || ' 2';
      end if;
      insert into public.people (account_id, display_name, tone)
      values (p_account_id, v_name, v_tone)
      returning id into v_person;
    end if;

    insert into public.account_invites (account_id, user_id, person_id, invited_by)
    values (p_account_id, v_user, v_person, v_uid);
    v_personas := v_personas || v_person;
    v_person := null;
  end loop;

  return jsonb_build_object('invited', cardinality(v_personas), 'person_ids', to_jsonb(v_personas));
end;
$$;

-- ============================================================================
-- Lo que me llegó (el home), aceptar, decir que no y cancelar
-- ============================================================================

create or replace function public.my_invites()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'account_id', a.id,
    'account_name', a.name,
    'account_type', a.type,
    'starts_on', a.starts_on,
    'ends_on', a.ends_on,
    'person_name', p.display_name,
    'invited_by', coalesce(
      (select q.display_name from public.people q where q.account_id = a.id and q.claimed_by = i.invited_by),
      nullif(btrim(pf.full_name), ''),
      'Alguien'
    ),
    'people_count', (select count(*) from public.people q where q.account_id = a.id),
    'created_at', i.created_at
  ) order by i.created_at desc), '[]'::jsonb)
  from public.account_invites i
  join public.accounts a on a.id = i.account_id and a.status <> 'closed'
  join public.people p on p.id = i.person_id
  left join public.profiles pf on pf.id = i.invited_by
  where i.user_id = auth.uid()
$$;

create or replace function public.accept_invite(p_invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  i public.account_invites%rowtype;
  v_person uuid;
  v_nombre text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into i from public.account_invites x where x.id = p_invite_id and x.user_id = v_uid for update;
  if not found then
    raise exception 'Esa invitación ya no está';
  end if;
  if exists (select 1 from public.accounts a where a.id = i.account_id and a.status = 'closed') then
    raise exception 'La cuenta está cerrada';
  end if;

  -- Si ya entró por otro lado (con el código), solo se borra la invitación
  if not exists (select 1 from public.account_members m where m.account_id = i.account_id and m.user_id = v_uid) then
    select p.id into v_person from public.people p where p.id = i.person_id and p.claimed_by is null for update;
    if v_person is null then
      -- Su persona la tomó otro usuario: entra con una nueva, con el mismo nombre
      select k.name into v_nombre from public.known_as(i.invited_by, v_uid) k;
      insert into public.people (account_id, display_name)
      values (i.account_id, left(coalesce(v_nombre, 'Alguien') || ' 2', 40))
      returning id into v_person;
    end if;
    update public.people p set claimed_by = v_uid where p.id = v_person;
    insert into public.account_members (account_id, user_id, role, person_id)
    values (i.account_id, v_uid, 'member', v_person);
  end if;

  delete from public.account_invites x where x.id = i.id;
  return i.account_id;
end;
$$;

-- «Ahora no»: se borra la invitación; su nombre queda en la cuenta, sin usuario
create or replace function public.decline_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.account_invites x where x.id = p_invite_id and x.user_id = auth.uid();
  if not found then
    raise exception 'Esa invitación ya no está';
  end if;
end;
$$;

-- Quien administra la cuenta deja de esperar a que acepte
create or replace function public.cancel_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
begin
  select x.account_id into v_account from public.account_invites x where x.id = p_invite_id;
  if v_account is null then
    raise exception 'Esa invitación ya no está';
  end if;
  if not public.has_account_role(v_account, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quien administra la cuenta puede cancelar la invitación';
  end if;
  delete from public.account_invites x where x.id = p_invite_id;
end;
$$;

-- ============================================================================
-- Permisos
-- ============================================================================

revoke execute on function public.share_an_account(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.known_as(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.people_to_add(uuid) from public, anon;
revoke execute on function public.invite_people(uuid, uuid[]) from public, anon;
revoke execute on function public.my_invites() from public, anon;
revoke execute on function public.accept_invite(uuid) from public, anon;
revoke execute on function public.decline_invite(uuid) from public, anon;
revoke execute on function public.cancel_invite(uuid) from public, anon;
grant execute on function public.people_to_add(uuid) to authenticated;
grant execute on function public.invite_people(uuid, uuid[]) to authenticated;
grant execute on function public.my_invites() to authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;
grant execute on function public.decline_invite(uuid) to authenticated;
grant execute on function public.cancel_invite(uuid) to authenticated;
