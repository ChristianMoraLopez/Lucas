-- ============================================================================
-- Lucas · 00000000000030_internal_functions.sql
-- Funciones internas que no deben poder llamarse desde /rest/v1/rpc.
-- Los triggers y los RPC (security definer, dueño postgres) las siguen usando.
-- Los helpers de membresía (is_account_member, has_account_role…) sí quedan
-- para authenticated: las políticas RLS los evalúan con el rol de quien consulta.
-- ============================================================================

revoke execute on function public.handle_new_user() from authenticated, service_role;
revoke execute on function public.people_default_tone() from authenticated, service_role;
revoke execute on function public.set_updated_at() from authenticated, service_role;
revoke execute on function public.fill_my_profile_name(text) from authenticated, service_role;
