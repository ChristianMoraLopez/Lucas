-- ============================================================================
-- Lucas · 00000000000720_chepito_aparte.sql
-- Chepito no es una cuenta más: cada quien tiene un solo Chepito, que se
-- llama «Chepito» y va aparte (abajo en el inicio), no entre las cuentas ni
-- como un tipo de cuenta que se crea con nombre.
--
--   · Las cuentas de cobro que ya había se llaman «Chepito».
--   · Si alguien tenía varias, sus cobros (y a quienes les cobra) pasan a la
--     más vieja y las demás se borran.
--   · mi_chepito() devuelve el Chepito de quien entra (y lo abre si no lo
--     tiene); desde WhatsApp se abre igual, con el mismo nombre.
--   · Los cobros se editan (a quién, cuánto y por qué, mientras siga
--     cobrando) y se borran (los pagados, o cualquiera: si seguía cobrando,
--     deja de cobrar y lo que no había salido ya no sale).
-- ============================================================================

-- Juntar en la más vieja las de cobro de un mismo dueño
do $$
declare
  r record;
  v_yo uuid;
begin
  for r in
    select a.id, a.owner_id,
           first_value(a.id) over (partition by a.owner_id order by a.created_at, a.id) as principal
    from public.accounts a
    where a.type = 'cobro'
  loop
    continue when r.id = r.principal;
    select p.id into v_yo from public.people p where p.account_id = r.principal and p.claimed_by = r.owner_id;
    continue when v_yo is null;
    update public.cobros set account_id = r.principal, acreedor_person_id = v_yo where account_id = r.id;
    update public.people set account_id = r.principal
    where account_id = r.id and id in (select c.deudor_person_id from public.cobros c where c.account_id = r.principal);
    delete from public.accounts where id = r.id;
  end loop;
end;
$$;

update public.accounts set name = 'Chepito' where type = 'cobro' and name <> 'Chepito';

