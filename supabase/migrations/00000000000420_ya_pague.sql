-- ============================================================================
-- Lucas · 00000000000420_ya_pague.sql
-- «Ya pagué» por WhatsApp: quien debe le escribe a Mister Luks («luks ya le
-- pagué a Santiago» en el grupo, o «ya pagué» por privado, respondiendo el
-- aviso de cobro) y queda marcado pagado, como al marcarlo en Liquidar.
--
--   · Quien escribe se reconoce por su número (o su LID), como en las
--     preguntas: solo marca lo que él paga, nunca lo de otro.
--   · En el grupo, solo lo de la cuenta del grupo; por privado, lo de todas
--     sus cuentas (el connector decide cuál por el nombre o el monto).
--   · Quien recibe se entera: en el grupo lo ve; si fue por privado, Mister
--     Luks le avisa por su chat privado si ya le escribió, si no en el grupo.
--
-- Y los avisos de cobro (410) cumplen lo que dicen en el grupo: «si me
-- escriben por privado, les mando el detalle por allá». A quien solo se le
-- avisó en el grupo y después le escribe a Mister Luks, le llega el detalle.
-- ============================================================================

alter table public.settlement_transfers
  add column avisado_privado boolean not null default false,
  add column paid_via text check (paid_via in ('app', 'whatsapp'));
comment on column public.settlement_transfers.avisado_privado is 'Si el aviso de cobro ya le llegó por privado (no solo en el grupo)';
comment on column public.settlement_transfers.paid_via is 'Por dónde se marcó pagada: en la app o diciéndole «ya pagué» a Mister Luks';

-- ============================================================================
-- Quién escribe: sus personas (en todas sus cuentas) por su número, su LID o
-- su chat privado, y lo que le falta pagar
-- ============================================================================

