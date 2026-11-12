-- ============================================================================
-- Lucas · 00000000000800_lo_mio_tambien_en_casa.sql
-- Lo que me tocó en «Moritas» también es gasto de mi casa. Cada quien elige,
-- en una cuenta, otra cuenta suya donde también entra lo suyo:
--
--   · Cuando un gasto queda confirmado y tiene su parte (lo que le tocó,
--     por partes iguales o por lo que pidió), en la otra cuenta aparece un
--     gasto por revisar con esa parte, pagado por esa persona, con la misma
--     fecha, comercio y categoría (si allá existe). Se divide como cualquier
--     gasto de esa cuenta (entre todos, por partes iguales) y se revisa allá.
--   · Si la parte cambia (corrigen quién pidió qué) o el gasto vuelve a
--     revisión, lo de la otra cuenta se pone al día mientras siga por
--     revisar; ya revisado allá, no se toca. Si se borra el gasto, se borra
--     su reflejo.
--   · Al elegir la cuenta, lo que ya estaba confirmado entra de una vez.
--   · Lo que llega como reflejo no se vuelve a reflejar (sin cadenas).
-- ============================================================================

create table public.cuentas_reflejo (
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  destino_account_id uuid not null references public.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, user_id),
  check (account_id <> destino_account_id)
);
comment on table public.cuentas_reflejo is 'Lo de esta persona en esta cuenta también entra, por revisar, en su otra cuenta';

alter table public.cuentas_reflejo enable row level security;
alter table public.cuentas_reflejo force row level security;
revoke all on public.cuentas_reflejo from anon, authenticated;
grant select on public.cuentas_reflejo to authenticated;
grant select, insert, update, delete on public.cuentas_reflejo to service_role;
create policy cuentas_reflejo_mias on public.cuentas_reflejo for select to authenticated using (user_id = auth.uid());

alter table public.expenses add column reflejo_de uuid references public.expenses (id) on delete cascade;
create unique index expenses_reflejo_idx on public.expenses (reflejo_de, account_id) where reflejo_de is not null;

-- Pone al día los reflejos de un gasto (uno por cada quien que lo pidió en esa cuenta)
create or replace function public.reflejar_gasto(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses%rowtype;
  r public.cuentas_reflejo%rowtype;
  m public.expenses%rowtype;
  v_cuenta text;
  v_yo uuid;
  v_parte bigint;
  v_yo_alla uuid;
  v_gente uuid[];
  v_nuevo uuid;
begin
  select * into e from public.expenses where id = p_expense_id;
  if e.id is null or e.reflejo_de is not null then
    return;
  end if;
  select a.name into v_cuenta from public.accounts a where a.id = e.account_id;
  for r in select * from public.cuentas_reflejo x where x.account_id = e.account_id loop
    select am.person_id into v_yo from public.account_members am where am.account_id = e.account_id and am.user_id = r.user_id;
    select coalesce(sum(s.amount_cop), 0) into v_parte from public.expense_splits s where s.expense_id = e.id and s.person_id = v_yo;
    select am.person_id into v_yo_alla
    from public.account_members am join public.accounts d on d.id = am.account_id
    where am.account_id = r.destino_account_id and am.user_id = r.user_id and d.status = 'active';
    select * into m from public.expenses x where x.reflejo_de = e.id and x.account_id = r.destino_account_id;

    if e.status <> 'confirmed' or v_parte <= 0 or v_yo is null or v_yo_alla is null then
      -- Ya no toca: se quita si allá nadie lo ha revisado
      if m.id is not null and m.status = 'pending_review' then
        delete from public.expenses where id = m.id;
      end if;
      continue;
    end if;
    if m.id is not null and m.status <> 'pending_review' then
      continue; -- ya lo revisaron allá
    end if;

    -- Si allá no se puede (el mes ya se liquidó, por ejemplo), lo de aquí sigue igual
    begin
    if m.id is null then
      insert into public.expenses (account_id, merchant, merchant_normalized, description, expense_date, total_cop, status,
                                   source, payer_person_id, category_id, created_by, reflejo_de, split_method)
      values (r.destino_account_id, e.merchant, e.merchant_normalized, 'Tu parte en «' || v_cuenta || '»', e.expense_date, v_parte,
              'pending_review', 'web', v_yo_alla,
              (select c2.id from public.categories c1 join public.categories c2 on c2.account_id = r.destino_account_id and c2.name = c1.name
               where c1.id = e.category_id),
              r.user_id, e.id, 'equal')
      returning id into v_nuevo;
    else
      update public.expenses
      set merchant = e.merchant, merchant_normalized = e.merchant_normalized, expense_date = e.expense_date, total_cop = v_parte,
          updated_at = now()
      where id = m.id;
      v_nuevo := m.id;
    end if;
    -- Como cualquier gasto de esa cuenta: entre todos, por partes iguales (se cambia al revisarlo)
    select array_agg(p.id order by p.created_at, p.id) into v_gente from public.people p where p.account_id = r.destino_account_id;
    perform public.replace_equal_split(v_nuevo, v_gente);
    exception when others then
      raise warning 'No se pudo reflejar el gasto % en la cuenta %: %', e.id, r.destino_account_id, sqlerrm;
    end;
  end loop;
end;
$$;

create or replace function public.reflejar_gasto_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'expenses' then
    if new.reflejo_de is null then
      perform public.reflejar_gasto(new.id);
    end if;
  elsif tg_op = 'DELETE' then
    perform public.reflejar_gasto(old.expense_id);
  else
    perform public.reflejar_gasto(new.expense_id);
  end if;
  return null;
end;
$$;

-- Al final de la transacción: con el gasto y su división ya completos
create constraint trigger trg_expenses_reflejar
  after insert or update of status, total_cop, expense_date, merchant on public.expenses
  deferrable initially deferred
  for each row
  execute function public.reflejar_gasto_trg();

create constraint trigger trg_expense_splits_reflejar
  after insert or update or delete on public.expense_splits
  deferrable initially deferred
  for each row
  execute function public.reflejar_gasto_trg();

-- Desde la app: «lo mío de aquí también va a…» (p_destino null lo apaga)
create or replace function public.fijar_reflejo(p_account_id uuid, p_destino uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_gasto uuid;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  if p_destino is null then
    delete from public.cuentas_reflejo where account_id = p_account_id and user_id = v_uid;
    return;
  end if;
  if p_destino = p_account_id or not public.is_account_member(p_destino)
     or not exists (select 1 from public.accounts d where d.id = p_destino and d.status = 'active' and d.type <> 'cobro') then
    raise exception 'Elige otra cuenta tuya que siga abierta';
  end if;
  insert into public.cuentas_reflejo (account_id, user_id, destino_account_id)
  values (p_account_id, v_uid, p_destino)
  on conflict (account_id, user_id) do update set destino_account_id = excluded.destino_account_id, created_at = now();
  -- Lo que ya estaba confirmado entra de una vez
  for v_gasto in
    select e.id from public.expenses e where e.account_id = p_account_id and e.status = 'confirmed' and e.reflejo_de is null
  loop
    perform public.reflejar_gasto(v_gasto);
  end loop;
end;
$$;

revoke execute on function public.reflejar_gasto(uuid) from public, anon, authenticated;
revoke execute on function public.reflejar_gasto_trg() from public, anon, authenticated;
revoke execute on function public.fijar_reflejo(uuid, uuid) from public, anon;
grant execute on function public.fijar_reflejo(uuid, uuid) to authenticated;
