-- ============================================================================
-- Lucas · 00000000000760_buscar_gastos.sql
-- Se le pregunta a Mister Luks por gastos de antes: «¿cuándo fue la última vez
-- que compré comida para el perro?», «¿qué días gasté en mascotas?», «¿tengo
-- registro de comida para perro?». El connector entiende la pregunta y arma
-- los grupos de palabras (cada palabra con sus parecidas: perro → dog,
-- concentrado, chunky…); aquí se buscan en lo que se sabe de cada gasto: el
-- comercio, la descripción, los ítems, el texto del recibo y lo que escribió
-- quien lo mandó.
--
--   · Un gasto coincide si cada grupo de palabras aparece en él («comida» y
--     «perro»). Si no, pero está en la categoría que se adivinó (Mascotas),
--     sale aparte: puede ser (un Homecenter en Mascotas que no dice qué fue).
--     Si la pregunta es solo por la categoría («¿cuándo gasté en mascotas?»),
--     estar en ella basta.
--   · Por privado, en todas las cuentas de quien pregunta (también las
--     cerradas: es para mirar atrás), por su número o por su usuario de Luks si
--     ya lo verificó. En un grupo, en la cuenta del grupo y en las anteriores
--     del mismo grupo (las noches de antes de «Volver a usar»).
--   · Los 8 más recientes de cada tipo, y cuántos son y cuánto suman.
-- ============================================================================

-- Las cuentas donde busca: las de quien escribe por privado, o la del grupo y sus anteriores
create or replace function public.cuentas_para_buscar(p_jid text, p_wa_id text, p_phone text, p_lid text)
returns table (account_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive del_grupo as (
    select l.account_id
    from public.whatsapp_groups g
    join public.account_group_links l on l.group_id = g.id
    where g.wa_group_jid = p_jid and g.chat_kind = 'grupo'
    union
    select a.previous_account_id from public.accounts a join del_grupo d on d.account_id = a.id
    where a.previous_account_id is not null
  ),
  suyas as (
    select y.account_id from public.personas_de_wa(p_jid, p_wa_id, p_phone, p_lid) y
    where p_jid !~ '@g\.us$'
    union
    select am.account_id
    from public.whatsapp_identities i
    join public.account_members am on am.user_id = i.user_id
    where p_jid !~ '@g\.us$' and i.user_id is not null and i.verified_at is not null
      and ((p_phone ~ '^[0-9]{6,20}$' and i.phone = p_phone) or (p_lid ~ '^[0-9]{6,30}$' and i.lid = p_lid))
  )
  select x.account_id
  from (select account_id from del_grupo union select account_id from suyas) x
  join public.accounts a on a.id = x.account_id
  where a.type <> 'cobro'
$$;

-- p_grupos: [["comid","food",…], ["perr","dog",…]] (ya en minúscula y sin tildes, como normalize_merchant)
-- p_categorias: las que se adivinaron («Mascotas»); p_categoria_basta: la pregunta es solo por ellas
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
          (select string_agg(i.name, ' ') from public.expense_items i where i.expense_id = e.id)
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

revoke execute on function public.cuentas_para_buscar(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.connector_buscar_gastos(text, text, text, text, jsonb, text[], boolean) from public, anon, authenticated;
grant execute on function public.connector_buscar_gastos(text, text, text, text, jsonb, text[], boolean) to service_role;
