-- ============================================================================
-- Lucas · 00000000000440_quien_pidio_que.sql
-- ¿Quién pidió qué? Cuando llega al grupo la cuenta de un restaurante con
-- varios ítems, Mister Luks la manda numerada y cada uno responde ese mensaje
-- con los números de lo suyo («1, 5»; «1x2» si fueron 2 de las 3 Coca-Colas).
-- Queda dividida por consumo, con el mismo cálculo de Dividir en la app: cada
-- ítem entre quienes lo pidieron (según cuántas unidades), lo que nadie dijo
-- entre todos, y la propina y el servicio según lo que consumió cada uno.
--
--   · Solo en paseos, con la cuenta recién llegada por WhatsApp (de 2 a 30
--     ítems), si nadie la ha dividido por consumo ni fijado montos todavía.
--   · Un solo mensaje por cuenta (escribir mucho y seguido hace que WhatsApp
--     bloquee el número), y una confirmación corta por cada respuesta.
--   · Cada quien marca lo suyo: se reconoce por su número, como en las preguntas.
-- ============================================================================

create table public.item_prompts (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null unique references public.expenses (id) on delete cascade,
  -- El mensaje con la lista (su wa_message_id dice a qué responden)
  outbox_id uuid references public.whatsapp_outbox (id) on delete set null,
  chat_jid text not null,
  -- Los ítems en el orden en que salen numerados
  items uuid[] not null,
  created_at timestamptz not null default now()
);
comment on table public.item_prompts is 'La lista numerada de ítems que Mister Luks mandó al grupo para que cada uno diga qué pidió';

alter table public.item_prompts enable row level security;
alter table public.item_prompts force row level security;
revoke all on public.item_prompts from anon, authenticated;

-- ============================================================================
-- partes_por_consumo: lo que le toca a cada uno según quién pidió qué (lo
-- mismo que dividirPorConsumo en apps/web/lib/consumo.ts). Quienes estaban:
-- los de la división que tiene y quienes marcaron ítems, en el orden de la
-- cuenta. Cada ítem entre quienes lo pidieron (según sus unidades), si nadie
-- entre todos; lo que no está en los ítems (propina, servicio) según lo que
-- consumió cada uno. Lo fijo se respeta y no sale aquí.
-- ============================================================================

