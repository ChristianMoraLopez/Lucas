-- ============================================================================
-- Lucas · 00000000000660_primer_gasto.sql
-- Santiago mandó su primer recibo en su grupo con Mister Luks y quedó anotado,
-- pero Mister Luks no dijo nada (las confirmaciones vienen apagadas en cada
-- grupo, la 315) y él quedó confundido. Al primer recibo que alguien manda en
-- una cuenta, Mister Luks le contesta siempre: «Listo, ya quedó registrado tu
-- gasto; revísalo aquí (el link) o pregúntame cuánto llevamos».
--
--   · Primera vez = el primer gasto anotado de esa persona en esa cuenta: no
--     tiene otro ya contestado (o callado) por Mister Luks, ni subido en la
--     app. Si manda varios seguidos, van todos en el mismo mensaje.
--   · Lo de un chat exportado no cuenta (eso no es alguien empezando).
--   · Después, lo de siempre: el grupo confirma cada gasto solo si un admin lo
--     prendió; por privado se contesta todo (la 630).
-- ============================================================================

-- ¿Es el primer gasto anotado de quien lo mandó en esa cuenta?
create or replace function public.es_primer_gasto(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.messages m
    where m.id = p_message_id
      and m.status = 'done' and m.source = 'whatsapp' and m.import_id is null
      and m.sender_person_id is not null
      and exists (select 1 from public.expenses e where e.message_id = m.id)
      and not exists (
        select 1 from public.messages m2
        where m2.account_id = m.account_id and m2.sender_person_id = m.sender_person_id
          and m2.id <> m.id and m2.status = 'done'
          -- Ya se le contestó (o se calló) a otro, o lo subió en la app o venía en un chat exportado
          and (m2.group_reply_at is not null or m2.source <> 'whatsapp' or m2.import_id is not null)
      )
  )
$$;

-- ============================================================================
-- Las respuestas de Luks (como en la 630), con el primer gasto de cada quien
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
  -- apagaron (salvo el primer gasto de cada quien) y lo de hace más de un día
  update public.messages m
  set group_reply_at = now()
  from public.account_group_links l
  where l.group_id = m.group_id
    and m.source = 'whatsapp' and m.group_reply_at is null
    and m.status in ('done', 'not_expense', 'duplicate', 'failed')
    and ((not l.confirm_in_group and not public.es_primer_gasto(m.id))
         or m.status in ('not_expense', 'failed') or m.received_at < now() - interval '1 day');
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
      'account_id', a.id,
      'account_name', a.name,
      -- Su primer gasto en la cuenta (la 660): «ya quedó registrado, revísalo aquí»
      'primera_vez', public.es_primer_gasto(m.id),
      'sender_person_id', m.sender_person_id,
      'sender_name', sp.display_name,
      -- Con usuario en la cuenta abre el gasto en la app; sin él, el link público de la cuenta
      'con_sesion', sp.claimed_by is not null
        and exists (select 1 from public.account_members am where am.account_id = a.id and am.user_id = sp.claimed_by),
      'token', (select sh.token from public.account_shares sh where sh.account_id = a.id),
      'expense', (
        select jsonb_build_object(
          'id', e.id,
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
    left join public.people sp on sp.id = m.sender_person_id
    where m.source = 'whatsapp' and m.group_reply_at is null
      and g.left_at is null
      and ((l.confirm_in_group and m.status in ('done', 'duplicate'))
           or (l.group_id is not null and public.es_primer_gasto(m.id))
           or (g.chat_kind = 'privado' and m.status in ('done', 'duplicate', 'not_expense', 'failed')))
    order by m.received_at
    limit p_limit
  ) t;
  return v_out;
end;
$$;

revoke execute on function public.es_primer_gasto(uuid) from public, anon, authenticated;
revoke execute on function public.connector_pending_replies(int) from public, anon, authenticated;
grant execute on function public.connector_pending_replies(int) to service_role;
