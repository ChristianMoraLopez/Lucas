-- ============================================================================
-- Lucas · 00000000000600_escribirle_a_quien_debe.sql
-- Nochita, liquidada: el aviso de cobro solo le llegó por privado a Tiago (el
-- único que le había escrito a Mister Luks); a los demás, en el grupo. Christian
-- quiere que Mister Luks le escriba también a quien nunca le ha escrito: «Hola,
-- soy Mister Luks, te escribo porque estás en el grupo Nochita; le debes tanto
-- a Christian por esto».
--
--   · El primer aviso de cada liquidación le llega por privado a quien debe y
--     está en el grupo con Mister Luks, aunque nunca le haya escrito. Si no
--     responde, los recordatorios siguen en el grupo (no se le insiste por
--     privado a quien no ha contestado).
--   · Quien dice «no me escribas» (o prefiere que le respondan en el grupo,
--     whatsapp_answer_prefs = 'aqui') no recibe nada por privado.
--   · Solo con los avisos de cobro prendidos en la cuenta, como siempre.
--   · Es connector_avisos_de_cobro (connector_cobros queda como en la 570
--     para el connector de antes, mientras se actualiza: ese no se presenta).
-- ============================================================================

-- ¿Prefiere que Mister Luks le hable en el grupo? («no me escribas» o «dímelo aquí»)
create or replace function public.prefiere_el_grupo(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.person_whatsapp_ids w
    join public.whatsapp_identities i on i.phone = w.wa_id or 'lid:' || i.lid = w.wa_id
    join public.whatsapp_answer_prefs x on x.identity_id = i.id
    where w.person_id = p_person_id and x.mode = 'aqui'
  )
$$;