create or replace function public.partes_por_consumo(p_expense_id uuid)
returns table (person_id uuid, parte bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with g as (
    select e.id, e.account_id, e.total_cop::numeric as total from public.expenses e where e.id = p_expense_id
  ),
  gente as (
    select p.id as person_id, row_number() over (order by p.created_at, p.id) as orden,
           exists (select 1 from public.expense_splits s where s.expense_id = p_expense_id and s.person_id = p.id and s.fixed) as fijo
    from public.people p join g on g.account_id = p.account_id
    where p.id in (select s.person_id from public.expense_splits s where s.expense_id = p_expense_id)
       or p.id in (select ip.person_id from public.expense_item_people ip join public.expense_items i on i.id = ip.item_id
                   where i.expense_id = p_expense_id)
  ),
  n as (select count(*)::numeric as n from gente),
  items as (
    select i.id, i.total_cop::numeric as total,
           (select sum(x.units) from public.expense_item_people x
            where x.item_id = i.id and x.person_id in (select gente.person_id from gente)) as unidades
    from public.expense_items i where i.expense_id = p_expense_id and i.total_cop > 0
  ),
  consumo as (
    select ge.person_id,
           coalesce(sum(case when it.unidades is null then it.total / n.n
                             when ip.person_id is not null then it.total * ip.units / it.unidades
                             else 0 end), 0) as consumo
    from gente ge cross join n
    left join items it on true
    left join public.expense_item_people ip on ip.item_id = it.id and ip.person_id = ge.person_id
    group by ge.person_id
  ),
  suma as (select coalesce(sum(items.total), 0) as suma from items),
  fijo as (select coalesce(sum(s.amount_cop), 0) as fijo from public.expense_splits s where s.expense_id = p_expense_id and s.fixed),
  libres as (
    select ge.person_id, ge.orden,
           case when suma.suma > 0 then c.consumo * g.total / suma.suma else g.total / n.n end as peso
    from gente ge join consumo c on c.person_id = ge.person_id cross join suma cross join g cross join n
    where not ge.fijo
  ),
  tot as (
    select (select g.total from g) - (select fijo.fijo from fijo) as libre,
           (select coalesce(sum(greatest(l.peso, 0)), 0) from libres l) as sp,
           (select count(*) from libres) as nl
  ),
  crudo as (
    select l.person_id, l.orden,
           tot.libre * case when tot.sp > 0 then greatest(l.peso, 0) / tot.sp else 1.0 / tot.nl end as v
    from libres l cross join tot
  ),
  piso as (select c.person_id, c.orden, c.v, floor(c.v + 0.000000001)::bigint as p from crudo c),
  resto as (select (select tot.libre from tot) - coalesce(sum(piso.p), 0) as r from piso),
  orden as (select piso.person_id, piso.p, row_number() over (order by (piso.v - piso.p) desc, piso.orden) as k from piso)
  select o.person_id, o.p + case when o.k <= (select resto.r from resto) then 1 else 0 end
  from orden o
  where (select tot.libre from tot) >= 0
$$;

-- Las partes de un gasto, según quién pidió qué (actualiza las que hay y agrega a quien marcó algo)
create or replace function public.repartir_por_consumo(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses%rowtype;
begin
  select * into e from public.expenses where id = p_expense_id for update;
  if not found or e.total_cop <= 0 then
    return;
  end if;
  if (select coalesce(sum(s.amount_cop), 0) from public.expense_splits s where s.expense_id = e.id and s.fixed) > e.total_cop then
    raise exception 'Lo que ponen fijo pasa el total de la cuenta';
  end if;
  update public.expense_splits s
  set amount_cop = x.parte
  from public.partes_por_consumo(e.id) x
  where s.expense_id = e.id and s.person_id = x.person_id and not s.fixed and s.amount_cop is distinct from x.parte;
  insert into public.expense_splits (expense_id, person_id, amount_cop, fixed)
  select e.id, x.person_id, x.parte, false
  from public.partes_por_consumo(e.id) x
  where not exists (select 1 from public.expense_splits s where s.expense_id = e.id and s.person_id = x.person_id);
  update public.expenses x set split_method = 'items' where x.id = e.id and x.split_method <> 'items';
end;
$$;

-- ============================================================================
-- connector_items_por_preguntar: las cuentas recién llegadas que vale la pena
-- preguntar (con todo para escribir la lista)
-- ============================================================================

create or replace function public.connector_items_por_preguntar(p_limit int default 10)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.r order by x.creado), '[]'::jsonb)
  from (
    select e.created_at as creado, jsonb_build_object(
      'expense_id', e.id,
      'group_jid', g.wa_group_jid,
      'merchant', e.merchant,
      'total', e.total_cop,
      'tip', e.tip_cop,
      'payer_name', (select p.display_name from public.people p where p.id = e.payer_person_id),
      'account', jsonb_build_object('name', a.name, 'language', a.language, 'currency', a.currency),
      'items', (
        select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'quantity', i.quantity, 'total', i.total_cop) order by i.created_at, i.id)
        from public.expense_items i where i.expense_id = e.id and not i.extra and i.total_cop > 0
      )
    ) as r
    from public.expenses e
    join public.accounts a on a.id = e.account_id
    join public.messages m on m.id = e.message_id
    join public.whatsapp_groups g on g.id = m.group_id and g.chat_kind = 'grupo' and g.left_at is null
    where a.type = 'evento' and a.status = 'active'
      and e.source = 'whatsapp'
      and e.created_at > now() - interval '3 hours'
      and e.split_method <> 'items'
      and not exists (select 1 from public.item_prompts p where p.expense_id = e.id)
      and not exists (select 1 from public.expense_splits s where s.expense_id = e.id and s.fixed)
      and (select count(*) from public.expense_items i where i.expense_id = e.id and not i.extra and i.total_cop > 0) between 2 and 30
      and not public.is_settled(a.id, e.expense_date)
      and exists (
        select 1 from public.whatsapp_group_sessions gs
        join public.whatsapp_connections c on c.id = gs.connection_id and c.kind = 'contador'
        where gs.group_id = g.id and gs.left_at is null
      )
    order by e.created_at
    limit greatest(coalesce(p_limit, 10), 1)
  ) x
$$;

