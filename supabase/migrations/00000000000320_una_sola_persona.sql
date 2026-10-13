-- ============================================================================
-- Lucas · 00000000000320_una_sola_persona.sql
-- Fase 5, primero: alguien que entró con Gmail y también está en el grupo de
-- WhatsApp es UNA persona de la cuenta, no dos.
--
-- Pasaba así: Christian crea la cuenta con Gmail («Christian Mora», sin
-- número); al conectar el grupo, sync_group_people no reconoce su número y
-- crea «Christian 🚀»; los gastos se dividen entre una persona de más. Y si
-- después verificaba su número (link /v/), wa_asociar saltaba esa cuenta
-- porque el número ya era de otra persona («taken_in»).
--
--   · Prevenir: sync_group_people, antes de crear a alguien, busca si su
--     número está verificado por un usuario que ya es persona de la cuenta.
--     Solo verificado: un número heredado (escrito en el perfil) no basta,
--     porque cualquiera puede escribir el número de otro.
--   · Reparar: al verificar el número (link /v/ o WhatsApp vinculado), si en
--     una de sus cuentas ese número es de otra persona SIN usuario, esa
--     persona se une a la suya (unir_personas): lo que pagó, sus partes, sus
--     ítems, su WhatsApp y sus mensajes pasan a la suya, y se borra. Los
--     totales y los saldos no cambian. Si es de otra persona CON usuario, o
--     está en una liquidación, no se toca y se avisa como antes.
--   · El número escrito en el perfil (add_my_whatsapp) sigue sin unir a
--     nadie: no está verificado.
--   · El error al reclamar una persona con WhatsApp ya no sugiere «entra como
--     persona nueva» (eso es lo que dejaba a alguien dos veces).
-- ============================================================================

-- ============================================================================
-- Unir dos personas de la misma cuenta
-- ============================================================================

-- p_de (sin usuario) pasa a ser p_a: como delete_person con p_move_whatsapp, más
-- los ítems de «dividir por consumo». Devuelve false si no se puede (otra
-- cuenta, p_de tiene usuario o está en una liquidación) sin cambiar nada.
create or replace function public.unir_personas(p_de uuid, p_a uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.people%rowtype;
  y public.people%rowtype;
begin
  select * into x from public.people where id = p_de for update;
  select * into y from public.people where id = p_a for update;
  if x.id is null or y.id is null or x.id = y.id or x.account_id <> y.account_id or x.claimed_by is not null then
    return false;
  end if;
  if exists (select 1 from public.settlement_transfers t where x.id in (t.from_person_id, t.to_person_id)) then
    return false;
  end if;

  -- 1) Lo que pagó (también lo que leyó la IA, para que no salga como corrección)
  update public.expenses e
  set payer_person_id = y.id,
      ai_snapshot = case
        when e.ai_snapshot ->> 'payer_person_id' = x.id::text then jsonb_set(e.ai_snapshot, '{payer_person_id}', to_jsonb(y.id))
        else e.ai_snapshot
      end
  where e.payer_person_id = x.id;

  -- 2) Su parte de cada gasto: si ya estaba la otra, se suman
  update public.expense_splits s2
  set amount_cop = s2.amount_cop + s.amount_cop,
      share_percent = case
        when s2.share_percent is null and s.share_percent is null then null
        else coalesce(s2.share_percent, 0) + coalesce(s.share_percent, 0)
      end,
      fixed = s2.fixed or s.fixed
  from public.expense_splits s
  where s.person_id = x.id and s2.person_id = y.id
    and s2.expense_id = s.expense_id and s2.item_id is not distinct from s.item_id;
  delete from public.expense_splits s
  where s.person_id = x.id
    and exists (
      select 1 from public.expense_splits s2
      where s2.person_id = y.id and s2.expense_id = s.expense_id and s2.item_id is not distinct from s.item_id
    );
  update public.expense_splits s set person_id = y.id where s.person_id = x.id;

  -- 3) Quién pidió qué (dividir por consumo)
  insert into public.expense_item_people (item_id, person_id)
  select ip.item_id, y.id from public.expense_item_people ip where ip.person_id = x.id
  on conflict do nothing;

  -- 4) Sus números de WhatsApp y sus mensajes
  insert into public.person_whatsapp_ids (person_id, wa_id)
  select y.id, w.wa_id from public.person_whatsapp_ids w where w.person_id = x.id
  on conflict (person_id, wa_id) do nothing;
  update public.messages m set sender_person_id = y.id where m.sender_person_id = x.id;

  delete from public.people where id = x.id;
  return true;
