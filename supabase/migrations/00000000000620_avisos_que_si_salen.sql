-- ============================================================================
-- Lucas · 00000000000620_avisos_que_si_salen.sql
-- Los primeros avisos por privado de la 600 no salieron: la bandeja de salida
-- (connector_outbox_enqueue, de la 330) solo acepta chats que ya existen (que
-- le escribieron a Mister Luks) y los descartó sin decir nada.
--
-- Ahora acepta también el chat de quien debe, pero solo para su aviso de
-- cobro («cobro:<transferencia>:<n>»): la transferencia está sin pagar, la
-- cuenta tiene los avisos prendidos, quien debe no prefiere el grupo y el
-- chat es justo el suyo en el grupo con Mister Luks (chat_nuevo_para). Para
-- todo lo demás sigue igual: nada a quien no le ha escrito.
-- ============================================================================

create or replace function public.es_aviso_a_quien_debe(p_chat_jid text, p_dedupe_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_dedupe_key ~ '^cobro:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]+$', false)
    and exists (
      select 1
      from public.settlement_transfers t
      join public.accounts a on a.id = t.account_id
      where t.id = split_part(p_dedupe_key, ':', 2)::uuid
        and t.paid_at is null and a.auto_cobros and a.status <> 'closed'
        and not public.prefiere_el_grupo(t.from_person_id)
        and public.chat_nuevo_para(t.from_person_id) = p_chat_jid
    )
$$;

-- La bandeja de salida (como en la 330), con el aviso de cobro a quien debe
create or replace function public.connector_outbox_enqueue(p_items jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  x jsonb;
  v_key text;
  v_nuevas text[] := '{}';
begin
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if not exists (
      select 1
      from public.whatsapp_groups g
      join public.whatsapp_group_sessions s on s.group_id = g.id and s.left_at is null
      join public.whatsapp_connections c on c.id = s.connection_id and c.kind = 'contador'
      where g.wa_group_jid = x ->> 'chat_jid'
    )
    -- Un chat que no existe todavía solo para el aviso de cobro a quien debe y está en el grupo (la 620)
    and not public.es_aviso_a_quien_debe(x ->> 'chat_jid', x ->> 'dedupe_key') then
      continue;
    end if;
    insert into public.whatsapp_outbox (chat_jid, reason, body, image_url, document_url, document_name, dedupe_key, identity_id, group_id)
    values (x ->> 'chat_jid', x ->> 'reason', left(x ->> 'body', 4000), x ->> 'image_url', x ->> 'document_url',
            left(x ->> 'document_name', 120), x ->> 'dedupe_key', (x ->> 'identity_id')::uuid,
            -- Si no llega (la guía que pidieron con «ayuda»), el grupo del chat
            coalesce((x ->> 'group_id')::uuid,
                     (select g2.id from public.whatsapp_groups g2 where g2.wa_group_jid = x ->> 'chat_jid' and g2.chat_kind = 'grupo')))
    on conflict (dedupe_key) do nothing
    returning dedupe_key into v_key;
    if v_key is not null then
      v_nuevas := v_nuevas || v_key;
      v_key := null;
    end if;
  end loop;
  return v_nuevas;
end;
$$;

revoke execute on function public.es_aviso_a_quien_debe(text, text) from public, anon, authenticated;
revoke execute on function public.connector_outbox_enqueue(jsonb) from public, anon, authenticated;
grant execute on function public.connector_outbox_enqueue(jsonb) to service_role;
