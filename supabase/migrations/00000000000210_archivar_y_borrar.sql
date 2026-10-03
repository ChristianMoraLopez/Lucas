-- ============================================================================
-- Lucas · 00000000000210_archivar_y_borrar.sql
-- Las cuentas que ya se cerraron se archivan, o se borran del todo.
--
--   · Archivar es de cada quien: la cuenta cerrada sale de su inicio y queda
--     en «Archivadas», con todo (gastos, fotos y liquidación). Se saca del
--     archivo cuando quiera. Los demás la siguen viendo donde la tengan.
--   · Borrar del todo es del titular, para todos y sin vuelta atrás: la
--     cuenta con sus gastos, personas, liquidación, link público y el enlace
--     con el grupo de WhatsApp. Se confirma escribiendo el nombre de la
--     cuenta. Las fotos y los PDF los borra la app antes (con la API de
--     Storage), mientras todavía tiene permiso.
-- ============================================================================

alter table public.account_members add column archived_at timestamptz;

-- p_archived true: la archiva (solo si está cerrada); false: la saca del archivo
create or replace function public.set_account_archived(p_account_id uuid, p_archived boolean)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_cuando timestamptz;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  select a.status into v_status from public.accounts a where a.id = p_account_id;
  if coalesce(p_archived, false) and v_status <> 'closed' then
    raise exception 'Solo se archivan las cuentas cerradas: primero ciérrenla en Liquidar';
  end if;

  update public.account_members am
  set archived_at = case when coalesce(p_archived, false) then coalesce(am.archived_at, now()) end
  where am.account_id = p_account_id and am.user_id = v_uid
  returning am.archived_at into v_cuando;
  return v_cuando;
end;
$$;

create or replace function public.delete_account_forever(p_account_id uuid, p_confirm text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into a from public.accounts x where x.id = p_account_id for update;
  if not found or not public.has_account_role(p_account_id, array['owner']::public.member_role[]) then
    raise exception 'Solo el titular borra la cuenta del todo';
  end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> lower(btrim(a.name)) then
    raise exception 'Para confirmar, escribe el nombre de la cuenta tal cual: «%»', a.name;
  end if;

  -- Lo que esperaba en la cola para esa cuenta ya no tiene a qué volver
  delete from public.jobs j where j.payload ->> 'account_id' = a.id::text and j.status = 'queued';
  -- Todo lo demás se va con la cuenta (on delete cascade)
  delete from public.accounts x where x.id = a.id;
  return a.name;
end;
$$;

revoke execute on function public.set_account_archived(uuid, boolean) from public, anon;
revoke execute on function public.delete_account_forever(uuid, text) from public, anon;
grant execute on function public.set_account_archived(uuid, boolean) to authenticated;
grant execute on function public.delete_account_forever(uuid, text) to authenticated;