-- El Chepito de quien entra (lo abre la primera vez)
create or replace function public.chepito_de(p_user_id uuid, p_idioma text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cuenta uuid;
  v_persona uuid;
begin
  select a.id into v_cuenta
  from public.accounts a
  join public.account_members am on am.account_id = a.id and am.user_id = p_user_id and am.role in ('owner', 'admin')
  where a.type = 'cobro'
  order by a.created_at
  limit 1;
  if v_cuenta is not null then
    -- Si alguien lo cerró o lo archivó, vuelve a estar abierto: Chepito no se cierra
    update public.accounts set status = 'active' where id = v_cuenta and status = 'closed';
    update public.account_members set archived_at = null where account_id = v_cuenta and user_id = p_user_id and archived_at is not null;
    return v_cuenta;
  end if;

  insert into public.accounts (name, type, owner_id, language)
  values ('Chepito', 'cobro', p_user_id, coalesce(p_idioma, 'es'))
  returning id into v_cuenta;
  insert into public.people (account_id, display_name, claimed_by)
  values (
    v_cuenta,
    left(coalesce(nullif(btrim((select pf.full_name from public.profiles pf where pf.id = p_user_id)), ''), 'Yo'), 40),
    p_user_id
  )
  returning id into v_persona;
  insert into public.account_members (account_id, user_id, role, person_id) values (v_cuenta, p_user_id, 'owner', v_persona);
  return v_cuenta;
end;
$$;

-- Desde la app
create or replace function public.mi_chepito()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  return public.chepito_de(auth.uid());
end;
$$;

-- Desde WhatsApp: el cobro va a su Chepito
create or replace function public.connector_chepito_crear(
  p_chat_jid text,
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_nombre text,
  p_telefono text,
  p_monto bigint,
  p_concepto text,
  p_avisar_en_min int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.whatsapp_identities%rowtype;
  v_cuenta uuid;
  v_nueva boolean;
  r jsonb;
begin
  if public.chat_privado_con_luks(p_chat_jid) is null then
    return jsonb_build_object('ok', false, 'reason', 'sin_chat');
  end if;
  select * into i from public.whatsapp_identities where id = public.wa_identidad(p_wa_id, p_phone, p_lid, null);
  if i.user_id is null or i.verified_at is null then
    return jsonb_build_object('ok', false, 'reason', 'sin_sesion');
  end if;

  v_nueva := not exists (
    select 1 from public.accounts a
    join public.account_members am on am.account_id = a.id and am.user_id = i.user_id and am.role in ('owner', 'admin')
    where a.type = 'cobro'
  );
  v_cuenta := public.chepito_de(i.user_id, case when coalesce(p_phone, '') like '1%' then 'en' else 'es' end);

  r := public.cobro_nuevo(v_cuenta, i.user_id, p_nombre, p_telefono, p_monto, p_concepto, 'whatsapp',
                          now() + make_interval(mins => greatest(coalesce(p_avisar_en_min, 0), 0)));
  return r || jsonb_build_object('nueva_cuenta', v_nueva);
end;
$$;

-- Corregir un cobro que sigue cobrando: a quién, cuánto y por qué (el WhatsApp no: ese es otro cobro)
create or replace function public.editar_cobro(p_cobro_id uuid, p_nombre text, p_monto bigint, p_concepto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.cobros%rowtype;
  v_nombre text := left(btrim(regexp_replace(coalesce(p_nombre, ''), '[*_~`]', '', 'g')), 40);
  v_concepto text := left(btrim(regexp_replace(coalesce(p_concepto, ''), '[*_~`]', '', 'g')), 120);
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into c from public.cobros where id = p_cobro_id for update;
  if c.id is null or not public.has_account_role(c.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Ese cobro no existe';
  end if;
  if not public.cobro_abierto(c) then
    raise exception 'Ese cobro ya terminó: no se puede editar';
  end if;
  if v_nombre = '' then
    raise exception '%', public.cobro_error('nombre');
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception '%', public.cobro_error('monto');
  end if;
  if length(v_concepto) < 2 then
    raise exception '%', public.cobro_error('concepto');
  end if;
  update public.cobros set monto = p_monto, concepto = v_concepto where id = c.id;
  update public.people set display_name = v_nombre where id = c.deudor_person_id;
end;
$$;

-- Borrar un cobro (y a quien debía, que solo estaba en la cuenta por ese cobro)
create or replace function public.borrar_cobro(p_cobro_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.cobros%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into c from public.cobros where id = p_cobro_id for update;
  if c.id is null or not public.has_account_role(c.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Ese cobro no existe';
  end if;
  -- El aviso que estaba por salir ya no sale
  update public.whatsapp_outbox set dropped_at = now()
  where dedupe_key like 'chepito:' || c.id || ':%' and sent_at is null and dropped_at is null;
  delete from public.cobros where id = c.id;
  delete from public.people p
  where p.id = c.deudor_person_id and p.claimed_by is null
    and not exists (select 1 from public.cobros o where o.deudor_person_id = p.id);
end;
$$;

-- Chepito no se crea como cuenta (va aparte) ni se le cambia el nombre
create or replace function public.no_renombrar_chepito()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type = 'cobro' then
    new.name := 'Chepito';
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_chepito_nombre on public.accounts;
create trigger accounts_chepito_nombre
  before insert or update of name, type on public.accounts
  for each row execute function public.no_renombrar_chepito();

revoke execute on function public.editar_cobro(uuid, text, bigint, text) from public, anon;
grant execute on function public.editar_cobro(uuid, text, bigint, text) to authenticated;
revoke execute on function public.borrar_cobro(uuid) from public, anon;
grant execute on function public.borrar_cobro(uuid) to authenticated;
revoke execute on function public.chepito_de(uuid, text) from public, anon, authenticated;
revoke execute on function public.mi_chepito() from public, anon;
grant execute on function public.mi_chepito() to authenticated;
revoke execute on function public.connector_chepito_crear(text, text, text, text, text, text, bigint, text, int) from public, anon, authenticated;
grant execute on function public.connector_chepito_crear(text, text, text, text, text, text, bigint, text, int) to service_role;
