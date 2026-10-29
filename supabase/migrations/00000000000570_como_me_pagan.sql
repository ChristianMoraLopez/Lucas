-- ============================================================================
-- Lucas · 00000000000570_como_me_pagan.sql
-- «Me envías $9.000 a tal número»: en el perfil cada quien pone cómo le pagan
-- (su llave Bre-B, su Nequi, su Daviplata) y eso sale donde le cobran a
-- alguien que le debe: los avisos de cobro de Mister Luks (por privado y en el
-- grupo), «cuánto debo», Liquidar y el «Cobrar por WhatsApp» de la app.
--
--   · Lo pone y lo cambia solo esa persona (set_como_me_pagan). Nequi y
--     Daviplata son celulares de Colombia (10 números, empiezan por 3); la
--     llave, lo que dé el banco (celular, correo, cédula, @alias).
--   · Lo ven quienes comparten una cuenta con ella (como_les_pagan) y Mister
--     Luks lo dice en los grupos de esas cuentas. No sale en el link público.
--   · Va con sus datos: en my_profile (y en «Descargar mis datos») y se borra
--     con la cuenta.
-- ============================================================================

alter table public.profiles
  add column pago_llave text check (pago_llave ~ '^[A-Za-z0-9@._+-]{3,60}$'),
  add column pago_nequi text check (pago_nequi ~ '^3[0-9]{9}$'),
  add column pago_daviplata text check (pago_daviplata ~ '^3[0-9]{9}$');

-- Cómo le pagan a un usuario: {"llave", "nequi", "daviplata"} con lo que tenga, o null
create or replace function public.pago_de_usuario(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(jsonb_strip_nulls(jsonb_build_object('llave', p.pago_llave, 'nequi', p.pago_nequi, 'daviplata', p.pago_daviplata)), '{}'::jsonb)
  from public.profiles p
  where p.id = p_user_id
$$;

-- De quienes tienen cuenta en Luks en esa cuenta y pusieron cómo les pagan: {person_id: {...}}
create or replace function public.como_les_pagan_en(p_account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(p.id, public.pago_de_usuario(p.claimed_by)), '{}'::jsonb)
  from public.people p
  where p.account_id = p_account_id and p.claimed_by is not null and public.pago_de_usuario(p.claimed_by) is not null
$$;

-- Para la app (Liquidar): lo mismo, solo para quien es de la cuenta
create or replace function public.como_les_pagan(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_account_member(p_account_id) then
    raise exception 'La cuenta no existe';
  end if;
  return public.como_les_pagan_en(p_account_id);
end;
$$;

-- Lo pone (o lo quita, vacío) cada quien en su perfil
create or replace function public.set_como_me_pagan(p_llave text, p_nequi text, p_daviplata text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_llave text := nullif(regexp_replace(coalesce(p_llave, ''), '\s+', '', 'g'), '');
  v_nequi text := nullif(regexp_replace(coalesce(p_nequi, ''), '\D', '', 'g'), '');
  v_daviplata text := nullif(regexp_replace(coalesce(p_daviplata, ''), '\D', '', 'g'), '');
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  -- «+57 300 123 4567» → 3001234567
  if v_nequi ~ '^573[0-9]{9}$' then v_nequi := substr(v_nequi, 3); end if;
  if v_daviplata ~ '^573[0-9]{9}$' then v_daviplata := substr(v_daviplata, 3); end if;
  if v_nequi is not null and v_nequi !~ '^3[0-9]{9}$' then
    raise exception 'El Nequi es un celular de Colombia: 10 números y empieza por 3';
  end if;
  if v_daviplata is not null and v_daviplata !~ '^3[0-9]{9}$' then
    raise exception 'El Daviplata es un celular de Colombia: 10 números y empieza por 3';
  end if;
  if v_llave is not null and v_llave !~ '^[A-Za-z0-9@._+-]{3,60}$' then
    raise exception 'Revisa la llave: es tu celular, tu correo, tu cédula o tu @alias, como te la dio el banco';
  end if;
  update public.profiles
  set pago_llave = v_llave, pago_nequi = v_nequi, pago_daviplata = v_daviplata, updated_at = now()
  where id = auth.uid();
  return public.pago_de_usuario(auth.uid());
end;
$$;

-- ============================================================================
-- my_profile (como en la 310) con cómo le pagan
-- ============================================================================

create or replace function public.my_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'full_name', p.full_name,
    'created_at', coalesce(p.created_at, u.created_at),
    'last_sign_in_at', (select max(i.last_sign_in_at) from auth.identities i where i.user_id = u.id),
    'providers', coalesce((select jsonb_agg(distinct i.provider) from auth.identities i where i.user_id = u.id), '[]'::jsonb),
    'privacy_accepted_at', p.privacy_accepted_at,
    'privacy_version', p.privacy_version,
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'type', a.type, 'status', a.status, 'role', am.role,
        'person_id', pp.id, 'person_name', pp.display_name, 'person_tone', pp.tone
      ) order by am.joined_at)
      from public.account_members am
      join public.accounts a on a.id = am.account_id
      left join public.people pp on pp.account_id = a.id and pp.claimed_by = u.id
      where am.user_id = u.id
    ), '[]'::jsonb),
    'whatsapp', coalesce((
      select jsonb_agg(distinct w.wa_id)
      from public.person_whatsapp_ids w
      join public.people pp on pp.id = w.person_id
      where pp.claimed_by = u.id
    ), '[]'::jsonb),
    'whatsapp_verificados', coalesce((
      select jsonb_agg(coalesce(wi.phone, 'lid:' || wi.lid))
      from public.whatsapp_identities wi
      where wi.user_id = u.id and wi.verified_at is not null
    ), '[]'::jsonb),
    -- Cómo le pagan (migración 570)
    'pago', public.pago_de_usuario(u.id)
  )
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = auth.uid()
$$;

-- ============================================================================
-- Mister Luks: los números de cada cuenta (numeros_para_luks, la de la 490)
-- llevan cómo le pagan a cada quien. La 490 queda con otro nombre y esta la
-- envuelve: quien la redefina después tiene que conservar «pagos».
-- ============================================================================

alter function public.numeros_para_luks(uuid, uuid, text) rename to numeros_para_luks_490;

create or replace function public.numeros_para_luks(p_account_id uuid, p_person_id uuid, p_wa_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.numeros_para_luks_490(p_account_id, p_person_id, p_wa_id)
    || jsonb_build_object('pagos', public.como_les_pagan_en(p_account_id))
$$;

-- ============================================================================
-- connector_cobros (como en la 420): a quién le paga, con cómo le pagan
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
      'to', jsonb_build_object(
        'id', x.to_person_id,
        'name', (select p.display_name from public.people p where p.id = x.to_person_id),
        'pago', (select public.pago_de_usuario(p.claimed_by) from public.people p where p.id = x.to_person_id)
      ),
      'amount', x.amount_cop,
      'private_jid', x.privado,
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

revoke execute on function public.pago_de_usuario(uuid) from public, anon, authenticated;
revoke execute on function public.como_les_pagan_en(uuid) from public, anon, authenticated;
revoke execute on function public.numeros_para_luks(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.como_les_pagan(uuid) from public, anon;
revoke execute on function public.set_como_me_pagan(text, text, text) from public, anon;
grant execute on function public.como_les_pagan(uuid) to authenticated;
grant execute on function public.set_como_me_pagan(text, text, text) to authenticated;
