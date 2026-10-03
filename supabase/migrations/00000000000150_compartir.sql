-- ============================================================================
-- Lucas · 00000000000150_compartir.sql
-- Compartir las cuentas con quien nunca abrió la app, y cobrarle.
--
--   · Link público por cuenta (/r/TOKEN): cualquiera con el link ve cuánto
--     puso cada uno, cuánto le toca, en qué se fue la plata y quién le paga a
--     quién. Lo crea, lo cambia o lo quita un admin. Nunca muestra fotos de
--     recibos, números de WhatsApp ni correos.
--   · account_numbers: lo que muestra Liquidar, sin datos de quien mira. La
--     usan settlement_overview (miembros) y shared_overview (el link público).
--   · add_people: agregar varias personas de una vez y, si se quiere, sumarlas
--     a los gastos que estaban divididos entre todos. Sirve para los recibos
--     subidos antes de agregar a la gente («pagué yo y después los agrego»).
-- ============================================================================

create table public.account_shares (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{20,64}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Solo por RPC: ni anon ni authenticated leen la tabla
alter table public.account_shares enable row level security;
alter table public.account_shares force row level security;
revoke all on public.account_shares from anon, authenticated;
grant select, insert, update, delete on public.account_shares to service_role;

-- 128 bits al azar en base64url (22 caracteres)
create or replace function public.new_share_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(encode(uuid_send(gen_random_uuid()), 'base64'), '+/=', '-_')
$$;

-- ============================================================================
-- Los números de una cuenta (lo de Liquidar), sin preguntar quién mira
-- ============================================================================

create or replace function public.account_numbers(p_account_id uuid, p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_mes date;
  v_desde date;
  v_hasta date;
  s public.settlements%rowtype;
begin
  select * into a from public.accounts where id = p_account_id;
  if a.id is null then
    return null;
  end if;

  if a.type = 'hogar' then
    v_mes := date_trunc('month', coalesce(p_month, v_hoy))::date;
    v_desde := v_mes;
    v_hasta := (v_mes + interval '1 month')::date;
  else
    v_desde := '0001-01-01';
    v_hasta := '9999-12-31';
  end if;
  select * into s from public.settlements x where x.account_id = a.id and x.period is not distinct from v_mes;

  return jsonb_build_object(
    'account', jsonb_build_object(
      'id', a.id, 'name', a.name, 'type', a.type, 'status', a.status,
      'starts_on', a.starts_on, 'ends_on', a.ends_on
    ),
    'today', v_hoy,
    'month', v_mes,
    'pending_count', (
      select count(*) from public.expenses e
      where e.account_id = a.id and e.status = 'pending_review' and e.expense_date >= v_desde and e.expense_date < v_hasta
    ),
    'incomplete_count', (
      select count(*) from public.expenses e
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
        and (e.payer_person_id is null
             or e.total_cop <> (select coalesce(sum(x.amount_cop), 0) from public.expense_splits x where x.expense_id = e.id))
    ),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.display_name, 'tone', p.tone, 'registered', p.claimed_by is not null,
        'paid', b.paid, 'share', b.share, 'balance', b.paid - b.share, 'expenses', b.expenses
      ) order by b.paid - b.share desc, p.display_name)
      from public.period_balances(a.id, v_mes) b
      join public.people p on p.id = b.person_id
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'merchant', e.merchant, 'expense_date', e.expense_date, 'total_cop', e.total_cop,
        'status', e.status, 'payer_person_id', e.payer_person_id,
        'category', c.name, 'category_letter', c.letter, 'category_tone', c.tone,
        'shares', coalesce((
          select jsonb_agg(jsonb_build_object('person_id', x.person_id, 'amount_cop', x.amount_cop))
          from public.expense_splits x where x.expense_id = e.id
        ), '[]'::jsonb)
      ) order by e.expense_date desc, e.created_at desc)
      from public.expenses e
      left join public.categories c on c.id = e.category_id
      where e.account_id = a.id and e.expense_date >= v_desde and e.expense_date < v_hasta
    ), '[]'::jsonb),
    'settlement', case when s.id is null then null else jsonb_build_object(
      'id', s.id,
      'created_at', s.created_at,
      'created_by', (select pf.full_name from public.profiles pf where pf.id = s.created_by),
      'transfers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'from', t.from_person_id, 'to', t.to_person_id, 'amount', t.amount_cop,
          'paid_at', t.paid_at,
          'paid_by', (
            select coalesce(pp.display_name, pf.full_name)
            from public.profiles pf
            left join public.people pp on pp.account_id = a.id and pp.claimed_by = pf.id
            where pf.id = t.paid_by
          )
        ) order by t.position)
        from public.settlement_transfers t where t.settlement_id = s.id
      ), '[]'::jsonb)
    ) end,
    'settled_months', case when a.type = 'hogar' then coalesce((
      select jsonb_agg(x.period order by x.period desc) from public.settlements x where x.account_id = a.id
    ), '[]'::jsonb) end
  );
end;
$$;

