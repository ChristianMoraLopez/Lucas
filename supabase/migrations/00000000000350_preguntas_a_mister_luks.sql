-- ============================================================================
-- Fase 7: preguntas a @mrluks
--
-- · connector_question: lo que hace falta para responder «cuánto llevamos»,
--   «quién le debe a quién», «cuánto debo» o «mis gastos». Los números salen
--   siempre de aquí (como el resumen y Liquidar de la app), nunca de Qwen.
-- · «¿Privado o aquí?»: lo personal se manda como cada quien prefiera
--   (whatsapp_answer_prefs, por número); la primera vez se pregunta, y la
--   pregunta queda esperando la respuesta 15 minutos.
-- · «no me cuentes»: desde ese momento no se anota lo que esa persona manda en
--   esa cuenta. Lo de antes (sus gastos y sus partes) queda igual. «luks
--   cuéntame» lo deshace.
-- · Las respuestas de Mister Luks firman «Más detalle en mrluks.com»: con eso
--   no se anotan como gastos (es_mensaje_de_luks, como en el connector y el worker).
-- ============================================================================

-- ---------- «¿Privado o aquí?» ----------
create table public.whatsapp_answer_prefs (
  identity_id uuid primary key references public.whatsapp_identities (id) on delete cascade,
  mode text check (mode in ('privado', 'aqui')),
  -- Lo personal que preguntó y espera «privado» o «aquí»
  pending_intent text check (pending_intent in ('mi_saldo', 'mis_gastos')),
  pending_group_id uuid references public.whatsapp_groups (id) on delete set null,
  pending_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_answer_prefs enable row level security;
alter table public.whatsapp_answer_prefs force row level security;
revoke all on public.whatsapp_answer_prefs from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_answer_prefs to service_role;

-- ---------- «No me cuentes» ----------
create table public.account_optouts (
  account_id uuid not null references public.accounts (id) on delete cascade,
  identity_id uuid not null references public.whatsapp_identities (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, identity_id)
);
create index account_optouts_identidad_idx on public.account_optouts (identity_id);

alter table public.account_optouts enable row level security;
alter table public.account_optouts force row level security;
revoke all on public.account_optouts from anon, authenticated;
grant select, insert, update, delete on public.account_optouts to service_role;

-- ---------- Las respuestas van por la bandeja de salida ----------
alter table public.whatsapp_outbox drop constraint whatsapp_outbox_reason_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_reason_check
  check (reason in ('welcome', 'group_hello', 'guide', 'invite', 'link', 'verify', 'soy_yo', 'history', 'import', 'answer'));

-- ---------- Lo que escribe Luks no es un gasto (como en la 340) ----------
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
$$;

-- ---------- ¿Esta persona pidió que no la contaran en esta cuenta? ----------
create or replace function public.no_lo_cuentes(p_account_id uuid, p_wa_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_optouts o
    join public.whatsapp_identities i on i.id = o.identity_id
    where o.account_id = p_account_id
      and (i.phone = p_wa_id or 'lid:' || i.lid = p_wa_id)
  )
$$;

-- Como connector_should_ingest (la 340), y además lo de quien dijo «no me cuentes»
-- (se revisa antes de bajar la foto o el PDF: de esa persona ya no se guarda nada)
create or replace function public.connector_should_ingest_sender(
  p_jid text,
  p_wa_message_id text,
  p_sent_at timestamptz,
  p_sender_wa_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := public.connector_should_ingest(p_jid, p_wa_message_id, p_sent_at);
begin
  if (v ->> 'ingest')::boolean and p_sender_wa_id is not null
     and public.no_lo_cuentes((v ->> 'account_id')::uuid, p_sender_wa_id) then
    return jsonb_build_object('ingest', false, 'reason', 'no_me_cuentes', 'account_id', v ->> 'account_id');
  end if;
  return v;
end;
$$;

-- ---------- Lo que hace falta para responder ----------
-- Del período que se ve en la app: el mes en curso en un hogar, todo en un
-- evento. «people» y las transferencias calculadas salen de los gastos
-- completos (con quién pagó y bien divididos), como en Liquidar; si el período
-- ya se liquidó, las transferencias son las de la liquidación.
create or replace function public.connector_question(
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
  v_pref text;
  v_contador boolean;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_mes date;
  v_desde date;
  v_hasta date;
  v_person uuid;
  s public.settlements%rowtype;
  v_base jsonb;
begin
  select * into g from public.whatsapp_groups where wa_group_jid = p_jid and chat_kind = 'grupo';
  if g.id is null then
    return jsonb_build_object('ok', false, 'reason', 'sin_grupo');
  end if;
  v_ident := public.wa_identidad(p_wa_id, p_phone, p_lid, p_name);
  select x.mode into v_pref from public.whatsapp_answer_prefs x where x.identity_id = v_ident;
  v_contador := exists (
    select 1 from public.whatsapp_group_sessions s2
    join public.whatsapp_connections c on c.id = s2.connection_id
    where s2.group_id = g.id and s2.left_at is null and c.kind = 'contador'
  );
  v_base := jsonb_build_object('identity_id', v_ident, 'pref', v_pref, 'contador_en_grupo', v_contador);

  select a2.* into a
  from public.account_group_links l join public.accounts a2 on a2.id = l.account_id
  where l.group_id = g.id;
  if a.id is null then
    return v_base || jsonb_build_object('ok', false, 'reason', 'sin_cuenta');
  end if;

  if a.type = 'hogar' then
    v_mes := date_trunc('month', v_hoy)::date;
    v_desde := v_mes;
    v_hasta := (v_mes + interval '1 month')::date;
  else
    v_desde := '0001-01-01';
    v_hasta := '9999-12-31';
  end if;
  select * into s from public.settlements x where x.account_id = a.id and x.period is not distinct from v_mes;
  v_person := coalesce(
    public.wa_person(a.id, p_wa_id),
    case when p_phone is not null then public.wa_person(a.id, p_phone) end,
    case when p_lid is not null then public.wa_person(a.id, 'lid:' || p_lid) end
  );

  return v_base || jsonb_build_object(
    'ok', true,
    'account', jsonb_build_object(
      'name', a.name, 'type', a.type, 'status', a.status, 'currency', a.currency, 'language', a.language, 'month', v_mes
    ),
    'optout', public.no_lo_cuentes(a.id, p_wa_id),
    'total', (
      select coalesce(sum(e.total_cop), 0) from public.expenses e
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
    ),
    'count', (
      select count(*) from public.expenses e
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
    ),
    'pending', (
      select count(*) from public.expenses e
      where e.account_id = a.id and e.status = 'pending_review' and e.expense_date >= v_desde and e.expense_date < v_hasta
    ),
    'incomplete', (
      select count(*) from public.expenses e
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
        and (e.payer_person_id is null
             or e.total_cop <> (select coalesce(sum(x.amount_cop), 0) from public.expense_splits x where x.expense_id = e.id))
    ),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'paid', b.paid, 'share', b.share, 'balance', b.paid - b.share)
                       order by b.paid - b.share desc, p.display_name)
      from public.period_balances(a.id, v_mes) b
      join public.people p on p.id = b.person_id
      where b.paid <> 0 or b.share <> 0
    ), '[]'::jsonb),
    'settlement', case when s.id is null then null else coalesce((
      select jsonb_agg(jsonb_build_object(
        'from', pf.display_name, 'to', pt.display_name, 'amount', t.amount_cop, 'paid', t.paid_at is not null,
        'from_id', t.from_person_id, 'to_id', t.to_person_id
      ) order by t.position)
      from public.settlement_transfers t
      join public.people pf on pf.id = t.from_person_id
      join public.people pt on pt.id = t.to_person_id
      where t.settlement_id = s.id
    ), '[]'::jsonb) end,
    'me', case when v_person is null then null else (
      select jsonb_build_object(
        'id', p.id,
        'name', p.display_name,
        'expenses', coalesce((
          select jsonb_agg(jsonb_build_object('merchant', x.merchant, 'total', x.total_cop, 'date', x.expense_date) order by x.expense_date desc, x.created_at desc)
          from (
            select e.merchant, e.total_cop, e.expense_date, e.created_at
            from public.expenses e
            where e.account_id = a.id and e.payer_person_id = p.id and e.expense_date >= v_desde and e.expense_date < v_hasta
            order by e.expense_date desc, e.created_at desc
            limit 5
          ) x
        ), '[]'::jsonb),
        'paid_total', (
          select coalesce(sum(e.total_cop), 0) from public.expenses e
          where e.account_id = a.id and e.payer_person_id = p.id and e.expense_date >= v_desde and e.expense_date < v_hasta
        ),
        'paid_count', (
          select count(*) from public.expenses e
          where e.account_id = a.id and e.payer_person_id = p.id and e.expense_date >= v_desde and e.expense_date < v_hasta
        )
      )
      from public.people p where p.id = v_person
    ) end
  );
