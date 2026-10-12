-- ============================================================================
-- Lucas · 00000000000310_numeros_verificados.sql
-- Fase 4: cada número de WhatsApp es una identidad, y solo cuenta como de un
-- usuario de Luks cuando está verificado.
--
--   · whatsapp_identities: un número (y su LID, si se sabe), el nombre que se
--     puso en WhatsApp y, si es de alguien, su usuario y cómo se verificó:
--       sesion_vinculada  lo vinculó desde su teléfono (WhatsApp Web)
--       link_privado      abrió el link /v/ que Mister Luks le mandó por privado
--       codigo_en_grupo   (reservado)
--       heredado          lo escribió en su perfil o venía de una persona que
--                         reclamó: es suyo para sus gastos, pero NO cuenta como
--                         verificado hasta que lo confirme
--     person_whatsapp_ids, whatsapp_group_members y whatsapp_senders apuntan a
--     ella (identity_id); un trigger la busca o la crea en cada fila nueva.
--   · «luks soy yo» (en un grupo o por privado a Mister Luks): el connector
--     deja en la bandeja un mensaje privado con el link /v/CÓDIGO. El código se
--     crea al mandarlo (connector_verify_mint), es de 144 bits, se guarda solo
--     su hash, sirve una vez y vence en 30 minutos. La web lo canjea con la
--     sesión iniciada (redeem_whatsapp_verification).
--   · Reclamar una persona que tiene WhatsApp (join_with_code, claim_person)
--     pide que ese número esté verificado por quien la reclama, o que un admin
--     lo haya agregado desde Personas (account_invites).
--   · El saludo de Mister Luks en un grupo sin cuenta nombra a quienes tienen
--     su número verificado.
-- ============================================================================

-- ============================================================================
-- Identidades
-- ============================================================================