create or replace function public.settlement_overview(p_account_id uuid, p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  return public.account_numbers(p_account_id, p_month) || jsonb_build_object(
    'is_admin', public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]),
    'my_person_id', (select p.id from public.people p where p.account_id = p_account_id and p.claimed_by = auth.uid())
  );
end;
$$;

-- ============================================================================
-- El link público
-- ============================================================================

-- El link vigente de la cuenta (cualquiera de la cuenta lo ve), o null
create or replace function public.share_link(p_account_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  return (select s.token from public.account_shares s where s.account_id = p_account_id);
end;
$$;

-- Crea el link (o devuelve el que hay). p_renew: uno nuevo; el anterior deja de servir.
create or replace function public.create_share_link(p_account_id uuid, p_renew boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quien administra la cuenta puede compartirla';
  end if;
  insert into public.account_shares (account_id, token, created_by)
  values (p_account_id, public.new_share_token(), auth.uid())
  on conflict (account_id) do update
    set token = case when p_renew then excluded.token else public.account_shares.token end,
        created_by = case when p_renew then excluded.created_by else public.account_shares.created_by end,
        created_at = case when p_renew then now() else public.account_shares.created_at end
  returning token into v_token;
  return v_token;
end;
$$;

create or replace function public.delete_share_link(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quien administra la cuenta puede dejar de compartirla';
  end if;
  delete from public.account_shares s where s.account_id = p_account_id;
end;
$$;

-- Lo que ve quien abre el link. null si el link no existe o ya no sirve.
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
  return public.account_numbers(v_account, p_month);
end;
$$;

-- ============================================================================
-- Agregar varias personas, y sumarlas a lo que estaba dividido entre todos
-- ============================================================================

create or replace function public.add_people(p_account_id uuid, p_names text[], p_include_in_shared boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes uuid[];
  v_nuevas uuid[] := '{}';
  v_nombre text;
  v_id uuid;
  v_gastos int := 0;
  e record;
begin
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quien administra la cuenta puede agregar personas';
  end if;
  if exists (select 1 from public.accounts a where a.id = p_account_id and a.status = 'closed') then
    raise exception 'La cuenta está cerrada: ya no entran personas';
  end if;

  select coalesce(array_agg(p.id order by p.created_at, p.id), '{}') into v_antes
  from public.people p where p.account_id = p_account_id;

  foreach v_nombre in array coalesce(p_names, '{}') loop
    v_nombre := btrim(regexp_replace(v_nombre, '[[:space:]]+', ' ', 'g'));
    continue when v_nombre = '';
    if length(v_nombre) > 40 then
      raise exception 'El nombre «%…» es muy largo (máximo 40 letras)', left(v_nombre, 20);
    end if;
    if exists (select 1 from public.people p where p.account_id = p_account_id and lower(p.display_name) = lower(v_nombre)) then
      raise exception 'Ya hay alguien que se llama «%» en la cuenta', v_nombre;
    end if;
    insert into public.people (account_id, display_name) values (p_account_id, v_nombre) returning id into v_id;
    v_nuevas := v_nuevas || v_id;
  end loop;

  if cardinality(v_nuevas) = 0 then
    raise exception 'Escribe al menos un nombre';
  end if;

  -- Los gastos repartidos por partes iguales entre todos los que estaban (y no
  -- liquidados) se vuelven a repartir incluyendo a las personas nuevas
  if p_include_in_shared and cardinality(v_antes) > 0 then
    for e in
      select x.id
      from public.expenses x
      where x.account_id = p_account_id
        and x.split_method = 'equal'
        and not public.is_settled(p_account_id, x.expense_date)
        and not exists (select 1 from public.expense_splits s where s.expense_id = x.id and s.item_id is not null)
        and (select array_agg(s.person_id order by s.person_id) from public.expense_splits s where s.expense_id = x.id)
            = (select array_agg(u order by u) from unnest(v_antes) u)
    loop
      perform public.replace_equal_split(e.id, v_antes || v_nuevas);
      v_gastos := v_gastos + 1;
    end loop;
  end if;

  return jsonb_build_object('person_ids', to_jsonb(v_nuevas), 'resplit', v_gastos);
end;
$$;

-- ============================================================================
-- Permisos
-- ============================================================================

revoke execute on function public.new_share_token() from public, anon, authenticated;
revoke execute on function public.account_numbers(uuid, date) from public, anon, authenticated;
grant execute on function public.account_numbers(uuid, date) to service_role;

revoke execute on function public.share_link(uuid) from public, anon;
revoke execute on function public.create_share_link(uuid, boolean) from public, anon;
revoke execute on function public.delete_share_link(uuid) from public, anon;
revoke execute on function public.add_people(uuid, text[], boolean) from public, anon;
grant execute on function public.share_link(uuid) to authenticated;
grant execute on function public.create_share_link(uuid, boolean) to authenticated;
grant execute on function public.delete_share_link(uuid) to authenticated;
grant execute on function public.add_people(uuid, text[], boolean) to authenticated;

-- La página pública la usa sin sesión
revoke execute on function public.shared_overview(text, date) from public;
grant execute on function public.shared_overview(text, date) to anon, authenticated;
