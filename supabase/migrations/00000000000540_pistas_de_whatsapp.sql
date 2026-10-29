-- ============================================================================
-- Lucas · 00000000000540_pistas_de_whatsapp.sql
-- En Personas, «Alguien del grupo 1850» o «Hh» no dicen quién es: ese 1850 es
-- de un id interno de WhatsApp (LID), no del teléfono. Para reconocerlos (y
-- ponerles nombre a mano), lo que WhatsApp sí dice de cada quien que no tiene
-- cuenta en Luks:
--
--   · su usuario de WhatsApp («@tiago.film»), que se ve en WhatsApp;
--   · el nombre que se puso, si quedó con otro (alguien le cambió el nombre);
--   · su teléfono, solo para quien administra la cuenta (ya lo ve: con él lo
--     invita por WhatsApp);
--   · si sigue en el grupo de la cuenta.
-- ============================================================================

create or replace function public.whatsapp_de_personas(p_account_id uuid)
returns table (person_id uuid, usuario text, nombre_whatsapp text, telefono text, en_el_grupo boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
begin
  if auth.uid() is null or not public.is_account_member(p_account_id) then
    raise exception 'La cuenta no existe';
  end if;
  v_admin := public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]);

  return query
  select distinct on (p.id)
    p.id,
    i.username,
    public.nombre_de_whatsapp(i.push_name),
    case when v_admin then coalesce(i.phone, case when w.wa_id ~ '^[0-9]{6,20}$' then w.wa_id end) end,
    -- null si la cuenta no tiene grupo (o no se sabe quién está)
    case when exists (select 1 from public.account_group_links l where l.account_id = p_account_id) then
      exists (
        select 1 from public.account_group_links l
        join public.whatsapp_group_members gm on gm.group_id = l.group_id
        where l.account_id = p_account_id and gm.left_at is null
          and (gm.identity_id = w.identity_id or gm.wa_id = w.wa_id)
      )
    end
  from public.people p
  join public.person_whatsapp_ids w on w.person_id = p.id
  left join public.whatsapp_identities i on i.id = w.identity_id
  where p.account_id = p_account_id and p.claimed_by is null
  order by p.id, w.created_at;
end;
$$;

revoke execute on function public.whatsapp_de_personas(uuid) from public, anon;
grant execute on function public.whatsapp_de_personas(uuid) to authenticated;
