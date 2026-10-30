-- ============================================================================
-- Lucas · 00000000000680_confirmaciones_apagadas.sql
-- Santiago mandó su segundo gasto en su grupo y Mister Luks no dijo nada: el
-- grupo no confirma cada gasto (vienen apagadas, la 315) y él no lo sabía.
-- El mensaje de su primer recibo (la 660) ahora lo dice: de aquí en adelante
-- no confirma cada uno, y quien administra la cuenta lo prende en la app.
-- connector_pending_replies (como en la 660) le cuenta al connector si el grupo
-- confirma y si quien mandó el recibo administra la cuenta.
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
      -- ¿El grupo confirma cada gasto? Si no, el primer recibo dice que de ahí en adelante no, y
      -- cómo prenderlo (quien administra la cuenta, en la app) (la 680)
      'confirma', coalesce(l.confirm_in_group, false),
      'admin', exists (
        select 1 from public.account_members am
        where am.account_id = a.id and am.user_id = sp.claimed_by and am.role in ('owner', 'admin')
      ),
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

revoke execute on function public.connector_pending_replies(int) from public, anon, authenticated;
grant execute on function public.connector_pending_replies(int) to service_role;
