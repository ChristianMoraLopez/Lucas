-- ============================================================================
-- Lucas · 00000000000780_memoria_de_productos.sql
-- Lo que compró queda guardado y enseña: aunque el recibo diga Homecenter, si
-- lo que se compró fue «Chunky Adultos 4kg» eso es comida para perro.
--
--   · El worker guarda todo lo que leyó que se compró en ai_snapshot.productos,
--     sume o no el total (los ítems para dividir por consumo siguen igual: solo
--     si suman). No se muestra en la app: es para clasificar y para buscar.
--   · Al confirmar un gasto (o corregir su categoría), cada producto queda
--     aprendido en esa categoría (product_memory). La próxima vez que aparezca,
--     el worker lo usa antes que el comercio: en Homecenter se compra de todo.
--     Si alguien lo corrige, se aprende la corrección.
--   · Lo que ya había: los ítems de los gastos confirmados entran de una vez.
--   · Buscar gastos (la 760) también busca en los productos.
-- ============================================================================

create table public.product_memory (
  account_id uuid not null references public.accounts (id) on delete cascade,
  normalized text not null check (length(normalized) between 3 and 80),
  product_text text not null,
  category_id uuid not null references public.categories (id) on delete cascade,
  hits int not null default 1 check (hits > 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, normalized)
);
comment on table public.product_memory is 'Lo que se ha comprado en la cuenta y en qué categoría quedó al confirmarlo (para clasificar por producto)';

alter table public.product_memory enable row level security;
alter table public.product_memory force row level security;
revoke all on public.product_memory from anon, authenticated;
grant select, insert, update, delete on public.product_memory to service_role;

-- Un nombre de producto que sirve para aprender (sin «bolsa», «domicilio», totales ni números sueltos)
create or replace function public.producto_aprendible(p_nombre text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when n is not null and length(n) between 3 and 80 and n ~ '[a-z]{3}'
         and n !~ '^(sub ?total|total|iva|impuesto|propina|servicio|cambio|efectivo|tarjeta|descuento|ahorro|valor|base|recibido|vueltas|redondeo|nit|cufe|cude|fecha|hora|caja|cajero|bolsas?|domicilio|envio)( |$)'
    then n end
  from (select public.normalize_merchant(p_nombre) as n) x
$$;

-- Al quedar confirmado (o cambiar de categoría ya confirmado), sus productos se aprenden en esa categoría
create or replace function public.aprender_productos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'confirmed' or new.category_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed' and old.category_id is not distinct from new.category_id then
    return new;
  end if;
  insert into public.product_memory as pm (account_id, normalized, product_text, category_id, hits)
  select new.account_id, x.n, min(x.nombre), new.category_id, 1
  from (
    select public.producto_aprendible(p) as n, left(btrim(p), 80) as nombre
    from jsonb_array_elements_text(case when jsonb_typeof(new.ai_snapshot -> 'productos') = 'array' then new.ai_snapshot -> 'productos' else '[]'::jsonb end) p
    union
    select public.producto_aprendible(i.name), left(btrim(i.name), 80) from public.expense_items i where i.expense_id = new.id
  ) x
  where x.n is not null
  group by x.n
  on conflict (account_id, normalized) do update
  set category_id = excluded.category_id,
      product_text = excluded.product_text,
      hits = case when pm.category_id = excluded.category_id then pm.hits + 1 else 1 end,
      updated_at = now();
  return new;
end;
$$;

create trigger trg_expenses_aprender_productos
  after insert or update of status, category_id on public.expenses
  for each row
  execute function public.aprender_productos();

-- Lo que ya había: los ítems de los gastos confirmados (la categoría que más veces tuvo cada producto)
insert into public.product_memory (account_id, normalized, product_text, category_id, hits)
select distinct on (z.account_id, z.n) z.account_id, z.n, z.nombre, z.category_id, z.veces
from (
  select e.account_id, public.producto_aprendible(i.name) as n, min(left(btrim(i.name), 80)) as nombre, e.category_id, count(*)::int as veces
  from public.expense_items i
  join public.expenses e on e.id = i.expense_id
  where e.status = 'confirmed' and e.category_id is not null
  group by 1, 2, 4
) z
where z.n is not null
order by z.account_id, z.n, z.veces desc
on conflict (account_id, normalized) do nothing;

-- Para el worker: lo aprendido en una cuenta
create or replace function public.worker_product_memory(p_account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('normalized', pm.normalized, 'category_id', pm.category_id, 'hits', pm.hits)), '[]'::jsonb)
  from (
    select * from public.product_memory where account_id = p_account_id order by hits desc, updated_at desc limit 3000
  ) pm