create table public.whatsapp_identities (
  id uuid primary key default gen_random_uuid(),
  phone text unique check (phone ~ '^[0-9]{6,20}$'),
  lid text unique check (lid ~ '^[0-9]{6,30}$'),
  username text check (length(username) <= 64),
  push_name text check (length(push_name) <= 120),
  user_id uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  verify_method text check (verify_method in ('link_privado', 'codigo_en_grupo', 'sesion_vinculada', 'heredado')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  check (phone is not null or lid is not null)
);

create index whatsapp_identities_usuario_idx on public.whatsapp_identities (user_id) where user_id is not null;

alter table public.whatsapp_identities enable row level security;
alter table public.whatsapp_identities force row level security;
revoke all on public.whatsapp_identities from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_identities to service_role;

alter table public.person_whatsapp_ids add column identity_id uuid references public.whatsapp_identities (id) on delete set null;
alter table public.whatsapp_group_members add column identity_id uuid references public.whatsapp_identities (id) on delete set null;
alter table public.whatsapp_senders add column identity_id uuid references public.whatsapp_identities (id) on delete set null;

create index person_whatsapp_ids_identidad_idx on public.person_whatsapp_ids (identity_id);
create index whatsapp_group_members_identidad_idx on public.whatsapp_group_members (identity_id);

-- Un usuario la tiene verificada (no basta con heredada)
create or replace function public.identidad_verificada(i public.whatsapp_identities)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select i.user_id is not null and i.verified_at is not null
$$;

-- La identidad de un número o «lid:…» (la busca o la crea). Si llegan el número
-- y el LID juntos, completa el que falte cuando nadie más lo tiene.
create or replace function public.wa_identidad(p_wa_id text, p_phone text default null, p_lid text default null, p_nombre text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := case when p_phone ~ '^[0-9]{6,20}$' then p_phone when p_wa_id ~ '^[0-9]{6,20}$' then p_wa_id end;
  v_lid text := case when p_lid ~ '^[0-9]{6,30}$' then p_lid when p_wa_id ~ '^lid:[0-9]{6,30}$' then substr(p_wa_id, 5) end;
  v_nombre text := left(nullif(btrim(p_nombre), ''), 120);
  v_id uuid;
begin
  if v_phone is null and v_lid is null then
    return null;
  end if;
  if v_phone is not null then
    select id into v_id from public.whatsapp_identities where phone = v_phone;
  end if;
  if v_id is null and v_lid is not null then
    select id into v_id from public.whatsapp_identities where lid = v_lid;
  end if;

  if v_id is null then
    insert into public.whatsapp_identities (phone, lid, push_name)
    values (v_phone, v_lid, v_nombre)
    on conflict do nothing
    returning id into v_id;
    -- Otra conexión la creó al mismo tiempo
    if v_id is null then
      select id into v_id from public.whatsapp_identities where phone = v_phone or lid = v_lid limit 1;
    end if;
    return v_id;
  end if;

  update public.whatsapp_identities i
  set phone = coalesce(i.phone, case when not exists (select 1 from public.whatsapp_identities x where x.phone = v_phone) then v_phone end),
      lid = coalesce(i.lid, case when not exists (select 1 from public.whatsapp_identities x where x.lid = v_lid) then v_lid end),
      push_name = coalesce(v_nombre, i.push_name),
      last_seen_at = now()
  where i.id = v_id;
  return v_id;
end;
$$;

-- Cada fila nueva (o que cambia de número) queda con su identidad
create or replace function public.wa_identidad_en_fila()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'whatsapp_group_members' then
    new.identity_id := public.wa_identidad(new.wa_id, new.phone, new.lid, new.name);
  elsif tg_table_name = 'whatsapp_senders' then
    new.identity_id := public.wa_identidad(new.wa_id, null, null, new.push_name);
  else
    new.identity_id := public.wa_identidad(new.wa_id);
  end if;
  return new;
end;
$$;

-- Lo que ya había (antes de los triggers: así no se recalcula dos veces)
update public.person_whatsapp_ids w set identity_id = public.wa_identidad(w.wa_id);
update public.whatsapp_group_members m set identity_id = public.wa_identidad(m.wa_id, m.phone, m.lid, m.name);
update public.whatsapp_senders s set identity_id = public.wa_identidad(s.wa_id, null, null, s.push_name);

create trigger trg_person_whatsapp_ids_identidad
  before insert or update of wa_id on public.person_whatsapp_ids
  for each row execute function public.wa_identidad_en_fila();
create trigger trg_whatsapp_group_members_identidad
  before insert or update of wa_id, phone, lid, name on public.whatsapp_group_members
  for each row execute function public.wa_identidad_en_fila();
create trigger trg_whatsapp_senders_identidad
  before insert or update of wa_id, push_name on public.whatsapp_senders
  for each row execute function public.wa_identidad_en_fila();

-- Quien vinculó su WhatsApp lo hizo desde su teléfono: ese número es suyo
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
  end if;
  return null;
end;
$$;

create trigger trg_whatsapp_connections_verifica
  after insert or update of status, phone_number on public.whatsapp_connections
  for each row execute function public.whatsapp_connections_verifica();

-- Las vinculaciones que ya estaban (primero se asegura su identidad, después se marca)
select public.wa_identidad(c.phone_number, c.phone_number, split_part(split_part(coalesce(c.wa_lid, ''), '@', 1), ':', 1))
from public.whatsapp_connections c
where c.kind = 'personal' and c.owner_id is not null and c.status = 'connected' and c.phone_number ~ '^[0-9]{6,20}$';

update public.whatsapp_identities i
set user_id = c.owner_id, verified_at = coalesce(c.connected_at, now()), verify_method = 'sesion_vinculada'
from public.whatsapp_connections c
where c.kind = 'personal' and c.owner_id is not null and c.status = 'connected' and i.phone = c.phone_number;

-- Los números de personas reclamadas por un solo usuario: suyos, pero heredados (sin verificar)
update public.whatsapp_identities i
set user_id = d.usuario, verify_method = 'heredado'
from (
  select w.identity_id, (array_agg(distinct p.claimed_by))[1] as usuario
  from public.person_whatsapp_ids w
  join public.people p on p.id = w.person_id
  where p.claimed_by is not null and w.identity_id is not null
  group by w.identity_id
  having count(distinct p.claimed_by) = 1
) d
where d.identity_id = i.id and i.user_id is null;

-- ============================================================================
-- El número en las cuentas de su usuario
-- ============================================================================

-- En cada cuenta del usuario (donde ese número no es de otra persona), el número
-- queda en su persona y lo que mandó desde él, a su nombre. Lo usan
-- add_my_whatsapp y el canje del link /v/.
create or replace function public.wa_asociar(p_uid uuid, p_wa text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pp public.people%rowtype;
  v_en int := 0;
  v_ocupado text[] := '{}';
begin
  for pp in select * from public.people where claimed_by = p_uid loop
    if exists (
      select 1 from public.person_whatsapp_ids w join public.people x on x.id = w.person_id
      where x.account_id = pp.account_id and w.wa_id = p_wa and x.id <> pp.id
    ) then
      v_ocupado := v_ocupado || (select a.name from public.accounts a where a.id = pp.account_id);
      continue;
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
  return jsonb_build_object('wa_id', p_wa, 'accounts', v_en, 'taken_in', to_jsonb(v_ocupado));
end;
$$;

-- Como en la 140, y el número queda como suyo (heredado: sin verificar)
create or replace function public.add_my_whatsapp(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_wa text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_r jsonb;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  -- «300 123 4567» → 573001234567
  if length(v_wa) = 10 and left(v_wa, 1) = '3' then
    v_wa := '57' || v_wa;
  end if;
  if v_wa !~ '^[0-9]{11,15}$' then
    raise exception 'Escribe tu número con el indicativo, por ejemplo 300 123 4567 o +57 300 123 4567';
  end if;

  v_r := public.wa_asociar(v_uid, v_wa);
  v_id := public.wa_identidad(v_wa);
  update public.whatsapp_identities
  set user_id = v_uid, verify_method = 'heredado'
  where id = v_id and user_id is null;
  return v_r;
end;
$$;

-- Como en la 140; además deja de ser suyo (y de estar verificado)
create or replace function public.remove_my_whatsapp(p_wa_id text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  delete from public.person_whatsapp_ids w
  using public.people pp
  where w.person_id = pp.id and pp.claimed_by = auth.uid() and w.wa_id = p_wa_id;
  get diagnostics v_n = row_count;
  update public.whatsapp_identities i
  set user_id = null, verified_at = null, verify_method = null
  where i.user_id = auth.uid() and (i.phone = p_wa_id or 'lid:' || i.lid = p_wa_id);
  return v_n;
end;
$$;

-- Como en la 140, con los números que tiene verificados
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
    ), '[]'::jsonb)
  )
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = auth.uid()
$$;

-- ============================================================================
-- «luks soy yo» y el link /v/
-- ============================================================================

create table public.whatsapp_verifications (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.whatsapp_identities (id) on delete cascade,
  -- sha256 del código; el código mismo solo va en el mensaje de WhatsApp
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  used_at timestamptz,
  used_by uuid references public.profiles (id) on delete set null
);

alter table public.whatsapp_verifications enable row level security;
alter table public.whatsapp_verifications force row level security;
revoke all on public.whatsapp_verifications from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_verifications to service_role;

-- La bandeja de salida sabe de qué identidad es un link (lo crea al mandarlo)
alter table public.whatsapp_outbox add column identity_id uuid references public.whatsapp_identities (id) on delete cascade;
alter table public.whatsapp_outbox drop constraint whatsapp_outbox_reason_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_reason_check
  check (reason in ('welcome', 'group_hello', 'guide', 'invite', 'link', 'verify', 'soy_yo'));

-- Alguien escribió «luks soy yo» (en un grupo o por privado). Pidió que le
-- escribieran: su chat privado queda abierto. Dice si su número ya es de un
-- usuario verificado (su primer nombre) y los últimos 4 números.
create or replace function public.connector_soy_yo(p_connection_id uuid, p_private_jid text, p_phone text, p_lid text, p_push_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.whatsapp_identities%rowtype;
  v_id uuid;
  v_nombre text;
begin
  perform public.connector_private_chat(p_connection_id, p_private_jid);
  v_id := public.wa_identidad(coalesce(p_phone, 'lid:' || p_lid), p_phone, p_lid, p_push_name);
  select * into i from public.whatsapp_identities where id = v_id;
  if public.identidad_verificada(i) then
    select split_part(btrim(pr.full_name), ' ', 1) into v_nombre from public.profiles pr where pr.id = i.user_id;
  end if;
  return jsonb_build_object(
    'identity_id', i.id,
    'verified', public.identidad_verificada(i),
    'name', nullif(v_nombre, ''),
    'last4', right(coalesce(i.phone, i.lid), 4)
  );
end;
$$;

-- Al mandar el link: crea el código (144 bits), guarda su hash y lo devuelve una sola vez
create or replace function public.connector_verify_mint(p_outbox_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identidad uuid;
  v_token text;
begin
  select o.identity_id into v_identidad
  from public.whatsapp_outbox o
  where o.id = p_outbox_id and o.reason = 'verify' and o.sent_at is null and o.dropped_at is null;
  if v_identidad is null then
    raise exception 'Ese mensaje no lleva un link de verificación';
  end if;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'), '=');
  insert into public.whatsapp_verifications (identity_id, token_hash)
  values (v_identidad, extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'));
  return v_token;
end;
$$;

-- La web, con la sesión iniciada: de qué número es el link y si todavía sirve
create or replace function public.preview_whatsapp_verification(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.whatsapp_verifications%rowtype;
  i public.whatsapp_identities%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into v from public.whatsapp_verifications
  where token_hash = extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256');
  if v.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into i from public.whatsapp_identities where id = v.identity_id;
  return jsonb_build_object(
    'status', case when v.used_at is not null then 'used' when v.expires_at <= now() then 'expired' else 'ok' end,
    'last4', right(coalesce(i.phone, i.lid), 4),
    'mine', public.identidad_verificada(i) and i.user_id = auth.uid(),
    'other', public.identidad_verificada(i) and i.user_id <> auth.uid()
  );
end;
$$;

-- «Sí, es mío»: el número queda verificado para quien abrió el link, en todas sus cuentas
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

  v_r := public.wa_asociar(v_uid, coalesce(i.phone, 'lid:' || i.lid));
  return v_r || jsonb_build_object('last4', right(coalesce(i.phone, i.lid), 4));
end;
$$;

-- La bandeja (como en la 290) también guarda de qué identidad es un link
create or replace function public.connector_outbox_enqueue(p_items jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  x jsonb;
  v_key text;
  v_nuevas text[] := '{}';
begin
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if not exists (
      select 1
      from public.whatsapp_groups g
      join public.whatsapp_group_sessions s on s.group_id = g.id and s.left_at is null
      join public.whatsapp_connections c on c.id = s.connection_id and c.kind = 'contador'
      where g.wa_group_jid = x ->> 'chat_jid'
    ) then
      continue;
    end if;
    insert into public.whatsapp_outbox (chat_jid, reason, body, image_url, document_url, document_name, dedupe_key, identity_id)
    values (x ->> 'chat_jid', x ->> 'reason', left(x ->> 'body', 4000), x ->> 'image_url', x ->> 'document_url',
            left(x ->> 'document_name', 120), x ->> 'dedupe_key', (x ->> 'identity_id')::uuid)
    on conflict (dedupe_key) do nothing
    returning dedupe_key into v_key;
    if v_key is not null then
      v_nuevas := v_nuevas || v_key;
      v_key := null;
    end if;
  end loop;
  return v_nuevas;
end;
$$;

-- ============================================================================
-- Reclamar una persona que tiene WhatsApp
-- ============================================================================

-- Solo si ese WhatsApp está verificado por quien la reclama, o si un admin lo
-- agregó desde Personas (la invitación existe mientras se acepta). Cubre
-- join_with_code, claim_person y accept_invite.
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
  raise exception 'Para entrar como «%», primero confirma que el WhatsApp ••• % es tuyo: escríbele «luks soy yo» a Mister Luks y abre el link que te manda. O entra como persona nueva y pídele a quien administra la cuenta que te agregue desde Personas.',
    new.display_name, v_ultimos;
end;
$$;

create trigger trg_people_reclamo_verificado
  before update of claimed_by on public.people
  for each row execute function public.people_reclamo_verificado();

-- La invitación (como en la 020) dice de cada persona sin reclamar si hay que
-- verificar su WhatsApp antes de elegirla
create or replace function public.preview_invitation(p_code text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invitations%rowtype;
  v_account public.accounts%rowtype;
  v_owner text;
  v_people json;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para ver una invitación';
  end if;

  select * into v_inv
  from public.invitations inv
  where inv.code = upper(trim(p_code));

  if not found then
    raise exception 'Ese código no existe. Revisa que esté bien escrito';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'Ese código ya no sirve: generaron uno nuevo';
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at <= now() then
    raise exception 'Ese código ya venció. Pide uno nuevo';
  end if;
  if v_inv.max_uses is not null and v_inv.uses >= v_inv.max_uses then
    raise exception 'Ese código ya se usó todas las veces permitidas';
  end if;

  select * into v_account
  from public.accounts a
  where a.id = v_inv.account_id;

  if v_account.status = 'closed' then
    raise exception 'Esa cuenta ya está cerrada';
  end if;

  select split_part(coalesce(nullif(trim(pf.full_name), ''), 'alguien'), ' ', 1) into v_owner
  from public.profiles pf
  where pf.id = v_account.owner_id;

  select coalesce(json_agg(json_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'tone', p.tone,
    'wa_last4', (select right(w.wa_id, 4) from public.person_whatsapp_ids w
                 where w.person_id = p.id order by w.created_at limit 1),
    'paid_count', (select count(*) from public.expenses e where e.payer_person_id = p.id),
    -- Tiene WhatsApp y no es un número que yo tenga verificado
    'needs_verification', exists (select 1 from public.person_whatsapp_ids w where w.person_id = p.id)
      and not exists (
        select 1 from public.person_whatsapp_ids w
        join public.whatsapp_identities i on i.id = w.identity_id
        where w.person_id = p.id and i.user_id = v_uid and i.verified_at is not null
      )
  ) order by p.display_name), '[]'::json)
  into v_people
  from public.people p
  where p.account_id = v_inv.account_id
    and p.claimed_by is null;

  return json_build_object(
    'account_id', v_account.id,
    'account_name', v_account.name,
    'account_type', v_account.type,
    'starts_on', v_account.starts_on,
    'ends_on', v_account.ends_on,
    'owner_name', v_owner,
    'role', v_inv.role,
    'already_member', exists (
      select 1 from public.account_members am
      where am.account_id = v_account.id and am.user_id = v_uid
    ),
    'people_count', (select count(*) from public.people p where p.account_id = v_account.id),
    'unclaimed_people', v_people
  );
end;
$$;

-- ============================================================================
-- El saludo del grupo (como en la 290): sin cuenta, nombra a quienes tienen
-- su número verificado
-- ============================================================================

create or replace function public.connector_group_hello(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.whatsapp_groups%rowtype;
  v_account uuid;
  v_name text;
  v_language text;
  v_usuarios text[];
begin
  update public.whatsapp_groups set hello_sent_at = now()
  where id = p_group_id and hello_sent_at is null
  returning * into g;
  if g.id is null then
    return jsonb_build_object('say_hello', false);
  end if;

  select l.account_id, a.name, a.language into v_account, v_name, v_language
  from public.account_group_links l join public.accounts a on a.id = l.account_id
  where l.group_id = g.id;

  if v_account is not null then
    select array_agg(x.n order by x.n) into v_usuarios
    from (
      select distinct split_part(btrim(p.display_name), ' ', 1) as n
      from public.people p
      join public.person_whatsapp_ids w on w.person_id = p.id
      join public.whatsapp_group_members m on m.group_id = g.id and m.left_at is null and m.wa_id = w.wa_id
      where p.account_id = v_account and p.claimed_by is not null
      limit 6
    ) x;
  else
    select array_agg(x.n order by x.n) into v_usuarios
    from (
      select distinct split_part(btrim(pr.full_name), ' ', 1) as n
      from public.whatsapp_group_members m
      join public.whatsapp_identities i on i.id = m.identity_id and i.user_id is not null and i.verified_at is not null
      join public.profiles pr on pr.id = i.user_id
      where m.group_id = g.id and m.left_at is null and nullif(btrim(pr.full_name), '') is not null
      limit 6
    ) x;
  end if;

  return jsonb_build_object(
    'say_hello', true, 'account_name', v_name, 'language', v_language,
    'luks_users', coalesce(to_jsonb(v_usuarios), '[]'::jsonb)
  );
end;
$$;

-- ============================================================================
-- Permisos
-- ============================================================================

revoke execute on function public.identidad_verificada(public.whatsapp_identities) from public, anon, authenticated;
revoke execute on function public.wa_identidad(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.wa_identidad_en_fila() from public, anon, authenticated;
revoke execute on function public.whatsapp_connections_verifica() from public, anon, authenticated;
revoke execute on function public.wa_asociar(uuid, text) from public, anon, authenticated;
revoke execute on function public.connector_soy_yo(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.connector_verify_mint(uuid) from public, anon, authenticated;
revoke execute on function public.people_reclamo_verificado() from public, anon, authenticated;
revoke execute on function public.preview_whatsapp_verification(text) from public, anon;
revoke execute on function public.redeem_whatsapp_verification(text) from public, anon;
grant execute on function public.wa_identidad(text, text, text, text) to service_role;
grant execute on function public.connector_soy_yo(uuid, text, text, text, text) to service_role;
grant execute on function public.connector_verify_mint(uuid) to service_role;
grant execute on function public.preview_whatsapp_verification(text) to authenticated;
grant execute on function public.redeem_whatsapp_verification(text) to authenticated;
