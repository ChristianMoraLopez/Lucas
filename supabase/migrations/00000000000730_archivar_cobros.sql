-- ============================================================================
-- Lucas · 00000000000730_archivar_cobros.sql
-- Los cobros que ya terminaron (pagados, «no le debo», detenidos o con los 4
-- avisos) se archivan: salen de la lista de Chepito y quedan en «Archivados»,
-- de donde se pueden sacar o borrar. Así un solo Chepito sirve para muchos
-- cobros, uno detrás de otro.
-- ============================================================================

alter table public.cobros add column if not exists archivado_at timestamptz;

-- Archivar (o sacar del archivo) un cobro que ya terminó
create or replace function public.archivar_cobro(p_cobro_id uuid, p_archivar boolean default true)
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
  if p_archivar and public.cobro_abierto(c) then
    raise exception 'Ese cobro sigue abierto: márcalo pagado o deja de cobrar antes de archivarlo';
  end if;
  update public.cobros set archivado_at = case when p_archivar then coalesce(archivado_at, now()) end where id = c.id;
end;
$$;

revoke execute on function public.archivar_cobro(uuid, boolean) from public, anon;
grant execute on function public.archivar_cobro(uuid, boolean) to authenticated;
