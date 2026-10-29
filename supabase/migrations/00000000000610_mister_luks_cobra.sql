-- ============================================================================
-- Lucas · 00000000000610_mister_luks_cobra.sql
-- «La idea es que Mister Luks cobre por mí»: los recordatorios también le
-- llegan por privado a quien debe y está en el grupo, aunque nunca le haya
-- contestado (en la 600 solo el primer aviso; los recordatorios iban al
-- grupo). Cada 3 días, como mucho 3 recordatorios, como siempre. Quien dice
-- «no me escribas» sigue solo en el grupo.
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
             -- Su chat con Mister Luks; si nunca le escribió, el del número con que está en el grupo:
             -- el aviso y los recordatorios le llegan por privado. Si prefiere el grupo, nunca
             case when ch.prefiere_el_grupo then null
                  else coalesce(ch.abierto, public.chat_nuevo_para(t.from_person_id))
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

revoke execute on function public.connector_avisos_de_cobro(int) from public, anon, authenticated;
grant execute on function public.connector_avisos_de_cobro(int) to service_role;
