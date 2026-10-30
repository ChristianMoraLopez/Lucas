-- ============================================================================
-- Lucas · 00000000000670_cuenta_del_privado.sql
-- Santiago abrió «Cuenta con Mister Luks» desde su chat privado y después la
-- conectó a su grupo «Gastos Santi mes», pero la cuenta siguió llamándose
-- «Cuenta con Mister Luks». Y como Mister Luks no reconocía su número, al
-- entrar a Luks le abrió esa cuenta aunque ya tenía «Casa gastos».
--
--   · Solo la cuenta del chat privado se llama «Cuenta con Mister Luks»: al
--     conectarla a un grupo toma el nombre del grupo (si nadie se lo cambió).
--   · Al verificar su número, si ya tiene cuentas abiertas no se abre otra:
--     Mister Luks le pregunta en cuál anota lo que mandó (o si abre «Cuenta
--     con Mister Luks» solo para eso). Sin cuentas, se abre como antes.
--   · El connector lee esa pregunta (connector_por_abrir_en_espera), mueve los
--     archivos a la cuenta que eligió y lo anota ahí, o abre la nueva
--     (connector_resolver_por_abrir).
-- ============================================================================

-- ============================================================================
-- La cuenta del chat privado conectada a un grupo: el nombre del grupo
-- ============================================================================

create or replace function public.nombre_del_grupo_a_la_cuenta_del_privado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.accounts a
  set name = left(btrim(g.name), 60)
  from public.whatsapp_groups g
  where a.id = new.account_id and g.id = new.group_id and g.chat_kind = 'grupo'
    and nullif(btrim(g.name), '') is not null
    and a.name in ('Cuenta con Mister Luks', 'My Mister Luks account')
    and exists (select 1 from public.cuentas_del_privado cp where cp.account_id = a.id);
  return new;
end;
$$;

create trigger trg_account_group_links_nombre_del_grupo
  after insert or update of account_id on public.account_group_links
  for each row
  execute function public.nombre_del_grupo_a_la_cuenta_del_privado();

-- Las que ya se conectaron a un grupo (la de Santiago)
update public.accounts a
set name = left(btrim(g.name), 60)
from public.account_group_links l
join public.whatsapp_groups g on g.id = l.group_id
where l.account_id = a.id and g.chat_kind = 'grupo'
  and nullif(btrim(g.name), '') is not null
  and a.name in ('Cuenta con Mister Luks', 'My Mister Luks account')
  and exists (select 1 from public.cuentas_del_privado cp where cp.account_id = a.id);

-- Con un código desde el grupo (como en la 370), con el nombre nuevo en la respuesta
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
  -- Si era la cuenta del chat privado, ya tiene el nombre del grupo (la 670)
  select a.name into v_name from public.accounts a where a.id = v_account;

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

-- Desde la app (como en la 370), con el nombre nuevo en el mensaje del grupo
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
  -- Si era la cuenta del chat privado, ya tiene el nombre del grupo (la 670)
  select * into a from public.accounts where id = p_account_id;
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

-- ============================================================================
-- Al verificar su número: si ya tiene cuentas, en cuál anota lo que mandó
-- ============================================================================

alter table public.cuentas_por_abrir
  add column opciones jsonb,
  add column preguntada_at timestamptz,
  add column resuelta_at timestamptz;