create or replace function public.personas_de_wa(p_jid text, p_wa_id text, p_phone text, p_lid text)
returns table (person_id uuid, account_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with dados as (
    select x from unnest(array[
      case when p_wa_id ~ '^([0-9]{6,20}|lid:[0-9]{6,30})$' then p_wa_id end,
      case when p_phone ~ '^[0-9]{6,20}$' then p_phone end,
      case when p_lid ~ '^[0-9]{6,30}$' then 'lid:' || p_lid end,
      case when p_jid ~ '^[0-9]{6,20}@s\.whatsapp\.net$' then split_part(p_jid, '@', 1)
           when p_jid ~ '^[0-9]{6,30}@lid$' then 'lid:' || split_part(p_jid, '@', 1) end
    ]) x
    where x is not null
  ),
  -- El mismo número con su LID (y al revés), si ya se sabe que son el mismo
  ids as (
    select x from dados
    union
    select i.phone from public.whatsapp_identities i
    where i.phone is not null and (i.phone in (select x from dados) or 'lid:' || i.lid in (select x from dados))
    union
    select 'lid:' || i.lid from public.whatsapp_identities i
    where i.lid is not null and (i.phone in (select x from dados) or 'lid:' || i.lid in (select x from dados))
  )
  select distinct w.person_id, p.account_id
  from public.person_whatsapp_ids w
  join public.people p on p.id = w.person_id
  where w.wa_id in (select x from ids)
$$;

-- Lo que le falta pagar a quien escribe: en un grupo, de su cuenta; por privado, de todas
create or replace function public.pendientes_de_wa(p_jid text, p_wa_id text, p_phone text, p_lid text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.settlement_transfers t
  join public.settlements s on s.id = t.settlement_id
  join public.accounts a on a.id = t.account_id
  where t.paid_at is null
    and a.status <> 'closed'
    and s.created_at > now() - interval '120 days'
    and t.from_person_id in (select y.person_id from public.personas_de_wa(p_jid, p_wa_id, p_phone, p_lid) y)
    and (
      not exists (select 1 from public.whatsapp_groups g where g.wa_group_jid = p_jid and g.chat_kind = 'grupo')
      or t.account_id in (
        select l.account_id from public.account_group_links l
        join public.whatsapp_groups g on g.id = l.group_id
        where g.wa_group_jid = p_jid and g.chat_kind = 'grupo'
      )
    )
$$;

-- Una transferencia como la lee el connector
create or replace function public.transferencia_para_luks(p_transfer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'settlement_id', t.settlement_id,
    'account', jsonb_build_object('id', a.id, 'name', a.name, 'language', a.language, 'currency', a.currency),
    'from_id', t.from_person_id,
    'from_name', pf.display_name,
    'to_id', t.to_person_id,
    'to_name', pt.display_name,
    'amount', t.amount_cop
  )
  from public.settlement_transfers t
  join public.accounts a on a.id = t.account_id
  join public.people pf on pf.id = t.from_person_id
  join public.people pt on pt.id = t.to_person_id
  where t.id = p_transfer_id
$$;

-- ============================================================================
-- connector_pendientes: lo que le falta pagar a quien dice «ya pagué»
-- ============================================================================

create or replace function public.connector_pendientes(
  p_jid text,
  p_wa_id text,
  p_phone text default null,
  p_lid text default null,
  p_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.whatsapp_groups%rowtype;
  a public.accounts%rowtype;
  v_ident uuid;
begin
  v_ident := public.wa_identidad(p_wa_id, p_phone, p_lid, p_name);
  select * into g from public.whatsapp_groups x where x.wa_group_jid = p_jid and x.chat_kind = 'grupo';
  if g.id is not null then
    select a2.* into a
    from public.account_group_links l join public.accounts a2 on a2.id = l.account_id
    where l.group_id = g.id;
  end if;

  return jsonb_build_object(
    'identity_id', v_ident,
    'grupo', g.id is not null,
    'contador_en_grupo', g.id is not null and exists (
      select 1 from public.whatsapp_group_sessions s2
      join public.whatsapp_connections c on c.id = s2.connection_id
      where s2.group_id = g.id and s2.left_at is null and c.kind = 'contador'
    ),
    -- La cuenta del grupo (en un chat privado no hay)
    'account', case when a.id is null then null else jsonb_build_object(
      'id', a.id, 'name', a.name, 'language', a.language, 'currency', a.currency,
      'liquidada', exists (select 1 from public.settlements s where s.account_id = a.id)
    ) end,
    -- Si se sabe quién es: en el grupo, en su cuenta; por privado, en alguna
    'conocido', exists (
      select 1 from public.personas_de_wa(p_jid, p_wa_id, p_phone, p_lid) y
      where a.id is null or y.account_id = a.id
    ),
    'pendientes', coalesce((
      select jsonb_agg(public.transferencia_para_luks(t.id) order by s.created_at desc, t.position)
      from public.settlement_transfers t
      join public.settlements s on s.id = t.settlement_id
      where t.id in (select public.pendientes_de_wa(p_jid, p_wa_id, p_phone, p_lid))
    ), '[]'::jsonb)
  );
end;
$$;

-- ============================================================================
-- connector_ya_pague: las marca pagadas (solo las que paga quien escribe) y
-- dice a dónde avisarle a quien recibe
-- ============================================================================

create or replace function public.connector_ya_pague(
  p_jid text,
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_transfer_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  with marcadas as (
    update public.settlement_transfers t
    set paid_at = now(),
        paid_by = (select p.claimed_by from public.people p where p.id = t.from_person_id),
        paid_via = 'whatsapp'
    where t.id = any (coalesce(p_transfer_ids, '{}'))
      and t.id in (select public.pendientes_de_wa(p_jid, p_wa_id, p_phone, p_lid))
    returning t.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from marcadas;

  return jsonb_build_object(
    'pagadas', coalesce((
      select jsonb_agg(
        public.transferencia_para_luks(t.id) || jsonb_build_object(
          'to_private_jid', public.chat_privado_de(t.to_person_id),
          'group_jid', public.grupo_con_mister_luks(t.account_id),
          -- Con esta, ¿ya pagaron todos los de esa liquidación?
          'todos_pagaron', not exists (
            select 1 from public.settlement_transfers x where x.settlement_id = t.settlement_id and x.paid_at is null
          )
        ) order by t.position)
      from public.settlement_transfers t
      where t.id = any (v_ids)
    ), '[]'::jsonb),
    -- Lo que le sigue faltando (ya sin las que marcó)
    'quedan', coalesce((
      select jsonb_agg(public.transferencia_para_luks(t.id) order by s.created_at desc, t.position)
      from public.settlement_transfers t
      join public.settlements s on s.id = t.settlement_id
      where t.id in (select public.pendientes_de_wa(p_jid, p_wa_id, p_phone, p_lid))
    ), '[]'::jsonb)
  );
end;
$$;

-- ============================================================================
-- Avisos de cobro (como en la 410), y a quien solo se le avisó en el grupo le
-- llega el detalle apenas le escribe a Mister Luks por privado
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
    with base as (
      select t.*, s.period, s.created_at as liquidada, a.name as cuenta, a.language, a.currency, a.type,
             public.chat_privado_de(t.from_person_id) as privado,
             public.grupo_con_mister_luks(a.id) as grupo
      from public.settlement_transfers t
      join public.settlements s on s.id = t.settlement_id
      join public.accounts a on a.id = t.account_id
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
      'to', jsonb_build_object('id', x.to_person_id, 'name', (select p.display_name from public.people p where p.id = x.to_person_id)),
      'amount', x.amount_cop,
      'private_jid', x.privado,
      'group_jid', x.grupo,
      'token', (select sh.token from public.account_shares sh where sh.account_id = x.account_id),
      -- Todo lo que le falta pagar a quien debe en esta liquidación (si le paga a varios)
      'transfers', (
        select jsonb_agg(jsonb_build_object('to', p.display_name, 'amount', t2.amount_cop) order by t2.position)
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

-- Ya se avisó: por privado a unos, en el grupo a otros (aunque la bandeja de salida lo haya descartado por repetido)
create or replace function public.connector_cobros_enviados(p_privados uuid[], p_en_grupo uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.settlement_transfers
  set avisos = avisos + 1,
      avisado_at = now(),
      avisado_privado = avisado_privado or id = any (coalesce(p_privados, '{}'))
  where id = any (coalesce(p_privados, '{}') || coalesce(p_en_grupo, '{}'))
$$;

-- La de la 410, para el connector de antes (mientras se actualiza): lo que tenía chat privado se avisó por privado
create or replace function public.connector_cobros_avisados(p_transfer_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.settlement_transfers
  set avisos = avisos + 1,
      avisado_at = now(),
      avisado_privado = avisado_privado or public.chat_privado_de(from_person_id) is not null
  where id = any (coalesce(p_transfer_ids, '{}'))
$$;

-- ============================================================================
-- Permisos: todo esto es del connector
-- ============================================================================

revoke execute on function public.personas_de_wa(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.pendientes_de_wa(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.transferencia_para_luks(uuid) from public, anon, authenticated;
revoke execute on function public.connector_pendientes(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.connector_ya_pague(text, text, text, text, uuid[]) from public, anon, authenticated;
revoke execute on function public.connector_cobros_enviados(uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.connector_pendientes(text, text, text, text, text) to service_role;
grant execute on function public.connector_ya_pague(text, text, text, text, uuid[]) to service_role;
grant execute on function public.connector_cobros_enviados(uuid[], uuid[]) to service_role;
