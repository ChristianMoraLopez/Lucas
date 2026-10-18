-- ============================================================================
-- Lucas · 00000000000430_propina_al_cambiar_el_total.sql
-- Cambiar el total en pesos de un recibo en otra moneda (lo que de verdad
-- cobró el banco, por ejemplo) reescala los ítems y las partes de cada uno,
-- pero dejaba la propina aparte igual: los ítems más la propina ya no daban
-- el total y Dividir mostraba que faltaba o sobraba plata. Ahora la propina
-- también se reescala, en la misma proporción.
-- ============================================================================

create or replace function public.set_expense_currency(
  p_expense_id uuid,
  p_currency text,
  p_original_total bigint,
  p_rate numeric,
  p_rate_date date,
  p_total_cop bigint,
  p_rate_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  e public.expenses%rowtype;
  v_cuenta text;
  v_estado text;
  v_moneda text := upper(nullif(btrim(p_currency), ''));
  v_viejo bigint;
  v_cambio boolean;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into e from public.expenses where id = p_expense_id for update;
  if not found or not public.is_account_member(e.account_id) then
    raise exception 'El gasto no existe';
  end if;
  if not public.has_account_role(e.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta corrigen gastos';
  end if;
  select a.currency, a.status into v_cuenta, v_estado from public.accounts a where a.id = e.account_id;
  if v_estado = 'closed' then
    raise exception 'La cuenta está cerrada: ya no cambia';
  end if;
  if v_moneda = v_cuenta then
    v_moneda := null;
  end if;
  if v_moneda is not null and v_moneda not in ('COP', 'CLP', 'BOB', 'USD', 'EUR', 'PEN', 'MXN', 'ARS', 'BRL') then
    raise exception 'Esa moneda no está disponible';
  end if;
  if p_total_cop is null or p_total_cop <= 0 or p_total_cop >= 1000000000000 then
    raise exception 'El total tiene que ser mayor que cero';
  end if;
  if v_moneda is not null then
    if p_original_total is null or p_original_total <= 0 or p_original_total >= 1000000000000 then
      raise exception 'Escribe cuánto dice el recibo';
    end if;
    if p_rate is null or p_rate <= 0 or p_rate >= 100000000 then
      raise exception 'Falta la tasa de cambio';
    end if;
    if p_rate_date is null or p_rate_date > (now() at time zone 'America/Bogota')::date + 1 then
      raise exception 'Revisa la fecha de la tasa de cambio';
    end if;
  end if;

  v_viejo := e.total_cop;
  v_cambio := p_total_cop is distinct from e.total_cop
    or v_moneda is distinct from e.original_currency
    or (v_moneda is not null and (p_original_total is distinct from e.original_total or p_rate is distinct from e.fx_rate));

  -- Los ítems y las partes de cada uno, en la misma proporción que el total
  if v_viejo > 0 and v_viejo <> p_total_cop then
    update public.expense_items i
    set unit_price_cop = round(i.unit_price_cop::numeric * p_total_cop / v_viejo)::bigint,
        total_cop = round(i.total_cop::numeric * p_total_cop / v_viejo)::bigint
    where i.expense_id = e.id;
    -- Las partes: con el resto a las que más perdieron al redondear, para que sumen justo el total
    if (select coalesce(sum(s.amount_cop), 0) from public.expense_splits s where s.expense_id = e.id) = v_viejo then
      with partes as (
        select s.id, s.amount_cop::numeric * p_total_cop / v_viejo as exacto
        from public.expense_splits s
        where s.expense_id = e.id
      ),
      orden as (
        select p.id,
               floor(p.exacto)::bigint as piso,
               row_number() over (order by p.exacto - floor(p.exacto) desc, p.id) as n,
               p_total_cop - sum(floor(p.exacto)::bigint) over () as faltan
        from partes p
      )
      update public.expense_splits s
      set amount_cop = o.piso + case when o.n <= o.faltan then 1 else 0 end
      from orden o
      where s.id = o.id;
    end if;
  end if;

  update public.expenses x
  set total_cop = p_total_cop,
      original_currency = v_moneda,
      original_total = case when v_moneda is not null then p_original_total end,
      fx_rate = case when v_moneda is not null then p_rate end,
      fx_date = case when v_moneda is not null then p_rate_date end,
      fx_source = case when v_moneda is not null then left(coalesce(nullif(btrim(p_rate_source), ''), 'manual'), 40) end,
      -- La propina que se dejó aparte, en la misma proporción (si no, los ítems más la propina ya no dan el total)
      tip_cop = case when v_viejo > 0 and v_viejo <> p_total_cop and x.tip_cop > 0
                     then round(x.tip_cop::numeric * p_total_cop / v_viejo)::bigint else x.tip_cop end,
      corrected_by = case when v_cambio then v_uid else x.corrected_by end,
      corrected_at = case when v_cambio then now() else x.corrected_at end
  where x.id = e.id;

  return jsonb_build_object('total_cop', p_total_cop, 'currency', coalesce(v_moneda, v_cuenta));
end;
$$;