-- Abre la cuenta que quedó por abrir y entra lo que mandó (como en la 640); cuántos entraron
create or replace function public.abrir_cuenta_por_abrir(p_account_id uuid, p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.cuentas_por_abrir%rowtype;
  v_n int;
begin
  select * into q from public.cuentas_por_abrir where account_id = p_account_id for update;
  if q.account_id is null or q.opened_at is not null then
    return 0;
  end if;
  perform public.abrir_cuenta_de_whatsapp(q.account_id, p_user_id, q.identity_id, q.name, q.person_name, q.language, q.chat_jid);
  v_n := public.ingresar_gastos_por_abrir(q.account_id);
  update public.cuentas_por_abrir set opened_at = now(), resuelta_at = coalesce(resuelta_at, now()) where account_id = q.account_id;
  return v_n;
end;
$$;

-- Su número quedó verificado (como en la 640): sin cuentas abiertas, se abre la que pidió;
-- con cuentas, Mister Luks le pregunta en cuál anota lo que mandó
create or replace function public.abrir_cuentas_al_verificar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.cuentas_por_abrir%rowtype;
  v_n int;
  v_cuentas jsonb;
  v_lista text;
  v_items int;
begin
  if new.user_id is null or new.verified_at is null then
    return new;
  end if;
  for q in
    select * from public.cuentas_por_abrir
    where identity_id = new.id and opened_at is null and preguntada_at is null
    order by created_at
    for update
  loop
    if exists (select 1 from public.accounts a where a.id = q.account_id) then
      update public.cuentas_por_abrir set opened_at = now() where account_id = q.account_id;
      continue;
    end if;

    -- Sus cuentas abiertas, las de gastos más recientes primero
    select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name) order by z.ultimo desc nulls last, z.name) into v_cuentas
    from (
      select a.id, a.name, (select max(e.created_at) from public.expenses e where e.account_id = a.id) as ultimo
      from public.account_members am
      join public.accounts a on a.id = am.account_id
      where am.user_id = new.user_id and am.archived_at is null and a.status = 'active'
      order by ultimo desc nulls last, a.name
      limit 6
    ) z;

    if v_cuentas is not null then
      select count(*) into v_items from public.gastos_por_abrir g where g.account_id = q.account_id and g.ingested_at is null;
      update public.cuentas_por_abrir
      set opciones = v_cuentas, preguntada_at = now(), resuelta_at = case when v_items = 0 then now() end
      where account_id = q.account_id;
      select string_agg(o.n || '. ' || (o.x ->> 'name'), E'\n' order by o.n) into v_lista
      from jsonb_array_elements(v_cuentas) with ordinality as o(x, n);
      perform public.connector_outbox_enqueue(jsonb_build_array(jsonb_build_object(
        'chat_jid', q.chat_jid,
        'reason', 'answer',
        'dedupe_key', 'cuenta-elegir:' || q.account_id,
        'body', case
          when v_items = 0 and q.language = 'en' then
            E'🎉 Done, you’re in Luks ✅\n\n💡 Send me your expenses right here and I’ll ask you which of your accounts to log them in.\n\n📊 More detail at mrluks.com'
          when v_items = 0 then
            E'🎉 Listo, ya entraste a Luks ✅\n\n💡 Mándame tus gastos por aquí y te pregunto en cuál de tus cuentas los anoto.\n\n📊 Más detalle en mrluks.com'
          when q.language = 'en' then
            E'🎉 Done, you’re in Luks ✅\n\n🧾 I see you already have accounts. Which one should I log what you sent me in?\n' || v_lista
              || E'\n' || (jsonb_array_length(v_cuentas) + 1) || '. A new account just for this: “' || q.name || '”'
              || E'\n\nReply with the number (or *no* if it was nothing).'
          else
            E'🎉 Listo, ya entraste a Luks ✅\n\n🧾 Veo que ya tienes cuentas. ¿En cuál anoto lo que me mandaste?\n' || v_lista
              || E'\n' || (jsonb_array_length(v_cuentas) + 1) || '. Una cuenta nueva solo para esto: «' || q.name || '»'
              || E'\n\nRespóndeme con el número (o *no* si no era nada).'
        end
      )));
      continue;
    end if;

    v_n := public.abrir_cuenta_por_abrir(q.account_id, new.user_id);
    perform public.connector_outbox_enqueue(jsonb_build_array(jsonb_build_object(
      'chat_jid', q.chat_jid,
      'reason', 'answer',
      'dedupe_key', 'cuenta-abierta:' || q.account_id,
      'body', case when q.language = 'en' then
        '🎉 Done, you’re in Luks: I opened your account “' || q.name || '”'
          || case when v_n > 0 then ' and I’m reading what you sent me. I’ll tell you how it went in a moment.' else '.' end
          || E'\n\n💡 Send me your expenses right here and I’ll log them there. If you later want other people to send receipts to it, connect it to a WhatsApp group from the app.\n\n📊 More detail at mrluks.com'
      else
        '🎉 Listo, ya entraste a Luks: abrí tu cuenta «' || q.name || '»'
          || case when v_n > 0 then ' y estoy leyendo lo que me mandaste. Ya te digo cómo quedó.' else '.' end
          || E'\n\n💡 Mándame tus gastos por aquí y los anoto allá. Si después quieres que otras personas manden recibos a esa cuenta, conéctala a un grupo de WhatsApp desde la app.\n\n📊 Más detalle en mrluks.com'
      end
    )));
  end loop;
  return new;
