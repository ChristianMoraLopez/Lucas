-- ============================================================================
-- Lucas · 00000000000590_comprobantes_que_son_pagos.sql
-- Nochita, ya liquidada: Juanes mandó el «Comprobante de transferencia» de Nu
-- (los $9.800 que le debía a Christian). El worker no lo reconoció como
-- transferencia, quedó como un gasto «Comprobante de» y Mister Luks preguntó
-- si reabría el paseo.
--
--   · El worker ya lo reconoce (y el «Envío exitoso / Destino:» de
--     Bancolombia). Si no sabe leer el comprobante del todo, prueba sus montos
--     sin el nombre: worker_pago_con_comprobante lo marca pagado solo si una
--     sola deuda de quien lo mandó cuadra con el monto.
--   · Si aun así no se puede emparejar, el worker lo marca «parece_pago»:
--     nunca se confirma solo y, en un paseo liquidado, la pregunta del grupo
--     es «¿es un pago o un gasto?»: «pago» no lo anota (el mensaje queda como
--     no gasto); «1» y «2», como antes.
-- ============================================================================

-- ¿Le pagó a alguien de la cuenta? (como en la 510, sin adivinar cuando no se ve el nombre)
create or replace function public.worker_pago_con_comprobante(p_message_id uuid, p_monto bigint, p_para text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  a public.accounts%rowtype;
  v_cuenta uuid;
  v_de uuid;
  v_para uuid;
  v_periodo date;
  t public.settlement_transfers%rowtype;
  v_grupo text;
  v_en boolean;
  v_quien text;
  v_a_quien text;
  v_nombre_cuenta text;
  v_tipo text;
  v_body text;
  v_todos boolean;
  v_monto text := public.format_cop(p_monto);
  v_para_txt text[] := coalesce(p_para, '{}');
  -- La cuenta se abrió con esta foto (la anterior estaba cerrada): lo de antes es de la anterior
  v_recien boolean;
begin
  select * into m from public.messages where id = p_message_id;
  if m.id is null or m.source <> 'whatsapp' or p_monto is null or p_monto <= 0 then
    return jsonb_build_object('handled', false);
  end if;
  select * into a from public.accounts where id = m.account_id;
  v_recien := a.previous_account_id is not null and a.created_at >= m.created_at - interval '2 minutes';

  -- 1. Lo que le falta pagar a quien recibe (por el nombre, o a quien sea si el banco no lo muestra), aquí o en la anterior
  foreach v_cuenta in array array_remove(array[a.id, a.previous_account_id], null) loop
    v_de := case when v_cuenta = a.id then coalesce(m.sender_person_id, public.wa_person(v_cuenta, m.sender_wa_id))
                 else public.wa_person(v_cuenta, m.sender_wa_id) end;
    continue when v_de is null;
    select x.* into t
    from public.settlement_transfers x
    where x.account_id = v_cuenta and x.from_person_id = v_de and x.paid_at is null
      and (cardinality(v_para_txt) = 0 or public.nombre_coincide(x.to_person_id, v_para_txt) > 0)
    order by abs(x.amount_cop - p_monto), public.nombre_coincide(x.to_person_id, v_para_txt) desc
    limit 1;
    -- Sin el nombre (un comprobante que no se supo leer del todo), solo si una sola deuda
    -- cuadra con el monto: si le debe eso mismo a dos, no se adivina a cuál (la 590)
    if t.id is not null and cardinality(v_para_txt) = 0 and (
      select count(*) from public.settlement_transfers x
      where x.account_id = v_cuenta and x.from_person_id = v_de and x.paid_at is null
        and abs(x.amount_cop - p_monto) <= greatest(1000, x.amount_cop * 0.02)
    ) <> 1 then
      t := null;
    end if;
    exit when t.id is not null;
  end loop;

  if t.id is not null and abs(t.amount_cop - p_monto) <= greatest(1000, t.amount_cop * 0.02) then
    update public.settlement_transfers
    set paid_at = now(), paid_by = (select p.claimed_by from public.people p where p.id = v_de), paid_via = 'whatsapp'
    where id = t.id;
    v_cuenta := t.account_id;
    v_para := t.to_person_id;
    v_tipo := 'pagada';
  elsif t.id is not null and cardinality(v_para_txt) > 0 then
    v_cuenta := t.account_id;
    v_para := t.to_person_id;
    v_tipo := 'distinto';
  else
    -- 2. ¿Quien recibe es de la cuenta? (uno solo, y no quien manda). Si no, es un gasto
    v_cuenta := case when v_recien then a.previous_account_id else a.id end;
    v_de := case when v_cuenta = a.id then coalesce(m.sender_person_id, public.wa_person(v_cuenta, m.sender_wa_id))
                 else public.wa_person(v_cuenta, m.sender_wa_id) end;
    if v_de is null or cardinality(v_para_txt) = 0 then
      return jsonb_build_object('handled', false);
    end if;
    select p.id into v_para
    from public.people p
    where p.account_id = v_cuenta and p.id <> v_de and public.nombre_coincide(p.id, v_para_txt) > 0
    order by public.nombre_coincide(p.id, v_para_txt) desc, p.created_at
    limit 1;
    if v_para is null or (
      select count(*) from public.people p
      where p.account_id = v_cuenta and p.id <> v_de
        and public.nombre_coincide(p.id, v_para_txt) = public.nombre_coincide(v_para, v_para_txt)
    ) > 1 then
      return jsonb_build_object('handled', false); -- nadie, o dos que se llaman parecido: no se adivina
    end if;

    v_periodo := case when a.type = 'hogar' then date_trunc('month', (coalesce(m.received_at, now()) at time zone 'America/Bogota'))::date end;
    if exists (
      select 1 from public.settlement_transfers x
      where x.account_id = v_cuenta and x.from_person_id = v_de and x.to_person_id = v_para and x.paid_at is not null
    ) then
      v_tipo := 'ya_estaba';
    elsif v_cuenta <> a.id or a.status <> 'active'
       or exists (select 1 from public.settlements s where s.account_id = v_cuenta and s.period is not distinct from v_periodo) then
      v_tipo := 'no_debia';
    else
      -- Sin liquidar: un pago hecho que ya cuenta en los saldos
      insert into public.settlement_payments (account_id, period, from_person_id, to_person_id, amount_cop, paid_at, paid_by)
      values (v_cuenta, v_periodo, v_de, v_para, p_monto, coalesce(m.received_at, now()), (select p.claimed_by from public.people p where p.id = v_de));
      v_tipo := 'abono';
    end if;
  end if;

  select c.name, c.language = 'en' into v_nombre_cuenta, v_en from public.accounts c where c.id = v_cuenta;
  v_quien := split_part(btrim(coalesce((select p.display_name from public.people p where p.id = v_de), '')), ' ', 1);
  v_a_quien := split_part(btrim(coalesce((select p.display_name from public.people p where p.id = v_para), '')), ' ', 1);
  v_todos := v_tipo = 'pagada' and not exists (
    select 1 from public.settlement_transfers x where x.settlement_id = t.settlement_id and x.paid_at is null
  );
  v_body := case
    when v_tipo = 'pagada' and v_en then
      '✅ Got the receipt: ' || v_quien || ' paid ' || v_a_quien || ' ' || v_monto || '. Marked as paid in “' || v_nombre_cuenta || '”.'
        || case when v_todos then E'\n🎉 With this, everyone has paid.' else '' end
    when v_tipo = 'pagada' then
      '✅ Vi el comprobante: ' || v_quien || ' le pagó ' || v_monto || ' a ' || v_a_quien || '. Queda marcado en «' || v_nombre_cuenta || '».'
        || case when v_todos then E'\n🎉 Con esto ya pagaron todos.' else '' end
    when v_tipo = 'distinto' and v_en then
      '🧾 Got ' || v_quien || '’s receipt: ' || v_monto || ' to ' || v_a_quien || '. In “' || v_nombre_cuenta || '” they owed '
        || public.format_cop(t.amount_cop) || E', so I didn’t mark it. If it’s settled, tell me *I paid* or mark it at mrluks.com.'
    when v_tipo = 'distinto' then
      '🧾 Vi el comprobante de ' || v_quien || ': ' || v_monto || ' para ' || v_a_quien || '. En «' || v_nombre_cuenta || '» le debía '
        || public.format_cop(t.amount_cop) || E', así que no lo marqué. Si ya quedó, escríbeme *ya pagué* o márquenlo en mrluks.com.'
    when v_tipo = 'ya_estaba' and v_en then
      '✅ Got ' || v_quien || '’s receipt to ' || v_a_quien || ' (' || v_monto || '): it was already marked as paid in “' || v_nombre_cuenta || '”.'
    when v_tipo = 'ya_estaba' then
      '✅ Vi el comprobante de ' || v_quien || ' para ' || v_a_quien || ' (' || v_monto || '): ya estaba marcado en «' || v_nombre_cuenta || '».'
    when v_tipo = 'no_debia' and v_en then
      '🧾 Got ' || v_quien || '’s receipt to ' || v_a_quien || ' (' || v_monto || '), but in “' || v_nombre_cuenta || '” '
        || v_quien || ' didn’t owe ' || v_a_quien || ' anything. It’s not an expense, so I didn’t log it.'
    when v_tipo = 'no_debia' then
      '🧾 Vi el comprobante de ' || v_quien || ' para ' || v_a_quien || ' (' || v_monto || '), pero en «' || v_nombre_cuenta || '» '
        || v_quien || ' no le debía nada a ' || v_a_quien || '. No es un gasto, así que no lo anoté.'
    when v_en then
      '✅ Logged: ' || v_quien || ' sent ' || v_a_quien || ' ' || v_monto || '. It already counts in “' || v_nombre_cuenta
        || E'”: when you settle, only what’s left is asked for.'
    else
      '✅ Anotado: ' || v_quien || ' le pasó ' || v_monto || ' a ' || v_a_quien || '. Ya cuenta en «' || v_nombre_cuenta
        || E'»: al liquidar solo se pide lo que falta.'
  end;

  v_grupo := coalesce(public.grupo_con_mister_luks(v_cuenta), public.grupo_con_mister_luks(a.id));
  if v_grupo is not null then
    perform public.connector_outbox_enqueue(jsonb_build_array(jsonb_build_object(
      'chat_jid', v_grupo,
      'reason', 'answer',
      'group_id', (select g.id from public.whatsapp_groups g where g.wa_group_jid = v_grupo),
      'dedupe_key', 'comprobante:' || m.id,
      'body', v_body
    )));
  end if;
  return jsonb_build_object(
    'handled', true, 'tipo', v_tipo, 'account_id', v_cuenta, 'from', v_de, 'to', v_para,
    'transfer_id', case when v_tipo in ('pagada', 'distinto') then t.id end
  );
end;
$$;

-- ============================================================================
-- Lo que llega a un paseo liquidado (como en la 450): si es un comprobante, la
-- pregunta es si es un pago o un gasto
-- ============================================================================

create or replace function public.en_espera_si_liquidado(p_message_id uuid, p_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  a public.accounts%rowtype;
  v_liquidacion uuid;
  v_grupo uuid;
  v_jid text;
  v_quien text;
  v_total bigint := greatest(coalesce((p_data ->> 'total_cop')::bigint, 0), 0);
  v_comercio text := left(coalesce(nullif(btrim(p_data ->> 'merchant'), ''), 'Gasto sin nombre'), 80);
  v_cuanto text;
  v_siguiente text;
  v_clave text;
  -- Un comprobante que el worker no pudo emparejar con una deuda (la 590): ¿pago o gasto?
  v_pago boolean := coalesce((p_data -> 'ai_snapshot' ->> 'parece_pago')::boolean, false);
begin
  select * into m from public.messages where id = p_message_id;
  if m.id is null or m.source <> 'whatsapp' then
    return false;
  end if;
  select * into a from public.accounts where id = m.account_id;
  if a.type <> 'evento' or a.status <> 'settling' then
    return false;
  end if;
  select s.id into v_liquidacion from public.settlements s where s.account_id = a.id and s.period is null;
  if v_liquidacion is null then
    return false;
  end if;
  -- Sin Mister Luks en el grupo no hay a quién preguntar: se reabre solo, como en la 390
  select g.id, g.wa_group_jid into v_grupo, v_jid
  from public.whatsapp_groups g
  where g.id = m.group_id and g.chat_kind = 'grupo' and g.left_at is null
    and exists (
      select 1 from public.whatsapp_group_sessions gs
      join public.whatsapp_connections c on c.id = gs.connection_id and c.kind = 'contador'
      where gs.group_id = g.id and gs.left_at is null
    );
  if v_grupo is null then
    return false;
  end if;

  insert into public.gastos_en_espera (message_id, account_id, data)
  values (m.id, a.id, p_data)
  on conflict (message_id) do update set data = excluded.data;

  if exists (select 1 from public.preguntas_reabrir q where q.settlement_id = v_liquidacion) then
    return true;
  end if;

  v_quien := split_part(btrim(coalesce((select p.display_name from public.people p where p.id = m.sender_person_id), '')), ' ', 1);
  v_cuanto := case when a.currency in ('COP', 'CLP') and v_total > 0 then ' · ' || public.format_cop(v_total) else '' end;
  v_siguiente := public.nombre_siguiente(a.id);
  v_clave := 'reabrir:' || v_liquidacion;
  perform public.connector_outbox_enqueue(jsonb_build_array(jsonb_build_object(
    'chat_jid', v_jid,
    'reason', 'answer',
    'group_id', v_grupo,
    'dedupe_key', v_clave,
    'body', case when v_pago and a.language = 'en' then
      '🧾 “' || a.name || '” is already settled and ' || coalesce(nullif(v_quien, '') || ' sent', 'there’s') || ' a transfer receipt'
        || v_cuanto || E'. Is it a payment between you or a new expense? Reply to this message:\n'
        || E'*payment* · It’s a payment: I won’t log it as an expense\n'
        || '*1* · It’s an expense: reopen “' || a.name || E'” and add it\n'
        || '*2* · It’s an expense: log it in a new account (“' || v_siguiente || E'”)\n\n📊 More detail at mrluks.com'
    when v_pago then
      '🧾 «' || a.name || '» ya está liquidada y ' || coalesce(nullif(v_quien, '') || ' mandó', 'llegó') || ' un comprobante de transferencia'
        || v_cuanto || E'. ¿Es un pago entre ustedes o un gasto nuevo? Respondan este mensaje:\n'
        || E'*pago* · Es un pago: no lo anoto como gasto\n'
        || '*1* · Es un gasto: reabrir «' || a.name || E'» y sumarlo\n'
        || '*2* · Es un gasto: anotarlo en una cuenta nueva («' || v_siguiente || E'»)\n\n📊 Más detalle en mrluks.com'
    when a.language = 'en' then
      '🔒 “' || a.name || '” is already settled and ' || coalesce(nullif(v_quien, '') || ' sent', 'there’s') || ' a new expense: *'
        || v_comercio || '*' || v_cuanto || E'.\nWhat should I do? Reply to this message:\n'
        || '*1* · Reopen “' || a.name || E'” and add it (what you already paid stays logged)\n'
        || '*2* · Log it in a new account (“' || v_siguiente || E'”)\n\n📊 More detail at mrluks.com'
    else
      '🔒 «' || a.name || '» ya está liquidada y ' || coalesce(nullif(v_quien, '') || ' mandó', 'llegó') || ' un gasto nuevo: *'
        || v_comercio || '*' || v_cuanto || E'.\n¿Qué hago? Respondan este mensaje:\n'
        || '*1* · Reabrir «' || a.name || E'» y sumarlo (lo que ya pagaron queda anotado)\n'
        || '*2* · Anotarlo en una cuenta nueva («' || v_siguiente || E'»)\n\n📊 Más detalle en mrluks.com'
    end
  )));
  insert into public.preguntas_reabrir (settlement_id, account_id, group_id, outbox_id)
  values (v_liquidacion, a.id, v_grupo, (select o.id from public.whatsapp_outbox o where o.dedupe_key = v_clave))
  on conflict (settlement_id) do nothing;
  return true;
end;
$$;

-- ============================================================================
-- La respuesta (como en la 450), con «pago»
-- ============================================================================

create or replace function public.connector_decidir_liquidada(
  p_jid text,
  p_quoted_wa_id text,
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_name text,
  p_modo text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.preguntas_reabrir%rowtype;
  a public.accounts%rowtype;
  d public.accounts%rowtype;
  v_me uuid;
  v_destino uuid;
  v_gastos jsonb;
begin
  if p_modo is null or p_modo not in ('reabrir', 'nueva', 'pago') then
    raise exception 'Responde reabrir, nueva o pago';
  end if;
  select x.* into q
  from public.preguntas_reabrir x
  join public.whatsapp_groups g on g.id = x.group_id
  left join public.whatsapp_outbox o on o.id = x.outbox_id
  where g.wa_group_jid = p_jid and x.decided_at is null
    and (p_quoted_wa_id is null or o.wa_message_id = p_quoted_wa_id)
  order by x.created_at desc
  limit 1
  for update of x;
  if q.settlement_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_es_pregunta');
  end if;
  select * into a from public.accounts where id = q.account_id;
  perform public.wa_identidad(p_wa_id, p_phone, p_lid, p_name);
  v_me := coalesce(
    public.wa_person(a.id, p_wa_id),
    case when p_phone is not null then public.wa_person(a.id, p_phone) end,
    case when p_lid is not null then public.wa_person(a.id, 'lid:' || p_lid) end
  );
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'no_te_conozco', 'language', a.language, 'account_name', a.name);
  end if;
  -- «pago»: los comprobantes que esperaban no son gastos (la 590). Si esperaba algo más, la pregunta sigue
  if p_modo = 'pago' then
    with soltados as (
      update public.gastos_en_espera e
      set released_at = now()
      where e.account_id = a.id and e.released_at is null
        and coalesce((e.data -> 'ai_snapshot' ->> 'parece_pago')::boolean, false)
      returning e.message_id, e.data
    ),
    marcados as (
      update public.messages x set status = 'not_expense', processed_at = now()
      from soltados s where x.id = s.message_id
      returning s.data
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'expense_id', null, 'duplicate_of', null,
      'merchant', left(coalesce(nullif(btrim(y.data ->> 'merchant'), ''), 'Comprobante de transferencia'), 80),
      'total', greatest(coalesce((y.data ->> 'total_cop')::bigint, 0), 0),
      'items', 0
    )), '[]'::jsonb) into v_gastos
    from marcados y;
    if jsonb_array_length(v_gastos) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'sin_comprobante', 'language', a.language, 'account_name', a.name);
    end if;
    if not exists (select 1 from public.gastos_en_espera e where e.account_id = a.id and e.released_at is null) then
      update public.preguntas_reabrir set decided_at = now(), decided_by = v_me where settlement_id = q.settlement_id;
    end if;
    return jsonb_build_object(
      'ok', true, 'modo', 'pago', 'account_id', a.id, 'language', a.language, 'currency', a.currency,
      'name', (select p.display_name from public.people p where p.id = v_me),
      'cuenta', a.name, 'anterior', a.name, 'gastos', v_gastos
    );
  end if;

  if p_modo = 'reabrir' and a.status = 'closed' then
    return jsonb_build_object('ok', false, 'reason', 'cerrada', 'language', a.language, 'account_name', a.name);
  end if;

  if p_modo = 'reabrir' then
    -- Si ya la reabrieron en la app, solo entra lo que esperaba
    if a.status = 'settling' then
      perform public.reabrir_liquidacion(q.settlement_id);
    end if;
    v_destino := a.id;
  else
    v_destino := public.abrir_cuenta_siguiente(q.group_id, a.id);
  end if;
  v_gastos := public.soltar_gastos_en_espera(a.id, v_destino);
  update public.preguntas_reabrir set decided_at = now(), decision = p_modo, decided_by = v_me where settlement_id = q.settlement_id;
  select * into d from public.accounts where id = v_destino;

  return jsonb_build_object(
    'ok', true,
    'modo', p_modo,
    'account_id', d.id,
    'language', d.language,
    'currency', d.currency,
    'name', (select p.display_name from public.people p where p.id = v_me),
    'cuenta', d.name,
    'anterior', a.name,
    'gastos', v_gastos
  );
end;
$$;

revoke execute on function public.worker_pago_con_comprobante(uuid, bigint, text[]) from public, anon, authenticated;
grant execute on function public.worker_pago_con_comprobante(uuid, bigint, text[]) to service_role;
revoke execute on function public.en_espera_si_liquidado(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.connector_decidir_liquidada(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.connector_decidir_liquidada(text, text, text, text, text, text, text) to service_role;
