-- ============================================================================
-- Lucas · 00000000000070_worker.sql
-- Fase 4: el worker de Python (services/worker) reemplaza al procesador
-- simulado. Todo lo que el worker necesita de la base, en RPC para el service
-- role (nadie más las puede llamar):
--
--   · Cola con reintentos limitados: worker_claim_jobs / worker_complete_job /
--     worker_fail_job, con backoff exponencial y rescate de trabajos que un
--     worker dejó a medias. Cada error queda en job_errors.
--   · worker_message_context: el mensaje, su cuenta, personas, categorías y
--     memoria de comercios en una sola lectura.
--   · worker_save_expense: guarda el gasto, sus ítems y la división en una
--     transacción, volviendo a revisar duplicados (CUFE y huella de imagen)
--     con un candado por cuenta, así dos workers no registran la misma factura.
--   · worker_training_export / worker_mark_exported: los ejemplos para
--     reentrenar Laya (services/worker/scripts/export_training.py).
--
-- El procesador simulado sigue corriendo hasta que el worker arranca y llama a
-- worker_take_over(), que apaga su cron: así nunca hay un rato en que nadie lea
-- la cola. Sus funciones se quedan para probar en local sin el worker:
-- `select public.run_simulated_worker();`
-- ============================================================================

-- ============================================================================
-- Mensajes: duplicados y el texto que se leyó (OCR, PDF o QR)
-- ============================================================================

alter table public.messages drop constraint messages_status_check;
alter table public.messages add constraint messages_status_check
  check (status in ('queued', 'processing', 'done', 'not_expense', 'duplicate', 'failed'));

-- Si el mensaje repite un gasto que ya existe (misma factura o misma foto).
-- Sin llave foránea a propósito: una segunda relación entre messages y expenses
-- volvería ambiguos los embeds de PostgREST que ya usa la web
-- (`messages(kind)` desde expenses, `expenses(...)` desde messages).
alter table public.messages add column duplicate_of uuid;

-- Lo que el worker leyó del mensaje (texto del PDF, OCR de la foto o el
-- contenido del QR). Sirve para revisar y para reentrenar a Laya en español.
alter table public.messages add column extracted_text text check (length(extracted_text) <= 20000);

-- ============================================================================
-- Cola: intentos máximos por trabajo y registro de cada error
-- ============================================================================

alter table public.jobs add column max_attempts int not null default 5 check (max_attempts between 1 and 20);

create index jobs_en_curso_idx on public.jobs (locked_at) where status = 'running';

create table public.job_errors (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  attempt int not null,
  worker text,
  error text not null,
  detail text, -- traza recortada; nunca el contenido del recibo
  retryable boolean not null default true,
  created_at timestamptz not null default now()
);

create index job_errors_trabajo_idx on public.job_errors (job_id, created_at desc);

-- Solo el service role: RLS forzado y sin políticas, igual que jobs
alter table public.job_errors enable row level security;
alter table public.job_errors force row level security;
revoke all on public.job_errors from anon, authenticated;

-- ============================================================================
-- Huella de imagen: distancia de Hamming entre dos hashes perceptuales en hex
-- (imagehash.phash con hash_size=16 → 64 caracteres). Null si no se comparan.
-- ============================================================================

