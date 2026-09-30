-- ============================================================================
-- Lucas · 00000000000020_rpc.sql
-- Funciones RPC. Todas security definer + search_path = '' (todo referencia
-- calificada), validan permisos adentro y fallan con mensajes en español.
-- ============================================================================

-- ============================================================================
-- create_account: crea cuenta + membresía owner + persona reclamada
-- + las 7 categorías por defecto. Devuelve el id de la cuenta.
-- ============================================================================

create or replace function public.create_account(
  p_name text,
  p_type public.account_type,
  p_starts_on date default null,
  p_ends_on date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_account_id uuid;
  v_person_id uuid;
  v_nombre text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para crear una cuenta';
  end if;

  insert into public.accounts (name, type, owner_id, starts_on, ends_on)
  values (p_name, p_type, v_uid, p_starts_on, p_ends_on)
  returning id into v_account_id;

  select nullif(trim(pf.full_name), '') into v_nombre
  from public.profiles pf
  where pf.id = v_uid;
  v_nombre := coalesce(v_nombre, 'Yo');

  insert into public.people (account_id, display_name, claimed_by)
  values (v_account_id, v_nombre, v_uid)
  returning id into v_person_id;

  insert into public.account_members (account_id, user_id, role, person_id)
  values (v_account_id, v_uid, 'owner', v_person_id);

  insert into public.categories (account_id, name, letter, tone, is_default) values
    (v_account_id, 'Café',        'C', 'ambar',  true),
    (v_account_id, 'Licor',       'L', 'morado', true),
    (v_account_id, 'Mercado',     'M', 'verde',  true),
    (v_account_id, 'Transporte',  'T', 'cian',   true),
    (v_account_id, 'Hospedaje',   'H', 'azul',   true),
    (v_account_id, 'Restaurante', 'R', 'rojo',   true),
    (v_account_id, 'Servicios',   'S', 'rosa',   true);

  return v_account_id;
end;
$$;

-- ============================================================================
-- join_with_code: unirse a una cuenta con código de invitación.
-- Devuelve el account_id.
-- ============================================================================

create or replace function public.join_with_code(
  p_code text,
  p_person_id uuid default null,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invitations%rowtype;
  v_estado text;
  v_person_id uuid;
  v_claimed_by uuid;
  v_nombre text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para unirte a una cuenta';
  end if;

  select * into v_inv
  from public.invitations inv
  where inv.code = upper(trim(p_code));

  if not found then
    raise exception 'Código de invitación no válido';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'La invitación fue revocada';
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at <= now() then
    raise exception 'La invitación está vencida';
  end if;
  if v_inv.max_uses is not null and v_inv.uses >= v_inv.max_uses then
    raise exception 'La invitación ya alcanzó el máximo de usos';
  end if;

  select a.status into v_estado
  from public.accounts a
  where a.id = v_inv.account_id;
  if v_estado = 'closed' then
    raise exception 'La cuenta está cerrada';
  end if;

  if exists (
    select 1 from public.account_members am
    where am.account_id = v_inv.account_id and am.user_id = v_uid
  ) then
    raise exception 'Ya eres miembro de esta cuenta';
  end if;

  if p_person_id is not null then
    -- Reclamar una persona existente de la cuenta (sin reclamar o mía)
    select p.id, p.claimed_by into v_person_id, v_claimed_by
    from public.people p
    where p.id = p_person_id and p.account_id = v_inv.account_id;
    if not found then
      raise exception 'La persona no pertenece a esta cuenta';
    end if;
    if v_claimed_by is not null and v_claimed_by <> v_uid then
      raise exception 'Esta persona ya fue reclamada por otro miembro';
    end if;
    update public.people p
    set claimed_by = v_uid
    where p.id = p_person_id and p.claimed_by is null;
  else
    -- Crear persona nueva reclamada por mí
    select nullif(trim(pf.full_name), '') into v_nombre
    from public.profiles pf
    where pf.id = v_uid;
    v_nombre := coalesce(nullif(trim(p_display_name), ''), v_nombre, 'Nuevo miembro');

    insert into public.people (account_id, display_name, claimed_by)
    values (v_inv.account_id, v_nombre, v_uid)
    returning id into v_person_id;
  end if;

  insert into public.account_members (account_id, user_id, role, person_id)
  values (v_inv.account_id, v_uid, v_inv.role, v_person_id);

  update public.invitations inv
  set uses = inv.uses + 1
  where inv.id = v_inv.id;

  return v_inv.account_id;
end;
$$;

-- ============================================================================
-- claim_person: un miembro reclama una persona sin reclamar de su cuenta.
-- ============================================================================

create or replace function public.claim_person(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_account_id uuid;
  v_claimed_by uuid;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;

  select p.account_id, p.claimed_by into v_account_id, v_claimed_by
  from public.people p
  where p.id = p_person_id;
  if not found then
    raise exception 'La persona no existe';
  end if;

  if not public.is_account_member(v_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  if v_claimed_by is not null and v_claimed_by <> v_uid then
    raise exception 'Esta persona ya fue reclamada por otro miembro';
  end if;
  if exists (
    select 1 from public.people p
    where p.account_id = v_account_id
      and p.claimed_by = v_uid
      and p.id <> p_person_id
  ) then
    raise exception 'Ya tienes una persona reclamada en esta cuenta';
  end if;

  update public.people p
  set claimed_by = v_uid
  where p.id = p_person_id;

  update public.account_members am
  set person_id = p_person_id
  where am.account_id = v_account_id and am.user_id = v_uid;
end;
$$;

-- ============================================================================
-- set_member_role: cambiar el rol de un miembro (owner/admin).
-- La transferencia de ownership no existe en esta fase.
-- ============================================================================

create or replace function public.set_member_role(
  p_account_id uuid,
  p_user_id uuid,
  p_role public.member_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner_id uuid;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;

  if p_user_id = v_uid then
    raise exception 'No puedes cambiar tu propio rol';
  end if;
  if p_role = 'owner' then
    raise exception 'No se puede asignar el rol de dueño';
  end if;
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'No tienes permisos de administrador en esta cuenta';
  end if;

  select a.owner_id into v_owner_id
  from public.accounts a
  where a.id = p_account_id;
  if not found then
    raise exception 'La cuenta no existe';
  end if;
  if p_user_id = v_owner_id then
    raise exception 'No se puede cambiar el rol del dueño de la cuenta';
  end if;

  update public.account_members am
  set role = p_role
  where am.account_id = p_account_id and am.user_id = p_user_id;
  if not found then
    raise exception 'El usuario no es miembro de esta cuenta';
  end if;
end;
$$;

-- ============================================================================
-- remove_member: expulsar un miembro y liberar su persona reclamada.
-- ============================================================================

create or replace function public.remove_member(
  p_account_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner_id uuid;
  v_target_role public.member_role;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;

  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'No tienes permisos de administrador en esta cuenta';
  end if;

  select a.owner_id into v_owner_id
  from public.accounts a
  where a.id = p_account_id;
  if not found then
    raise exception 'La cuenta no existe';
  end if;
  if p_user_id = v_owner_id then
    raise exception 'No se puede expulsar al dueño de la cuenta';
  end if;

  select am.role into v_target_role
  from public.account_members am
  where am.account_id = p_account_id and am.user_id = p_user_id;
  if not found then
    raise exception 'El usuario no es miembro de esta cuenta';
  end if;

  if v_target_role = 'admin'
     and not public.has_account_role(p_account_id, array['owner']::public.member_role[]) then
    raise exception 'Un administrador no puede expulsar a otro administrador';
  end if;

  delete from public.account_members am
  where am.account_id = p_account_id and am.user_id = p_user_id;

  -- Liberar la persona que tenía reclamada, si tenía
  update public.people p
  set claimed_by = null
  where p.account_id = p_account_id and p.claimed_by = p_user_id;
end;
$$;

-- ============================================================================
-- create_invitation: código XXXX-XXXX (alfabeto sin 0/O/1/I/L, bytes
-- aleatorios de pgcrypto). Prefijo: primeras 4 letras del nombre de la cuenta
-- en mayúsculas y sin tildes (estilo PASEO-7K2Q). Devuelve el código.
-- ============================================================================

create or replace function public.create_invitation(
  p_account_id uuid,
  p_role public.member_role default 'member',
  p_expires_at timestamptz default null,
  p_max_uses int default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- sin 0/O/1/I/L
  v_nombre text;
  v_prefijo text;
  v_codigo text;
  v_bytes bytea;
  i int;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'No tienes permisos de administrador en esta cuenta';
  end if;
  if p_role = 'owner' then
    raise exception 'No se puede asignar el rol de dueño';
  end if;

  select a.name into v_nombre
  from public.accounts a
  where a.id = p_account_id;
  if not found then
    raise exception 'La cuenta no existe';
  end if;

  v_prefijo := regexp_replace(
    translate(upper(v_nombre), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'),
    '[^A-Z]', '', 'g');
  v_prefijo := substr(v_prefijo || 'XXXX', 1, 4);

  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_codigo := v_prefijo || '-';
    for i in 0..3 loop
      v_codigo := v_codigo || substr(c_alfabeto, (get_byte(v_bytes, i) % length(c_alfabeto)) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.invitations inv where inv.code = v_codigo);
  end loop;

  insert into public.invitations (account_id, code, role, expires_at, max_uses, created_by)
  values (p_account_id, v_codigo, p_role, p_expires_at, p_max_uses, auth.uid());

  return v_codigo;
end;
$$;

-- ============================================================================
-- revoke_invitation
-- ============================================================================

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;

  select inv.account_id into v_account_id
  from public.invitations inv
  where inv.id = p_invitation_id;
  if not found then
    raise exception 'La invitación no existe';
  end if;

  if not public.has_account_role(v_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'No tienes permisos de administrador en esta cuenta';
  end if;

  update public.invitations inv
  set revoked_at = now()
  where inv.id = p_invitation_id and inv.revoked_at is null;
end;
$$;

-- ============================================================================
-- close_account
-- ============================================================================

create or replace function public.close_account(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'No tienes permisos de administrador en esta cuenta';
  end if;

  update public.accounts a
  set status = 'closed', closed_at = now()
  where a.id = p_account_id and a.status = 'active';
  if not found then
    raise exception 'La cuenta no existe o ya está cerrada';
  end if;
end;
$$;