-- Su chat privado aunque nunca le haya escrito a Mister Luks: está ahora en el grupo de la cuenta
-- (con su número si se ve; si no, con su LID)
create or replace function public.chat_nuevo_para(p_person_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when gm.phone is not null then gm.phone || '@s.whatsapp.net' else gm.lid || '@lid' end
  from public.people p
  join public.person_whatsapp_ids w on w.person_id = p.id
  join public.account_group_links l on l.account_id = p.account_id
  join public.whatsapp_groups g on g.id = l.group_id and g.chat_kind = 'grupo' and g.left_at is null
  join public.whatsapp_group_sessions gs on gs.group_id = g.id and gs.left_at is null
  join public.whatsapp_connections c on c.id = gs.connection_id and c.kind = 'contador'
  join public.whatsapp_group_members gm on gm.group_id = g.id and gm.left_at is null
   and (gm.wa_id = w.wa_id or gm.phone = w.wa_id or 'lid:' || gm.lid = w.wa_id)
  where p.id = p_person_id
    and (gm.phone is not null or gm.lid is not null)
    and not public.no_lo_cuentes(p.account_id, w.wa_id)
  order by gm.phone is null, gm.updated_at desc
  limit 1
$$;

-- Lo que ve Liquidar (como en la 410): a quiénes les puede escribir por privado
create or replace function public.auto_cobros_estado(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  return jsonb_build_object(
    'on', (select a.auto_cobros from public.accounts a where a.id = p_account_id),
    'grupo', public.grupo_con_mister_luks(p_account_id) is not null,
    'por_privado', coalesce((
      select jsonb_agg(p.id) from public.people p
      where p.account_id = p_account_id and not public.prefiere_el_grupo(p.id)
        and (public.chat_privado_de(p.id) is not null or public.chat_nuevo_para(p.id) is not null)
    ), '[]'::jsonb)
  );
end;
$$;

-- ============================================================================
-- connector_avisos_de_cobro: como connector_cobros (la 570), con el primer aviso por privado
-- ============================================================================

create or replace function public.connector_avisos_de_cobro(p_limit int default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce((
    with base as (
      select t.*, s.period, s.created_at as liquidada, a.name as cuenta, a.language, a.currency, a.type,
             ch.abierto,
             -- Su chat con Mister Luks; si nunca le escribió, el primer aviso le llega igual por
             -- privado (está en el grupo); los recordatorios, en el grupo. Si prefiere el grupo, nunca
             case when ch.prefiere_el_grupo then null
                  else coalesce(ch.abierto, case when not t.avisado_privado then public.chat_nuevo_para(t.from_person_id) end)
             end as privado,
             public.grupo_con_mister_luks(a.id) as grupo
      from public.settlement_transfers t
      join public.settlements s on s.id = t.settlement_id
      join public.accounts a on a.id = t.account_id
      cross join lateral (
        select public.chat_privado_de(t.from_person_id) as abierto, public.prefiere_el_grupo(t.from_person_id) as prefiere_el_grupo
      ) ch
      where a.auto_cobros and a.status <> 'closed'
        and t.paid_at is null
        and s.created_at > now() - interval '45 days'
    ),
    pendientes as (
      select * from base b
      where (b.privado is not null or b.grupo is not null)
        and (b.avisado_at is null
             or (b.avisado_at < now() - interval '3 days' and b.avisos < 4)
             or (b.privado is not null and not b.avisado_privado and b.avisos < 4))
      order by b.liquidada, b.position
      limit greatest(coalesce(p_limit, 40), 1)
    )
    select jsonb_agg(jsonb_build_object(
      'transfer_id', x.id,
      'settlement_id', x.settlement_id,
      'avisos', x.avisos,
      'avisado_privado', x.avisado_privado,
      'account', jsonb_build_object('id', x.account_id, 'name', x.cuenta, 'language', x.language, 'currency', x.currency,
                                    'type', x.type, 'month', x.period),
      'from', jsonb_build_object('id', x.from_person_id, 'name', (select p.display_name from public.people p where p.id = x.from_person_id)),
      'to', jsonb_build_object(
        'id', x.to_person_id,
        'name', (select p.display_name from public.people p where p.id = x.to_person_id),
        'pago', (select public.pago_de_usuario(p.claimed_by) from public.people p where p.id = x.to_person_id)
      ),
      'amount', x.amount_cop,
      'private_jid', x.privado,
      -- Nunca le ha escrito a Mister Luks: el mensaje se presenta (la 600)
      'primera_vez', x.privado is not null and x.abierto is null,
      'group_jid', x.grupo,
      'token', (select sh.token from public.account_shares sh where sh.account_id = x.account_id),
      -- Todo lo que le falta pagar a quien debe en esta liquidación (si le paga a varios), con cómo le pagan a cada uno
      'transfers', (
        select jsonb_agg(jsonb_build_object('to', p.display_name, 'amount', t2.amount_cop, 'pago', public.pago_de_usuario(p.claimed_by)) order by t2.position)
        from public.settlement_transfers t2 join public.people p on p.id = t2.to_person_id
        where t2.settlement_id = x.settlement_id and t2.from_person_id = x.from_person_id and t2.paid_at is null
      ),
      -- Los gastos en los que tuvo parte y que pagó otro (con los ítems, para decirle qué pidió)
      'expenses', coalesce((
        select jsonb_agg(g || jsonb_build_object('payer_name', (select p.display_name from public.people p where p.id = (g ->> 'payer_person_id')::uuid)))
        from jsonb_array_elements(public.account_numbers(x.account_id, x.period) -> 'expenses') g
        where g ->> 'payer_person_id' is not null
          and g ->> 'payer_person_id' <> x.from_person_id::text
          and g -> 'shares' @> jsonb_build_array(jsonb_build_object('person_id', x.from_person_id))
      ), '[]'::jsonb)
    ) order by x.liquidada, x.position)
    from pendientes x
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.prefiere_el_grupo(uuid) from public, anon, authenticated;
revoke execute on function public.chat_nuevo_para(uuid) from public, anon, authenticated;
revoke execute on function public.connector_avisos_de_cobro(int) from public, anon, authenticated;
grant execute on function public.connector_avisos_de_cobro(int) to service_role;
revoke execute on function public.auto_cobros_estado(uuid) from public, anon;
grant execute on function public.auto_cobros_estado(uuid) to authenticated;
