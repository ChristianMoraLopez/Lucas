-- ============================================================================
-- Lucas · 00000000000370_cuenta_siguiente.sql
-- Un grupo sigue después de liquidar: el paseo se liquidó y al grupo llega un
-- gasto nuevo (o alguien quiere conectarle otra cuenta).
--
--   · Una cuenta liquidada (un paseo «liquidándose» o una cuenta cerrada) ya no
--     ocupa su grupo: «luks CÓDIGO», conectar el grupo desde la app o crear su
--     cuenta desde el link /g/ lo pasan a la cuenta nueva sin desconectarlo
--     antes. Lo de la cuenta vieja se queda allá; en la nueva se anota desde
--     ese momento, sin la pregunta de «¿desde cuándo anoto?».
--   · Si llega un gasto a un grupo cuya cuenta ya se liquidó, Luks abre la
--     siguiente solo: «Chile Hack» → «Chile Hack 2», del mismo tipo, moneda e
--     idioma, con la misma gente (quienes usan Luks, con su rol, y los que
--     siguen en el grupo), sus categorías y lo que aprendió de los comercios.
--     El chat exportado no abre cuentas (llega sin remitente) y quien dijo «no
--     me cuentes» tampoco.
--   · Mister Luks lo cuenta en el grupo cuando entra el primer gasto de verdad
--     (una foto del paseo que no es gasto no lo hace hablar).
--   · Antes, «luks CÓDIGO» decía «ya está conectado a otra cuenta» aunque esa
--     cuenta estuviera liquidada, y el segundo intento no tenía respuesta.
-- ============================================================================

alter table public.accounts
  add column previous_account_id uuid references public.accounts (id) on delete set null,
  add column continuation_announced_at timestamptz;

