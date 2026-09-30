-- ============================================================================
-- Lucas · 00000000000010_rls.sql
-- Helpers de membresía + RLS completo (enable + force en todas las tablas).
--
-- Los helpers son security definer y los crea el rol de migración (postgres,
-- superusuario), por lo que leen account_members/expenses sin disparar RLS
-- recursivo aun con FORCE ROW LEVEL SECURITY activo.
-- ============================================================================

-- ============================================================================
-- Helpers
-- ============================================================================

create or replace function public.is_account_member(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_members am
    where am.account_id = p_account_id
      and am.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_account_role(p_account_id uuid, p_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_members am
    where am.account_id = p_account_id
      and am.user_id = (select auth.uid())
      and am.role = any (p_roles)
  );
$$;

-- Membresía a través del gasto (evita repetir el join expenses→account_members)
create or replace function public.is_expense_member(p_expense_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.expenses e
    join public.account_members am on am.account_id = e.account_id
    where e.id = p_expense_id
      and am.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_expense_role(p_expense_id uuid, p_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.expenses e
    join public.account_members am on am.account_id = e.account_id
    where e.id = p_expense_id
      and am.user_id = (select auth.uid())
      and am.role = any (p_roles)
  );
$$;

-- ============================================================================
-- Activar RLS (enable + force) en todas las tablas
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

alter table public.accounts enable row level security;
alter table public.accounts force row level security;

alter table public.account_members enable row level security;
alter table public.account_members force row level security;

alter table public.people enable row level security;
alter table public.people force row level security;

alter table public.person_whatsapp_ids enable row level security;
alter table public.person_whatsapp_ids force row level security;

alter table public.invitations enable row level security;
alter table public.invitations force row level security;

alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_connections force row level security;

alter table public.whatsapp_groups enable row level security;
alter table public.whatsapp_groups force row level security;

alter table public.account_group_links enable row level security;
alter table public.account_group_links force row level security;

alter table public.messages enable row level security;
alter table public.messages force row level security;

alter table public.jobs enable row level security;
alter table public.jobs force row level security;

alter table public.categories enable row level security;
alter table public.categories force row level security;

alter table public.expenses enable row level security;
alter table public.expenses force row level security;

alter table public.expense_items enable row level security;
alter table public.expense_items force row level security;

alter table public.expense_splits enable row level security;
alter table public.expense_splits force row level security;

alter table public.merchant_memory enable row level security;
alter table public.merchant_memory force row level security;

alter table public.budgets enable row level security;
alter table public.budgets force row level security;

alter table public.training_examples enable row level security;
alter table public.training_examples force row level security;

-- ============================================================================
-- profiles
-- ============================================================================

-- Propio perfil o perfiles de quienes comparten alguna cuenta conmigo
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.account_members am1
      join public.account_members am2 on am2.account_id = am1.account_id
      where am1.user_id = (select auth.uid())
        and am2.user_id = profiles.id
    )
  );

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ============================================================================
-- accounts (sin INSERT: las cuentas se crean por RPC create_account)
-- ============================================================================

create policy accounts_select on public.accounts
  for select to authenticated
  using (public.is_account_member(id));

