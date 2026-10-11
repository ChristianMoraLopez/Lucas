-- ============================================================================
-- Lucas · 00000000000280_privacidad_de_los_grupos.sql
-- Un WhatsApp vinculado es el número de una persona: Luks ve todos sus grupos,
-- pero de los que no están conectados a una cuenta solo guarda el nombre y el
-- JID (para que pueda elegir cuál conectar). Quién está en un grupo se guarda
-- solo si el grupo es de una cuenta, o si lo lee Mister Luks (el número
-- contador: lo agregaron a propósito y tiene que saber a quién saluda).
-- Ley 1581: ningún dato personal sin para qué.
--
--   · grupo_guarda_integrantes(): esa regla, en un solo lugar.
--   · connector_set_group_members: si el grupo no cumple la regla, no guarda
--     nada. El connector tampoco los manda (services/connector/src/ingest.ts);
--     esto es la red de seguridad.
--   · Al desconectar un grupo de su cuenta (o borrar la cuenta) se olvidan sus
--     integrantes, salvo que lo lea Mister Luks.
--   · Lo que sobra de antes lo borra
--     supabase/operacion/2026-10-11_integrantes_sin_cuenta.sql (a mano).
--   · Mensajes de grupos sin cuenta nunca se guardaron (connector_should_ingest).
-- ============================================================================

-- ¿Se pueden guardar los integrantes de este grupo? Si es de una cuenta o si lo lee Mister Luks
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
        from public.whatsapp_groups g
        join public.whatsapp_connections c on c.id = g.connection_id
        where g.id = p_group_id and c.kind = 'contador'
      )
$$;

-- El connector manda la lista completa de integrantes de un grupo (como en la 160)
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

  return jsonb_build_object('members', public.group_member_count(p_group_id), 'people_added', public.sync_group_people(p_group_id));
end;
$$;

-- Se desconectó el grupo de su cuenta: quién está ya no tiene para qué guardarse
-- (las personas de la cuenta y sus gastos se quedan)
create or replace function public.account_group_links_olvidar_integrantes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.grupo_guarda_integrantes(old.group_id) then
    delete from public.whatsapp_group_members where group_id = old.group_id;
  end if;
  return null;
end;
$$;

create trigger trg_account_group_links_olvidar_integrantes
  after delete on public.account_group_links
  for each row
  execute function public.account_group_links_olvidar_integrantes();

-- ============================================================================
-- Permisos
-- ============================================================================

revoke execute on function public.grupo_guarda_integrantes(uuid) from public, anon, authenticated;
revoke execute on function public.account_group_links_olvidar_integrantes() from public, anon, authenticated;
grant execute on function public.grupo_guarda_integrantes(uuid) to service_role;
