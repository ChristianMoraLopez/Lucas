-- ============================================================================
-- Lucas · 00000000000710_chepito.sql
-- Chepito: a veces el problema no es repartir los gastos sino cobrarlos.
-- Desde la app (una cuenta de tipo cobro) o por privado a Mister Luks («Juan
-- me debe 50 mil por la boleta» y su contacto), alguien dice quién le debe,
-- su WhatsApp, cuánto y por qué. Mister Luks le escribe a esa persona, se
-- presenta, le dice de parte de quién, cuánto y por qué (y cómo pagarle, si
-- quien cobra lo puso en su perfil) y se lo recuerda cada 2 días, como mucho
-- 4 veces.
--
--   · Quien debe responde «ya pagué» (queda pagado y se le avisa a quien
--     cobra), «no le debo» (se deja de cobrar y se le avisa) o «no me
--     escribas» (nunca más le llega un cobro, de nadie).
--   · Topes para no volverse spam: 10 cobros abiertos por usuario, 3 a un
--     mismo número (de cualquiera) y 25 números nuevos al día en total.
--   · Los horarios (lunes a viernes de 8 a. m. a 7 p. m., sábados hasta las 3
--     p. m., ni domingos ni festivos, hora de Colombia) los cuida el
--     connector, que es el que sabe qué hora es en Colombia y qué días son
--     festivos (la Ley 2300 de 2023, «Dejen de fregar»).
--   · Lo ven quienes son de la cuenta. Las cuentas de cobro no salen en lo
--     que Mister Luks hace por privado con las demás cuentas (personas_de_wa).
-- ============================================================================