create policy accounts_update on public.accounts
  for update to authenticated
  using (public.has_account_role(id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_account_role(id, array['owner', 'admin']::public.member_role[]));

create policy accounts_delete on public.accounts
  for delete to authenticated
  using (public.has_account_role(id, array['owner']::public.member_role[]));

-- ============================================================================
-- account_members (todo cambio de membresía va por RPC)
-- ============================================================================

create policy account_members_select on public.account_members
  for select to authenticated
  using (public.is_account_member(account_id));

-- ============================================================================
-- people
-- ============================================================================

create policy people_select on public.people
  for select to authenticated
  using (public.is_account_member(account_id));

create policy people_insert on public.people
  for insert to authenticated
  with check (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

create policy people_update on public.people
  for update to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

create policy people_delete on public.people
  for delete to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

-- ============================================================================
-- person_whatsapp_ids (el connector escribe con service role)
-- ============================================================================

create policy person_whatsapp_ids_select on public.person_whatsapp_ids
  for select to authenticated
  using (exists (
    select 1 from public.people p
    where p.id = person_whatsapp_ids.person_id
      and public.is_account_member(p.account_id)
  ));

create policy person_whatsapp_ids_insert on public.person_whatsapp_ids
  for insert to authenticated
  with check (exists (
    select 1 from public.people p
    where p.id = person_whatsapp_ids.person_id
      and public.has_account_role(p.account_id, array['owner', 'admin']::public.member_role[])
  ));

create policy person_whatsapp_ids_update on public.person_whatsapp_ids
  for update to authenticated
  using (exists (
    select 1 from public.people p
    where p.id = person_whatsapp_ids.person_id
      and public.has_account_role(p.account_id, array['owner', 'admin']::public.member_role[])
  ))
  with check (exists (
    select 1 from public.people p
    where p.id = person_whatsapp_ids.person_id
      and public.has_account_role(p.account_id, array['owner', 'admin']::public.member_role[])
  ));

create policy person_whatsapp_ids_delete on public.person_whatsapp_ids
  for delete to authenticated
  using (exists (
    select 1 from public.people p
    where p.id = person_whatsapp_ids.person_id
      and public.has_account_role(p.account_id, array['owner', 'admin']::public.member_role[])
  ));

-- ============================================================================
-- invitations (escritura solo por RPC)
-- ============================================================================

create policy invitations_select on public.invitations
  for select to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

-- ============================================================================
-- whatsapp_connections y jobs: sin políticas para authenticated.
-- Con RLS forzado y sin policies, solo el service role (BYPASSRLS) los toca.
-- ============================================================================

-- ============================================================================
-- whatsapp_groups (lectura si el grupo enlaza a una cuenta donde soy miembro)
-- ============================================================================

create policy whatsapp_groups_select on public.whatsapp_groups
  for select to authenticated
  using (exists (
    select 1 from public.account_group_links agl
    where agl.group_id = whatsapp_groups.id
      and public.is_account_member(agl.account_id)
  ));

-- ============================================================================
-- account_group_links
-- ============================================================================

create policy account_group_links_select on public.account_group_links
  for select to authenticated
  using (public.is_account_member(account_id));

create policy account_group_links_insert on public.account_group_links
  for insert to authenticated
  with check (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

create policy account_group_links_delete on public.account_group_links
  for delete to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

-- ============================================================================
-- messages (escritura solo service role, vía el worker)
-- ============================================================================

create policy messages_select on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.account_group_links agl
    where agl.group_id = messages.group_id
      and public.is_account_member(agl.account_id)
  ));

-- ============================================================================
-- expenses (cualquier miembro reporta; solo owner/admin corrige o borra)
-- ============================================================================

create policy expenses_select on public.expenses
  for select to authenticated
  using (public.is_account_member(account_id));

create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (public.is_account_member(account_id));

create policy expenses_update on public.expenses
  for update to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

create policy expenses_delete on public.expenses
  for delete to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

-- ============================================================================
-- expense_items / expense_splits (permisos vía el gasto padre)
-- ============================================================================

create policy expense_items_select on public.expense_items
  for select to authenticated
  using (public.is_expense_member(expense_id));

create policy expense_items_insert on public.expense_items
  for insert to authenticated
  with check (public.is_expense_member(expense_id));

create policy expense_items_update on public.expense_items
  for update to authenticated
  using (public.has_expense_role(expense_id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_expense_role(expense_id, array['owner', 'admin']::public.member_role[]));

create policy expense_items_delete on public.expense_items
  for delete to authenticated
  using (public.has_expense_role(expense_id, array['owner', 'admin']::public.member_role[]));

create policy expense_splits_select on public.expense_splits
  for select to authenticated
  using (public.is_expense_member(expense_id));

create policy expense_splits_insert on public.expense_splits
  for insert to authenticated
  with check (public.is_expense_member(expense_id));

create policy expense_splits_update on public.expense_splits
  for update to authenticated
  using (public.has_expense_role(expense_id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_expense_role(expense_id, array['owner', 'admin']::public.member_role[]));

create policy expense_splits_delete on public.expense_splits
  for delete to authenticated
  using (public.has_expense_role(expense_id, array['owner', 'admin']::public.member_role[]));

-- ============================================================================
-- categories / merchant_memory / budgets / training_examples
-- select: miembros · escritura: owner/admin
-- ============================================================================

create policy categories_select on public.categories
  for select to authenticated
  using (public.is_account_member(account_id));

create policy categories_insert on public.categories
  for insert to authenticated
  with check (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

create policy categories_update on public.categories
  for update to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

create policy categories_delete on public.categories
  for delete to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

create policy merchant_memory_select on public.merchant_memory
  for select to authenticated
  using (public.is_account_member(account_id));

create policy merchant_memory_insert on public.merchant_memory
  for insert to authenticated
  with check (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

create policy merchant_memory_update on public.merchant_memory
  for update to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

create policy merchant_memory_delete on public.merchant_memory
  for delete to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

create policy budgets_select on public.budgets
  for select to authenticated
  using (public.is_account_member(account_id));

create policy budgets_insert on public.budgets
  for insert to authenticated
  with check (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

create policy budgets_update on public.budgets
  for update to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

create policy budgets_delete on public.budgets
  for delete to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

-- Las correcciones las hacen owner/admin, así que el insert también es de ellos
create policy training_examples_select on public.training_examples
  for select to authenticated
  using (public.is_account_member(account_id));

create policy training_examples_insert on public.training_examples
  for insert to authenticated
  with check (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

create policy training_examples_update on public.training_examples
  for update to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));

create policy training_examples_delete on public.training_examples
  for delete to authenticated
  using (public.has_account_role(account_id, array['owner', 'admin']::public.member_role[]));
