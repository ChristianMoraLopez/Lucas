-- ============================================================================
-- Lucas · 00000000000410_avisos_de_cobro.sql
-- Avisos de cobro: al liquidar, Mister Luks le escribe a cada quien que debe
-- cuánto, a quién y por qué (ítem por ítem), y se lo recuerda hasta que lo
-- marquen pagado. Se prende o se apaga por cuenta (quien la administra).
--
--   · Por privado solo a quien ya le escribió a Mister Luks (tiene su chat
--     abierto): escribirle a alguien que no lo hizo primero es la forma más
--     rápida de que WhatsApp bloquee el número. A los demás se les avisa en
--     el grupo de la cuenta. Quien dijo «no me cuentes», tampoco por privado.
--   · El primer aviso sale apenas se liquida; después, uno cada 3 días, como
--     mucho 3 recordatorios, y nada de liquidaciones de hace más de 45 días.
--   · El connector arma los mensajes (services/connector/src/cobros.ts) con lo
--     que da connector_cobros y los manda por la bandeja de salida, con el
--     mismo límite de frecuencia de todo lo que escribe.
-- ============================================================================

alter table public.accounts add column auto_cobros boolean not null default false;
comment on column public.accounts.auto_cobros is
  'Al liquidar, Mister Luks le avisa a quien debe (por privado si ya le escribió, si no en el grupo) y se lo recuerda';

alter table public.settlement_transfers
  add column avisos int not null default 0,
  add column avisado_at timestamptz;
comment on column public.settlement_transfers.avisos is 'Cuántas veces Mister Luks le avisó a quien paga (avisos de cobro)';

-- El chat privado con Mister Luks de una persona (si le escribió y no dijo «no me cuentes»)
create or replace function public.chat_privado_de(p_person_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select g.wa_group_jid
  from public.people p
  join public.person_whatsapp_ids w on w.person_id = p.id
  join public.whatsapp_groups g
    on g.chat_kind = 'privado' and g.left_at is null
   and g.wa_group_jid = case when w.wa_id like 'lid:%' then substr(w.wa_id, 5) || '@lid' else w.wa_id || '@s.whatsapp.net' end
  join public.whatsapp_group_sessions gs on gs.group_id = g.id and gs.left_at is null
  join public.whatsapp_connections c on c.id = gs.connection_id and c.kind = 'contador'
  where p.id = p_person_id
    and not public.no_lo_cuentes(p.account_id, w.wa_id)
  order by g.last_message_at desc nulls last
  limit 1
$$;

-- El grupo de la cuenta donde está Mister Luks
create or replace function public.grupo_con_mister_luks(p_account_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select g.wa_group_jid
  from public.account_group_links l
  join public.whatsapp_groups g on g.id = l.group_id and g.chat_kind = 'grupo' and g.left_at is null
  join public.whatsapp_group_sessions gs on gs.group_id = g.id and gs.left_at is null
  join public.whatsapp_connections c on c.id = gs.connection_id and c.kind = 'contador'
  where l.account_id = p_account_id
  limit 1
$$;

-- ============================================================================
-- Prender o apagar los avisos (quien administra). Al prenderlos se crea el
-- link de las cuentas si no existía: los avisos lo llevan para ver lo suyo.
-- ============================================================================

create or replace function public.set_auto_cobros(p_account_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta prenden los avisos de cobro';
  end if;
  if exists (select 1 from public.accounts a where a.id = p_account_id and a.status = 'closed') then
    raise exception 'La cuenta está cerrada: ya no se cobra nada';
  end if;
  update public.accounts set auto_cobros = coalesce(p_on, false) where id = p_account_id;
  if p_on then
    insert into public.account_shares (account_id, token, created_by)
    values (p_account_id, public.new_share_token(), auth.uid())
    on conflict (account_id) do nothing;
  end if;
end;
$$;

-- Lo que ve Liquidar: si están prendidos y a quiénes les llegaría por privado
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
      where p.account_id = p_account_id and public.chat_privado_de(p.id) is not null
    ), '[]'::jsonb)
  );
end;
$$;

-- ============================================================================
-- connector_cobros: los avisos que tocan ahora (el primero apenas se liquida;
-- después cada 3 días, hasta 3 recordatorios), con todo para escribirlos
-- ============================================================================

create or replace function public.connector_cobros(p_limit int default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce((
    with pendientes as (
      select t.*, s.period, s.created_at as liquidada, a.name as cuenta, a.language, a.currency, a.type,
             public.chat_privado_de(t.from_person_id) as privado,
             public.grupo_con_mister_luks(a.id) as grupo
      from public.settlement_transfers t
      join public.settlements s on s.id = t.settlement_id
      join public.accounts a on a.id = t.account_id
      where a.auto_cobros and a.status <> 'closed'
        and t.paid_at is null
        and s.created_at > now() - interval '45 days'
        and (t.avisado_at is null or (t.avisado_at < now() - interval '3 days' and t.avisos < 4))
      order by s.created_at, t.position
      limit greatest(coalesce(p_limit, 40), 1)
    )
    select jsonb_agg(jsonb_build_object(
      'transfer_id', x.id,
      'settlement_id', x.settlement_id,
      'avisos', x.avisos,
      'account', jsonb_build_object('id', x.account_id, 'name', x.cuenta, 'language', x.language, 'currency', x.currency,
                                    'type', x.type, 'month', x.period),
      'from', jsonb_build_object('id', x.from_person_id, 'name', (select p.display_name from public.people p where p.id = x.from_person_id)),
      'to', jsonb_build_object('id', x.to_person_id, 'name', (select p.display_name from public.people p where p.id = x.to_person_id)),
      'amount', x.amount_cop,
      'private_jid', x.privado,
      'group_jid', x.grupo,
      'token', (select sh.token from public.account_shares sh where sh.account_id = x.account_id),
      -- Todo lo que paga quien debe en esta liquidación (si le paga a varios)
      'transfers', (
        select jsonb_agg(jsonb_build_object('to', p.display_name, 'amount', t2.amount_cop) order by t2.position)
        from public.settlement_transfers t2 join public.people p on p.id = t2.to_person_id
        where t2.settlement_id = x.settlement_id and t2.from_person_id = x.from_person_id
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
    where x.privado is not null or x.grupo is not null
  ), '[]'::jsonb);
end;
$$;

-- Ya se avisó (aunque la bandeja de salida lo haya descartado por estar repetido)
create or replace function public.connector_cobros_avisados(p_transfer_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.settlement_transfers
  set avisos = avisos + 1, avisado_at = now()
  where id = any (coalesce(p_transfer_ids, '{}'))
$$;

-- ============================================================================
-- Permisos
-- ============================================================================

revoke execute on function public.chat_privado_de(uuid) from public, anon, authenticated;
revoke execute on function public.grupo_con_mister_luks(uuid) from public, anon, authenticated;
revoke execute on function public.connector_cobros(int) from public, anon, authenticated;
revoke execute on function public.connector_cobros_avisados(uuid[]) from public, anon, authenticated;
grant execute on function public.connector_cobros(int) to service_role;
grant execute on function public.connector_cobros_avisados(uuid[]) to service_role;

revoke execute on function public.set_auto_cobros(uuid, boolean) from public, anon;
revoke execute on function public.auto_cobros_estado(uuid) from public, anon;
grant execute on function public.set_auto_cobros(uuid, boolean) to authenticated;
grant execute on function public.auto_cobros_estado(uuid) to authenticated;