create table public.cobros (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  -- Quien cobra (su persona en la cuenta) y a quién le cobra
  acreedor_person_id uuid not null references public.people (id) on delete cascade,
  deudor_person_id uuid not null references public.people (id) on delete cascade,
  -- El WhatsApp de quien debe: E.164 sin «+» (573001234567)
  telefono text not null check (telefono ~ '^[0-9]{8,15}$'),
  -- En la moneda de la cuenta, como los gastos (centavos si la moneda los tiene)
  monto bigint not null check (monto > 0),
  concepto text not null check (length(btrim(concepto)) between 2 and 120),
  origen text not null check (origen in ('web', 'whatsapp')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Los avisos: el primero no antes de avisar_desde, después cada 2 días, como mucho 4
  avisar_desde timestamptz not null default now(),
  avisos int not null default 0 check (avisos between 0 and 4),
  primer_aviso_at timestamptz,
  avisado_at timestamptz,
  -- Cómo terminó: pagado (lo marcó quien cobra o dijo «ya pagué» quien debe), «no le debo» o detenido
  pagado_at timestamptz,
  pagado_por text check (pagado_por in ('acreedor', 'deudor')),
  no_debe_at timestamptz,
  detenido_at timestamptz,
  detenido_por text check (detenido_por in ('acreedor', 'no_me_escribas'))
);
create index cobros_cuenta_idx on public.cobros (account_id, created_at desc);
create index cobros_abiertos_idx on public.cobros (telefono)
  where pagado_at is null and no_debe_at is null and detenido_at is null;

-- Quien dijo «no me escribas»: nunca más le llega un cobro, de nadie
create table public.cobros_no_escribir (
  telefono text primary key check (telefono ~ '^[0-9]{8,15}$'),
  created_at timestamptz not null default now()
);

alter table public.cobros enable row level security;
alter table public.cobros_no_escribir enable row level security;
alter table public.cobros_no_escribir force row level security;
create policy cobros_select on public.cobros for select to authenticated using (public.is_account_member(account_id));
revoke insert, update, delete on public.cobros from anon, authenticated;
revoke all on public.cobros_no_escribir from anon, authenticated;
grant select on public.cobros to authenticated;
grant select, insert, update, delete on public.cobros, public.cobros_no_escribir to service_role;

-- ¿Sigue cobrando? (ni pagado, ni «no le debo», ni detenido, ni con los 4 avisos ya mandados)
create or replace function public.cobro_abierto(c public.cobros)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select c.pagado_at is null and c.no_debe_at is null and c.detenido_at is null and c.avisos < 4
$$;

-- «300 123 4567» (celular de Colombia sin indicativo) → 573001234567; «+56 9 …» → 569…; o null
create or replace function public.telefono_de_cobro(p_telefono text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when d ~ '^3[0-9]{9}$' then '57' || d
    when d ~ '^[0-9]{8,15}$' then d
  end
  from (select regexp_replace(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), '^00', '') as d) x
$$;

-- ============================================================================
-- Un cobro nuevo (desde la app o desde WhatsApp): quien debe queda como una persona de la cuenta
-- ============================================================================

create or replace function public.cobro_nuevo(
  p_account_id uuid,
  p_user_id uuid,
  p_nombre text,
  p_telefono text,
  p_monto bigint,
  p_concepto text,
  p_origen text,
  p_avisar_desde timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  v_tel text := public.telefono_de_cobro(p_telefono);
  v_nombre text := left(btrim(regexp_replace(coalesce(p_nombre, ''), '[*_~`]', '', 'g')), 40);
  v_concepto text := left(btrim(regexp_replace(coalesce(p_concepto, ''), '[*_~`]', '', 'g')), 120);
  v_acreedor uuid;
  v_deudor uuid;
  v_id uuid;
begin
  select * into a from public.accounts where id = p_account_id;
  if a.id is null or a.type <> 'cobro' then
    return jsonb_build_object('ok', false, 'reason', 'no_es_cobro');
  end if;
  if a.status = 'closed' then
    return jsonb_build_object('ok', false, 'reason', 'cerrada');
  end if;
  select p.id into v_acreedor from public.people p where p.account_id = a.id and p.claimed_by = p_user_id;
  if v_acreedor is null then
    return jsonb_build_object('ok', false, 'reason', 'no_es_de_la_cuenta');
  end if;
  if v_nombre = '' then
    return jsonb_build_object('ok', false, 'reason', 'nombre');
  end if;
  if v_tel is null then
    return jsonb_build_object('ok', false, 'reason', 'telefono');
  end if;
  if p_monto is null or p_monto <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'monto');
  end if;
  if length(v_concepto) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'concepto');
  end if;
  -- A sí mismo no
  if exists (select 1 from public.whatsapp_identities i where i.user_id = p_user_id and i.phone = v_tel) then
    return jsonb_build_object('ok', false, 'reason', 'es_tu_numero');
  end if;
  -- Pidió que no le escribieran
  if exists (select 1 from public.cobros_no_escribir n where n.telefono = v_tel) then
    return jsonb_build_object('ok', false, 'reason', 'no_quiere');
  end if;
  -- Ya le está cobrando en esta cuenta
  if exists (select 1 from public.cobros c where c.account_id = a.id and c.telefono = v_tel and public.cobro_abierto(c)) then
    return jsonb_build_object('ok', false, 'reason', 'ya_le_cobras');
  end if;
  -- Topes: 10 cobros abiertos por usuario y 3 a un mismo número
  if (select count(*) from public.cobros c where c.created_by = p_user_id and public.cobro_abierto(c)) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'tope');
  end if;
  if (select count(*) from public.cobros c where c.telefono = v_tel and public.cobro_abierto(c)) >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'tope_numero');
  end if;

  insert into public.people (account_id, display_name) values (a.id, v_nombre) returning id into v_deudor;
  insert into public.cobros (account_id, acreedor_person_id, deudor_person_id, telefono, monto, concepto, origen, created_by, avisar_desde)
  values (a.id, v_acreedor, v_deudor, v_tel, p_monto, v_concepto, p_origen, p_user_id, coalesce(p_avisar_desde, now()))
  returning id into v_id;
  return jsonb_build_object(
    'ok', true, 'cobro_id', v_id, 'account_id', a.id, 'account_name', a.name, 'nombre', v_nombre, 'telefono', v_tel,
    'monto', p_monto, 'currency', a.currency, 'language', a.language, 'concepto', v_concepto, 'pago', public.pago_de_usuario(p_user_id)
  );
end;
$$;

