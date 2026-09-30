-- ============================================================================
-- Lucas · 00000000000020_rpc.sql
-- Funciones RPC. Las que cambian datos son security definer + search_path = ''
-- (todo va calificado), validan permisos adentro y fallan con mensajes en
-- español. Las de lectura son security invoker: RLS decide qué ven.
-- ============================================================================

-- ============================================================================
-- Auxiliares internas
-- ============================================================================

-- Prefijo del código de invitación: la primera palabra de 3+ letras del
-- nombre de la cuenta, en mayúsculas, sin tildes y de máximo 8 letras.
-- «Paseo Santa Marta» → PASEO · «Mi casa» → CASA · «Apto 402» → APTO.
create or replace function public.invitation_prefix(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_limpio text := translate(upper(coalesce(p_name, '')), 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ', 'AAAAEEEEIIIIOOOOUUUUN');
  v_palabra text;
begin
  foreach v_palabra in array regexp_split_to_array(v_limpio, '[^A-Z]+') loop
    if length(v_palabra) >= 3 then
      return left(v_palabra, 8);
    end if;
  end loop;
  v_limpio := regexp_replace(v_limpio, '[^A-Z]', '', 'g');
  if length(v_limpio) >= 3 then
    return left(v_limpio, 8);
  end if;
  return 'LUCAS';
end;
$$;

-- Si el perfil aún no tiene nombre (entró con enlace mágico), usa el que la
-- persona escribió al crear o unirse a una cuenta.
create or replace function public.fill_my_profile_name(p_name text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles pf
  set full_name = trim(p_name)
  where pf.id = (select auth.uid())
    and nullif(trim(pf.full_name), '') is null
    and nullif(trim(p_name), '') is not null;
$$;

-- ============================================================================
-- create_account: crea cuenta + membresía owner + persona reclamada
-- + las 8 categorías por defecto. Devuelve el id de la cuenta.
-- ============================================================================

create or replace function public.create_account(
  p_name text,
  p_type public.account_type,
  p_starts_on date default null,
  p_ends_on date default null,
  p_display_name text default null
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
  if nullif(trim(p_name), '') is null then
    raise exception 'Ponle un nombre a la cuenta';
  end if;
  if p_starts_on is not null and p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'La fecha de fin no puede ser antes de la de inicio';
  end if;

  insert into public.accounts (name, type, owner_id, starts_on, ends_on)
  values (
    trim(p_name),
    p_type,
    v_uid,
    case when p_type = 'evento' then p_starts_on end,
    case when p_type = 'evento' then p_ends_on end
  )
  returning id into v_account_id;

  select nullif(trim(pf.full_name), '') into v_nombre
  from public.profiles pf
  where pf.id = v_uid;
  v_nombre := coalesce(nullif(trim(p_display_name), ''), v_nombre, 'Yo');
  perform public.fill_my_profile_name(p_display_name);

  insert into public.people (account_id, display_name, claimed_by)
  values (v_account_id, v_nombre, v_uid)
  returning id into v_person_id;

  insert into public.account_members (account_id, user_id, role, person_id)
  values (v_account_id, v_uid, 'owner', v_person_id);

  -- Mismas letras y tonos que CATEGORIES en components/lucas-ui.tsx
  insert into public.categories (account_id, name, letter, tone, is_default) values
    (v_account_id, 'Café',        'C', 'naranja',  true),
    (v_account_id, 'Licor',       'L', 'morado',   true),
    (v_account_id, 'Mercado',     'M', 'verde',    true),
    (v_account_id, 'Transporte',  'T', 'azul',     true),
    (v_account_id, 'Hospedaje',   'H', 'turquesa', true),
    (v_account_id, 'Restaurante', 'R', 'coral',    true),
    (v_account_id, 'Servicios',   'S', 'amarillo', true),
    (v_account_id, 'Otros',       'O', 'rosa',     true);

  return v_account_id;
end;
$$;

-- ============================================================================
-- preview_invitation: vista previa de una invitación ANTES de unirse, para
-- mostrar «¿Eres alguna de estas personas?». No exige membresía (por eso es
-- security definer) y solo expone datos mínimos: nombre y tipo de la cuenta,
-- quién la creó y nombre/tono de las personas sin reclamar.
-- ============================================================================

create or replace function public.preview_invitation(p_code text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invitations%rowtype;
  v_account public.accounts%rowtype;
  v_owner text;
  v_people json;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para ver una invitación';
  end if;

  select * into v_inv
  from public.invitations inv
  where inv.code = upper(trim(p_code));

  if not found then
    raise exception 'Ese código no existe. Revisa que esté bien escrito';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'Ese código ya no sirve: generaron uno nuevo';
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at <= now() then
    raise exception 'Ese código ya venció. Pide uno nuevo';
  end if;
  if v_inv.max_uses is not null and v_inv.uses >= v_inv.max_uses then
    raise exception 'Ese código ya se usó todas las veces permitidas';
  end if;

  select * into v_account
  from public.accounts a
  where a.id = v_inv.account_id;

  if v_account.status = 'closed' then
    raise exception 'Esa cuenta ya está cerrada';
  end if;

  select split_part(coalesce(nullif(trim(pf.full_name), ''), 'alguien'), ' ', 1) into v_owner
  from public.profiles pf
  where pf.id = v_account.owner_id;

  select coalesce(json_agg(json_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'tone', p.tone,
    'wa_last4', (select right(w.wa_id, 4) from public.person_whatsapp_ids w
                 where w.person_id = p.id order by w.created_at limit 1),
    'paid_count', (select count(*) from public.expenses e where e.payer_person_id = p.id)
  ) order by p.display_name), '[]'::json)
  into v_people
  from public.people p
  where p.account_id = v_inv.account_id
    and p.claimed_by is null;

  return json_build_object(
    'account_id', v_account.id,
    'account_name', v_account.name,
    'account_type', v_account.type,
    'starts_on', v_account.starts_on,
    'ends_on', v_account.ends_on,
    'owner_name', v_owner,
    'role', v_inv.role,
    'already_member', exists (
      select 1 from public.account_members am
      where am.account_id = v_account.id and am.user_id = v_uid
    ),
    'people_count', (select count(*) from public.people p where p.account_id = v_account.id),
    'unclaimed_people', v_people
  );
end;
$$;

-- ============================================================================
-- join_with_code: unirse a una cuenta con código de invitación, reclamando
-- una persona existente o creando una nueva. Devuelve el account_id.
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

  -- for update: dos personas usando el último cupo a la vez no lo exceden
  select * into v_inv
  from public.invitations inv
  where inv.code = upper(trim(p_code))
  for update;

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
    -- Reclamar una persona existente de la cuenta que nadie haya reclamado
    select p.id, p.claimed_by into v_person_id, v_claimed_by
    from public.people p
    where p.id = p_person_id and p.account_id = v_inv.account_id
    for update;
    if not found then
      raise exception 'La persona no pertenece a esta cuenta';
    end if;
    if v_claimed_by is not null then
      raise exception 'Esta persona ya fue reclamada por otro miembro';
    end if;
    update public.people p
    set claimed_by = v_uid
    where p.id = p_person_id;

    select p.display_name into v_nombre from public.people p where p.id = p_person_id;
    perform public.fill_my_profile_name(v_nombre);
  else
    -- Crear persona nueva reclamada por mí
    select nullif(trim(pf.full_name), '') into v_nombre
    from public.profiles pf
    where pf.id = v_uid;
    v_nombre := coalesce(nullif(trim(p_display_name), ''), v_nombre);
    if v_nombre is null then
      raise exception 'Escribe tu nombre para entrar como persona nueva';
    end if;
    perform public.fill_my_profile_name(v_nombre);

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
-- claim_person: un miembro reclama una persona sin reclamar de su cuenta
-- (entró como persona nueva y después vio que ya existía: «Felipe» del grupo).
-- La persona que tenía se borra si todavía no tiene gastos; si ya tiene, hay
-- que unirlas a mano (un admin), para no perder plata por el camino.
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
  v_actual uuid;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;

  select p.account_id, p.claimed_by into v_account_id, v_claimed_by
  from public.people p
  where p.id = p_person_id
  for update;
  if not found then
    raise exception 'La persona no existe';
  end if;

  if not public.is_account_member(v_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  if v_claimed_by is not null then
    if v_claimed_by = v_uid then
      return; -- ya es mía
    end if;
    raise exception 'Esta persona ya fue reclamada por otro miembro';
  end if;

  select p.id into v_actual
  from public.people p
  where p.account_id = v_account_id and p.claimed_by = v_uid;

  if v_actual is not null then
    if exists (select 1 from public.expenses e where e.payer_person_id = v_actual)
       or exists (select 1 from public.expense_splits s where s.person_id = v_actual) then
      raise exception 'Tu persona actual ya tiene gastos. Pídele a un admin que las una';
    end if;
    update public.account_members am
    set person_id = null
    where am.account_id = v_account_id and am.user_id = v_uid;
    delete from public.people p where p.id = v_actual;
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
-- set_member_role: cambiar el rol de un miembro entre admin y member.
-- - Nadie cambia su propio rol ni el del owner, y nadie se vuelve owner.
-- - Un admin nombra admins; bajar a un admin es cosa del owner.
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
  v_target_role public.member_role;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;

  if p_user_id = v_uid then
    raise exception 'No puedes cambiar tu propio rol';
  end if;
  if p_role = 'owner' then
    raise exception 'No se puede asignar el rol de titular';
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
    raise exception 'No se puede cambiar el rol del titular de la cuenta';
  end if;

  select am.role into v_target_role
  from public.account_members am
  where am.account_id = p_account_id and am.user_id = p_user_id;
  if not found then
    raise exception 'El usuario no es miembro de esta cuenta';
  end if;

  if v_target_role = 'admin' and p_role <> 'admin'
     and not public.has_account_role(p_account_id, array['owner']::public.member_role[]) then
    raise exception 'Solo el titular de la cuenta puede quitarle el rol a un administrador';
  end if;

  update public.account_members am
  set role = p_role
  where am.account_id = p_account_id and am.user_id = p_user_id;
end;
$$;

-- ============================================================================
-- remove_member: sacar a un miembro y liberar su persona reclamada (sus
-- gastos siguen contando; la persona queda «sin cuenta»).
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
    raise exception 'No se puede sacar al titular de la cuenta';
  end if;
  if p_user_id = v_uid then
    raise exception 'Para salirte de la cuenta usa «Salir de esta cuenta»';
  end if;

  select am.role into v_target_role
  from public.account_members am
  where am.account_id = p_account_id and am.user_id = p_user_id;
  if not found then
    raise exception 'El usuario no es miembro de esta cuenta';
  end if;

  if v_target_role = 'admin'
     and not public.has_account_role(p_account_id, array['owner']::public.member_role[]) then
    raise exception 'Un administrador no puede sacar a otro administrador';
  end if;

  delete from public.account_members am
  where am.account_id = p_account_id and am.user_id = p_user_id;

  update public.people p
  set claimed_by = null
  where p.account_id = p_account_id and p.claimed_by = p_user_id;
end;
$$;

-- ============================================================================
-- leave_account: salirse de una cuenta (el owner no puede: la cuenta es suya).
-- ============================================================================

create or replace function public.leave_account(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  if public.has_account_role(p_account_id, array['owner']::public.member_role[]) then
    raise exception 'El titular no puede salirse de su propia cuenta';
  end if;

  delete from public.account_members am
  where am.account_id = p_account_id and am.user_id = v_uid;

  update public.people p
  set claimed_by = null
  where p.account_id = p_account_id and p.claimed_by = v_uid;
end;
$$;

-- ============================================================================
-- create_invitation: código PREFIJO-XXXX (alfabeto sin 0/O/1/I/L para que se
-- pueda dictar por teléfono; bytes aleatorios de pgcrypto). Devuelve el código.
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
  v_account public.accounts%rowtype;
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
    raise exception 'No se puede asignar el rol de titular';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'La fecha de vencimiento ya pasó';
  end if;
  if p_max_uses is not null and p_max_uses < 1 then
    raise exception 'El límite de usos debe ser de al menos 1';
  end if;

  select * into v_account
  from public.accounts a
  where a.id = p_account_id;
  if not found then
    raise exception 'La cuenta no existe';
  end if;
  if v_account.status = 'closed' then
    raise exception 'La cuenta está cerrada: ya no se puede invitar a nadie';
  end if;

  v_prefijo := public.invitation_prefix(v_account.name);

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
-- close_account: cierra la cuenta (en un evento, después de liquidar).
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

  -- Una cuenta cerrada no recibe a nadie más
  update public.invitations inv
  set revoked_at = now()
  where inv.account_id = p_account_id and inv.revoked_at is null;
end;
$$;

-- ============================================================================
-- Lecturas (security invoker: RLS filtra)
-- ============================================================================

-- Selector de cuentas: una fila por cuenta mía con lo que muestra la tarjeta.
-- total_cop: todo el evento, o el mes en curso (hora de Bogotá) para hogar.
create or replace function public.account_overview()
returns table (
  id uuid,
  name text,
  type public.account_type,
  status text,
  role public.member_role,
  starts_on date,
  ends_on date,
  closed_at timestamptz,
  people_count int,
  total_cop bigint,
  pending_count int,
  budget_cop bigint,
  people jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with mes as (
    select date_trunc('month', (now() at time zone 'America/Bogota'))::date as inicio
  )
  select
    a.id,
    a.name,
    a.type,
    a.status,
    am.role,
    a.starts_on,
    a.ends_on,
    a.closed_at,
    (select count(*)::int from public.people p where p.account_id = a.id),
    coalesce((
      select sum(e.total_cop)
      from public.expenses e, mes
      where e.account_id = a.id
        and (a.type = 'evento'
             or (e.expense_date >= mes.inicio and e.expense_date < (mes.inicio + interval '1 month')::date))
    ), 0)::bigint,
    (select count(*)::int from public.expenses e where e.account_id = a.id and e.status = 'pending_review'),
    case when a.type = 'hogar' then coalesce(
      (select b.amount_cop from public.budgets b, mes
       where b.account_id = a.id and b.category_id is null and b.period = mes.inicio),
      (select sum(b.amount_cop)::bigint from public.budgets b, mes
       where b.account_id = a.id and b.category_id is not null and b.period = mes.inicio)
    ) end,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', p.display_name,
        'tone', p.tone,
        'registered', p.claimed_by is not null
      ) order by p.created_at, p.id)
      from public.people p
      where p.account_id = a.id
    ), '[]'::jsonb)
  from public.account_members am
  join public.accounts a on a.id = am.account_id
  where am.user_id = (select auth.uid())
  order by (a.status = 'closed'), am.joined_at desc;
$$;

-- Pantalla Personas: todas las personas de la cuenta con su membresía (si
-- tienen cuenta), cuántos gastos pagaron y cuántas correcciones hicieron.
create or replace function public.account_people(p_account_id uuid)
returns table (
  person_id uuid,
  display_name text,
  tone text,
  user_id uuid,
  role public.member_role,
  joined_at timestamptz,
  is_me boolean,
  paid_count int,
  corrections_count int,
  wa_last4 text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.display_name,
    p.tone::text,
    am.user_id,
    am.role,
    am.joined_at,
    coalesce(am.user_id = (select auth.uid()), false),
    (select count(*)::int from public.expenses e where e.payer_person_id = p.id),
    case when am.user_id is null then 0 else (
      select count(*)::int from public.expenses e
      where e.account_id = p.account_id and e.corrected_by = am.user_id
    ) end,
    (select right(w.wa_id, 4) from public.person_whatsapp_ids w
     where w.person_id = p.id order by w.created_at limit 1)
  from public.people p
  left join public.account_members am
    on am.account_id = p.account_id and am.person_id = p.id
  where p.account_id = p_account_id
  union all
  -- Miembros sin persona enlazada (caso raro: borraron su persona)
  select
    null,
    coalesce(nullif(trim(pf.full_name), ''), 'Sin nombre'),
    'rosa',
    am.user_id,
    am.role,
    am.joined_at,
    am.user_id = (select auth.uid()),
    0,
    (select count(*)::int from public.expenses e
     where e.account_id = am.account_id and e.corrected_by = am.user_id),
    null
  from public.account_members am
  left join public.profiles pf on pf.id = am.user_id
  where am.account_id = p_account_id and am.person_id is null;
$$;

-- ============================================================================
-- Permisos de ejecución: nada para anon ni PUBLIC; todo exige sesión.
-- ============================================================================

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema public to service_role;
