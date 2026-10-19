-- ============================================================================
-- Lucas · 00000000000490_reabrir_desde_la_app.sql
-- 1. Un gasto que llegó por WhatsApp a un paseo liquidado (la 450) también se
--    ve en la app, con lo mismo que pregunta Mister Luks: reabrir y sumarlo, o
--    anotarlo en la cuenta siguiente. Lo que se decida allá, Mister Luks lo
--    cuenta en el grupo (y después sale la lista de quién pidió qué).
-- 2. A quien le deben, Mister Luks le dice de qué: numeros_para_luks trae lo
--    que pagó, con lo de cada uno (pagados).
-- ============================================================================

-- Como en la 480, con lo que pagó (pagados)
create or replace function public.numeros_para_luks(p_account_id uuid, p_person_id uuid, p_wa_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_mes date;
  v_desde date;
  v_hasta date;
  s public.settlements%rowtype;
begin
  select * into a from public.accounts where id = p_account_id;
  if a.id is null then
    return null;
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

  return jsonb_build_object(
    'account', jsonb_build_object(
      'id', a.id, 'name', a.name, 'type', a.type, 'status', a.status, 'currency', a.currency, 'language', a.language, 'month', v_mes
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
    'me', case when p_person_id is null then null else (
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
        -- Lo que pagó, con lo de cada uno: para decirle de qué le pagan
        'pagados', coalesce((
          select jsonb_agg(gx.e order by gx.n)
          from jsonb_array_elements(public.account_numbers(a.id, v_mes) -> 'expenses') with ordinality as gx (e, n)
          where gx.e ->> 'payer_person_id' = p.id::text
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
      from public.people p where p.id = p_person_id
    ) end
  );
end;
$$;

-- ============================================================================
-- gastos_en_espera_de: lo que espera en una cuenta liquidada (null si nada)
-- ============================================================================

create or replace function public.gastos_en_espera_de(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
begin
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  select * into a from public.accounts where id = p_account_id;
  if not exists (select 1 from public.gastos_en_espera ge where ge.account_id = a.id and ge.released_at is null) then
    return null;
  end if;
  return jsonb_build_object(
    'cuenta', a.name,
    'cerrada', a.status = 'closed',
    'siguiente', public.nombre_siguiente(a.id),
    'gastos', (
      select jsonb_agg(jsonb_build_object(
        'merchant', left(coalesce(nullif(btrim(ge.data ->> 'merchant'), ''), 'Gasto sin nombre'), 80),
        'total', greatest(coalesce((ge.data ->> 'total_cop')::bigint, 0), 0),
        'items', jsonb_array_length(coalesce(ge.data -> 'items', '[]'::jsonb)),
        'quien', (select p.display_name from public.people p where p.id = m.sender_person_id),
        'created_at', ge.created_at
      ) order by ge.created_at)
      from public.gastos_en_espera ge
      join public.messages m on m.id = ge.message_id
      where ge.account_id = a.id and ge.released_at is null
    )
  );
end;
$$;

-- ============================================================================
-- decidir_liquidada: lo mismo que responder «1» o «2» a Mister Luks, desde la
-- app (cualquiera de la cuenta, como en el grupo). Mister Luks lo cuenta allá.
-- ============================================================================

create or replace function public.decidir_liquidada(p_account_id uuid, p_modo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  d public.accounts%rowtype;
  q public.preguntas_reabrir%rowtype;
  v_me uuid;
  v_quien text;
  v_grupo uuid;
  v_jid text;
  v_destino uuid;
  v_gastos jsonb;
  v_lista text;
  v_cuenta_moneda boolean;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if p_modo is null or p_modo not in ('reabrir', 'nueva') then
    raise exception 'Elige reabrir o cuenta nueva';
  end if;
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  select * into a from public.accounts where id = p_account_id for update;
  if not exists (select 1 from public.gastos_en_espera ge where ge.account_id = a.id and ge.released_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'nada_en_espera');
  end if;
  if p_modo = 'reabrir' and a.status = 'closed' then
    raise exception 'La cuenta está cerrada: solo se puede anotar en una cuenta nueva';
  end if;

  select x.* into q from public.preguntas_reabrir x
  where x.account_id = a.id and x.decided_at is null
  order by x.created_at desc limit 1
  for update;
  select p.id, p.display_name into v_me, v_quien from public.people p
  where p.account_id = a.id and p.claimed_by = auth.uid()
  order by p.created_at limit 1;
  v_quien := coalesce(split_part(btrim(v_quien), ' ', 1), '');
  v_grupo := coalesce(q.group_id, (select l.group_id from public.account_group_links l where l.account_id = a.id limit 1));

  if p_modo = 'reabrir' then
    if a.status = 'settling' then
      perform public.reabrir_liquidacion((select s.id from public.settlements s where s.account_id = a.id and s.period is null));
    end if;
    v_destino := a.id;
  else
    v_destino := public.abrir_cuenta_siguiente(v_grupo, a.id);
  end if;
  v_gastos := public.soltar_gastos_en_espera(a.id, v_destino);
  update public.preguntas_reabrir set decided_at = now(), decision = p_modo, decided_by = v_me
  where account_id = a.id and decided_at is null;
  select * into d from public.accounts where id = v_destino;

  -- Mister Luks lo cuenta en el grupo (la lista de quién pidió qué sale sola después)
  select g.wa_group_jid into v_jid from public.whatsapp_groups g where g.id = v_grupo and g.chat_kind = 'grupo' and g.left_at is null;
  if v_jid is not null then
    v_cuenta_moneda := d.currency in ('COP', 'CLP');
    select string_agg('*' || (x ->> 'merchant') || '*' || case when v_cuenta_moneda then ' (' || public.format_cop((x ->> 'total')::bigint) || ')' else '' end,
                      case when a.language = 'en' then ' and ' else ' y ' end)
      into v_lista
    from jsonb_array_elements(v_gastos) x
    where x ->> 'duplicate_of' is null;
    perform public.connector_outbox_enqueue(jsonb_build_array(jsonb_build_object(
      'chat_jid', v_jid,
      'reason', 'answer',
      'group_id', v_grupo,
      'dedupe_key', 'reabrir-app:' || coalesce(q.settlement_id::text, a.id::text),
      'body', case
        when a.language = 'en' and p_modo = 'reabrir' then
          '🔓 ' || coalesce(nullif(v_quien, ''), 'Someone') || ' reopened “' || a.name || '” in the app' || coalesce(' and added ' || v_lista, '')
            || E'. When you’re done, settle it again at mrluks.com.\n\n📊 More detail at mrluks.com'
        when a.language = 'en' then
          '🆕 ' || coalesce(nullif(v_quien, ''), 'Someone') || ' opened “' || d.name || '” in the app' || coalesce(' and logged ' || v_lista || ' there', '')
            || '. “' || a.name || E'” stays as it was.\n\n📊 More detail at mrluks.com'
        when p_modo = 'reabrir' then
          '🔓 ' || coalesce(nullif(v_quien, ''), 'Alguien') || ' reabrió «' || a.name || '» desde la app' || coalesce(' y sumó ' || v_lista, '')
            || E'. Cuando terminen, la vuelven a liquidar en mrluks.com.\n\n📊 Más detalle en mrluks.com'
        else
          '🆕 ' || coalesce(nullif(v_quien, ''), 'Alguien') || ' abrió «' || d.name || '» desde la app' || coalesce(' y ahí anotó ' || v_lista, '')
            || '. «' || a.name || E'» queda como estaba.\n\n📊 Más detalle en mrluks.com'
      end
    )));
  end if;

  return jsonb_build_object('ok', true, 'modo', p_modo, 'account_id', d.id, 'cuenta', d.name, 'gastos', v_gastos);
end;
$$;

revoke execute on function public.gastos_en_espera_de(uuid) from public, anon;
revoke execute on function public.decidir_liquidada(uuid, text) from public, anon;
grant execute on function public.gastos_en_espera_de(uuid) to authenticated;
grant execute on function public.decidir_liquidada(uuid, text) to authenticated;
