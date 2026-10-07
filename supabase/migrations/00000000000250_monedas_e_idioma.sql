-- ============================================================================
-- 250 · Monedas e idioma de cada cuenta
--
-- Luks ya no es solo para Colombia: una cuenta lleva sus gastos en pesos
-- colombianos (lo de siempre), pesos chilenos, bolivianos o dólares, y habla
-- en español o en inglés (las respuestas de Luks en el grupo de WhatsApp).
--
-- Los montos siguen siendo enteros en la unidad más chica de la moneda:
-- pesos (COP, CLP) o centavos (BOB, USD). Las columnas se siguen llamando
-- *_cop. Por eso la moneda solo se cambia mientras la cuenta no tiene gastos.
-- ============================================================================

alter table public.accounts
  add column if not exists currency text not null default 'COP',
  add column if not exists language text not null default 'es';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_currency_check') then
    alter table public.accounts add constraint accounts_currency_check check (currency in ('COP', 'CLP', 'BOB', 'USD'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accounts_language_check') then
    alter table public.accounts add constraint accounts_language_check check (language in ('es', 'en'));
  end if;
end;
$$;

-- La moneda y el idioma de una cuenta (quien administra). La moneda, antes del
-- primer gasto: después los montos ya están en la otra unidad.
create or replace function public.set_account_settings(p_account_id uuid, p_currency text default null, p_language text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta cambian esto';
  end if;
  select * into a from public.accounts where id = p_account_id for update;
  if p_currency is not null and p_currency not in ('COP', 'CLP', 'BOB', 'USD') then
    raise exception 'Esa moneda no está disponible';
  end if;
  if p_language is not null and p_language not in ('es', 'en') then
    raise exception 'Ese idioma no está disponible';
  end if;
  if p_currency is not null and p_currency <> a.currency
     and exists (select 1 from public.expenses e where e.account_id = p_account_id) then
    raise exception 'La moneda se elige antes del primer gasto: esta cuenta ya tiene gastos';
  end if;
  update public.accounts
  set currency = coalesce(p_currency, currency), language = coalesce(p_language, language)
  where id = p_account_id;
end;
$$;

-- El link público también dice en qué moneda está la cuenta
create or replace function public.shared_overview(p_token text, p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{20,64}$' then
    return null;
  end if;
  select s.account_id into v_account from public.account_shares s where s.token = p_token;
  if v_account is null then
    return null;
  end if;
  return public.account_numbers(v_account, p_month)
    || (select jsonb_build_object('currency', a.currency, 'language', a.language) from public.accounts a where a.id = v_account);
end;
$$;

-- El worker lee los montos en la moneda de la cuenta
create or replace function public.worker_message_context(p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  a public.accounts%rowtype;
  v_sender uuid;
begin
  select * into m from public.messages where id = p_message_id;
  if not found then
    return null;
  end if;
  select * into a from public.accounts where id = m.account_id;

  -- Quién lo mandó: la persona que subió desde la web o el dueño del número
  v_sender := m.sender_person_id;
  if v_sender is null and m.sender_wa_id is not null then
    select w.person_id into v_sender
    from public.person_whatsapp_ids w
    join public.people p on p.id = w.person_id
    where w.wa_id = m.sender_wa_id and p.account_id = m.account_id
    limit 1;
  end if;

  return jsonb_build_object(
    'message', jsonb_build_object(
      'id', m.id, 'account_id', m.account_id, 'kind', m.kind, 'source', m.source, 'status', m.status,
      'text_body', m.text_body, 'media_path', m.media_path, 'file_name', m.file_name,
      'mime_type', m.mime_type, 'received_at', m.received_at, 'uploaded_by', m.uploaded_by
    ),
    'sender_person_id', v_sender,
    'account', jsonb_build_object(
      'id', a.id, 'name', a.name, 'type', a.type, 'status', a.status,
      'starts_on', a.starts_on, 'ends_on', a.ends_on,
      'currency', a.currency, 'language', a.language
    ),
    'today', (now() at time zone 'America/Bogota')::date,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name) order by p.created_at, p.id)
      from public.people p where p.account_id = a.id
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'is_default', c.is_default) order by c.name)
      from public.categories c where c.account_id = a.id
    ), '[]'::jsonb),
    'memory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mm.id, 'merchant_text', mm.merchant_text, 'normalized', mm.normalized,
        'category_id', mm.category_id, 'hits', mm.hits
      ) order by mm.hits desc)
      from public.merchant_memory mm where mm.account_id = a.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Las respuestas de Luks en el grupo, con la moneda y el idioma de la cuenta
create or replace function public.connector_pending_replies(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  -- Sin confirmación: lo que no es gasto, lo que falló, los grupos que las
  -- apagaron y lo de hace más de un día (ya nadie espera la respuesta)
  update public.messages m
  set group_reply_at = now()
  from public.account_group_links l
  where l.group_id = m.group_id
    and m.source = 'whatsapp' and m.group_reply_at is null
    and m.status in ('done', 'not_expense', 'duplicate', 'failed')
    and (not l.confirm_in_group or m.status in ('not_expense', 'failed') or m.received_at < now() - interval '1 day');

  select coalesce(jsonb_agg(x order by x ->> 'received_at'), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
      'message_id', m.id,
      'group_jid', g.wa_group_jid,
      'wa_message_id', m.wa_message_id,
      'sender_wa_id', m.sender_wa_id,
      'status', m.status,
      'received_at', m.received_at,
      'currency', a.currency,
      'language', a.language,
      'expense', (
        select jsonb_build_object(
          'merchant', e.merchant, 'total_cop', e.total_cop, 'status', e.status,
          'payer', p.display_name,
          'split_count', (select count(*) from public.expense_splits s where s.expense_id = e.id)
        )
        from public.expenses e left join public.people p on p.id = e.payer_person_id
        where e.message_id = m.id
        limit 1
      ),
      'duplicate_of', (
        select jsonb_build_object('merchant', d.merchant, 'total_cop', d.total_cop, 'expense_date', d.expense_date)
        from public.expenses d where d.id = m.duplicate_of
      )
    ) as x
    from public.messages m
    join public.accounts a on a.id = m.account_id
    join public.whatsapp_groups g on g.id = m.group_id
    join public.account_group_links l on l.group_id = m.group_id and l.confirm_in_group
    where m.source = 'whatsapp' and m.group_reply_at is null
      and m.status in ('done', 'duplicate')
      and g.left_at is null
    order by m.received_at
    limit p_limit
  ) t;
  return v_out;
end;
$$;

revoke execute on function public.set_account_settings(uuid, text, text) from public, anon;
grant execute on function public.set_account_settings(uuid, text, text) to authenticated;
