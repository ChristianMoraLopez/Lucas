-- ============================================================================
-- Lucas · 00000000000530_nombres_de_whatsapp.sql
-- «Alguien del grupo 4372», «WhatsApp 0097»: personas que entraron por el
-- grupo sin nombre. WhatsApp sí sabe cómo se llaman: el nombre que cada quien
-- se puso (aunque llegue de otro grupo o de un mensaje) o su usuario
-- («@juanes»). En cuanto se sabe, la persona queda con ese nombre.
--
--   · connector_usuarios: el connector manda el usuario de WhatsApp de los
--     integrantes y de quien escribe (Baileys lo trae); queda en
--     whatsapp_identities.username (la columna es de la 310).
--   · Solo a quien tiene el nombre automático (name_source 'auto') y no tiene
--     cuenta en Luks: lo que alguien escribió a mano no se toca.
--   · Primero el nombre que se puso; si no hay (o no tiene letras), el
--     usuario con «@». Si otro de la cuenta ya se llama así, con los últimos
--     cuatro números, como en la 200.
--   · Al enlazar a alguien con su WhatsApp (person_whatsapp_ids) y cada vez que
--     su identidad aprende el nombre o el usuario. Y lo que ya había.
-- ============================================================================

-- Cómo se llama en WhatsApp: el nombre que se puso o, si no, «@usuario» (null si no se sabe)
create or replace function public.nombre_de_identidad(p_identity_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case when public.nombre_de_whatsapp(i.push_name) ~ '[[:alpha:]].*[[:alpha:]]' then public.nombre_de_whatsapp(i.push_name) end,
    case when i.username ~ '^[a-z0-9._]{3,35}$' then '@' || i.username end
  )
  from public.whatsapp_identities i
  where i.id = p_identity_id
$$;

-- La persona con nombre automático queda con el de WhatsApp. true si cambió
create or replace function public.nombrar_con_whatsapp(p_person_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.people%rowtype;
  v_name text;
  v_wa text;
begin
  select * into p from public.people where id = p_person_id for update;
  -- El automático, o el «@usuario» que se puso mientras no se sabía el nombre
  if p.id is null or p.claimed_by is not null
     or not (p.name_source = 'auto' or (p.name_source = 'whatsapp' and p.display_name like '@%')) then
    return false;
  end if;
  select public.nombre_de_identidad(w.identity_id), w.wa_id into v_name, v_wa
  from public.person_whatsapp_ids w
  where w.person_id = p.id and public.nombre_de_identidad(w.identity_id) is not null
  order by w.created_at
  limit 1;
  if v_name is null then
    return false;
  end if;

  -- Si ya hay alguien con ese nombre, se le ponen los últimos cuatro números
  if exists (select 1 from public.people o where o.account_id = p.account_id and o.id <> p.id and lower(o.display_name) = lower(v_name)) then
    v_name := v_name || ' ' || right(regexp_replace(v_wa, '[^0-9]', '', 'g'), 4);
    if exists (select 1 from public.people o where o.account_id = p.account_id and o.id <> p.id and lower(o.display_name) = lower(v_name)) then
      return false;
    end if;
  end if;

  if v_name = p.display_name then
    return false;
  end if;
  update public.people set display_name = v_name, name_source = 'whatsapp' where id = p.id;
  return true;
end;
$$;

-- Al enlazar a alguien con su WhatsApp (ya con su identidad)
create or replace function public.person_whatsapp_ids_nombrar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.identity_id is not null then
    perform public.nombrar_con_whatsapp(new.person_id);
  end if;
  return null;
end;
$$;

create trigger trg_person_whatsapp_ids_nombrar
  after insert or update of identity_id on public.person_whatsapp_ids
  for each row execute function public.person_whatsapp_ids_nombrar();

-- Cuando la identidad aprende el nombre o el usuario, todos los que se llamaban «Alguien del grupo»
create or replace function public.whatsapp_identities_nombrar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.nombrar_con_whatsapp(w.person_id)
  from public.person_whatsapp_ids w
  join public.people p on p.id = w.person_id
  where w.identity_id = new.id and p.claimed_by is null
    and (p.name_source = 'auto' or (p.name_source = 'whatsapp' and p.display_name like '@%'));
  return null;
end;
$$;

create trigger trg_whatsapp_identities_nombrar
  after update of push_name, username on public.whatsapp_identities
  for each row
  when (old.push_name is distinct from new.push_name or old.username is distinct from new.username)
  execute function public.whatsapp_identities_nombrar();

-- ============================================================================
-- connector_usuarios: [{"id", "phone", "lid", "username"}] → el usuario de
-- WhatsApp de cada uno. Devuelve cuántos cambiaron.
-- ============================================================================

create or replace function public.connector_usuarios(p_usuarios jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  x jsonb;
  v_id uuid;
  v_usuario text;
  n int := 0;
begin
  if jsonb_typeof(p_usuarios) <> 'array' then
    return 0;
  end if;
  for x in select e from jsonb_array_elements(p_usuarios) e limit 1000 loop
    v_usuario := lower(ltrim(btrim(coalesce(x ->> 'username', '')), '@'));
    continue when v_usuario !~ '^[a-z0-9._]{3,35}$';
    continue when coalesce(x ->> 'id', '') !~ '^([0-9]{6,20}|lid:[0-9]{6,30})$';
    v_id := public.wa_identidad(x ->> 'id', x ->> 'phone', x ->> 'lid');
    continue when v_id is null;
    update public.whatsapp_identities set username = v_usuario where id = v_id and username is distinct from v_usuario;
    if found then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Lo que ya había: «Alguien del grupo 4372» que en WhatsApp se llama «Hh»
select public.nombrar_con_whatsapp(p.id)
from public.people p
where p.name_source = 'auto' and p.claimed_by is null;

revoke execute on function public.nombre_de_identidad(uuid) from public, anon, authenticated;
revoke execute on function public.nombrar_con_whatsapp(uuid) from public, anon, authenticated;
revoke execute on function public.person_whatsapp_ids_nombrar() from public, anon, authenticated;
revoke execute on function public.whatsapp_identities_nombrar() from public, anon, authenticated;
revoke execute on function public.connector_usuarios(jsonb) from public, anon, authenticated;
grant execute on function public.connector_usuarios(jsonb) to service_role;
