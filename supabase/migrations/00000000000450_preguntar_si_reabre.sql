-- ============================================================================
-- Lucas · 00000000000450_preguntar_si_reabre.sql
-- Un paseo ya liquidado y al grupo llega otro gasto (Dani pagó algo más):
-- Mister Luks lo lee, lo deja en espera y pregunta en el grupo qué hacer.
--
--   «1» → reabre el paseo y lo suma (como la 390: lo que ya pagaron queda
--         como pagos hechos y cuenta en los saldos).
--   «2» → abre la cuenta siguiente («DaniChile 2», como hacía la 370: la misma
--         gente, sus categorías, lo que aprendió de los comercios) y lo anota
--         allá; el grupo pasa a la nueva y la liquidada queda como estaba.
--
-- Al anotarlo, si la cuenta trae varios ítems, sale sola la lista de «¿quién
-- pidió qué?» (la 440), y después se liquida otra vez como siempre.
--
--   · Solo lo que llega por el grupo y si Mister Luks está ahí para preguntar;
--     si no, se reabre solo como en la 390. Lo que se sube desde la app
--     también reabre solo (quien lo sube ya decidió).
--   · Una pregunta por liquidación: si llegan más gastos antes de que alguien
--     responda, esperan todos la misma respuesta.
--   · Si quien administra reabre la liquidación en la app, lo que esperaba
--     entra solo.
-- ============================================================================

