-- ============================================================================
-- Lo que hace Luks no es un gasto.
--
-- Desde Liquidar se manda al grupo «las cuentas» (cuánto fue y quién le paga
-- a quién) y a cada uno su cobro; Luks responde «Anotado: … · $…». Todo eso
-- trae montos, así que se leería como un gasto nuevo. Se reconoce por su
-- firma («Esto se hizo en mrluks.com», el link /r/TOKEN de las cuentas, el
-- formato de las respuestas) y por el número de Luks (que escribe en los
-- grupos que también lee el WhatsApp de alguien). Lo mismo revisan el
-- connector (services/connector/src/text.ts) y el worker (lucas_worker/luks.py).
-- ============================================================================

create or replace function public.es_mensaje_de_luks(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~* '(esto se hizo en mrluks\.com|cuentas hechas con luks|hecho con luks|(mrluks\.com|\.vercel\.app)/r/[A-Za-z0-9_-]{20,64})'
      or coalesce(p_text, '') ~* '^\s*(anotad[oa]s?|recibido|ya estaba anotado)[\s:].*·\s*\$\d'
$$;

-- El número de Luks (por teléfono o por su LID)
create or replace function public.es_numero_de_luks(p_wa_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_wa_id is not null and exists (
    select 1 from public.whatsapp_connections c
    where c.kind = 'contador' and (c.phone_number = p_wa_id or public.lid_wa_id(c.wa_lid) = p_wa_id)
  )
$$;

-- El connector no guarda lo que hizo Luks
create or replace function public.connector_ingest_message(
  p_jid text,
  p_wa_message_id text,
  p_sender_wa_id text,
  p_sender_name text,
  p_kind public.message_kind,
  p_text text,
  p_media_path text,
  p_file_name text,
  p_mime_type text,
  p_sent_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb := public.connector_should_ingest(p_jid, p_wa_message_id, p_sent_at);
  v_account uuid := (v_check ->> 'account_id')::uuid;
  v_group uuid := (v_check ->> 'group_id')::uuid;
  v_person uuid;
  v_message uuid;
begin
  if not (v_check ->> 'ingest')::boolean then
    return v_check;
  end if;
  if p_kind = 'text' and nullif(btrim(p_text), '') is null then
    return jsonb_build_object('ingest', false, 'reason', 'vacio');
  end if;
  if p_kind <> 'text' and (p_media_path is null or p_media_path not like v_account::text || '/%') then
    return jsonb_build_object('ingest', false, 'reason', 'archivo_fuera_de_la_cuenta');
  end if;
  -- Lo que escribe Luks, o lo que se manda desde Luks (las cuentas, un cobro), no es un gasto
  if public.es_mensaje_de_luks(p_text) then
    return jsonb_build_object('ingest', false, 'reason', 'mensaje_de_luks', 'account_id', v_account);
  end if;
  if public.es_numero_de_luks(p_sender_wa_id) then
    return jsonb_build_object('ingest', false, 'reason', 'numero_de_luks', 'account_id', v_account);
  end if;

  v_person := public.wa_person(v_account, p_sender_wa_id);

  insert into public.messages (
    account_id, group_id, source, wa_message_id, sender_wa_id, sender_name, sender_person_id,
    kind, text_body, media_path, file_name, mime_type, received_at
  )
  values (
    v_account, v_group, 'whatsapp', p_wa_message_id, p_sender_wa_id, left(p_sender_name, 120), v_person,
    p_kind, left(nullif(btrim(p_text), ''), 4000), p_media_path, left(p_file_name, 120), p_mime_type,
    coalesce(p_sent_at, now())
  )
  on conflict (group_id, wa_message_id) do nothing
  returning id into v_message;

  if v_message is null then
    return jsonb_build_object('ingest', false, 'reason', 'repetido');
  end if;

  insert into public.jobs (type, payload)
  values ('process_message', jsonb_build_object('message_id', v_message, 'account_id', v_account));

  update public.whatsapp_groups set last_message_at = now() where id = v_group;

  if p_sender_wa_id is not null then
    insert into public.whatsapp_senders (account_id, wa_id, push_name)
    values (v_account, p_sender_wa_id, left(p_sender_name, 120))
    on conflict (account_id, wa_id) do update
      set last_seen_at = now(),
          message_count = public.whatsapp_senders.message_count + 1,
          push_name = coalesce(excluded.push_name, public.whatsapp_senders.push_name);
  end if;

  return jsonb_build_object('ingest', true, 'message_id', v_message, 'account_id', v_account,
                            'known_sender', v_person is not null);
end;
$$;

-- Tampoco se sube desde la web
create or replace function public.submit_upload(
  p_account_id uuid,
  p_kind public.message_kind,
  p_text text default null,
  p_media_path text default null,
  p_file_name text default null,
  p_mime_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_person uuid;
  v_message uuid;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  if exists (select 1 from public.accounts a where a.id = p_account_id and a.status = 'closed') then
    raise exception 'La cuenta está cerrada: ya no recibe gastos';
  end if;

  if p_kind = 'text' then
    if nullif(btrim(p_text), '') is null then
      raise exception 'Escribe el gasto, por ejemplo «taxis al aeropuerto 100 lucas»';
    end if;
    if length(p_text) > 1000 then
      raise exception 'El mensaje es muy largo (máximo 1.000 letras)';
    end if;
    if public.es_mensaje_de_luks(p_text) then
      raise exception 'Ese mensaje lo hizo Luks (las cuentas o un cobro): no es un gasto nuevo';
    end if;
  else
    if p_media_path is null
       or p_media_path not like p_account_id::text || '/%'
       or p_media_path like '%..%' then
      raise exception 'El archivo no está en la carpeta de esta cuenta';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'evidencias' and o.name = p_media_path) then
      raise exception 'No encontramos el archivo subido. Intenta subirlo otra vez';
    end if;
    if p_kind = 'pdf' and coalesce(p_mime_type, 'application/pdf') <> 'application/pdf' then
      raise exception 'Ese archivo no es un PDF';
    end if;
  end if;

  select p.id into v_person
  from public.people p
  where p.account_id = p_account_id and p.claimed_by = v_uid;

  insert into public.messages (account_id, source, kind, text_body, media_path, file_name, mime_type, uploaded_by, sender_person_id)
  values (
    p_account_id, 'web', p_kind,
    case when p_kind = 'text' then btrim(p_text) else nullif(btrim(p_text), '') end,
    case when p_kind = 'text' then null else p_media_path end,
    left(p_file_name, 120), p_mime_type, v_uid, v_person
  )
  returning id into v_message;

  insert into public.jobs (type, payload)
  values ('process_message', jsonb_build_object('message_id', v_message, 'account_id', p_account_id));

  return v_message;
end;
$$;

revoke execute on function public.es_numero_de_luks(text) from public, anon, authenticated;
grant execute on function public.es_numero_de_luks(text) to service_role;
