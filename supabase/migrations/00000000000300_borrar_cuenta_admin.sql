-- ============================================================================
-- Lucas · 00000000000300_borrar_cuenta_admin.sql
-- Borrar una cuenta del todo ya no es solo del titular ni solo de las cuentas
-- cerradas: lo puede hacer cualquier admin, cuando quiera. La web lo confirma
-- con un diálogo (sin escribir el nombre); la función sigue pidiendo el nombre
-- como seguro, y la app lo manda sola. Se borra para todos y sin vuelta atrás,
-- como en la 210: gastos, personas, liquidación, link público y el enlace con
-- el grupo de WhatsApp (sus integrantes se olvidan, migración 280).
-- ============================================================================

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
  if not found or not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quien administra la cuenta la puede borrar';
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