$$;

-- Buscar gastos (la 760), también en los productos
create or replace function public.connector_buscar_gastos(
  p_jid text,
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_grupos jsonb,
  p_categorias text[] default '{}',
  p_categoria_basta boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cats text[] := (select coalesce(array_agg(public.normalize_merchant(c)), '{}') from unnest(coalesce(p_categorias, '{}')) c);
begin
  if jsonb_typeof(p_grupos) <> 'array' or (jsonb_array_length(p_grupos) = 0 and cardinality(v_cats) = 0) then
    return jsonb_build_object('ok', false, 'reason', 'sin_palabras');
  end if;
  return (
    with cuentas as (
      select distinct c.account_id from public.cuentas_para_buscar(p_jid, p_wa_id, p_phone, p_lid) c
    ),
    gastos as (
      select e.id, e.expense_date, e.created_at, e.merchant, e.total_cop, a.name as cuenta, a.currency,
        cat.name as categoria, pp.display_name as pago,
        ' ' || coalesce(public.normalize_merchant(concat_ws(' ',
          e.merchant, e.description, e.ai_snapshot ->> 'description_en', m.text_body, m.extracted_text,
          (select string_agg(i.name, ' ') from public.expense_items i where i.expense_id = e.id),
          case when jsonb_typeof(e.ai_snapshot -> 'productos') = 'array' then
            (select string_agg(x, ' ') from jsonb_array_elements_text(e.ai_snapshot -> 'productos') x) end
        )), '') || ' ' as texto,
        coalesce(public.normalize_merchant(cat.name) = any (v_cats), false) as por_categoria
      from public.expenses e
      join cuentas cu on cu.account_id = e.account_id
      join public.accounts a on a.id = e.account_id
      left join public.messages m on m.id = e.message_id
      left join public.categories cat on cat.id = e.category_id
      left join public.people pp on pp.id = e.payer_person_id
    ),
    marcados as (
      select g.*,
        jsonb_array_length(p_grupos) > 0 and not exists (
          select 1 from jsonb_array_elements(p_grupos) grupo
          where not exists (
            select 1 from jsonb_array_elements_text(grupo) palabra
            where length(palabra) >= 3 and g.texto like '% ' || palabra || '%'
          )
        ) as por_texto
      from gastos g
    ),
    hallados as (
      select x.*, (x.por_texto or (p_categoria_basta and x.por_categoria)) as seguro
      from marcados x
      where x.por_texto or x.por_categoria
    )
    select jsonb_build_object(
      'ok', true,
      'cuentas', (select count(*) from cuentas),
      'seguros', jsonb_build_object(
        'n', (select count(*) from hallados where seguro),
        'total', (select coalesce(sum(total_cop), 0) from hallados where seguro),
        'gastos', coalesce((
          select jsonb_agg(jsonb_build_object('fecha', h.expense_date, 'comercio', h.merchant, 'total', h.total_cop,
                   'moneda', h.currency, 'categoria', h.categoria, 'cuenta', h.cuenta, 'pago', h.pago)
                 order by h.expense_date desc, h.created_at desc)
          from (select * from hallados where seguro order by expense_date desc, created_at desc limit 8) h
        ), '[]'::jsonb)
      ),
      'quizas', jsonb_build_object(
        'n', (select count(*) from hallados where not seguro),
        'gastos', coalesce((
          select jsonb_agg(jsonb_build_object('fecha', h.expense_date, 'comercio', h.merchant, 'total', h.total_cop,
                   'moneda', h.currency, 'categoria', h.categoria, 'cuenta', h.cuenta, 'pago', h.pago)
                 order by h.expense_date desc, h.created_at desc)
          from (select * from hallados where not seguro order by expense_date desc, created_at desc limit 4) h
        ), '[]'::jsonb)
      )
    )
  );
end;
$$;


revoke execute on function public.aprender_productos() from public, anon, authenticated;
revoke execute on function public.worker_product_memory(uuid) from public, anon, authenticated;
grant execute on function public.worker_product_memory(uuid) to service_role;
revoke execute on function public.connector_buscar_gastos(text, text, text, text, jsonb, text[], boolean) from public, anon, authenticated;
grant execute on function public.connector_buscar_gastos(text, text, text, text, jsonb, text[], boolean) to service_role;
