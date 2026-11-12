-- ============================================================================
-- Lucas · 00000000000790_nadie_del_grupo_por_fuera.sql
-- En «Moritas» el grupo tiene 8 personas y la cuenta quedó con 3: los que no
-- tenían nombre visible en WhatsApp no entraron al conectarlo. Que alguien del
-- grupo no esté en la cuenta no debe pasar nunca.
--
--   · Cada vez que cambian los integrantes de un grupo conectado (entra
--     alguien, llega la lista completa, alguien vuelve), sus personas se ponen
--     al día con sync_group_people: no depende de que el momento de conectar
--     coincida con el de recibir la lista.
--   · Los que no tienen nombre entran como «WhatsApp 4913» (o «@usuario») y
--     toman su nombre de WhatsApp en cuanto se sabe (la 530); en Personas se
--     les puede poner a mano.
--   · Lo que ya faltaba entra de una vez.
-- ============================================================================

create or replace function public.integrantes_a_personas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cuenta uuid;
begin
  if new.left_at is not null then
    return null;
  end if;
  select l.account_id into v_cuenta
  from public.account_group_links l
  join public.accounts a on a.id = l.account_id and a.status <> 'closed'
  where l.group_id = new.group_id;
  if v_cuenta is null then
    return null;
  end if;
  -- Ya es alguien de la cuenta (lo normal): nada que hacer
  if coalesce(
    public.wa_person(v_cuenta, new.wa_id),
    case when new.lid is not null then public.wa_person(v_cuenta, 'lid:' || new.lid) end,
    case when new.phone is not null then public.wa_person(v_cuenta, new.phone) end
  ) is not null then
    return null;
  end if;
  perform public.sync_group_people(new.group_id);
  return null;
end;
$$;

-- Al final de la transacción: lo normal (conectar, la lista del grupo) ya creó a las personas y esto no hace nada
create constraint trigger trg_group_members_personas
  after insert or update on public.whatsapp_group_members
  deferrable initially deferred
  for each row
  execute function public.integrantes_a_personas();

-- Lo que ya faltaba
select public.sync_group_people(l.group_id)
from public.account_group_links l
join public.accounts a on a.id = l.account_id and a.status <> 'closed';

revoke execute on function public.integrantes_a_personas() from public, anon, authenticated;
