-- ============================================================================
-- Lucas · 00000000000520_eliminar_por_whatsapp.sql
-- «luks elimina este gasto»: alguien responde (cita) en el grupo el mensaje de
-- un gasto (la foto del recibo, el PDF, «fueron 5 lucas de arepa» o la lista
-- de «¿quién pidió qué?» de Mister Luks) y el gasto se elimina, como
-- «Eliminar» en la app (discard_expense): el mensaje queda como «no era un
-- gasto» y no se vuelve a leer.
--
-- Lo puede eliminar quien lo mandó, quien lo pagó o quien administra la
-- cuenta. Lo liquidado no se toca (queda congelado hasta reabrir).
-- ============================================================================

create or replace function public.connector_eliminar_gasto(
  p_jid text,
  p_quoted_wa_id text,
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.messages%rowtype;
  a public.accounts%rowtype;
  v_ids uuid[];
  v_me uuid;
  v_gastos jsonb;
begin
  if p_quoted_wa_id is null then
    return jsonb_build_object('ok', false, 'reason', 'sin_cita');
  end if;

  -- Lo que mandó alguien al grupo (la foto, el PDF o el texto)
  select m.* into msg
  from public.messages m
  join public.whatsapp_groups g on g.id = m.group_id
  where g.wa_group_jid = p_jid and m.wa_message_id = p_quoted_wa_id;

  if msg.id is not null then
    select array_agg(e.id order by e.created_at) into v_ids from public.expenses e where e.message_id = msg.id;
  else
    -- O la lista de «¿quién pidió qué?» que mandó Mister Luks
    select array[p.expense_id] into v_ids
    from public.item_prompts p
    join public.whatsapp_outbox o on o.id = p.outbox_id
    where o.chat_jid = p_jid and o.wa_message_id = p_quoted_wa_id;
  end if;

  if v_ids is null then
    select * into a from public.accounts where id = msg.account_id;
    -- El worker todavía lo está leyendo
    if msg.status in ('queued', 'processing') then
      return jsonb_build_object('ok', false, 'reason', 'procesando', 'language', a.language);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'no_es_gasto', 'language', a.language);
  end if;

  select a2.* into a from public.accounts a2 join public.expenses e on e.account_id = a2.id where e.id = v_ids[1];
  select jsonb_agg(jsonb_build_object('merchant', e.merchant, 'total', e.total_cop) order by e.created_at) into v_gastos
  from public.expenses e where e.id = any (v_ids);

  if a.status = 'closed' or exists (select 1 from public.expenses e where e.id = any (v_ids) and public.is_settled(a.id, e.expense_date)) then
    return jsonb_build_object('ok', false, 'reason', 'liquidado', 'language', a.language, 'account_name', a.name, 'gastos', v_gastos);
  end if;

  perform public.wa_identidad(p_wa_id, p_phone, p_lid, p_name);
  v_me := coalesce(
    public.wa_person(a.id, p_wa_id),
    case when p_phone is not null then public.wa_person(a.id, p_phone) end,
    case when p_lid is not null then public.wa_person(a.id, 'lid:' || p_lid) end
  );
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'no_te_conozco', 'language', a.language, 'account_name', a.name);
  end if;

  -- Quien lo mandó, quien lo pagó o quien administra la cuenta
  if not (
    v_me = msg.sender_person_id
    or (msg.sender_wa_id is not null and v_me = public.wa_person(a.id, msg.sender_wa_id))
    or not exists (select 1 from public.expenses e where e.id = any (v_ids) and e.payer_person_id is distinct from v_me)
    or exists (
      select 1 from public.account_members am
      where am.account_id = a.id and am.person_id = v_me and am.role in ('owner', 'admin')
    )
  ) then
    return jsonb_build_object(
      'ok', false, 'reason', 'no_puedes', 'language', a.language, 'account_name', a.name, 'gastos', v_gastos,
      'name', (select display_name from public.people where id = v_me)
    );
  end if;

  -- Su mensaje (también si citaron la lista de Mister Luks) ya no se vuelve a leer
  update public.messages m set status = 'not_expense'
  where m.id in (select e.message_id from public.expenses e where e.id = any (v_ids));
  delete from public.expenses e where e.id = any (v_ids);

  return jsonb_build_object(
    'ok', true,
    'language', a.language,
    'currency', a.currency,
    'account_id', a.id,
    'account_name', a.name,
    'name', (select display_name from public.people where id = v_me),
    'gastos', v_gastos
  );
end;
$$;

revoke execute on function public.connector_eliminar_gasto(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.connector_eliminar_gasto(text, text, text, text, text, text) to service_role;