-- Lo que llegó por el grupo a un paseo liquidado, con lo que leyó el worker
create table public.gastos_en_espera (
  message_id uuid primary key references public.messages (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_to uuid references public.accounts (id) on delete set null
);
create index gastos_en_espera_cuenta_idx on public.gastos_en_espera (account_id) where released_at is null;

-- La pregunta en el grupo, una por liquidación (la liquidación se borra al reabrir: sin referencia)
create table public.preguntas_reabrir (
  settlement_id uuid primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  group_id uuid not null references public.whatsapp_groups (id) on delete cascade,
  outbox_id uuid references public.whatsapp_outbox (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decision text check (decision in ('reabrir', 'nueva')),
  decided_by uuid references public.people (id) on delete set null
);

alter table public.gastos_en_espera enable row level security;
alter table public.gastos_en_espera force row level security;
revoke all on public.gastos_en_espera from anon, authenticated;
alter table public.preguntas_reabrir enable row level security;
alter table public.preguntas_reabrir force row level security;
revoke all on public.preguntas_reabrir from anon, authenticated;

-- «DaniChile» → «DaniChile 2» (o la 3, si la 2 ya existe)
create or replace function public.nombre_siguiente(p_account_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  v_base text;
  v_nombre text;
  n int := 2;
begin
  select * into a from public.accounts where id = p_account_id;
  v_base := left(coalesce(nullif(regexp_replace(btrim(a.name), '\s+\d{1,2}$', ''), ''), btrim(a.name)), 55);
  loop
    v_nombre := v_base || ' ' || n;
    exit when not exists (select 1 from public.accounts x where x.owner_id = a.owner_id and lower(x.name) = lower(v_nombre));
    n := n + 1;
  end loop;
  return v_nombre;
end;
$$;

-- ============================================================================
-- en_espera_si_liquidado: si el gasto llegó por el grupo a un paseo liquidado,
-- queda en espera y Mister Luks pregunta (una vez). true si quedó en espera.
-- ============================================================================

create or replace function public.en_espera_si_liquidado(p_message_id uuid, p_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  a public.accounts%rowtype;
  v_liquidacion uuid;
  v_grupo uuid;
  v_jid text;
  v_quien text;
  v_total bigint := greatest(coalesce((p_data ->> 'total_cop')::bigint, 0), 0);
  v_comercio text := left(coalesce(nullif(btrim(p_data ->> 'merchant'), ''), 'Gasto sin nombre'), 80);
  v_cuanto text;
  v_siguiente text;
  v_clave text;
begin
  select * into m from public.messages where id = p_message_id;
  if m.id is null or m.source <> 'whatsapp' then
    return false;
  end if;
  select * into a from public.accounts where id = m.account_id;
  if a.type <> 'evento' or a.status <> 'settling' then
    return false;
  end if;
  select s.id into v_liquidacion from public.settlements s where s.account_id = a.id and s.period is null;
  if v_liquidacion is null then
    return false;
  end if;
  -- Sin Mister Luks en el grupo no hay a quién preguntar: se reabre solo, como en la 390
  select g.id, g.wa_group_jid into v_grupo, v_jid
  from public.whatsapp_groups g
  where g.id = m.group_id and g.chat_kind = 'grupo' and g.left_at is null
    and exists (
      select 1 from public.whatsapp_group_sessions gs
      join public.whatsapp_connections c on c.id = gs.connection_id and c.kind = 'contador'
      where gs.group_id = g.id and gs.left_at is null
    );
  if v_grupo is null then
    return false;
  end if;

  insert into public.gastos_en_espera (message_id, account_id, data)
  values (m.id, a.id, p_data)
  on conflict (message_id) do update set data = excluded.data;

  if exists (select 1 from public.preguntas_reabrir q where q.settlement_id = v_liquidacion) then
    return true;
  end if;

  v_quien := split_part(btrim(coalesce((select p.display_name from public.people p where p.id = m.sender_person_id), '')), ' ', 1);
  v_cuanto := case when a.currency in ('COP', 'CLP') and v_total > 0 then ' · ' || public.format_cop(v_total) else '' end;
  v_siguiente := public.nombre_siguiente(a.id);
  v_clave := 'reabrir:' || v_liquidacion;
  perform public.connector_outbox_enqueue(jsonb_build_array(jsonb_build_object(
    'chat_jid', v_jid,
    'reason', 'answer',
    'group_id', v_grupo,
    'dedupe_key', v_clave,
    'body', case when a.language = 'en' then
      '🔒 “' || a.name || '” is already settled and ' || coalesce(nullif(v_quien, '') || ' sent', 'there’s') || ' a new expense: *'
        || v_comercio || '*' || v_cuanto || E'.\nWhat should I do? Reply to this message:\n'
        || '*1* · Reopen “' || a.name || E'” and add it (what you already paid stays logged)\n'
        || '*2* · Log it in a new account (“' || v_siguiente || E'”)\n\n📊 More detail at mrluks.com'
    else
      '🔒 «' || a.name || '» ya está liquidada y ' || coalesce(nullif(v_quien, '') || ' mandó', 'llegó') || ' un gasto nuevo: *'
        || v_comercio || '*' || v_cuanto || E'.\n¿Qué hago? Respondan este mensaje:\n'
        || '*1* · Reabrir «' || a.name || E'» y sumarlo (lo que ya pagaron queda anotado)\n'
        || '*2* · Anotarlo en una cuenta nueva («' || v_siguiente || E'»)\n\n📊 Más detalle en mrluks.com'
    end
  )));
  insert into public.preguntas_reabrir (settlement_id, account_id, group_id, outbox_id)
  values (v_liquidacion, a.id, v_grupo, (select o.id from public.whatsapp_outbox o where o.dedupe_key = v_clave))
  on conflict (settlement_id) do nothing;
  return true;
end;
$$;

-- ============================================================================
-- worker_save_expense: como en la 370, pero lo que llega por el grupo a un
-- paseo liquidado queda en espera (en_espera_si_liquidado)
-- ============================================================================

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

  -- Un paseo ya liquidado: lo que llega por el grupo espera a que digan si se reabre o va a una cuenta nueva
  if public.en_espera_si_liquidado(m.id, p_data) then
    update public.messages
    set status = 'done', processed_at = now(), extracted_text = left(p_data ->> 'extracted_text', 20000)
    where id = m.id;
    return jsonb_build_object('skipped', true, 'status', 'en_espera');
  end if;

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

-- ============================================================================
-- Lo que esperaba entra a la cuenta que digan (la misma reabierta o la nueva)
-- ============================================================================

-- Lo que leyó el worker, con las personas y la categoría de la otra cuenta (por su nombre)
create or replace function public.datos_en_otra_cuenta(p_data jsonb, p_destino uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (p_data - 'memory_id') || jsonb_build_object(
    'payer_person_id', (
      select np.id from public.people op
      join public.people np on np.account_id = p_destino and np.display_name = op.display_name
      where op.id = public.try_uuid(p_data ->> 'payer_person_id')
      order by np.created_at limit 1
    ),
    'category_id', (
      select nc.id from public.categories oc
      join public.categories nc on nc.account_id = p_destino and nc.name = oc.name
      where oc.id = public.try_uuid(p_data ->> 'category_id')
      limit 1
    ),
    'split_person_ids', coalesce((
      select jsonb_agg(np.id)
      from jsonb_array_elements_text(coalesce(p_data -> 'split_person_ids', '[]'::jsonb)) x (id)
      join public.people op on op.id = public.try_uuid(x.id)
      join public.people np on np.account_id = p_destino and np.display_name = op.display_name
    ), '[]'::jsonb)
  )
$$;

create or replace function public.soltar_gastos_en_espera(p_account_id uuid, p_destino uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.gastos_en_espera%rowtype;
  v_data jsonb;
  v_res jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  for r in
    select * from public.gastos_en_espera
    where account_id = p_account_id and released_at is null
    order by created_at
    for update
  loop
    v_data := r.data;
    if p_destino <> p_account_id then
      v_data := public.datos_en_otra_cuenta(r.data, p_destino);
      update public.messages set account_id = p_destino where id = r.message_id;
    end if;
    update public.messages set status = 'processing', processed_at = null where id = r.message_id;
    update public.gastos_en_espera set released_at = now(), released_to = p_destino where message_id = r.message_id;
    v_res := public.worker_save_expense(r.message_id, v_data);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'expense_id', v_res ->> 'expense_id',
      'duplicate_of', v_res ->> 'duplicate_of',
      'merchant', left(coalesce(nullif(btrim(v_data ->> 'merchant'), ''), 'Gasto sin nombre'), 80),
      'total', greatest(coalesce((v_data ->> 'total_cop')::bigint, 0), 0),
      'items', (select count(*) from public.expense_items i where i.expense_id = public.try_uuid(v_res ->> 'expense_id'))
    ));
  end loop;
  return v_out;
end;
$$;

-- ============================================================================
-- La cuenta siguiente («DaniChile 2»), como la de la 370: la misma gente (con
-- su rol), sus categorías y lo que aprendió de los comercios; el grupo pasa a
-- ella. Las preferencias de la anterior (avisos de cobro, a quién se paga) siguen.
-- ============================================================================

create or replace function public.abrir_cuenta_siguiente(p_group_id uuid, p_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  l public.account_group_links%rowtype;
  v_nueva uuid;
  p record;
  v_persona uuid;
begin
  perform 1 from public.whatsapp_groups where id = p_group_id for update;
  select * into l from public.account_group_links where group_id = p_group_id;
  select * into a from public.accounts where id = p_account_id;
  if a.id is null or a.status not in ('settling', 'closed') then
    return a.id;
  end if;

  insert into public.accounts (name, type, owner_id, starts_on, currency, language, previous_account_id,
                               continuation_announced_at, auto_cobros, settle_direct)
  values (public.nombre_siguiente(a.id), a.type, a.owner_id,
          case when a.type = 'evento' then (now() at time zone 'America/Bogota')::date end,
          a.currency, a.language, a.id, now(), a.auto_cobros, a.settle_direct)
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

  insert into public.account_optouts (account_id, identity_id)
  select v_nueva, o.identity_id from public.account_optouts o where o.account_id = a.id
  on conflict do nothing;

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

  -- El grupo pasa a la nueva: se anota desde ya
  if l.group_id is not null then
    update public.account_group_links
    set account_id = v_nueva, linked_by = a.owner_id, history = 'desde_ya', history_at = now(), ingest_from = now() - interval '1 minute'
    where group_id = p_group_id;
    perform public.sync_group_people(p_group_id);
    if exists (select 1 from public.whatsapp_group_members m where m.group_id = p_group_id and m.left_at is null) then
      update public.account_group_links set members_synced_at = now() where group_id = p_group_id;
    end if;
  end if;
  return v_nueva;
end;
$$;

-- ============================================================================
-- connector_decidir_liquidada: alguien del paseo respondió la pregunta
-- p_modo: 'reabrir' o 'nueva'. p_quoted_wa_id: el mensaje que citó (null si
-- respondió «1» o «2» a secas o le dijo «luks reabre»)
-- ============================================================================

create or replace function public.connector_decidir_liquidada(
  p_jid text,
  p_quoted_wa_id text,
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_name text,
  p_modo text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.preguntas_reabrir%rowtype;
  a public.accounts%rowtype;
  d public.accounts%rowtype;
  v_me uuid;
  v_destino uuid;
  v_gastos jsonb;
begin
  if p_modo is null or p_modo not in ('reabrir', 'nueva') then
    raise exception 'Responde reabrir o nueva';
  end if;
  select x.* into q
  from public.preguntas_reabrir x
  join public.whatsapp_groups g on g.id = x.group_id
  left join public.whatsapp_outbox o on o.id = x.outbox_id
  where g.wa_group_jid = p_jid and x.decided_at is null
    and (p_quoted_wa_id is null or o.wa_message_id = p_quoted_wa_id)
  order by x.created_at desc
  limit 1
  for update of x;
  if q.settlement_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_es_pregunta');
  end if;
  select * into a from public.accounts where id = q.account_id;
  perform public.wa_identidad(p_wa_id, p_phone, p_lid, p_name);
  v_me := coalesce(
    public.wa_person(a.id, p_wa_id),
    case when p_phone is not null then public.wa_person(a.id, p_phone) end,
    case when p_lid is not null then public.wa_person(a.id, 'lid:' || p_lid) end
  );
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'no_te_conozco', 'language', a.language, 'account_name', a.name);
  end if;
  if p_modo = 'reabrir' and a.status = 'closed' then
    return jsonb_build_object('ok', false, 'reason', 'cerrada', 'language', a.language, 'account_name', a.name);
  end if;

  if p_modo = 'reabrir' then
    -- Si ya la reabrieron en la app, solo entra lo que esperaba
    if a.status = 'settling' then
      perform public.reabrir_liquidacion(q.settlement_id);
    end if;
    v_destino := a.id;
  else
    v_destino := public.abrir_cuenta_siguiente(q.group_id, a.id);
  end if;
  v_gastos := public.soltar_gastos_en_espera(a.id, v_destino);
  update public.preguntas_reabrir set decided_at = now(), decision = p_modo, decided_by = v_me where settlement_id = q.settlement_id;
  select * into d from public.accounts where id = v_destino;

  return jsonb_build_object(
    'ok', true,
    'modo', p_modo,
    'language', d.language,
    'currency', d.currency,
    'name', (select p.display_name from public.people p where p.id = v_me),
    'cuenta', d.name,
    'anterior', a.name,
    'gastos', v_gastos
  );
end;
$$;

-- ============================================================================
-- Reabrir en la app (como en la 390): lo que esperaba en el grupo entra solo
-- ============================================================================

create or replace function public.reopen_settlement(p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.settlements%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into s from public.settlements where id = p_settlement_id;
  if not found or not public.has_account_role(s.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta pueden reabrir una liquidación';
  end if;
  if exists (select 1 from public.accounts a where a.id = s.account_id and a.status = 'closed') then
    raise exception 'La cuenta está cerrada: la liquidación ya no cambia';
  end if;
  perform public.reabrir_liquidacion(s.id);
  perform public.soltar_gastos_en_espera(s.account_id, s.account_id);
  update public.preguntas_reabrir set decided_at = now(), decision = 'reabrir' where settlement_id = s.id and decided_at is null;
end;
$$;

-- ============================================================================
-- Permisos: lo nuevo es interno; la respuesta, del connector
-- ============================================================================

revoke execute on function public.nombre_siguiente(uuid) from public, anon, authenticated;
revoke execute on function public.en_espera_si_liquidado(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.datos_en_otra_cuenta(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.soltar_gastos_en_espera(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.abrir_cuenta_siguiente(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.connector_decidir_liquidada(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.connector_decidir_liquidada(text, text, text, text, text, text, text) to service_role;
