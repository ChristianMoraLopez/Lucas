-- ============================================================================
-- Lucas · 00000000000640_cuenta_desde_el_privado.sql
-- Santiago le mandó por privado a Mister Luks un recibo y no tenía ninguna
-- cuenta abierta. Lo usual es un grupo de WhatsApp con Mister Luks, pero si
-- el gasto es solo suyo, Mister Luks le abre una cuenta ahí mismo («sí») y lee
-- lo que ya le mandó, sin que tenga que volver a mandarlo:
--
--   · Si su WhatsApp ya está conectado a su usuario de Luks, la cuenta
--     («Gastos de Santiago») se abre en el momento y el recibo entra.
--   · Si no, la cuenta queda por abrir con lo que mandó guardado; le llega el
--     link para entrar a Luks y, apenas su número queda verificado, la
--     cuenta se abre sola, el recibo entra y Mister Luks le avisa por privado.
--   · La cuenta queda unida a su chat privado con Mister Luks (por ahí le
--     sigue mandando recibos) y después se puede conectar a un grupo.
--
-- Y para decidir dónde anotar lo que llega por privado,
-- connector_cuentas_para_anotar: todas sus cuentas abiertas (la 480 solo
-- lista las que ya tienen gastos suyos).
-- ============================================================================

-- La cuenta que pidió abrir por privado sin tener todavía usuario de Luks (el id
-- se elige antes, para que los archivos queden desde ya en su carpeta)
create table public.cuentas_por_abrir (
  account_id uuid primary key,
  identity_id uuid not null references public.whatsapp_identities (id) on delete cascade,
  chat_jid text not null check (chat_jid ~ '^[0-9]{6,30}@(s\.whatsapp\.net|lid)$'),
  name text not null check (length(trim(name)) between 1 and 60),
  person_name text not null check (length(trim(person_name)) between 1 and 40),
  language text not null default 'es' check (language in ('es', 'en')),
  created_at timestamptz not null default now(),
  opened_at timestamptz
);
create index cuentas_por_abrir_identidad_idx on public.cuentas_por_abrir (identity_id) where opened_at is null;

-- Lo que mandó para esa cuenta, esperando a que se abra
create table public.gastos_por_abrir (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.cuentas_por_abrir (account_id) on delete cascade,
  wa_message_id text not null check (length(wa_message_id) <= 128),
  sender_wa_id text,
  sender_name text check (length(sender_name) <= 120),
  kind public.message_kind not null,
  text_body text check (length(text_body) <= 4000),
  media_path text check (length(media_path) <= 300),
  file_name text check (length(file_name) <= 120),
  mime_type text check (length(mime_type) <= 100),
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  ingested_at timestamptz,
  unique (account_id, wa_message_id)
);

