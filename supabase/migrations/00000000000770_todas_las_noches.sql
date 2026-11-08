-- ============================================================================
-- Lucas · 00000000000770_todas_las_noches.sql
-- Con «Noche nueva» (la 750) cada salida de «Gentelinda» empieza en ceros, y
-- también se quiere ver cuánto se ha gastado en el grupo de siempre. Las
-- cuentas se encadenan por previous_account_id (la 370, la 450 y la 750):
-- todas_las_noches(cuenta) devuelve la cadena entera, de la más reciente a la
-- primera, con lo gastado en cada una y la suma.
--
--   · Solo las cuentas de la cadena donde quien pregunta es miembro.
--   · Lo gastado cuenta los gastos revisados y por revisar (como el total de
--     cada cuenta en el inicio).
-- ============================================================================

create or replace function public.todas_las_noches(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  return (
    with recursive atras as (
      select a.id, a.previous_account_id, 0 as paso from public.accounts a where a.id = p_account_id
      union
      select a.id, a.previous_account_id, t.paso + 1 from public.accounts a join atras t on a.id = t.previous_account_id
      where t.paso < 200
    ),
    adelante as (
      select a.id, 0 as paso from public.accounts a where a.id = p_account_id
      union
      select a.id, t.paso + 1 from public.accounts a join adelante t on a.previous_account_id = t.id
      where t.paso < 200
    ),
    cadena as (
      select c.id
      from (select id from atras union select id from adelante) c
      where public.is_account_member(c.id)
    ),
    noches as (
      select a.id, a.name, a.type, a.status, a.currency, a.starts_on, a.ends_on, a.created_at,
        coalesce((select sum(e.total_cop) from public.expenses e where e.account_id = a.id), 0) as total,
        (select count(*) from public.expenses e where e.account_id = a.id) as gastos,
        (select min(e.expense_date) from public.expenses e where e.account_id = a.id) as desde,
        (select max(e.expense_date) from public.expenses e where e.account_id = a.id) as hasta
      from public.accounts a
      join cadena c on c.id = a.id
    )
    select jsonb_build_object(
      'total', coalesce(sum(n.total), 0),
      'gastos', coalesce(sum(n.gastos), 0),
      'noches', coalesce(jsonb_agg(jsonb_build_object(
        'id', n.id, 'name', n.name, 'type', n.type, 'status', n.status, 'currency', n.currency,
        'starts_on', n.starts_on, 'ends_on', n.ends_on, 'desde', n.desde, 'hasta', n.hasta,
        'total', n.total, 'gastos', n.gastos
      ) order by n.created_at desc), '[]'::jsonb)
    )
    from noches n
  );
end;
$$;

revoke execute on function public.todas_las_noches(uuid) from public, anon;
grant execute on function public.todas_las_noches(uuid) to authenticated;
