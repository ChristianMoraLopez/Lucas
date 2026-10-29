-- ============================================================================
-- Lucas · 00000000000510_pago_con_comprobante.sql
-- Javi manda al grupo el pantallazo de la transferencia («Listo! Enviaste tu
-- dinero $48.750 · Para Chr****** Rey** Mor*** Lop**») con un «ya pagué mi
-- amor ❤️». Antes era un gasto nuevo de «X Bre-B|nu» y, con el paseo
-- liquidado, Mister Luks preguntaba si reabría. Es un pago entre ellos:
--
--   · Si le debía eso (o casi) a quien recibe, la transferencia queda pagada y
--     Mister Luks lo dice en el grupo.
--   · Si le debía otra cantidad, lo dice y no marca nada.
--   · Si ya estaba pagada, o no le debía nada, también lo dice.
--   · Sin liquidar todavía, queda como un pago hecho (settlement_payments, como
--     lo de una liquidación que se reabrió): cuenta en los saldos y al liquidar
--     solo se pide lo que falta.
--   · Si quien recibe no es de la cuenta (la tienda, el hostal), sí es un
--     gasto: sigue como siempre.
--
-- El worker lee el monto y lo que se ve del nombre de quien recibe (el banco
-- lo tapa: «Chr****** Rey**» → {chr, rey}); aquí se compara con el nombre de
-- cada persona y con el de su perfil. Una cuenta cerrada ya abrió la siguiente
-- al llegar la foto (la 370): se busca también en la anterior.
-- ============================================================================

-- ¿El nombre de la persona (o el de su perfil) empieza como lo que se ve? El primero tiene que coincidir
create or replace function public.nombre_coincide(p_person_id uuid, p_para text[])
returns int
language sql
stable
security definer
set search_path = ''
as $$
  with nombres as (
    select regexp_split_to_table(
      lower(translate(
        coalesce(p.display_name, '') || ' ' || coalesce(pr.full_name, ''),
        'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
        'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun'
      )),
      '[^a-z]+'
    ) as tok
    from public.people p
    left join public.profiles pr on pr.id = p.claimed_by
    where p.id = p_person_id
  ),
  vistos as (
    select x.pre, x.k from unnest(p_para) with ordinality as x (pre, k) where length(x.pre) >= 2
  ),
  coinciden as (
    select v.k from vistos v
    where exists (
      select 1 from nombres n
      where length(n.tok) >= 2 and (n.tok like v.pre || '%' or (length(n.tok) >= 3 and v.pre like n.tok || '%'))
    )
  )
  select case when exists (select 1 from coinciden where k = (select min(k) from vistos)) then (select count(*)::int from coinciden) else 0 end
$$;

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

revoke execute on function public.nombre_coincide(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.worker_pago_con_comprobante(uuid, bigint, text[]) from public, anon, authenticated;
grant execute on function public.worker_pago_con_comprobante(uuid, bigint, text[]) to service_role;
