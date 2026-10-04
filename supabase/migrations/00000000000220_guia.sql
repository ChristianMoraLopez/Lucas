-- ============================================================================
-- Lucas · 00000000000220_guia.sql
-- La guía paso a paso: sale sola la primera vez que alguien entra al inicio
-- («inicio») y a una cuenta («cuenta»); después se ve con el botón «?».
--
--   · profiles.guias_vistas: las guías que ya vio (o se saltó).
--   · marcar_guia(): la marca como vista.
--   · Quienes ya usaban Luks antes de la guía no la ven sola: la tienen en «?».
-- ============================================================================

alter table public.profiles add column guias_vistas text[] not null default '{}';

update public.profiles set guias_vistas = array['cuenta', 'inicio'];

create or replace function public.marcar_guia(p_guia text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vistas text[];
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if p_guia is null or p_guia not in ('inicio', 'cuenta') then
    raise exception 'Esa guía no existe';
  end if;
  update public.profiles p
  set guias_vistas = (select array_agg(distinct g order by g) from unnest(p.guias_vistas || p_guia) g)
  where p.id = auth.uid()
  returning p.guias_vistas into v_vistas;
  return v_vistas;
end;
$$;

revoke execute on function public.marcar_guia(text) from public, anon;
grant execute on function public.marcar_guia(text) to authenticated;