-- La cuenta que se abrió desde un chat privado, unida a ese chat
create table public.cuentas_del_privado (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  group_id uuid not null references public.whatsapp_groups (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.cuentas_por_abrir enable row level security;
alter table public.cuentas_por_abrir force row level security;
alter table public.gastos_por_abrir enable row level security;
alter table public.gastos_por_abrir force row level security;
alter table public.cuentas_del_privado enable row level security;
alter table public.cuentas_del_privado force row level security;
revoke all on public.cuentas_por_abrir from anon, authenticated;
revoke all on public.gastos_por_abrir from anon, authenticated;
revoke all on public.cuentas_del_privado from anon, authenticated;

-- Su chat privado con Mister Luks (el «grupo» de lo que manda por ahí)
create or replace function public.chat_privado_con_luks(p_chat_jid text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.id
  from public.whatsapp_groups g
  join public.whatsapp_group_sessions s on s.group_id = g.id and s.left_at is null
  join public.whatsapp_connections c on c.id = s.connection_id and c.kind = 'contador'
  where g.wa_group_jid = p_chat_jid and g.chat_kind = 'privado' and g.left_at is null
  limit 1
$$;

-- Abre la cuenta de quien la pidió por privado: suya (dueña), con su persona, su
-- WhatsApp y las categorías de siempre, unida a su chat privado
create or replace function public.abrir_cuenta_de_whatsapp(
  p_account_id uuid,
  p_user_id uuid,
  p_identity_id uuid,
  p_name text,
  p_person_name text,
  p_language text,
  p_chat_jid text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.whatsapp_identities%rowtype;
  v_person uuid;
  v_chat uuid := public.chat_privado_con_luks(p_chat_jid);
begin
  select * into i from public.whatsapp_identities where id = p_identity_id;
  insert into public.accounts (id, name, type, owner_id, language)
  values (p_account_id, left(trim(p_name), 60), 'hogar', p_user_id, coalesce(p_language, 'es'));
  insert into public.people (account_id, display_name, claimed_by, name_source)
  values (p_account_id, left(trim(p_person_name), 40), p_user_id, 'whatsapp')
  returning id into v_person;
  insert into public.account_members (account_id, user_id, role, person_id)
  values (p_account_id, p_user_id, 'owner', v_person);
  insert into public.person_whatsapp_ids (person_id, wa_id)
  select v_person, x from unnest(array[i.phone, case when i.lid is not null then 'lid:' || i.lid end]) x
  where x is not null
  on conflict do nothing;
  perform public.add_default_categories(p_account_id);
  if v_chat is not null then
    insert into public.cuentas_del_privado (account_id, group_id) values (p_account_id, v_chat) on conflict do nothing;
  end if;
  return v_person;
end;
$$;

-- Lo que esperaba la cuenta entra como mensajes suyos (el worker los lee como siempre)
create or replace function public.ingresar_gastos_por_abrir(p_account_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.cuentas_por_abrir%rowtype;
  r public.gastos_por_abrir%rowtype;
  v_chat uuid;
  v_person uuid;
  v_message uuid;
  v_n int := 0;
begin
  select * into q from public.cuentas_por_abrir where account_id = p_account_id;
  v_chat := public.chat_privado_con_luks(q.chat_jid);
  select p.id into v_person from public.people p where p.account_id = p_account_id order by p.created_at limit 1;
  if v_chat is null or v_person is null then
    return 0;
  end if;
  for r in select * from public.gastos_por_abrir where account_id = p_account_id and ingested_at is null order by sent_at for update loop
    insert into public.messages (
      account_id, group_id, source, wa_message_id, sender_wa_id, sender_name, sender_person_id,
      kind, text_body, media_path, file_name, mime_type, received_at
    )
    values (
      p_account_id, v_chat, 'whatsapp', r.wa_message_id, r.sender_wa_id, r.sender_name, v_person,
      r.kind, r.text_body, r.media_path, r.file_name, r.mime_type, r.sent_at
    )
    on conflict (group_id, wa_message_id) do nothing
    returning id into v_message;
    if v_message is not null then
      insert into public.jobs (type, payload)
      values ('process_message', jsonb_build_object('message_id', v_message, 'account_id', p_account_id));
      v_n := v_n + 1;
      v_message := null;
    end if;
    update public.gastos_por_abrir set ingested_at = now() where id = r.id;
  end loop;
  return v_n;
end;
$$;

-- «Sí, ábreme una cuenta»: la abre ya (si su WhatsApp tiene usuario de Luks) o la deja por abrir
create or replace function public.connector_abrir_cuenta_privada(
  p_chat_jid text,
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
  v_ident uuid;
  i public.whatsapp_identities%rowtype;
  q public.cuentas_por_abrir%rowtype;
  v_nombre text;
  v_cuenta text;
  v_idioma text := case when coalesce(p_phone, '') like '1%' then 'en' else 'es' end;
  v_id uuid := gen_random_uuid();
begin
  if public.chat_privado_con_luks(p_chat_jid) is null then
    return jsonb_build_object('ok', false, 'reason', 'sin_chat');
  end if;
  v_ident := public.wa_identidad(p_wa_id, p_phone, p_lid, p_name);
  select * into i from public.whatsapp_identities where id = v_ident;

  -- Ya la había pedido y sigue por abrir: la misma
  select * into q from public.cuentas_por_abrir x where x.identity_id = v_ident and x.opened_at is null order by x.created_at desc limit 1;
  if q.account_id is not null then
    return jsonb_build_object('ok', true, 'abierta', false, 'account_id', q.account_id, 'account_name', q.name, 'identity_id', v_ident);
  end if;

  -- El nombre: el de WhatsApp (o el de su usuario de Luks), si dice algo
  v_nombre := coalesce(
    nullif(split_part(btrim(coalesce(public.nombre_de_whatsapp(coalesce(i.push_name, p_name)), '')), ' ', 1), ''),
    nullif(split_part(btrim(coalesce((select pf.full_name from public.profiles pf where pf.id = i.user_id), '')), ' ', 1), '')
  );
  v_cuenta := case when v_nombre is not null then
    case when v_idioma = 'en' then v_nombre || '’s expenses' else 'Gastos de ' || v_nombre end
  else case when v_idioma = 'en' then 'My expenses' else 'Mis gastos' end end;

  if i.user_id is not null and i.verified_at is not null then
    perform public.abrir_cuenta_de_whatsapp(v_id, i.user_id, v_ident, v_cuenta, coalesce(v_nombre, 'Yo'), v_idioma, p_chat_jid);
    return jsonb_build_object('ok', true, 'abierta', true, 'account_id', v_id, 'account_name', left(v_cuenta, 60), 'identity_id', v_ident);
  end if;

  insert into public.cuentas_por_abrir (account_id, identity_id, chat_jid, name, person_name, language)
  values (v_id, v_ident, p_chat_jid, left(v_cuenta, 60), left(coalesce(v_nombre, 'Yo'), 40), v_idioma);
  return jsonb_build_object('ok', true, 'abierta', false, 'account_id', v_id, 'account_name', left(v_cuenta, 60), 'identity_id', v_ident);
end;
$$;

-- Lo que mandó, guardado para la cuenta por abrir (los archivos ya están en su carpeta)
create or replace function public.connector_guardar_gastos_por_abrir(p_account_id uuid, p_items jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  x jsonb;
  v_n int := 0;
begin
  if not exists (select 1 from public.cuentas_por_abrir q where q.account_id = p_account_id and q.opened_at is null) then
    return 0;
  end if;
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if (x ->> 'kind') <> 'text' and coalesce(x ->> 'media_path', '') not like p_account_id::text || '/%' then
      continue;
    end if;
    insert into public.gastos_por_abrir (account_id, wa_message_id, sender_wa_id, sender_name, kind, text_body, media_path, file_name, mime_type, sent_at)
    values (
      p_account_id, x ->> 'wa_message_id', x ->> 'sender_wa_id', left(x ->> 'sender_name', 120), (x ->> 'kind')::public.message_kind,
      left(nullif(btrim(x ->> 'text'), ''), 4000), x ->> 'media_path', left(x ->> 'file_name', 120), x ->> 'mime_type',
      coalesce((x ->> 'sent_at')::timestamptz, now())
    )
    on conflict (account_id, wa_message_id) do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Su número quedó verificado con su usuario de Luks: se abren las cuentas que pidió por
-- privado, entra lo que mandó y Mister Luks le avisa
create or replace function public.abrir_cuentas_al_verificar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.cuentas_por_abrir%rowtype;
  v_n int;
begin
  if new.user_id is null or new.verified_at is null then
    return new;
  end if;
  for q in select * from public.cuentas_por_abrir where identity_id = new.id and opened_at is null order by created_at for update loop
    if exists (select 1 from public.accounts a where a.id = q.account_id) then
      update public.cuentas_por_abrir set opened_at = now() where account_id = q.account_id;
      continue;
    end if;
    perform public.abrir_cuenta_de_whatsapp(q.account_id, new.user_id, new.id, q.name, q.person_name, q.language, q.chat_jid);
    v_n := public.ingresar_gastos_por_abrir(q.account_id);
    update public.cuentas_por_abrir set opened_at = now() where account_id = q.account_id;
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

create trigger trg_whatsapp_identities_abrir_cuentas
  after insert or update of user_id, verified_at on public.whatsapp_identities
  for each row
  when (new.user_id is not null and new.verified_at is not null)
  execute function public.abrir_cuentas_al_verificar();

-- ============================================================================
-- Dónde puede anotar lo que manda por privado: sus cuentas abiertas (las unidas a
-- este chat primero, después las de gastos más recientes)
-- ============================================================================

create or replace function public.connector_cuentas_para_anotar(
  p_jid text,
  p_wa_id text,
  p_phone text default null,
  p_lid text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'type', z.type) order by z.del_chat desc, z.ultimo desc nulls last, z.name), '[]'::jsonb)
  from (
    select distinct on (a.id) a.id, a.name, a.type,
      exists (
        select 1 from public.cuentas_del_privado cp join public.whatsapp_groups g on g.id = cp.group_id
        where cp.account_id = a.id and g.wa_group_jid = p_jid
      ) as del_chat,
      (select max(e.created_at) from public.expenses e where e.account_id = a.id) as ultimo
    from public.personas_de_wa(p_jid, p_wa_id, p_phone, p_lid) y
    join public.accounts a on a.id = y.account_id
    where a.status = 'active'
      and not exists (
        select 1 from public.account_members am
        where am.account_id = a.id and am.person_id = y.person_id and am.archived_at is not null
      )
      and not public.no_lo_cuentes(a.id, coalesce(p_wa_id, p_phone))
    order by a.id
  ) z
$$;

revoke execute on function public.chat_privado_con_luks(text) from public, anon, authenticated;
revoke execute on function public.abrir_cuenta_de_whatsapp(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.ingresar_gastos_por_abrir(uuid) from public, anon, authenticated;
revoke execute on function public.abrir_cuentas_al_verificar() from public, anon, authenticated;
revoke execute on function public.connector_abrir_cuenta_privada(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.connector_guardar_gastos_por_abrir(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.connector_cuentas_para_anotar(text, text, text, text) from public, anon, authenticated;
grant execute on function public.connector_abrir_cuenta_privada(text, text, text, text, text) to service_role;
grant execute on function public.connector_guardar_gastos_por_abrir(uuid, jsonb) to service_role;
grant execute on function public.connector_cuentas_para_anotar(text, text, text, text) to service_role;
