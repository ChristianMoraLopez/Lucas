-- ============================================================================
-- Lucas · 00000000000470_lo_que_consumio.sql
-- «Cuánto debo»: Mister Luks dice también por qué, gasto por gasto e ítem por
-- ítem (lo que pidió y cuánto costó), como en los avisos de cobro. Para eso
-- connector_question trae en «me» lo que consumió quien pregunta.
-- Es la de la 400 con «consumo».
-- ============================================================================

create or replace function public.connector_question(
  p_jid text,
  p_wa_id text,
  p_phone text default null,
  p_lid text default null,
  p_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.whatsapp_groups%rowtype;
  a public.accounts%rowtype;
  v_ident uuid;
  v_pref text;
  v_contador boolean;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_mes date;
  v_desde date;
  v_hasta date;
  v_person uuid;
  s public.settlements%rowtype;
  v_base jsonb;
begin
  select * into g from public.whatsapp_groups where wa_group_jid = p_jid and chat_kind = 'grupo';
  if g.id is null then
    return jsonb_build_object('ok', false, 'reason', 'sin_grupo');
  end if;
  v_ident := public.wa_identidad(p_wa_id, p_phone, p_lid, p_name);
  select x.mode into v_pref from public.whatsapp_answer_prefs x where x.identity_id = v_ident;
  v_contador := exists (
    select 1 from public.whatsapp_group_sessions s2
    join public.whatsapp_connections c on c.id = s2.connection_id
    where s2.group_id = g.id and s2.left_at is null and c.kind = 'contador'
  );
  v_base := jsonb_build_object('identity_id', v_ident, 'pref', v_pref, 'contador_en_grupo', v_contador);

  select a2.* into a
  from public.account_group_links l join public.accounts a2 on a2.id = l.account_id
  where l.group_id = g.id;
  if a.id is null then
    return v_base || jsonb_build_object('ok', false, 'reason', 'sin_cuenta');
  end if;

  if a.type = 'hogar' then
    v_mes := date_trunc('month', v_hoy)::date;
    v_desde := v_mes;
    v_hasta := (v_mes + interval '1 month')::date;
  else
    v_desde := '0001-01-01';
    v_hasta := '9999-12-31';
  end if;
  select * into s from public.settlements x where x.account_id = a.id and x.period is not distinct from v_mes;
  v_person := coalesce(
    public.wa_person(a.id, p_wa_id),
    case when p_phone is not null then public.wa_person(a.id, p_phone) end,
    case when p_lid is not null then public.wa_person(a.id, 'lid:' || p_lid) end
  );

  return v_base || jsonb_build_object(
    'ok', true,
    'account', jsonb_build_object(
      'name', a.name, 'type', a.type, 'status', a.status, 'currency', a.currency, 'language', a.language, 'month', v_mes
    ),
    'optout', public.no_lo_cuentes(a.id, p_wa_id),
    'total', (
      select coalesce(sum(e.total_cop), 0) from public.expenses e
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
    ),
    'count', (
      select count(*) from public.expenses e
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
    ),
    'pending', (
      select count(*) from public.expenses e
      where e.account_id = a.id and e.status = 'pending_review' and e.expense_date >= v_desde and e.expense_date < v_hasta
    ),
    'incomplete', (
      select count(*) from public.expenses e
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
        and (e.payer_person_id is null
             or e.total_cop <> (select coalesce(sum(x.amount_cop), 0) from public.expense_splits x where x.expense_id = e.id))
    ),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'paid', b.paid, 'share', b.share,
                                          'balance', b.paid - b.share + b.sent - b.received)
                       order by b.paid - b.share + b.sent - b.received desc, p.display_name)
      from public.saldos(a.id, v_mes) b
      join public.people p on p.id = b.person_id
      where b.paid <> 0 or b.share <> 0 or b.sent <> 0 or b.received <> 0
    ), '[]'::jsonb),
    -- Si se liquidara hoy sin cruzar deudas: por pareja, y quién pagó algo de quién
    -- (con eso el connector busca menos transferencias, como la app)
    'direct', a.settle_direct,
    'paid_for', case when a.settle_direct then coalesce((
      select jsonb_agg(distinct jsonb_build_object('from_id', s2.person_id, 'to_id', e.payer_person_id))
      from public.expenses e
      join public.expense_splits s2 on s2.expense_id = e.id
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
        and e.payer_person_id is not null and s2.person_id <> e.payer_person_id and s2.amount_cop > 0
    ), '[]'::jsonb) end,
    'direct_transfers', case when a.settle_direct then coalesce((
      select jsonb_agg(jsonb_build_object(
        'from', pf.display_name, 'to', pt.display_name, 'amount', x.amount_cop, 'from_id', x.from_person_id, 'to_id', x.to_person_id
      ) order by x.amount_cop desc, x.from_person_id, x.to_person_id)
      from public.transferencias_directas(a.id, v_mes) x
      join public.people pf on pf.id = x.from_person_id
      join public.people pt on pt.id = x.to_person_id
    ), '[]'::jsonb) end,
    'settlement', case when s.id is null then null else coalesce((
      select jsonb_agg(jsonb_build_object(
        'from', pf.display_name, 'to', pt.display_name, 'amount', t.amount_cop, 'paid', t.paid_at is not null,
        'from_id', t.from_person_id, 'to_id', t.to_person_id
      ) order by t.position)
      from public.settlement_transfers t
      join public.people pf on pf.id = t.from_person_id
      join public.people pt on pt.id = t.to_person_id
      where t.settlement_id = s.id
    ), '[]'::jsonb) end,
    'me', case when v_person is null then null else (
      select jsonb_build_object(
        'id', p.id,
        'name', p.display_name,
        -- Lo que consumió: los gastos donde tuvo parte, con los ítems (para decirle por qué debe)
        'consumo', coalesce((
          select jsonb_agg(gx.e || jsonb_build_object(
            'payer_name', (select p2.display_name from public.people p2 where p2.id = public.try_uuid(gx.e ->> 'payer_person_id'))
          ) order by gx.n)
          from jsonb_array_elements(public.account_numbers(a.id, v_mes) -> 'expenses') with ordinality as gx (e, n)
          where gx.e -> 'shares' @> jsonb_build_array(jsonb_build_object('person_id', p.id))
        ), '[]'::jsonb),
        'expenses', coalesce((
          select jsonb_agg(jsonb_build_object('merchant', x.merchant, 'total', x.total_cop, 'date', x.expense_date) order by x.expense_date desc, x.created_at desc)
          from (
            select e.merchant, e.total_cop, e.expense_date, e.created_at
            from public.expenses e
            where e.account_id = a.id and e.payer_person_id = p.id and e.expense_date >= v_desde and e.expense_date < v_hasta
            order by e.expense_date desc, e.created_at desc
            limit 5
          ) x
        ), '[]'::jsonb),
        'paid_total', (
          select coalesce(sum(e.total_cop), 0) from public.expenses e
          where e.account_id = a.id and e.payer_person_id = p.id and e.expense_date >= v_desde and e.expense_date < v_hasta
        ),
        'paid_count', (
          select count(*) from public.expenses e
          where e.account_id = a.id and e.payer_person_id = p.id and e.expense_date >= v_desde and e.expense_date < v_hasta
        )
      )
      from public.people p where p.id = v_person
    ) end
  );
end;
$$;