create or replace function public.image_hash_distance(a text, b text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when a ~ '^[0-9a-f]+$' and b ~ '^[0-9a-f]+$' and length(a) = length(b) and length(a) between 16 and 256
      then bit_count(('x' || a)::bit varying # ('x' || b)::bit varying)::int
  end
$$;

-- El gasto de la cuenta que ya tiene esta factura (CUFE) o una foto casi igual.
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
  select e.id
  from public.expenses e
  where e.account_id = p_account_id
    and (
      (nullif(p_cufe, '') is not null and e.cufe = lower(p_cufe))
      or (
        nullif(p_image_hash, '') is not null and e.image_hash is not null
        and public.image_hash_distance(e.image_hash, lower(p_image_hash)) <= p_max_distance
      )
    )
  order by coalesce(e.cufe = lower(p_cufe), false) desc, e.created_at
  limit 1
$$;

-- ============================================================================
-- worker_claim_jobs: rescata lo abandonado y toma los siguientes trabajos.
-- FOR UPDATE SKIP LOCKED: varios workers pueden correr sin pisarse.
-- ============================================================================

create or replace function public.worker_claim_jobs(
  p_worker text,
  p_limit int default 1,
  p_stale_after interval default interval '15 minutes'
)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs%rowtype;
begin
  -- 1. Trabajos que un worker tomó y nunca soltó (se reinició, se quedó sin
  --    memoria…). Cuentan como un intento fallido.
  for j in
    select * from public.jobs
    where status = 'running' and locked_at < now() - p_stale_after
    for update skip locked
  loop
    insert into public.job_errors (job_id, message_id, attempt, worker, error, retryable)
    values (
      j.id, public.try_uuid(j.payload ->> 'message_id'), j.attempts, j.locked_by,
      'El worker no terminó el trabajo en ' || p_stale_after::text, j.attempts < j.max_attempts
    );
    update public.jobs
    set status = case when j.attempts < j.max_attempts then 'queued' else 'failed' end::public.job_status,
        last_error = 'El worker no terminó el trabajo',
        locked_at = null, locked_by = null, run_at = now()
    where id = j.id;
    update public.messages
    set status = case when j.attempts < j.max_attempts then 'queued' else 'failed' end
    where id = public.try_uuid(j.payload ->> 'message_id') and status = 'processing';
  end loop;

  -- 2. Los siguientes en la cola
  for j in
    with siguientes as (
      select id from public.jobs
      where status = 'queued' and type = 'process_message' and run_at <= now()
      order by run_at, created_at
      limit greatest(1, least(p_limit, 50))
      for update skip locked
    )
    update public.jobs x
    set status = 'running', locked_at = now(), locked_by = left(p_worker, 120), attempts = x.attempts + 1
    from siguientes s
    where x.id = s.id
    returning x.*
  loop
    update public.messages
    set status = 'processing'
    where id = public.try_uuid(j.payload ->> 'message_id') and status in ('queued', 'failed');
    return next j;
  end loop;
end;
$$;

create or replace function public.worker_complete_job(p_job_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.jobs
  set status = 'done', locked_at = null, last_error = null
  where id = p_job_id and status = 'running';
$$;

-- Registra el error y decide: otra vez más tarde (30 s, 1 min, 2 min… hasta
-- 1 hora) o se rinde y el mensaje queda como «No pudimos leerlo».
create or replace function public.worker_fail_job(
  p_job_id uuid,
  p_error text,
  p_detail text default null,
  p_retryable boolean default true
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs%rowtype;
  v_retry boolean;
begin
  select * into j from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'El trabajo % no existe', p_job_id;
  end if;

  v_retry := p_retryable and j.attempts < j.max_attempts;

  insert into public.job_errors (job_id, message_id, attempt, worker, error, detail, retryable)
  values (
    j.id, public.try_uuid(j.payload ->> 'message_id'), j.attempts, j.locked_by,
    left(coalesce(nullif(btrim(p_error), ''), 'Error sin mensaje'), 1000), left(p_detail, 8000), v_retry
  );

  update public.jobs
  set status = case when v_retry then 'queued' else 'failed' end::public.job_status,
      last_error = left(p_error, 1000),
      locked_at = null,
      locked_by = null,
      run_at = case
        when v_retry then now() + least(interval '1 hour', interval '30 seconds' * power(2, greatest(j.attempts - 1, 0)))
        else j.run_at
      end
  where id = j.id;

  update public.messages
  set status = case when v_retry then 'queued' else 'failed' end
  where id = public.try_uuid(j.payload ->> 'message_id') and status in ('queued', 'processing');

  return case when v_retry then 'queued' else 'failed' end;
end;
$$;

-- ============================================================================
-- worker_message_context: todo lo que el worker necesita saber del mensaje.
-- ============================================================================

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
      'starts_on', a.starts_on, 'ends_on', a.ends_on
    ),
    'today', (now() at time zone 'America/Bogota')::date,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name) order by p.created_at, p.id)
      from public.people p where p.account_id = a.id
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name)
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