-- Lo que la app muestra cuando no se pudo
create or replace function public.cobro_error(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_reason
    when 'no_es_cobro' then 'Esa cuenta no es de cobro'
    when 'cerrada' then 'Esa cuenta está cerrada'
    when 'no_es_de_la_cuenta' then 'No eres de esa cuenta'
    when 'nombre' then 'Escribe a quién le cobras'
    when 'telefono' then 'Revisa el WhatsApp: con el indicativo del país, por ejemplo +57 300 123 4567'
    when 'monto' then 'Escribe cuánto te debe'
    when 'concepto' then 'Escribe por qué te debe'
    when 'es_tu_numero' then 'Ese WhatsApp es el tuyo'
    when 'no_quiere' then 'Esa persona le pidió a Mister Luks que no le escriba más'
    when 'ya_le_cobras' then 'Ya le estás cobrando a ese número en esta cuenta'
    when 'tope' then 'Tienes 10 cobros abiertos: cierra alguno antes de crear otro'
    when 'tope_numero' then 'A ese número ya le están cobrando varias personas'
    else 'No se pudo crear el cobro'
  end
$$;

-- Desde la app: quien administra la cuenta de cobro (los cuatro datos son obligatorios)
create or replace function public.crear_cobro(p_account_id uuid, p_nombre text, p_telefono text, p_monto bigint, p_concepto text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta pueden cobrar';
  end if;
  r := public.cobro_nuevo(p_account_id, auth.uid(), p_nombre, p_telefono, p_monto, p_concepto, 'web');
  if not (r ->> 'ok')::boolean then
    raise exception '%', public.cobro_error(r ->> 'reason');
  end if;
  return (r ->> 'cobro_id')::uuid;
end;
$$;

-- Desde la app: «ya me pagó» o «deja de cobrarle»
create or replace function public.marcar_cobro(p_cobro_id uuid, p_que text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.cobros%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into c from public.cobros where id = p_cobro_id for update;
  if c.id is null or not public.has_account_role(c.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Ese cobro no existe';
  end if;
  if p_que = 'pagado' then
    update public.cobros set pagado_at = coalesce(pagado_at, now()), pagado_por = coalesce(pagado_por, 'acreedor') where id = c.id;
  elsif p_que = 'detener' then
    update public.cobros set detenido_at = coalesce(detenido_at, now()), detenido_por = coalesce(detenido_por, 'acreedor') where id = c.id;
  else
    raise exception 'No sé qué hacer con ese cobro';
  end if;
end;
$$;

-- ============================================================================
-- Desde WhatsApp: el cobro va a su cuenta de cobro (o a «Mis cobros», que se abre la primera vez)
-- ============================================================================

create or replace function public.connector_chepito_crear(
  p_chat_jid text,
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_nombre text,
  p_telefono text,
  p_monto bigint,
  p_concepto text,
  p_avisar_en_min int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.whatsapp_identities%rowtype;
  v_cuenta uuid;
  v_persona uuid;
  v_nueva boolean := false;
  v_idioma text := case when coalesce(p_phone, '') like '1%' then 'en' else 'es' end;
  r jsonb;
begin
  if public.chat_privado_con_luks(p_chat_jid) is null then
    return jsonb_build_object('ok', false, 'reason', 'sin_chat');
  end if;
  select * into i from public.whatsapp_identities where id = public.wa_identidad(p_wa_id, p_phone, p_lid, null);
  if i.user_id is null or i.verified_at is null then
    return jsonb_build_object('ok', false, 'reason', 'sin_sesion');
  end if;

  select a.id into v_cuenta
  from public.accounts a
  join public.account_members am on am.account_id = a.id and am.user_id = i.user_id and am.role in ('owner', 'admin') and am.archived_at is null
  where a.type = 'cobro' and a.status <> 'closed'
  order by a.created_at
  limit 1;
  if v_cuenta is null then
    insert into public.accounts (name, type, owner_id, language)
    values (case when v_idioma = 'en' then 'My collections' else 'Mis cobros' end, 'cobro', i.user_id, v_idioma)
    returning id into v_cuenta;
    insert into public.people (account_id, display_name, claimed_by)
    values (
      v_cuenta,
      left(coalesce(nullif(btrim((select pf.full_name from public.profiles pf where pf.id = i.user_id)), ''), 'Yo'), 40),
      i.user_id
    )
    returning id into v_persona;
    insert into public.account_members (account_id, user_id, role, person_id) values (v_cuenta, i.user_id, 'owner', v_persona);
    v_nueva := true;
  end if;

  r := public.cobro_nuevo(v_cuenta, i.user_id, p_nombre, p_telefono, p_monto, p_concepto, 'whatsapp',
                          now() + make_interval(mins => greatest(coalesce(p_avisar_en_min, 0), 0)));
  return r || jsonb_build_object('nueva_cuenta', v_nueva);
end;
$$;

-- Cómo le pagan, desde WhatsApp: lo que diga se suma a lo que ya tenía en el perfil (como set_como_me_pagan)
create or replace function public.connector_chepito_como_me_pagan(
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_llave text,
  p_nequi text,
  p_daviplata text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.whatsapp_identities%rowtype;
  pf public.profiles%rowtype;
  v_llave text := nullif(regexp_replace(coalesce(p_llave, ''), '\s+', '', 'g'), '');
  v_nequi text := nullif(regexp_replace(coalesce(p_nequi, ''), '\D', '', 'g'), '');
  v_daviplata text := nullif(regexp_replace(coalesce(p_daviplata, ''), '\D', '', 'g'), '');
begin
  select * into i from public.whatsapp_identities where id = public.wa_identidad(p_wa_id, p_phone, p_lid, null);
  if i.user_id is null or i.verified_at is null then
    return jsonb_build_object('ok', false, 'reason', 'sin_sesion');
  end if;
  if v_nequi ~ '^573[0-9]{9}$' then v_nequi := substr(v_nequi, 3); end if;
  if v_daviplata ~ '^573[0-9]{9}$' then v_daviplata := substr(v_daviplata, 3); end if;
  if (v_nequi is not null and v_nequi !~ '^3[0-9]{9}$') or (v_daviplata is not null and v_daviplata !~ '^3[0-9]{9}$')
     or (v_llave is not null and v_llave !~ '^[A-Za-z0-9@._+-]{3,60}$') then
    return jsonb_build_object('ok', false, 'reason', 'no_valido');
  end if;
  select * into pf from public.profiles where id = i.user_id for update;
  update public.profiles
  set pago_llave = coalesce(v_llave, pf.pago_llave),
      pago_nequi = coalesce(v_nequi, pf.pago_nequi),
      pago_daviplata = coalesce(v_daviplata, pf.pago_daviplata),
      updated_at = now()
  where id = i.user_id;
  return jsonb_build_object('ok', true, 'pago', public.pago_de_usuario(i.user_id));
end;
$$;

-- ============================================================================
-- Los avisos: los que tocan (el connector mira la hora), y cada uno sale por la bandeja de salida
-- ============================================================================

create or replace function public.connector_chepito_pendientes(p_limit int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Números nuevos al día, en total: el resto espera a mañana
  v_cupo int := greatest(0, 25 - (select count(*) from public.cobros c where c.primer_aviso_at > now() - interval '1 day'));
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'cobro_id', x.id,
      'avisos', x.avisos,
      'telefono', x.telefono,
      'deudor', (select p.display_name from public.people p where p.id = x.deudor_person_id),
      'acreedor', (select p.display_name from public.people p where p.id = x.acreedor_person_id),
      'monto', x.monto,
      'concepto', x.concepto,
      'currency', a.currency,
      'language', a.language,
      'pago', public.pago_de_usuario((select p.claimed_by from public.people p where p.id = x.acreedor_person_id))
    ) order by x.avisos desc, x.created_at)
    from (
      (
        select c.* from public.cobros c
        where public.cobro_abierto(c) and c.avisos > 0
          and c.avisado_at < now() - interval '2 days' + interval '30 minutes'
          and not exists (select 1 from public.cobros_no_escribir n where n.telefono = c.telefono)
        order by c.avisado_at
        limit greatest(coalesce(p_limit, 20), 1)
      )
      union all
      (
        select c.* from public.cobros c
        where public.cobro_abierto(c) and c.avisos = 0 and c.avisar_desde <= now()
          and not exists (select 1 from public.cobros_no_escribir n where n.telefono = c.telefono)
        order by c.created_at
        limit least(v_cupo, greatest(coalesce(p_limit, 20), 1))
      )
    ) x
    join public.accounts a on a.id = x.account_id
    where a.status <> 'closed'
  ), '[]'::jsonb);
end;
$$;

-- Manda el aviso número avisos + 1 (si todavía toca) y lo cuenta; false si ya no tocaba
create or replace function public.connector_chepito_avisar(p_cobro_id uuid, p_avisos int, p_body text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.cobros%rowtype;
begin
  select * into c from public.cobros where id = p_cobro_id for update;
  if c.id is null or not public.cobro_abierto(c) or c.avisos <> p_avisos or nullif(btrim(p_body), '') is null
     or exists (select 1 from public.cobros_no_escribir n where n.telefono = c.telefono)
     or (c.avisos = 0 and c.avisar_desde > now())
     or (c.avisos > 0 and c.avisado_at >= now() - interval '2 days' + interval '30 minutes') then
    return false;
  end if;
  insert into public.whatsapp_outbox (chat_jid, reason, body, dedupe_key)
  values (c.telefono || '@s.whatsapp.net', 'answer', left(p_body, 4000), 'chepito:' || c.id || ':' || (c.avisos + 1))
  on conflict (dedupe_key) do nothing;
  update public.cobros
  set avisos = avisos + 1, avisado_at = now(), primer_aviso_at = coalesce(primer_aviso_at, now())
  where id = c.id;
  return true;
end;
$$;

-- ============================================================================
-- Lo que responde quien debe: «ya pagué», «no le debo» o «no me escribas»
-- ============================================================================

-- Sus números: el que se ve, el de su LID (si ya se sabe) y el del chat
create or replace function public.telefonos_de_wa(p_wa_id text, p_phone text, p_lid text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct t) filter (where t is not null), '{}')
  from (
    select case when p_phone ~ '^[0-9]{8,15}$' then p_phone end as t
    union all select case when p_wa_id ~ '^[0-9]{8,15}$' then p_wa_id end
    union all select i.phone from public.whatsapp_identities i
      where i.phone is not null and p_lid ~ '^[0-9]{6,30}$' and i.lid = p_lid
    union all select i.phone from public.whatsapp_identities i
      where i.phone is not null and p_wa_id ~ '^lid:[0-9]{6,30}$' and 'lid:' || i.lid = p_wa_id
  ) x
$$;

-- Lo marca en todos sus cobros que siguen abiertos y dice a quién avisarle (su chat con Mister Luks, si tiene)
create or replace function public.connector_chepito_respuesta(p_wa_id text, p_phone text, p_lid text, p_que text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tels text[] := public.telefonos_de_wa(p_wa_id, p_phone, p_lid);
  v_ids uuid[];
begin
  if p_que not in ('pagado', 'no_debe', 'no_escribas') then
    raise exception 'Respuesta desconocida: %', p_que;
  end if;
  if p_que = 'no_escribas' then
    insert into public.cobros_no_escribir (telefono) select unnest(v_tels) on conflict do nothing;
  end if;
  select coalesce(array_agg(c.id), '{}') into v_ids
  from public.cobros c
  where c.telefono = any (v_tels) and c.pagado_at is null and c.no_debe_at is null and c.detenido_at is null
    and (c.avisos > 0 or p_que = 'no_escribas');
  if p_que = 'pagado' then
    update public.cobros set pagado_at = now(), pagado_por = 'deudor' where id = any (v_ids);
  elsif p_que = 'no_debe' then
    update public.cobros set no_debe_at = now() where id = any (v_ids);
  else
    update public.cobros set detenido_at = now(), detenido_por = 'no_me_escribas' where id = any (v_ids);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'cobro_id', c.id,
      'account_id', c.account_id,
      'deudor', d.display_name,
      'acreedor', ac.display_name,
      'monto', c.monto,
      'concepto', c.concepto,
      'currency', a.currency,
      'language', a.language,
      'avisos', c.avisos,
      -- El chat de quien cobra con Mister Luks (si le ha escrito): ahí le avisa
      'acreedor_chat', (
        select g.wa_group_jid
        from public.whatsapp_identities i
        join public.whatsapp_groups g on g.chat_kind = 'privado' and g.left_at is null
          and (g.wa_group_jid = i.phone || '@s.whatsapp.net' or g.wa_group_jid = i.lid || '@lid')
        where i.user_id = ac.claimed_by and i.verified_at is not null
        order by g.last_message_at desc nulls last
        limit 1
      )
    ) order by c.created_at)
    from public.cobros c
    join public.accounts a on a.id = c.account_id
    join public.people d on d.id = c.deudor_person_id
    join public.people ac on ac.id = c.acreedor_person_id
    where c.id = any (v_ids)
  ), '[]'::jsonb);