end;
$$;

-- ============================================================================
-- El número en las cuentas de su usuario (como en la 310), uniendo a la persona repetida
-- ============================================================================

-- p_unir: el número está verificado (link /v/ o WhatsApp vinculado), así que si
-- en una cuenta es de otra persona sin usuario, es la misma persona: se unen.
-- Devuelve en cuántas cuentas quedó, dónde se unió («merged_in») y dónde es de
-- otra persona («taken_in»).
create or replace function public.wa_asociar_numero(p_uid uuid, p_wa text, p_unir boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pp public.people%rowtype;
  v_otra uuid;
  v_cuenta text;
  v_en int := 0;
  v_ocupado text[] := '{}';
  v_unidas text[] := '{}';
begin
  for pp in select * from public.people where claimed_by = p_uid loop
    select x.id into v_otra
    from public.person_whatsapp_ids w join public.people x on x.id = w.person_id
    where x.account_id = pp.account_id and w.wa_id = p_wa and x.id <> pp.id
    limit 1;
    if v_otra is not null then
      select a.name into v_cuenta from public.accounts a where a.id = pp.account_id;
      if p_unir and public.unir_personas(v_otra, pp.id) then
        v_unidas := v_unidas || v_cuenta;
      else
        v_ocupado := v_ocupado || v_cuenta;
        v_otra := null;
        continue;
      end if;
      v_otra := null;
    end if;
    insert into public.person_whatsapp_ids (person_id, wa_id) values (pp.id, p_wa) on conflict (person_id, wa_id) do nothing;
    v_en := v_en + 1;

    update public.messages m set sender_person_id = pp.id
    where m.account_id = pp.account_id and m.sender_wa_id = p_wa and m.sender_person_id is null;
    update public.expenses e set payer_person_id = pp.id
    from public.messages m
    where m.id = e.message_id and m.account_id = pp.account_id and m.sender_wa_id = p_wa
      and e.payer_person_id is null and e.status = 'pending_review';
  end loop;
  return jsonb_build_object('wa_id', p_wa, 'accounts', v_en, 'taken_in', to_jsonb(v_ocupado), 'merged_in', to_jsonb(v_unidas));
end;
$$;

-- El de siempre (add_my_whatsapp: número sin verificar): no une a nadie
create or replace function public.wa_asociar(p_uid uuid, p_wa text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.wa_asociar_numero(p_uid, p_wa, false)
$$;

-- «Sí, es mío» (como en la 310): verificado, así que une a la persona repetida
create or replace function public.redeem_whatsapp_verification(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v public.whatsapp_verifications%rowtype;
  i public.whatsapp_identities%rowtype;
  v_r jsonb;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into v from public.whatsapp_verifications
  where token_hash = extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256')
  for update;
  if v.id is null then
    raise exception 'Ese link no sirve. Escríbele otra vez «luks soy yo» a Mister Luks';
  end if;
  if v.used_at is not null then
    raise exception 'Ese link ya se usó. Si necesitas otro, escríbele «luks soy yo» a Mister Luks';
  end if;
  if v.expires_at <= now() then
    raise exception 'Ese link ya venció (dura 30 minutos). Escríbele otra vez «luks soy yo» a Mister Luks';
  end if;

  update public.whatsapp_verifications set used_at = now(), used_by = v_uid where id = v.id;
  -- Quien tiene el teléfono es el dueño del número, aunque antes lo hubiera verificado otro
  update public.whatsapp_identities
  set user_id = v_uid, verified_at = now(), verify_method = 'link_privado'
  where id = v.identity_id
  returning * into i;

  v_r := public.wa_asociar_numero(v_uid, coalesce(i.phone, 'lid:' || i.lid), true);
  return v_r || jsonb_build_object('last4', right(coalesce(i.phone, i.lid), 4));
end;
$$;

-- Quien vinculó su WhatsApp lo hizo desde su teléfono (como en la 310): ese número
-- es suyo, y en sus cuentas la persona repetida con ese número se une a la suya
create or replace function public.whatsapp_connections_verifica()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if new.kind = 'personal' and new.owner_id is not null and new.status = 'connected' and new.phone_number ~ '^[0-9]{6,20}$' then
    v_id := public.wa_identidad(new.phone_number, new.phone_number, split_part(split_part(coalesce(new.wa_lid, ''), '@', 1), ':', 1));
    update public.whatsapp_identities
    set user_id = new.owner_id, verified_at = now(), verify_method = 'sesion_vinculada'
    where id = v_id and (user_id is distinct from new.owner_id or verified_at is null);
    if found then
      perform public.wa_asociar_numero(new.owner_id, new.phone_number, true);
    end if;
  end if;
  return null;
end;
$$;

-- ============================================================================
-- Cada integrante del grupo es una persona de la cuenta (como en la 200), y quien
-- ya está en la cuenta con su usuario y tiene su número verificado no se repite
-- ============================================================================

create or replace function public.sync_group_people(p_group_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_added int := 0;
  m record;
  v_person uuid;
  v_name text;
  v_wa_name text;
  v_parecidos uuid[];
begin
  select l.account_id into v_account
  from public.account_group_links l
  join public.accounts a on a.id = l.account_id
  where l.group_id = p_group_id and a.status <> 'closed';
  if v_account is null then
    return 0;
  end if;

  for m in
    select * from public.whatsapp_group_members x
    where x.group_id = p_group_id and x.left_at is null
    order by x.joined_at, x.wa_id
  loop
    -- Su nombre de WhatsApp: el del grupo o, si ya escribió, el que traían sus mensajes
    v_wa_name := coalesce(
      public.nombre_de_whatsapp(m.name),
      (select public.nombre_de_whatsapp(s.push_name) from public.whatsapp_senders s
       where s.account_id = v_account and s.wa_id in (m.wa_id, m.phone, 'lid:' || m.lid)
         and public.nombre_de_whatsapp(s.push_name) is not null
       order by s.last_seen_at desc limit 1)
    );

    -- Ya es de alguien (por su número o por el LID con que escribió antes)
    v_person := coalesce(
      public.wa_person(v_account, m.wa_id),
      case when m.lid is not null then public.wa_person(v_account, 'lid:' || m.lid) end,
      case when m.phone is not null then public.wa_person(v_account, m.phone) end
    );
    if v_person is not null then
      insert into public.person_whatsapp_ids (person_id, wa_id) values (v_person, m.wa_id)
      on conflict (person_id, wa_id) do nothing;
      -- Si todavía se llamaba «WhatsApp 4567», ahora con su nombre
      perform public.aprender_nombre(v_account, m.wa_id, v_wa_name, false);
      v_person := null;
      continue;
    end if;
    -- El número de Luks no es una persona
    if exists (
      select 1 from public.whatsapp_connections c
      where c.kind = 'contador'
        and (c.phone_number in (m.phone, m.wa_id) or public.lid_wa_id(c.wa_lid) in (m.wa_id, 'lid:' || m.lid))
    ) then
      continue;
    end if;

    -- El WhatsApp vinculado de alguien de la cuenta: es esa persona
    select p.id into v_person
    from public.whatsapp_connections c
    join public.people p on p.account_id = v_account and p.claimed_by = c.owner_id
    where c.kind = 'personal'
      and (c.phone_number in (m.phone, m.wa_id) or public.lid_wa_id(c.wa_lid) in (m.wa_id, 'lid:' || m.lid))
    limit 1;

    -- Su número está verificado por alguien que ya está en la cuenta con su
    -- usuario (entró con Gmail, por ejemplo): es esa persona, no una nueva
    if v_person is null and m.identity_id is not null then
      select p.id into v_person
      from public.whatsapp_identities i
      join public.people p on p.account_id = v_account and p.claimed_by = i.user_id
      where i.id = m.identity_id and i.verified_at is not null
      limit 1;
    end if;

    -- Alguien agregado a mano con el mismo nombre y sin WhatsApp (solo si es uno)
    if v_person is null and v_wa_name is not null then
      select array_agg(p.id) into v_parecidos
      from public.people p
      where p.account_id = v_account
        and translate(lower(btrim(p.display_name)), 'áéíóúüñ', 'aeiouun') = translate(lower(v_wa_name), 'áéíóúüñ', 'aeiouun')
        and not exists (select 1 from public.person_whatsapp_ids w where w.person_id = p.id);
      if cardinality(v_parecidos) = 1 then
        v_person := v_parecidos[1];
      end if;
    end if;

    if v_person is null then
      v_name := coalesce(v_wa_name, case when m.phone is not null then 'WhatsApp ' || right(m.phone, 4) else 'Alguien del grupo' end);
      if exists (select 1 from public.people p where p.account_id = v_account and lower(p.display_name) = lower(v_name)) then
        v_name := v_name || ' ' || right(coalesce(m.phone, m.wa_id), 4);
      end if;
      insert into public.people (account_id, display_name, name_source)
      values (v_account, v_name, case when v_wa_name is null then 'auto' else 'whatsapp' end)
      returning id into v_person;
      v_added := v_added + 1;
    end if;

    insert into public.person_whatsapp_ids (person_id, wa_id) values (v_person, m.wa_id)
    on conflict (person_id, wa_id) do nothing;

    -- Lo que ya había mandado ese número queda a su nombre (como en identify_wa_sender)
    update public.messages x set sender_person_id = v_person
    where x.account_id = v_account and x.sender_wa_id = m.wa_id and x.sender_person_id is null;
    update public.expenses e set payer_person_id = v_person
    from public.messages x
    where x.id = e.message_id and x.account_id = v_account and x.sender_wa_id = m.wa_id
      and e.payer_person_id is null and e.status = 'pending_review';
    v_person := null;
  end loop;
  return v_added;
end;
$$;

-- ============================================================================
-- Reclamar una persona que tiene WhatsApp (como en la 310), sin sugerir que
-- entre como persona nueva: así es como alguien quedaba dos veces
-- ============================================================================

create or replace function public.people_reclamo_verificado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ultimos text;
begin
  if new.claimed_by is null or old.claimed_by is not null then
    return new;
  end if;
  select right(w.wa_id, 4) into v_ultimos
  from public.person_whatsapp_ids w
  where w.person_id = new.id
  order by w.created_at
  limit 1;
  if v_ultimos is null then
    return new; -- sin WhatsApp: como siempre
  end if;
  if exists (
    select 1
    from public.person_whatsapp_ids w
    join public.whatsapp_identities i on i.id = w.identity_id
    where w.person_id = new.id and i.user_id = new.claimed_by and i.verified_at is not null
  ) or exists (
    select 1 from public.account_invites x where x.person_id = new.id and x.user_id = new.claimed_by
  ) then
    return new;
  end if;
  raise exception 'Para entrar como «%», primero confirma que el WhatsApp ••• % es tuyo: escríbele «luks soy yo» a Mister Luks y abre el link que te manda. Así no quedas dos veces en la cuenta.',
    new.display_name, v_ultimos;
end;
$$;

-- ============================================================================
-- Permisos
-- ============================================================================

revoke execute on function public.unir_personas(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.wa_asociar_numero(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.wa_asociar(uuid, text) from public, anon, authenticated;