-- «No es un gasto» (un saludo en el grupo) o «Ya estaba» (misma factura o foto).
create or replace function public.worker_mark_message(
  p_message_id uuid,
  p_status text,
  p_duplicate_of uuid default null,
  p_extracted_text text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('not_expense', 'duplicate') then
    raise exception 'Estado no permitido para el worker: %', p_status;
  end if;
  update public.messages
  set status = p_status,
      duplicate_of = case when p_status = 'duplicate' then p_duplicate_of end,
      extracted_text = coalesce(left(p_extracted_text, 20000), extracted_text),
      processed_at = now()
  where id = p_message_id;
end;
$$;

-- ============================================================================
-- worker_save_expense: el gasto leído, en una sola transacción.
--
-- p_data (lo arma services/worker/lucas_worker/pipeline.py):
--   merchant, description, expense_date, total_cop, category_id, payer_person_id,
--   status ('confirmed' | 'pending_review'), confidence, field_confidence,
--   ai_snapshot, split_note, split_person_ids[], items[{name, quantity,
--   unit_price_cop, total_cop}], cufe, image_hash, memory_id, extracted_text
--
-- Devuelve {expense_id, status} o {duplicate_of} o {skipped, status}.
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

  v_dup := public.worker_find_duplicate(m.account_id, p_data ->> 'cufe', p_data ->> 'image_hash', p_max_distance);
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

  insert into public.expense_items (expense_id, name, quantity, unit_price_cop, total_cop)
  select v_expense,
         left(btrim(i ->> 'name'), 80),
         least(greatest(coalesce((i ->> 'quantity')::numeric, 1), 0.001), 9999999),
         greatest(coalesce((i ->> 'unit_price_cop')::bigint, 0), 0),
         greatest(coalesce((i ->> 'total_cop')::bigint, 0), 0)
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

-- ============================================================================
-- Ejemplos para reentrenar a Laya. Dos fuentes:
--   · training_examples: cada vez que una persona cambió la categoría de la IA
--   · (opcional) los gastos confirmados: los revisó una persona o los clasificó
--     la memoria de comercios, que a su vez sale de revisiones humanas
-- Con el comercio, la descripción en inglés, el mensaje, el texto leído y los
-- ítems, para armar el «state» de cada variante de Laya.
-- ============================================================================

create or replace function public.worker_training_export(
  p_since timestamptz default null,
  p_include_confirmed boolean default false,
  p_only_new boolean default true,
  p_limit int default 5000
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ejemplos as (
    select 'te:' || t.id::text as id, t.id as training_id, t.source, t.account_id, t.created_at,
           c.name as category, coalesce(e.merchant, t.merchant_text) as merchant,
           e.description, e.id as expense_id, coalesce(m.text_body, t.raw_text) as message_text,
           m.extracted_text, m.kind
    from public.training_examples t
    join public.categories c on c.id = t.category_id
    left join public.expenses e on e.id = t.expense_id
    left join public.messages m on m.id = e.message_id
    where (p_since is null or t.created_at >= p_since)
      and (not p_only_new or t.exported_at is null)

    union all

    select 'ex:' || e.id::text, null, 'confirmed', e.account_id, e.updated_at,
           c.name, e.merchant, e.description, e.id, m.text_body, m.extracted_text, m.kind
    from public.expenses e
    join public.categories c on c.id = e.category_id
    left join public.messages m on m.id = e.message_id
    where p_include_confirmed
      and e.status = 'confirmed'
      and (p_since is null or e.updated_at >= p_since)
      -- las correcciones ya salen arriba; no repetir el mismo gasto
      and not exists (select 1 from public.training_examples t where t.expense_id = e.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id, 'training_id', x.training_id, 'source', x.source, 'account_id', x.account_id,
    'created_at', x.created_at, 'category', x.category, 'merchant', x.merchant,
    'description', x.description, 'message_text', x.message_text,
    'extracted_text', left(x.extracted_text, 2000), 'kind', x.kind,
    'items', coalesce((
      select jsonb_agg(i.name order by i.created_at) from public.expense_items i where i.expense_id = x.expense_id
    ), '[]'::jsonb)
  ) order by x.created_at), '[]'::jsonb)
  from (select * from ejemplos order by created_at limit greatest(1, p_limit)) x
$$;

create or replace function public.worker_mark_exported(p_training_ids uuid[])
returns int
language sql
security definer
set search_path = ''
as $$
  with marcados as (
    update public.training_examples
    set exported_at = now()
    where id = any (p_training_ids) and exported_at is null
    returning 1
  )
  select count(*)::int from marcados
$$;

-- ============================================================================
-- worker_take_over: el worker la llama al arrancar y apaga el cron del
-- procesador simulado (si existe). Hasta ese momento el simulador sigue
-- atendiendo la cola; después, solo el worker. Devuelve si había algo que apagar.
-- ============================================================================

create or replace function public.worker_take_over()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return false;
  end if;
  if exists (select 1 from cron.job where jobname = 'lucas-procesador-simulado') then
    perform cron.unschedule('lucas-procesador-simulado');
    return true;
  end if;
  return false;
end;
$$;

-- ============================================================================
-- Permisos: todo esto es solo del worker (service role).
-- ============================================================================

revoke execute on function public.image_hash_distance(text, text) from public, anon, authenticated;
revoke execute on function public.worker_find_duplicate(uuid, text, text, int) from public, anon, authenticated;
revoke execute on function public.worker_claim_jobs(text, int, interval) from public, anon, authenticated;
revoke execute on function public.worker_complete_job(uuid) from public, anon, authenticated;
revoke execute on function public.worker_fail_job(uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.worker_message_context(uuid) from public, anon, authenticated;
revoke execute on function public.worker_mark_message(uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.worker_save_expense(uuid, jsonb, int) from public, anon, authenticated;
revoke execute on function public.worker_training_export(timestamptz, boolean, boolean, int) from public, anon, authenticated;
revoke execute on function public.worker_mark_exported(uuid[]) from public, anon, authenticated;
revoke execute on function public.worker_take_over() from public, anon, authenticated;

grant execute on function public.image_hash_distance(text, text) to service_role;
grant execute on function public.worker_find_duplicate(uuid, text, text, int) to service_role;
grant execute on function public.worker_claim_jobs(text, int, interval) to service_role;
grant execute on function public.worker_complete_job(uuid) to service_role;
grant execute on function public.worker_fail_job(uuid, text, text, boolean) to service_role;
grant execute on function public.worker_message_context(uuid) to service_role;
grant execute on function public.worker_mark_message(uuid, text, uuid, text) to service_role;
grant execute on function public.worker_save_expense(uuid, jsonb, int) to service_role;
grant execute on function public.worker_training_export(timestamptz, boolean, boolean, int) to service_role;
grant execute on function public.worker_mark_exported(uuid[]) to service_role;
grant execute on function public.worker_take_over() to service_role;
grant select, insert, update, delete on public.job_errors to service_role;