end;
$$;

-- La pregunta que espera respuesta en ese chat (de las últimas 12 horas), con lo que mandó
create or replace function public.connector_por_abrir_en_espera(p_chat_jid text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'account_id', q.account_id,
    'account_name', q.name,
    'language', q.language,
    'opciones', q.opciones,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'wa_message_id', g.wa_message_id, 'kind', g.kind, 'text', g.text_body, 'media_path', g.media_path,
        'file_name', g.file_name, 'mime_type', g.mime_type, 'sent_at', g.sent_at
      ) order by g.sent_at)
      from public.gastos_por_abrir g
      where g.account_id = q.account_id and g.ingested_at is null
    ), '[]'::jsonb)
  )
  from public.cuentas_por_abrir q
  where q.chat_jid = p_chat_jid
    and q.preguntada_at > now() - interval '12 hours'
    and q.opened_at is null and q.resuelta_at is null
  order by q.preguntada_at desc
  limit 1
$$;

-- Lo que respondió: 'nueva' abre «Cuenta con Mister Luks» con lo que mandó; 'listo' (el connector ya
-- lo anotó en la cuenta que eligió) o 'no' (no era nada) cierran la pregunta
create or replace function public.connector_resolver_por_abrir(p_account_id uuid, p_que text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.cuentas_por_abrir%rowtype;
  v_user uuid;
  v_n int;
begin
  if p_que not in ('nueva', 'listo', 'no') then
    raise exception 'Respuesta desconocida: %', p_que;
  end if;
  select * into q from public.cuentas_por_abrir where account_id = p_account_id for update;
  if q.account_id is null or q.opened_at is not null or q.resuelta_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'ya_no');
  end if;
  if p_que = 'nueva' then
    select i.user_id into v_user from public.whatsapp_identities i where i.id = q.identity_id and i.verified_at is not null;
    if v_user is null then
      return jsonb_build_object('ok', false, 'reason', 'sin_usuario');
    end if;
    v_n := public.abrir_cuenta_por_abrir(q.account_id, v_user);
    return jsonb_build_object('ok', true, 'account_id', q.account_id, 'account_name', q.name, 'leyendo', v_n);
  end if;
  if p_que = 'listo' then
    update public.gastos_por_abrir set ingested_at = now() where account_id = q.account_id and ingested_at is null;
  end if;
  update public.cuentas_por_abrir set resuelta_at = now() where account_id = q.account_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.nombre_del_grupo_a_la_cuenta_del_privado() from public, anon, authenticated;
revoke execute on function public.abrir_cuenta_por_abrir(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.abrir_cuentas_al_verificar() from public, anon, authenticated;
revoke execute on function public.connector_por_abrir_en_espera(text) from public, anon, authenticated;
grant execute on function public.connector_por_abrir_en_espera(text) to service_role;
revoke execute on function public.connector_resolver_por_abrir(uuid, text) from public, anon, authenticated;
grant execute on function public.connector_resolver_por_abrir(uuid, text) to service_role;