-- Si la cuenta del grupo ya se liquidó, lo suelta y devuelve su nombre (si no, null)
create or replace function public.soltar_grupo_liquidado(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre text;
begin
  select a.name into v_nombre
  from public.account_group_links l
  join public.accounts a on a.id = l.account_id
  where l.group_id = p_group_id and a.status in ('settling', 'closed');
  if v_nombre is null then
    return null;
  end if;
  delete from public.account_group_links where group_id = p_group_id;
  return v_nombre;
end;
$$;

-- La última cuenta (otra que esta) a la que llegaron mensajes del grupo
create or replace function public.cuenta_anterior_del_grupo(p_group_id uuid, p_account_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.name
  from public.messages m
  join public.accounts a on a.id = m.account_id
  where m.group_id = p_group_id and m.account_id <> p_account_id
  order by m.received_at desc
  limit 1
$$;

-- La cuenta que sigue a la liquidada del grupo: la crea, le pasa la gente, las
-- categorías y la memoria de comercios, y le conecta el grupo. Si otro mensaje
-- ya la abrió, devuelve esa.
create or replace function public.cuenta_siguiente(p_group_id uuid, p_desde timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  l public.account_group_links%rowtype;
  v_nueva uuid;
  v_base text;
  v_nombre text;
  n int := 2;
  p record;
  v_persona uuid;
begin
  -- Uno a la vez por grupo
  perform 1 from public.whatsapp_groups where id = p_group_id for update;
  select * into l from public.account_group_links where group_id = p_group_id;
  if l.group_id is null then
    return null;
  end if;
  select * into a from public.accounts where id = l.account_id;
  if a.status not in ('settling', 'closed') then
    return a.id;
  end if;

  -- «Chile Hack» → «Chile Hack 2»; si ya existe, «Chile Hack 3»…
  v_base := left(coalesce(nullif(regexp_replace(btrim(a.name), '\s+\d{1,2}$', ''), ''), btrim(a.name)), 55);
  loop
    v_nombre := v_base || ' ' || n;
    exit when not exists (
      select 1 from public.accounts x where x.owner_id = a.owner_id and lower(x.name) = lower(v_nombre)
    );
    n := n + 1;
  end loop;

  insert into public.accounts (name, type, owner_id, starts_on, currency, language, previous_account_id)
  values (v_nombre, a.type, a.owner_id,
          case when a.type = 'evento' then (least(p_desde, now()) at time zone 'America/Bogota')::date end,
          a.currency, a.language, a.id)
  returning id into v_nueva;

  -- La misma gente: quienes usan Luks en la cuenta (con su rol) y quienes siguen en el grupo
  for p in
    select pp.id, pp.display_name, pp.tone, pp.claimed_by, pp.name_source, am.user_id as miembro, am.role
    from public.people pp
    left join public.account_members am on am.account_id = a.id and am.person_id = pp.id
    where pp.account_id = a.id
      and (
        am.user_id is not null
        or exists (
          select 1
          from public.person_whatsapp_ids w
          join public.whatsapp_group_members gm
            on gm.group_id = p_group_id and gm.left_at is null and w.wa_id in (gm.wa_id, gm.phone, 'lid:' || gm.lid)
          where w.person_id = pp.id
        )
      )
    order by pp.created_at, pp.id
  loop
    insert into public.people (account_id, display_name, tone, claimed_by, name_source)
    values (v_nueva, p.display_name, p.tone, case when p.miembro is not null then p.claimed_by end, p.name_source)
    returning id into v_persona;
    insert into public.person_whatsapp_ids (person_id, wa_id)
    select v_persona, w.wa_id from public.person_whatsapp_ids w where w.person_id = p.id
    on conflict (person_id, wa_id) do nothing;
    if p.miembro is not null then
      insert into public.account_members (account_id, user_id, role, person_id)
      values (v_nueva, p.miembro, p.role, v_persona)
      on conflict do nothing;
    end if;
  end loop;

  -- Quien dijo «no me cuentes» en la anterior tampoco cuenta en esta
  insert into public.account_optouts (account_id, identity_id)
  select v_nueva, o.identity_id from public.account_optouts o where o.account_id = a.id
  on conflict do nothing;

  -- Sus categorías y lo que ya aprendió de los comercios
  insert into public.categories (account_id, name, letter, tone, is_default, description)
  select v_nueva, c.name, c.letter, c.tone, c.is_default, c.description
  from public.categories c
  where c.account_id = a.id;
  if not found then
    perform public.add_default_categories(v_nueva);
  end if;
  insert into public.merchant_memory (account_id, merchant_text, normalized, category_id, hits)
  select v_nueva, mm.merchant_text, mm.normalized, nc.id, mm.hits
  from public.merchant_memory mm
  join public.categories oc on oc.id = mm.category_id
  join public.categories nc on nc.account_id = v_nueva and nc.name = oc.name
  where mm.account_id = a.id
  on conflict (account_id, normalized) do nothing;

  -- El grupo pasa a la nueva: se anota desde este mensaje
  delete from public.account_group_links where group_id = p_group_id;
  insert into public.account_group_links (group_id, account_id, linked_by, confirm_in_group, history, history_at, ingest_from)
  values (p_group_id, v_nueva, a.owner_id, l.confirm_in_group, 'desde_ya', now(), least(p_desde, now()) - interval '1 minute');

  -- Y quien esté en el grupo y todavía no sea persona de la cuenta
  perform public.sync_group_people(p_group_id);
  if exists (select 1 from public.whatsapp_group_members m where m.group_id = p_group_id and m.left_at is null) then
    update public.account_group_links set members_synced_at = now() where group_id = p_group_id;
  end if;
  return v_nueva;
end;
$$;

-- Mister Luks cuenta en el grupo que abrió la cuenta siguiente (una vez, con el primer gasto)
create or replace function public.anunciar_cuenta_siguiente(p_account_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  v_anterior text;
  v_jid text;
begin
  update public.accounts
  set continuation_announced_at = now()
  where id = p_account_id and previous_account_id is not null and continuation_announced_at is null
  returning * into a;
  if a.id is null then
    return;
  end if;
  select x.name into v_anterior from public.accounts x where x.id = a.previous_account_id;
  select g.wa_group_jid into v_jid from public.whatsapp_groups g where g.id = p_group_id;
  if v_jid is null or v_anterior is null then
    return;
  end if;
  perform public.connector_outbox_enqueue(jsonb_build_array(jsonb_build_object(
    'chat_jid', v_jid,
    'reason', 'link',
    'group_id', p_group_id,
    'dedupe_key', 'siguiente:' || a.id,
    'body', case when a.language = 'en' then
      '🧾 “' || v_anterior || '” was already settled, so I opened a new account for what’s next: “' || a.name
        || '”. I logged this expense there 😉 You can rename it at mrluks.com.'
    else
      '🧾 «' || v_anterior || '» ya estaba liquidada, así que abrí una cuenta nueva para lo que sigue: «' || a.name
        || '». Ahí anoté este gasto 😉 Si quieren, cámbienle el nombre en mrluks.com.'
    end
  )));
end;
$$;

-- Como en la 340, con 'cuenta_liquidada' en vez de 'cuenta_cerrada' si ya se liquidó
create or replace function public.connector_should_ingest(p_jid text, p_wa_message_id text, p_sent_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_account uuid;
  v_status text;
  v_desde timestamptz;
begin
  select g.id, l.account_id, a.status, l.ingest_from into v_group, v_account, v_status, v_desde
  from public.whatsapp_groups g
  join public.account_group_links l on l.group_id = g.id
  join public.accounts a on a.id = l.account_id
  where g.wa_group_jid = p_jid;

  if v_account is null then
    return jsonb_build_object('ingest', false, 'reason', 'grupo_sin_enlazar');
  end if;
  -- Ya se liquidó: connector_should_ingest_sender abre la siguiente si llega un gasto
  if v_status in ('settling', 'closed') then
    return jsonb_build_object('ingest', false, 'reason', 'cuenta_liquidada', 'account_id', v_account, 'group_id', v_group);
  end if;
  if v_status <> 'active' then
    return jsonb_build_object('ingest', false, 'reason', 'cuenta_cerrada', 'account_id', v_account);
  end if;
  if p_sent_at < v_desde - interval '2 minutes' then
    return jsonb_build_object('ingest', false, 'reason', 'antes_del_enlace', 'account_id', v_account);
  end if;
  if exists (select 1 from public.messages m where m.group_id = v_group and m.wa_message_id = p_wa_message_id) then
    return jsonb_build_object('ingest', false, 'reason', 'repetido', 'account_id', v_account);
  end if;
  return jsonb_build_object('ingest', true, 'account_id', v_account, 'group_id', v_group);
end;
$$;

-- Como en la 350, pero si la cuenta del grupo ya se liquidó y alguien manda un
-- gasto, abre la siguiente (por eso ya no es stable). Sin remitente (el chat
-- exportado) no abre nada, ni por alguien que dijo «no me cuentes».
create or replace function public.connector_should_ingest_sender(
  p_jid text,
  p_wa_message_id text,
  p_sent_at timestamptz,
  p_sender_wa_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v jsonb := public.connector_should_ingest(p_jid, p_wa_message_id, p_sent_at);
  v_nueva uuid;
begin
  if v ->> 'reason' = 'cuenta_liquidada' and p_sender_wa_id is not null
     and not public.no_lo_cuentes((v ->> 'account_id')::uuid, p_sender_wa_id) then
    v_nueva := public.cuenta_siguiente((v ->> 'group_id')::uuid, p_sent_at);
    v := public.connector_should_ingest(p_jid, p_wa_message_id, p_sent_at) || jsonb_build_object('new_account', v_nueva);
  end if;
  if (v ->> 'ingest')::boolean and p_sender_wa_id is not null
     and public.no_lo_cuentes((v ->> 'account_id')::uuid, p_sender_wa_id) then
    return jsonb_build_object('ingest', false, 'reason', 'no_me_cuentes', 'account_id', v ->> 'account_id');
  end if;
  return v;
end;
$$;

-- «luks CÓDIGO» (como en la 290): una cuenta liquidada ya no ocupa el grupo, y
-- si es otra cuenta abierta, dice cuál
create or replace function public.connector_link_group(
  p_connection_id uuid,
  p_jid text,
  p_name text,
  p_code text,
  p_sender_wa_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_account uuid;
  v_current uuid;
  v_name text;
  v_language text;
  v_user uuid;
  v_added int;
  v_anterior text;
begin
  if p_jid !~ '@g\.us$' then
    return jsonb_build_object('ok', false, 'error', 'no_es_grupo');
  end if;
  v_account := public.wa_account_for_code(p_code);
  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'codigo_invalido');
  end if;

  v_group := (public.connector_upsert_group(p_connection_id, p_jid, p_name) ->> 'group_id')::uuid;
  perform 1 from public.whatsapp_groups where id = v_group for update;

  select l.account_id into v_current from public.account_group_links l where l.group_id = v_group;
  select a.name, a.language into v_name, v_language from public.accounts a where a.id = v_account;
  if v_current = v_account then
    return jsonb_build_object('ok', true, 'already', true, 'account_id', v_account, 'account_name', v_name, 'group_id', v_group,
                              'language', v_language);
  end if;
  -- Si la cuenta del grupo ya se liquidó, el grupo queda libre para la nueva
  if v_current is not null then
    v_anterior := public.soltar_grupo_liquidado(v_group);
    if v_anterior is not null then
      v_current := null;
    end if;
  end if;
  if v_current is not null then
    return jsonb_build_object('ok', false, 'error', 'otra_cuenta',
                              'account_name', (select a.name from public.accounts a where a.id = v_current),
                              'language', (select a.language from public.accounts a where a.id = v_current));
  end if;

  -- Si quien escribió el código ya tiene usuario en la cuenta, queda como quien enlazó
  select p.claimed_by into v_user
  from public.people p
  where p.id = public.wa_person(v_account, p_sender_wa_id);

  insert into public.account_group_links (group_id, account_id, linked_by, linked_by_wa_id)
  values (v_group, v_account, v_user, p_sender_wa_id);

  -- El grupo ya venía de otra cuenta: lo de allá se queda allá, aquí se anota lo nuevo (sin preguntar)
  v_anterior := coalesce(v_anterior, public.cuenta_anterior_del_grupo(v_group, v_account));
  if v_anterior is not null then
    update public.account_group_links set history = 'desde_ya', history_at = now() where group_id = v_group;
  end if;

  -- Los integrantes del grupo pasan a ser las personas de la cuenta
  v_added := public.sync_group_people(v_group);

  return jsonb_build_object('ok', true, 'already', false, 'account_id', v_account, 'account_name', v_name, 'group_id', v_group,
                            'people_added', v_added, 'members', public.group_member_count(v_group), 'language', v_language,
                            'previous_account', v_anterior);
end;
$$;

-- Como en la 340: si el grupo ya venía de otra cuenta, sin la pregunta de desde cuándo
create or replace function public.conectar_grupo(p_group_id uuid, p_account_id uuid, p_uid uuid, p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.whatsapp_groups%rowtype;
  a public.accounts%rowtype;
  v_n int;
  v_anterior text;
begin
  select * into g from public.whatsapp_groups where id = p_group_id;
  select * into a from public.accounts where id = p_account_id;
  insert into public.account_group_links (group_id, account_id, linked_by)
  values (p_group_id, p_account_id, p_uid);
  if p_link_id is not null then
    update public.group_links set used_at = now(), used_by = p_uid where id = p_link_id;
  end if;

  -- Si Mister Luks está, ya se sabe quién está en el grupo
  if exists (select 1 from public.whatsapp_group_members m where m.group_id = p_group_id and m.left_at is null) then
    perform public.sync_group_people(p_group_id);
    update public.account_group_links set members_synced_at = now() where group_id = p_group_id;
  end if;

  v_n := public.group_member_count(p_group_id);
  -- El grupo ya venía de otra cuenta (liquidada o desconectada): sin la pregunta de desde cuándo
  v_anterior := public.cuenta_anterior_del_grupo(p_group_id, p_account_id);
  if v_anterior is not null then
    update public.account_group_links set history = 'desde_ya', history_at = now() where group_id = p_group_id;
  end if;
  -- Como MSG.linked del connector (y así es_mensaje_de_luks lo reconoce)
  perform public.connector_outbox_enqueue(jsonb_build_array(jsonb_build_object(
    'chat_jid', g.wa_group_jid,
    'reason', 'link',
    'group_id', p_group_id,
    'dedupe_key', 'link:' || p_group_id || ':' || p_account_id,
    'body', case when a.language = 'en' then
      '🎉 Done! This group is now connected to “' || a.name || '”'
        || case when v_n > 0 then ' and its ' || v_n || ' members are already in the account 🙌' else '' end || '.'
        || case when v_anterior is not null then E'\n\nWhat’s in “' || v_anterior || '” stays there: from now on I’ll log new expenses here.' else '' end
        || E'\n\nSend receipt photos, PDFs or messages with the amount (for example “airport taxi $45”) and I’ll log them ✅'
        || case when v_anterior is null then E'\n\n🗓️ Since when do I log? Reply *1* for *from now on* or *2* for *the whole chat* (you send it to me exported).' else '' end
    else
      '🎉 ¡Listo! Este grupo quedó conectado a «' || a.name || '»'
        || case when v_n > 0 then ' y sus ' || v_n || ' integrantes ya están en la cuenta 🙌' else '' end || '.'
        || case when v_anterior is not null then E'\n\nLo de «' || v_anterior || '» se queda allá: desde ahora anoto aquí lo nuevo.' else '' end
        || E'\n\nManden fotos de recibos, PDFs o mensajes con el monto (por ejemplo «taxi al aeropuerto 45 lucas») y yo los anoto ✅'
        || case when v_anterior is null then E'\n\n🗓️ ¿Desde cuándo anoto? Respondan *1* para *desde ahora* o *2* para *todo el chat* (me lo mandan exportado).' else '' end
    end
  )));
end;
$$;

-- Conectar el grupo desde la app (como en la 330): una cuenta liquidada ya no lo ocupa
create or replace function public.link_group_to_account(p_group_id uuid, p_token text, p_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  k public.group_links%rowtype;
  g public.whatsapp_groups%rowtype;
  v_actual uuid;
  v_via text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran esa cuenta pueden conectarle un grupo';
  end if;
  if exists (select 1 from public.accounts a where a.id = p_account_id and a.status = 'closed') then
    raise exception 'Esa cuenta está cerrada: ya no se le conectan grupos';
  end if;
  if p_token is not null then
    select * into k from public.group_links where token_hash = public.hash_codigo(p_token);
  end if;
  select * into g from public.whatsapp_groups
  where id = coalesce(k.group_id, p_group_id) and chat_kind = 'grupo'
  for update;
  if g.id is null then
    raise exception 'Ese grupo no existe o el link no sirve';
  end if;

  select l.account_id into v_actual from public.account_group_links l where l.group_id = g.id;
  if v_actual = p_account_id then
    return p_account_id;
  end if;
  -- Si la cuenta del grupo ya se liquidó, el grupo queda libre para esta
  if v_actual is not null and public.soltar_grupo_liquidado(g.id) is not null then
    v_actual := null;
  end if;
  if v_actual is not null then
    raise exception 'Este grupo ya está conectado a otra cuenta de Luks';
  end if;
  v_via := public.acceso_al_grupo(v_uid, g.id, p_token);
  if v_via is null then
    raise exception 'Este link ya no sirve (dura dos semanas). Escriban «ayuda» en el grupo y Mister Luks manda uno nuevo';
  end if;

  perform public.conectar_grupo(g.id, p_account_id, v_uid, case when v_via = 'link' then k.id end);
  return p_account_id;
end;
$$;

-- Crear la cuenta del grupo (como en la 330): si la del grupo ya se liquidó, se crea la siguiente
create or replace function public.create_account_from_group(
  p_group_id uuid,
  p_token text,
  p_name text,
  p_type public.account_type,
  p_starts_on date default null,
  p_ends_on date default null,
  p_display_name text default null,
  p_currency text default null,
  p_language text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  k public.group_links%rowtype;
  g public.whatsapp_groups%rowtype;
  v_cuenta uuid;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para crear una cuenta';
  end if;
  if p_token is not null then
    select * into k from public.group_links where token_hash = public.hash_codigo(p_token);
  end if;
  -- Uno a la vez por grupo
  select * into g from public.whatsapp_groups
  where id = coalesce(k.group_id, p_group_id) and chat_kind = 'grupo'
  for update;
  if g.id is null then
    raise exception 'Ese grupo no existe o el link no sirve';
  end if;

  -- Si la cuenta del grupo ya se liquidó, se crea la siguiente (no se entra a la vieja)
  perform public.soltar_grupo_liquidado(g.id);
  select l.account_id into v_cuenta from public.account_group_links l where l.group_id = g.id;
  if v_cuenta is not null then
    return public.entrar_por_el_grupo(v_uid, g.id, v_cuenta);
  end if;
  if public.acceso_al_grupo(v_uid, g.id, p_token) is null then
    raise exception 'Este link ya no sirve (dura dos semanas). Escriban «ayuda» en el grupo y Mister Luks manda uno nuevo';
  end if;

  v_cuenta := public.create_account(coalesce(nullif(btrim(p_name), ''), g.name, 'Grupo'), p_type, p_starts_on, p_ends_on, p_display_name);
  if p_currency is not null or p_language is not null then
    perform public.set_account_settings(v_cuenta, p_currency, p_language);
  end if;
  perform public.conectar_grupo(g.id, v_cuenta, v_uid, case when public.acceso_al_grupo(v_uid, g.id, p_token) = 'link' then k.id end);
  return v_cuenta;
end;
$$;

-- Lo que ve /g/ y «Nuevo grupo detectado» (como en la 330): una cuenta liquidada
-- no cuenta como la del grupo; sale en «previous» para decir que se crea la siguiente
create or replace function public.preview_group(p_token text default null, p_group_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  k public.group_links%rowtype;
  g public.whatsapp_groups%rowtype;
  v_via text;
  v_cuenta public.accounts%rowtype;
  v_miembro boolean;
  v_anterior text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if p_token is not null then
    select * into k from public.group_links where token_hash = public.hash_codigo(p_token);
    if k.id is null then
      return jsonb_build_object('status', 'invalid');
    end if;
  end if;
  select * into g from public.whatsapp_groups
  where id = coalesce(k.group_id, p_group_id) and chat_kind = 'grupo';
  if g.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Una cuenta ya liquidada no ocupa el grupo: se ofrece crear la siguiente
  select a.* into v_cuenta
  from public.account_group_links l join public.accounts a on a.id = l.account_id
  where l.group_id = g.id and a.status not in ('settling', 'closed');
  select a.name into v_anterior
  from public.account_group_links l join public.accounts a on a.id = l.account_id
  where l.group_id = g.id and a.status in ('settling', 'closed');
  v_miembro := v_cuenta.id is not null and exists (
    select 1 from public.account_members am where am.account_id = v_cuenta.id and am.user_id = v_uid
  );

  v_via := public.acceso_al_grupo(v_uid, g.id, p_token);
  if v_via is null then
    -- Un link usado o vencido: el nombre del grupo y, si tiene cuenta, cuál (para pedir entrar)
    if k.id is not null then
      return jsonb_build_object(
        'status', case when k.used_at is not null or v_cuenta.id is not null then 'used' else 'expired' end,
        'name', g.name,
        'linked', case when v_cuenta.id is not null then jsonb_build_object('account_id', case when v_miembro then v_cuenta.id end,
                                                                            'account_name', v_cuenta.name, 'member', v_miembro) end
      );
    end if;
    return jsonb_build_object('status', 'invalid');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'via', v_via,
    'group_id', g.id,
    'name', g.name,
    'mister_luks', exists (
      select 1 from public.whatsapp_group_sessions s join public.whatsapp_connections c on c.id = s.connection_id
      where s.group_id = g.id and s.left_at is null and c.kind = 'contador'
    ),
    'member_count', public.group_member_count(g.id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'last4', x.last4, 'me', x.me, 'user', x.usuario) order by x.me desc, x.name)
      from (
        select coalesce(public.nombre_de_whatsapp(m.name), 'WhatsApp ' || right(coalesce(m.phone, m.lid, m.wa_id), 4)) as name,
               right(coalesce(m.phone, m.lid, m.wa_id), 4) as last4,
               coalesce(i.user_id = v_uid and i.verified_at is not null, false) as me,
               coalesce(i.user_id is not null and i.verified_at is not null, false) as usuario
        from public.whatsapp_group_members m
        left join public.whatsapp_identities i on i.id = m.identity_id
        where m.group_id = g.id and m.left_at is null
          and not exists (
            select 1 from public.whatsapp_connections c
            where c.kind = 'contador'
              and (c.phone_number in (m.phone, m.wa_id) or public.lid_wa_id(c.wa_lid) in (m.wa_id, 'lid:' || m.lid))
          )
        limit 60
      ) x
    ), '[]'::jsonb),
    'in_group', v_via = 'mi_whatsapp' or public.mi_numero_en_el_grupo(v_uid, g.id),
    'previous', v_anterior,
    'linked', case when v_cuenta.id is not null then jsonb_build_object('account_id', case when v_miembro then v_cuenta.id end,
                                                                        'account_name', v_cuenta.name, 'member', v_miembro) end,
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type) order by a.created_at desc)
      from public.account_members am
      join public.accounts a on a.id = am.account_id
      where am.user_id = v_uid and am.role in ('owner', 'admin') and a.status <> 'closed'
    ), '[]'::jsonb)
  );
end;
$$;

-- Como en la 360, y con el aviso de la cuenta siguiente en el primer gasto
create or replace function public.worker_save_expense(
  p_message_id uuid,
  p_data jsonb,
  p_max_distance int default 12
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  v_dup uuid;
  v_parecido uuid;
  v_expense uuid;
  v_category uuid := public.try_uuid(p_data ->> 'category_id');
  v_payer uuid := public.try_uuid(p_data ->> 'payer_person_id');
  v_total bigint := greatest(coalesce((p_data ->> 'total_cop')::bigint, 0), 0);
  v_date date := coalesce((p_data ->> 'expense_date')::date, (now() at time zone 'America/Bogota')::date);
  v_merchant text := left(coalesce(nullif(btrim(p_data ->> 'merchant'), ''), 'Gasto sin nombre'), 80);
  v_status public.expense_status := case
    when p_data ->> 'status' = 'confirmed' then 'confirmed' else 'pending_review'
  end::public.expense_status;
  v_snapshot jsonb := coalesce(p_data -> 'ai_snapshot', '{}'::jsonb);
  v_people uuid[];
  -- El recibo original (otra moneda): lo que no cuadre se ignora, el gasto igual se guarda
  v_moneda text := upper(nullif(btrim(p_data ->> 'original_currency'), ''));
  v_original bigint;
  v_tasa numeric;
  v_dia_tasa date;
begin
  select * into m from public.messages where id = p_message_id for update;
  if not found then
    raise exception 'El mensaje % no existe', p_message_id;
  end if;
  if m.status in ('done', 'not_expense', 'duplicate') then
    return jsonb_build_object('skipped', true, 'status', m.status);
  end if;

  if v_moneda is not null and (
    v_moneda not in ('COP', 'CLP', 'BOB', 'USD', 'EUR', 'PEN', 'MXN', 'ARS', 'BRL')
    or v_moneda = (select a.currency from public.accounts a where a.id = m.account_id)
  ) then
    v_moneda := null;
  end if;
  if v_moneda is not null then
    if coalesce(p_data ->> 'original_total', '') ~ '^[0-9]{1,12}$' and (p_data ->> 'original_total')::bigint > 0 then
      v_original := (p_data ->> 'original_total')::bigint;
    end if;
    if coalesce(p_data ->> 'fx_rate', '') ~ '^[0-9]{1,8}([.][0-9]{1,20})?$' and (p_data ->> 'fx_rate')::numeric > 0 then
      v_tasa := (p_data ->> 'fx_rate')::numeric;
    end if;
    if coalesce(p_data ->> 'fx_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then
      v_dia_tasa := (p_data ->> 'fx_date')::date;
    end if;
  end if;

  -- Un candado por cuenta mientras se revisa y se guarda: si llegan dos fotos
  -- iguales a la vez, la segunda ve la primera.
  perform pg_advisory_xact_lock(hashtextextended('lucas-dedup:' || m.account_id::text, 0));

  v_dup := public.worker_buscar_repetido(
    m.account_id, p_data ->> 'cufe', p_data ->> 'image_hash', p_max_distance,
    v_total, v_date, p_data ->> 'extracted_text'
  );
  if v_dup is not null then
    update public.messages
    set status = 'duplicate', duplicate_of = v_dup, processed_at = now(),
        extracted_text = left(p_data ->> 'extracted_text', 20000)
    where id = m.id;
    return jsonb_build_object('duplicate_of', v_dup);
  end if;

  -- Nada de categorías ni personas de otra cuenta
  if v_category is not null and not exists (
    select 1 from public.categories c where c.id = v_category and c.account_id = m.account_id
  ) then
    v_category := null;
  end if;
  if v_payer is not null and not exists (
    select 1 from public.people p where p.id = v_payer and p.account_id = m.account_id
  ) then
    v_payer := null;
  end if;

  -- Mismo comercio, día y valor que otro gasto: puede ser la misma compra en
  -- otra foto. No se descarta (podría ser real), pero va sí o sí a revisión.
  if v_total > 0 then
    select e.id into v_parecido
    from public.expenses e
    where e.account_id = m.account_id
      and e.total_cop = v_total
      and e.expense_date = v_date
      and e.merchant_normalized = public.normalize_merchant(v_merchant)
    order by e.created_at
    limit 1;
    if v_parecido is not null then
      v_status := 'pending_review';
      v_snapshot := v_snapshot || jsonb_build_object('possible_duplicate_of', v_parecido);
    end if;
  end if;

  -- Sin pagador no se confirma solo
  if v_payer is null or v_total = 0 then
    v_status := 'pending_review';
  end if;

  insert into public.expenses (
    account_id, merchant, merchant_normalized, description, expense_date, total_cop, category_id,
    payer_person_id, status, confidence, source, message_id, evidence_path, cufe, image_hash,
    created_by, ai_snapshot, field_confidence, split_note,
    original_currency, original_total, fx_rate, fx_date, fx_source
  )
  values (
    m.account_id, v_merchant, public.normalize_merchant(v_merchant),
    left(nullif(btrim(p_data ->> 'description'), ''), 160),
    v_date, v_total, v_category, v_payer, v_status,
    round(least(greatest(coalesce((p_data ->> 'confidence')::numeric, 0), 0), 1), 2),
    m.source, m.id, m.media_path,
    lower(nullif(p_data ->> 'cufe', '')), lower(nullif(p_data ->> 'image_hash', '')),
    m.uploaded_by, v_snapshot, p_data -> 'field_confidence',
    left(nullif(btrim(p_data ->> 'split_note'), ''), 200),
    v_moneda, v_original, v_tasa, case when v_tasa is not null then v_dia_tasa end,
    case when v_tasa is not null then left(nullif(btrim(p_data ->> 'fx_source'), ''), 40) end
  )
  returning id into v_expense;

  -- created_at en el orden del recibo: así se muestran al dividir por consumo
  insert into public.expense_items (expense_id, name, quantity, unit_price_cop, total_cop, created_at)
  select v_expense,
         left(btrim(i ->> 'name'), 80),
         least(greatest(coalesce((i ->> 'quantity')::numeric, 1), 0.001), 9999999),
         greatest(coalesce((i ->> 'unit_price_cop')::bigint, 0), 0),
         greatest(coalesce((i ->> 'total_cop')::bigint, 0), 0),
         now() + x.n * interval '1 millisecond'
  from jsonb_array_elements(coalesce(p_data -> 'items', '[]'::jsonb)) with ordinality as x (i, n)
  where nullif(btrim(i ->> 'name'), '') is not null and x.n <= 60;

  -- Entre quiénes: los que nombró el mensaje («entre Vale y Santi») o todos
  select array_agg(p.id order by p.created_at, p.id) into v_people
  from public.people p
  where p.account_id = m.account_id
    and p.id in (
      select public.try_uuid(x) from jsonb_array_elements_text(coalesce(p_data -> 'split_person_ids', '[]'::jsonb)) x
    );
  if coalesce(array_length(v_people, 1), 0) = 0 then
    select array_agg(p.id order by p.created_at, p.id) into v_people
    from public.people p where p.account_id = m.account_id;
  end if;
  if coalesce(array_length(v_people, 1), 0) > 0 then
    perform public.replace_equal_split(v_expense, v_people);
  end if;

  -- La memoria de comercios acertó: suma un uso
  if public.try_uuid(p_data ->> 'memory_id') is not null then
    update public.merchant_memory mm
    set hits = mm.hits + 1
    where mm.id = public.try_uuid(p_data ->> 'memory_id') and mm.account_id = m.account_id;
  end if;

  update public.messages
  set status = 'done', processed_at = now(), duplicate_of = null,
      extracted_text = left(p_data ->> 'extracted_text', 20000)
  where id = m.id;

  -- El primer gasto de una cuenta que Luks abrió solo (la anterior ya estaba liquidada): lo cuenta en el grupo
  if m.group_id is not null then
    perform public.anunciar_cuenta_siguiente(m.account_id, m.group_id);
  end if;

  return jsonb_build_object('expense_id', v_expense, 'status', v_status, 'possible_duplicate_of', v_parecido);
end;
$$;

-- Lo que escribe Luks no es un gasto (como en la 350), con el aviso de la cuenta siguiente
create or replace function public.es_mensaje_de_luks(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~* '(esto se hizo en mrluks\.com|made with mrluks\.com|cuentas hechas con luks|hecho con luks|(mrluks\.com|\.vercel\.app)/r/[A-Za-z0-9_-]{20,64})'
      or coalesce(p_text, '') ~* '^\s*\W{0,4}\s*(anotad[oa]s?|recibido|ya estaba anotado|logged|received|already logged)[\s:].*·\s*(\$|bs\s?)\d'
      or coalesce(p_text, '') ~* '(soy|i[’'']m) \*?mister luks|(listo[:!]?|done[:!]?)\s*(este grupo quedó conectado|this group is now connected)'
      or coalesce(p_text, '') ~* 'dijo que (anote|lea)\M|said to (log|read)\M|le[ií] el chat exportado|i read the exported chat'
      or coalesce(p_text, '') ~* 'm[aá]s detalle en mrluks\.com|more detail at mrluks\.com'
      or coalesce(p_text, '') ~* 'ya estaba liquidada|was already settled'
$$;

-- ============================================================================
-- Permisos: todo lo nuevo es interno
-- ============================================================================

revoke execute on function public.soltar_grupo_liquidado(uuid) from public, anon, authenticated;
revoke execute on function public.cuenta_anterior_del_grupo(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.cuenta_siguiente(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.anunciar_cuenta_siguiente(uuid, uuid) from public, anon, authenticated;