end;
$$;

-- «privado» o «aquí»: guarda cómo quiere recibir lo suyo. Con p_only_pending
-- (respondió solo «privado» o «aquí», sin hablarle a Luks) cuenta solo si en
-- ese grupo había una pregunta suya esperando (de los últimos 15 minutos).
-- Devuelve la pregunta que esperaba, para responderla ya.
create or replace function public.connector_answer_pref(
  p_jid text,
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_name text,
  p_mode text,
  p_only_pending boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ident uuid;
  x public.whatsapp_answer_prefs%rowtype;
  v_group uuid;
  v_espera boolean;
begin
  if p_mode not in ('privado', 'aqui') then
    raise exception 'Modo desconocido: %', p_mode;
  end if;
  v_ident := public.wa_identidad(p_wa_id, p_phone, p_lid, p_name);
  select id into v_group from public.whatsapp_groups where wa_group_jid = p_jid;
  select * into x from public.whatsapp_answer_prefs where identity_id = v_ident for update;
  v_espera := coalesce(x.pending_intent is not null and x.pending_group_id = v_group and x.pending_at > now() - interval '15 minutes', false);
  if p_only_pending and not v_espera then
    return jsonb_build_object('changed', false);
  end if;
  insert into public.whatsapp_answer_prefs as w (identity_id, mode, updated_at)
  values (v_ident, p_mode, now())
  on conflict (identity_id) do update
    set mode = excluded.mode, pending_intent = null, pending_group_id = null, pending_at = null, updated_at = now();
  return jsonb_build_object('changed', true, 'mode', p_mode, 'pending_intent', case when v_espera then x.pending_intent end);
end;
$$;

-- Preguntó algo suyo sin haber dicho cómo lo quiere: queda esperando «privado» o «aquí»
create or replace function public.connector_ask_answer_pref(p_jid text, p_identity_id uuid, p_intent text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.whatsapp_answer_prefs as w (identity_id, pending_intent, pending_group_id, pending_at)
  values (p_identity_id, p_intent, (select id from public.whatsapp_groups where wa_group_jid = p_jid), now())
  on conflict (identity_id) do update
    set pending_intent = excluded.pending_intent, pending_group_id = excluded.pending_group_id, pending_at = now(), updated_at = now();
end;
$$;

-- «no me cuentes» (p_on) o «cuéntame»: en la cuenta del grupo
create or replace function public.connector_optout(
  p_jid text,
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_name text,
  p_on boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ident uuid;
  v_account uuid;
  v_nombre text;
  v_language text;
  v_n int;
begin
  select l.account_id, a.name, a.language into v_account, v_nombre, v_language
  from public.whatsapp_groups g
  join public.account_group_links l on l.group_id = g.id
  join public.accounts a on a.id = l.account_id
  where g.wa_group_jid = p_jid;
  if v_account is null then
    return jsonb_build_object('changed', false, 'reason', 'sin_cuenta');
  end if;
  v_ident := public.wa_identidad(p_wa_id, p_phone, p_lid, p_name);
  if p_on then
    insert into public.account_optouts (account_id, identity_id) values (v_account, v_ident)
    on conflict (account_id, identity_id) do nothing;
  else
    delete from public.account_optouts where account_id = v_account and identity_id = v_ident;
  end if;
  get diagnostics v_n = row_count;
  return jsonb_build_object('changed', v_n > 0, 'account_name', v_nombre, 'language', v_language);
end;
$$;

-- Un grupo leído solo por un WhatsApp vinculado: Mister Luks le responde por
-- privado a quien le preguntó (le habló a Luks). Abre ese chat si Mister Luks
-- existe; si no, no hay a dónde responder.
create or replace function public.connector_open_private_answer(p_jid text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contador uuid;
begin
  select c.id into v_contador from public.whatsapp_connections c where c.kind = 'contador' and c.status = 'connected';
  if v_contador is null then
    return false;
  end if;
  perform public.connector_private_chat(v_contador, p_jid);
  return true;
end;
$$;

-- ---------- Permisos ----------
revoke execute on function public.no_lo_cuentes(uuid, text) from public, anon, authenticated;
revoke execute on function public.connector_should_ingest_sender(text, text, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.connector_question(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.connector_answer_pref(text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.connector_ask_answer_pref(text, uuid, text) from public, anon, authenticated;
revoke execute on function public.connector_optout(text, text, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.connector_open_private_answer(text) from public, anon, authenticated;

grant execute on function public.connector_should_ingest_sender(text, text, timestamptz, text) to service_role;
grant execute on function public.connector_question(text, text, text, text, text) to service_role;
grant execute on function public.connector_answer_pref(text, text, text, text, text, text, boolean) to service_role;
grant execute on function public.connector_ask_answer_pref(text, uuid, text) to service_role;
grant execute on function public.connector_optout(text, text, text, text, text, boolean) to service_role;
grant execute on function public.connector_open_private_answer(text) to service_role;