-- La lista quedó en la bandeja de salida (o no se pudo: igual no se vuelve a preguntar)
create or replace function public.connector_item_prompt_guardado(p_expense_id uuid, p_items uuid[], p_chat_jid text, p_dedupe_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.item_prompts (expense_id, outbox_id, chat_jid, items)
  select p_expense_id, (select o.id from public.whatsapp_outbox o where o.dedupe_key = p_dedupe_key), p_chat_jid, p_items
  where exists (select 1 from public.expenses e where e.id = p_expense_id)
  on conflict (expense_id) do nothing
$$;

-- ============================================================================
-- connector_items_respuesta: alguien respondió la lista con lo suyo
-- p_claims = [{"n": 1, "units": 2}, {"n": 5}] (n: el número en la lista).
-- Responder otra vez cambia las unidades de lo que nombra; quitarse un ítem,
-- en la app (Dividir).
-- ============================================================================

create or replace function public.connector_items_respuesta(
  p_jid text,
  p_quoted_wa_id text,
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_name text,
  p_claims jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.item_prompts%rowtype;
  e public.expenses%rowtype;
  a public.accounts%rowtype;
  v_me uuid;
  v_n int;
  c jsonb;
  v_item uuid;
  v_units numeric;
begin
  select p.* into pr
  from public.item_prompts p
  join public.whatsapp_outbox o on o.id = p.outbox_id
  where o.chat_jid = p_jid and o.wa_message_id = p_quoted_wa_id;
  if pr.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_es_pregunta');
  end if;
  select * into e from public.expenses where id = pr.expense_id;
  select * into a from public.accounts where id = e.account_id;
  perform public.wa_identidad(p_wa_id, p_phone, p_lid, p_name);
  v_me := coalesce(
    public.wa_person(a.id, p_wa_id),
    case when p_phone is not null then public.wa_person(a.id, p_phone) end,
    case when p_lid is not null then public.wa_person(a.id, 'lid:' || p_lid) end
  );
  if a.status = 'closed' or public.is_settled(a.id, e.expense_date) then
    return jsonb_build_object('ok', false, 'reason', 'liquidado', 'language', a.language, 'merchant', e.merchant);
  end if;
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'no_te_conozco', 'language', a.language, 'account_name', a.name);
  end if;
  v_n := coalesce(array_length(pr.items, 1), 0);
  -- Si alguien cambió los ítems en la app, la lista ya no sirve
  if exists (select 1 from unnest(pr.items) x where not exists (select 1 from public.expense_items i where i.id = x)) then
    return jsonb_build_object('ok', false, 'reason', 'cambio', 'language', a.language, 'merchant', e.merchant);
  end if;
  if exists (select 1 from public.expense_splits s where s.expense_id = e.id and s.fixed) then
    return jsonb_build_object('ok', false, 'reason', 'fijos', 'language', a.language, 'merchant', e.merchant);
  end if;

  for c in select x from jsonb_array_elements(coalesce(p_claims, '[]'::jsonb)) x loop
    if coalesce(c ->> 'n', '') !~ '^[0-9]{1,3}$' or (c ->> 'n')::int < 1 or (c ->> 'n')::int > v_n then
      return jsonb_build_object('ok', false, 'reason', 'no_existe', 'n', c ->> 'n', 'total_items', v_n, 'language', a.language);
    end if;
    v_item := pr.items[(c ->> 'n')::int];
    v_units := case when coalesce(c ->> 'units', '') ~ '^[0-9]{1,3}([.][0-9]{1,3})?$' then least(greatest((c ->> 'units')::numeric, 0.001), 1000) else 1 end;
    insert into public.expense_item_people (item_id, person_id, units)
    values (v_item, v_me, v_units)
    on conflict (item_id, person_id) do update set units = excluded.units;
  end loop;
  perform public.repartir_por_consumo(e.id);

  return jsonb_build_object(
    'ok', true,
    'language', a.language,
    'currency', a.currency,
    'merchant', e.merchant,
    'name', (select p.display_name from public.people p where p.id = v_me),
    'parte', coalesce((select s.amount_cop from public.expense_splits s where s.expense_id = e.id and s.person_id = v_me), 0),
    'mios', coalesce((
      select jsonb_agg(jsonb_build_object('n', k.n, 'name', i.name, 'quantity', i.quantity, 'units', ip.units) order by k.n)
      from unnest(pr.items) with ordinality as k (item_id, n)
      join public.expense_items i on i.id = k.item_id
      join public.expense_item_people ip on ip.item_id = i.id and ip.person_id = v_me
    ), '[]'::jsonb),
    'sin_nadie', (
      select count(*) from unnest(pr.items) x
      where not exists (select 1 from public.expense_item_people ip where ip.item_id = x)
    )
  );
end;
$$;

-- ============================================================================
-- Permisos: del connector
-- ============================================================================

revoke execute on function public.partes_por_consumo(uuid) from public, anon, authenticated;
revoke execute on function public.repartir_por_consumo(uuid) from public, anon, authenticated;
revoke execute on function public.connector_items_por_preguntar(int) from public, anon, authenticated;
revoke execute on function public.connector_item_prompt_guardado(uuid, uuid[], text, text) from public, anon, authenticated;
revoke execute on function public.connector_items_respuesta(text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.connector_items_por_preguntar(int) to service_role;
grant execute on function public.connector_item_prompt_guardado(uuid, uuid[], text, text) to service_role;
grant execute on function public.connector_items_respuesta(text, text, text, text, text, text, jsonb) to service_role;