end;
$$;

-- ============================================================================
-- Las cuentas de cobro no son de lo que Mister Luks hace por privado con las demás (como en la 420)
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
  join public.accounts a on a.id = p.account_id
  where w.wa_id in (select x from ids)
    and a.type <> 'cobro'
$$;

revoke execute on function public.cobro_nuevo(uuid, uuid, text, text, bigint, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.crear_cobro(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.crear_cobro(uuid, text, text, bigint, text) to authenticated;
revoke execute on function public.marcar_cobro(uuid, text) from public, anon;
grant execute on function public.marcar_cobro(uuid, text) to authenticated;
revoke execute on function public.telefonos_de_wa(text, text, text) from public, anon, authenticated;
revoke execute on function public.connector_chepito_crear(text, text, text, text, text, text, bigint, text, int) from public, anon, authenticated;
grant execute on function public.connector_chepito_crear(text, text, text, text, text, text, bigint, text, int) to service_role;
revoke execute on function public.connector_chepito_como_me_pagan(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.connector_chepito_como_me_pagan(text, text, text, text, text, text) to service_role;
revoke execute on function public.connector_chepito_pendientes(int) from public, anon, authenticated;
grant execute on function public.connector_chepito_pendientes(int) to service_role;
revoke execute on function public.connector_chepito_avisar(uuid, int, text) from public, anon, authenticated;
grant execute on function public.connector_chepito_avisar(uuid, int, text) to service_role;
revoke execute on function public.connector_chepito_respuesta(text, text, text, text) from public, anon, authenticated;
grant execute on function public.connector_chepito_respuesta(text, text, text, text) to service_role;
