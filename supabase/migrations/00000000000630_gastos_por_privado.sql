-- ============================================================================
-- Lucas · 00000000000630_gastos_por_privado.sql
-- Santiago le mandó por privado a Mister Luks un pago de $800.000 (el arriendo)
-- y no le respondió nada: por privado, lo que no era una pregunta se ignoraba.
--
-- Ahora Mister Luks pregunta en cuál de sus cuentas abiertas lo anota (o si es
-- su pago de algo que debe) y, con la respuesta, lo anota desde el chat
-- privado: el mensaje queda en la cuenta elegida (su chat privado como
-- «grupo» del mensaje), el worker lo lee como siempre y Mister Luks le
-- confirma por privado cómo quedó.
--
--   · connector_ingest_privado: solo en una cuenta abierta donde quien lo
--     manda es una de las personas (y no dijo «no me cuentes»).
--   · connector_pending_replies (como en la 250): también lo que llegó por
--     privado, con el nombre de la cuenta; ahí se contesta siempre (también
--     si no era un gasto o no se pudo leer), en los grupos como antes.
-- ============================================================================

create or replace function public.connector_ingest_privado(
  p_chat_jid text,
  p_account_id uuid,
  p_wa_message_id text,
  p_sender_wa_id text,
  p_sender_phone text,
  p_sender_lid text,
  p_sender_name text,
  p_kind public.message_kind,
  p_text text,
  p_media_path text,
  p_file_name text,
  p_mime_type text,
  p_sent_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  v_group uuid;
  v_person uuid;
  v_message uuid;
begin
  -- Su chat privado con Mister Luks
  select g.id into v_group
  from public.whatsapp_groups g
  join public.whatsapp_group_sessions s on s.group_id = g.id and s.left_at is null
  join public.whatsapp_connections c on c.id = s.connection_id and c.kind = 'contador'
  where g.wa_group_jid = p_chat_jid and g.chat_kind = 'privado' and g.left_at is null
  limit 1;
  if v_group is null then
    return jsonb_build_object('ingest', false, 'reason', 'sin_chat');
  end if;
  select * into a from public.accounts where id = p_account_id;
  if a.id is null or a.status = 'closed' then
    return jsonb_build_object('ingest', false, 'reason', 'cuenta_cerrada');
  end if;
  if a.status <> 'active' then
    return jsonb_build_object('ingest', false, 'reason', 'cuenta_liquidada', 'account_name', a.name);
  end if;
  v_person := coalesce(
    public.wa_person(a.id, p_sender_wa_id),
    case when p_sender_phone is not null then public.wa_person(a.id, p_sender_phone) end,
    case when p_sender_lid is not null then public.wa_person(a.id, 'lid:' || p_sender_lid) end
  );
  if v_person is null then
    return jsonb_build_object('ingest', false, 'reason', 'no_es_de_la_cuenta', 'account_name', a.name);
  end if;
  if public.no_lo_cuentes(a.id, p_sender_wa_id) then
    return jsonb_build_object('ingest', false, 'reason', 'no_me_cuentes', 'account_name', a.name);
  end if;
  if p_kind = 'text' and nullif(btrim(p_text), '') is null then
    return jsonb_build_object('ingest', false, 'reason', 'vacio');
  end if;
  if p_kind <> 'text' and (p_media_path is null or p_media_path not like a.id::text || '/%') then
    return jsonb_build_object('ingest', false, 'reason', 'archivo_fuera_de_la_cuenta');
  end if;
  if public.es_mensaje_de_luks(p_text) then
    return jsonb_build_object('ingest', false, 'reason', 'mensaje_de_luks');
  end if;

  insert into public.messages (
    account_id, group_id, source, wa_message_id, sender_wa_id, sender_name, sender_person_id,
    kind, text_body, media_path, file_name, mime_type, received_at
  )
  values (
    a.id, v_group, 'whatsapp', p_wa_message_id, p_sender_wa_id, left(p_sender_name, 120), v_person,
    p_kind, left(nullif(btrim(p_text), ''), 4000), p_media_path, left(p_file_name, 120), p_mime_type,
    coalesce(p_sent_at, now())
  )
  on conflict (group_id, wa_message_id) do nothing
  returning id into v_message;
  if v_message is null then
    return jsonb_build_object('ingest', false, 'reason', 'repetido', 'account_name', a.name);
  end if;

  insert into public.jobs (type, payload)
  values ('process_message', jsonb_build_object('message_id', v_message, 'account_id', a.id));
  update public.whatsapp_groups set last_message_at = now() where id = v_group;

  return jsonb_build_object('ingest', true, 'message_id', v_message, 'account_id', a.id, 'account_name', a.name);
end;
$$;

-- ============================================================================
-- Las respuestas de Luks (como en la 250), también por privado
-- ============================================================================

create or replace function public.connector_pending_replies(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  -- Sin confirmación: lo que no es gasto, lo que falló, los grupos que las
  -- apagaron y lo de hace más de un día (ya nadie espera la respuesta)
  update public.messages m
  set group_reply_at = now()
  from public.account_group_links l
  where l.group_id = m.group_id
    and m.source = 'whatsapp' and m.group_reply_at is null
    and m.status in ('done', 'not_expense', 'duplicate', 'failed')
    and (not l.confirm_in_group or m.status in ('not_expense', 'failed') or m.received_at < now() - interval '1 day');
  -- Por privado se contesta siempre, pero no lo de hace más de un día
  update public.messages m
  set group_reply_at = now()
  from public.whatsapp_groups g
  where g.id = m.group_id and g.chat_kind = 'privado'
    and m.source = 'whatsapp' and m.group_reply_at is null
    and m.status in ('done', 'not_expense', 'duplicate', 'failed')
    and m.received_at < now() - interval '1 day';

  select coalesce(jsonb_agg(x order by x ->> 'received_at'), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
      'message_id', m.id,
      'group_jid', g.wa_group_jid,
      'wa_message_id', m.wa_message_id,
      'sender_wa_id', m.sender_wa_id,
      'status', m.status,
      'received_at', m.received_at,
      'currency', a.currency,
      'language', a.language,
      -- Por privado (la 630): la respuesta dice en qué cuenta quedó
      'privado', g.chat_kind = 'privado',
      'account_name', a.name,
      'expense', (
        select jsonb_build_object(
          'merchant', e.merchant, 'total_cop', e.total_cop, 'status', e.status,
          'payer', p.display_name,
          'split_count', (select count(*) from public.expense_splits s where s.expense_id = e.id)
        )
        from public.expenses e left join public.people p on p.id = e.payer_person_id
        where e.message_id = m.id
        limit 1
      ),
      'duplicate_of', (
        select jsonb_build_object('merchant', d.merchant, 'total_cop', d.total_cop, 'expense_date', d.expense_date)
        from public.expenses d where d.id = m.duplicate_of
      )
    ) as x
    from public.messages m
    join public.accounts a on a.id = m.account_id
    join public.whatsapp_groups g on g.id = m.group_id
    left join public.account_group_links l on l.group_id = m.group_id
    where m.source = 'whatsapp' and m.group_reply_at is null
      and g.left_at is null
      and ((l.confirm_in_group and m.status in ('done', 'duplicate'))
           or (g.chat_kind = 'privado' and m.status in ('done', 'duplicate', 'not_expense', 'failed')))
    order by m.received_at
    limit p_limit
  ) t;
  return v_out;
end;
$$;

revoke execute on function public.connector_ingest_privado(text, uuid, text, text, text, text, text, public.message_kind, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.connector_ingest_privado(text, uuid, text, text, text, text, text, public.message_kind, text, text, text, text, timestamptz) to service_role;
revoke execute on function public.connector_pending_replies(int) from public, anon, authenticated;
grant execute on function public.connector_pending_replies(int) to service_role;
