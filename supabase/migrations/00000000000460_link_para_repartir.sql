-- ============================================================================
-- Lucas · 00000000000460_link_para_repartir.sql
-- La lista de «¿quién pidió qué?» (la 440) lleva el link para terminar de
-- revisar y repartir en la app lo que no quede bien por WhatsApp: para eso
-- connector_items_por_preguntar dice también de qué cuenta es el gasto.
-- ============================================================================

create or replace function public.connector_items_por_preguntar(p_limit int default 10)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.r order by x.creado), '[]'::jsonb)
  from (
    select e.created_at as creado, jsonb_build_object(
      'expense_id', e.id,
      'group_jid', g.wa_group_jid,
      'merchant', e.merchant,
      'total', e.total_cop,
      'tip', e.tip_cop,
      'payer_name', (select p.display_name from public.people p where p.id = e.payer_person_id),
      'account', jsonb_build_object('id', a.id, 'name', a.name, 'language', a.language, 'currency', a.currency),
      'items', (
        select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'quantity', i.quantity, 'total', i.total_cop) order by i.created_at, i.id)
        from public.expense_items i where i.expense_id = e.id and not i.extra and i.total_cop > 0
      )
    ) as r
    from public.expenses e
    join public.accounts a on a.id = e.account_id
    join public.messages m on m.id = e.message_id
    join public.whatsapp_groups g on g.id = m.group_id and g.chat_kind = 'grupo' and g.left_at is null
    where a.type = 'evento' and a.status = 'active'
      and e.source = 'whatsapp'
      and e.created_at > now() - interval '3 hours'
      and e.split_method <> 'items'
      and not exists (select 1 from public.item_prompts p where p.expense_id = e.id)
      and not exists (select 1 from public.expense_splits s where s.expense_id = e.id and s.fixed)
      and (select count(*) from public.expense_items i where i.expense_id = e.id and not i.extra and i.total_cop > 0) between 2 and 30
      and not public.is_settled(a.id, e.expense_date)
      and exists (
        select 1 from public.whatsapp_group_sessions gs
        join public.whatsapp_connections c on c.id = gs.connection_id and c.kind = 'contador'
        where gs.group_id = g.id and gs.left_at is null
      )
    order by e.created_at
    limit greatest(coalesce(p_limit, 10), 1)
  ) x
$$;
