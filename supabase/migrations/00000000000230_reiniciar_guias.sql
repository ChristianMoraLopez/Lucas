-- ============================================================================
-- Lucas · 00000000000230_reiniciar_guias.sql
-- «Ver las guías otra vez» (Perfil): la del inicio y la de las cuentas vuelven
-- a salir solas, como la primera vez.
-- ============================================================================

create or replace function public.reiniciar_guias()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  update public.profiles set guias_vistas = '{}' where id = auth.uid();
end;
$$;

revoke execute on function public.reiniciar_guias() from public, anon;
grant execute on function public.reiniciar_guias() to authenticated;
