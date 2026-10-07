-- ============================================================================
-- 240 · Duplicados de verdad
--
-- Los comprobantes de un mismo banco (Nu, Nequi, Bancolombia…) son la misma
-- pantalla con otros números: su huella perceptual queda casi igual y un
-- comprobante nuevo salía como «Ya estaba anotado» (el 4 de octubre, uno de
-- Farmatodo por $105.900 quedó como copia de uno de D1 por $21.350, cada vez
-- que lo reenviaron).
--
-- Ahora una foto parecida solo es la misma compra si además coinciden el
-- total, la fecha y los códigos largos del comprobante (autorización, número
-- de transacción) cuando los dos los tienen. Sin el total (antes de leer la
-- foto) la huella ya no basta: la foto se lee y se compara al guardar.
--
-- Y los ítems del recibo quedan en el orden en que se leyeron.
-- ============================================================================

-- Los números largos de un comprobante (autorización, transacción, factura)
create or replace function public.codigos_del_texto(p_text text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct x[1] order by x[1]), '{}')
  from regexp_matches(coalesce(p_text, ''), '(\d{6,})', 'g') as x
$$;

-- El gasto de la cuenta que ya tiene esta factura (CUFE) o esta misma foto:
-- huella casi igual, mismo total y mismo día, y (si los dos comprobantes traen
-- códigos largos) al menos un código en común.
create or replace function public.worker_buscar_repetido(
  p_account_id uuid,
  p_cufe text,
  p_image_hash text,
  p_max_distance int default 12,
  p_total_cop bigint default null,
  p_expense_date date default null,
  p_text text default null
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.expenses e
  left join public.messages m on m.id = e.message_id
  where e.account_id = p_account_id
    and (
      (nullif(p_cufe, '') is not null and e.cufe = lower(p_cufe))
      or (
        nullif(p_image_hash, '') is not null and e.image_hash is not null
        and coalesce(p_total_cop, 0) > 0
        and e.total_cop = p_total_cop
        and (p_expense_date is null or e.expense_date = p_expense_date)
        and public.image_hash_distance(e.image_hash, lower(p_image_hash)) <= p_max_distance
        and (
          cardinality(public.codigos_del_texto(p_text)) = 0
          or cardinality(public.codigos_del_texto(m.extracted_text)) = 0
          or public.codigos_del_texto(p_text) && public.codigos_del_texto(m.extracted_text)
        )
      )
    )
  order by coalesce(e.cufe = lower(p_cufe), false) desc, e.created_at
  limit 1
$$;

-- La de antes (la llama el worker con el CUFE, y antes de leer la foto con la
-- huella): sin total, la huella ya no basta; el CUFE sí.
create or replace function public.worker_find_duplicate(
  p_account_id uuid,
  p_cufe text,
  p_image_hash text,
  p_max_distance int default 12
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select public.worker_buscar_repetido(p_account_id, p_cufe, p_image_hash, p_max_distance)
$$;

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
begin
  select * into m from public.messages where id = p_message_id for update;
  if not found then
    raise exception 'El mensaje % no existe', p_message_id;
  end if;
  if m.status in ('done', 'not_expense', 'duplicate') then
    return jsonb_build_object('skipped', true, 'status', m.status);
  end if;

  -- Un candado por cuenta mientras se revisa y se guarda: si llegan dos fotos
  -- iguales a la vez, la segunda ve la primera.
  perform pg_advisory_xact_lock(hashtextextended('lucas-dedup:' || m.account_id::text, 0));

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
    created_by, ai_snapshot, field_confidence, split_note
  )
  values (
    m.account_id, v_merchant, public.normalize_merchant(v_merchant),
    left(nullif(btrim(p_data ->> 'description'), ''), 160),
    v_date, v_total, v_category, v_payer, v_status,
    round(least(greatest(coalesce((p_data ->> 'confidence')::numeric, 0), 0), 1), 2),
    m.source, m.id, m.media_path,
    lower(nullif(p_data ->> 'cufe', '')), lower(nullif(p_data ->> 'image_hash', '')),
    m.uploaded_by, v_snapshot, p_data -> 'field_confidence',
    left(nullif(btrim(p_data ->> 'split_note'), ''), 200)
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

  return jsonb_build_object('expense_id', v_expense, 'status', v_status, 'possible_duplicate_of', v_parecido);
end;
$$;

revoke execute on function public.codigos_del_texto(text) from public, anon, authenticated;
revoke execute on function public.worker_buscar_repetido(uuid, text, text, int, bigint, date, text) from public, anon, authenticated;
revoke execute on function public.worker_find_duplicate(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.worker_buscar_repetido(uuid, text, text, int, bigint, date, text) to service_role;
grant execute on function public.worker_find_duplicate(uuid, text, text, int) to service_role;
revoke execute on function public.worker_save_expense(uuid, jsonb, int) from public, anon, authenticated;
grant execute on function public.worker_save_expense(uuid, jsonb, int) to service_role;
