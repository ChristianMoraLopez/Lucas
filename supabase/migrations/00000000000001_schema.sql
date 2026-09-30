-- ============================================================================
-- Lucas · 00000000000001_schema.sql
-- Enums, tablas, índices y triggers base (updated_at y creación de perfil).
-- Postgres 15/17 (Supabase). Solo extensiones disponibles en Supabase hosted.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- Enums
-- ============================================================================

create type public.account_type as enum ('hogar', 'evento');
create type public.member_role as enum ('owner', 'admin', 'member');
create type public.expense_status as enum ('pending_review', 'confirmed');
create type public.split_method as enum ('equal', 'percent', 'exact', 'items');
create type public.message_kind as enum ('photo', 'pdf', 'text');
create type public.job_status as enum ('queued', 'running', 'done', 'failed');
create type public.connection_status as enum ('connecting', 'connected', 'disconnected');

-- ============================================================================
-- Perfiles (1:1 con auth.users)
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- Cuentas y membresía
-- ============================================================================

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.account_type not null,
  currency text not null default 'COP',
  owner_id uuid not null references public.profiles (id),
  status text not null default 'active' check (status in ('active', 'closed')),
  starts_on date,
  ends_on date,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Para eventos ends_on puede ser null; si hay fechas deben ser coherentes
  check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  display_name text not null,
  tone text not null default 'azul',
  -- Si el usuario reclamado se borra, la persona queda libre
  claimed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un usuario reclama máximo una persona por cuenta
create unique index people_una_reclamada_por_usuario
  on public.people (account_id, claimed_by)
  where claimed_by is not null;

create table public.account_members (
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null default 'member',
  -- Si la persona se borra, la membresía queda sin persona enlazada
  person_id uuid references public.people (id) on delete set null,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

create table public.person_whatsapp_ids (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  wa_id text not null,
  created_at timestamptz not null default now(),
  unique (person_id, wa_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  code text not null unique, -- estilo PASEO-7K2Q
  role public.member_role not null default 'member' check (role <> 'owner'),
  expires_at timestamptz,
  max_uses int,
  uses int not null default 0,
  created_by uuid not null references public.profiles (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Infraestructura WhatsApp (solo service role; RLS sin políticas authenticated)
-- ============================================================================

create table public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  label text,
  status public.connection_status not null default 'connecting',
  phone_number text,
  session_ciphertext bytea, -- credenciales Baileys cifradas
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.whatsapp_connections (id) on delete cascade,
  wa_group_jid text not null unique,
  name text,
  created_at timestamptz not null default now()
);

-- group_id es la PK: un grupo enlaza a exactamente una cuenta (decisión de diseño).
create table public.account_group_links (
  group_id uuid primary key references public.whatsapp_groups (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  linked_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.whatsapp_groups (id) on delete cascade,
  wa_message_id text not null,
  sender_wa_id text,
  kind public.message_kind not null,
  text_body text,
  media_path text, -- path en Storage privado
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (group_id, wa_message_id)
);

-- Cola del worker; solo service role
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}',
  status public.job_status not null default 'queued',
  attempts int not null default 0,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now()
);

create index jobs_cola_idx on public.jobs (run_at) where status = 'queued';

-- ============================================================================
-- Gastos
-- ============================================================================

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  letter text not null,
  tone text not null default 'azul',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, name)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  merchant text not null,
  merchant_normalized text,
  description text, -- descripción corta en inglés que genera la IA
  expense_date date not null default current_date,
  total_cop bigint not null check (total_cop >= 0),
  category_id uuid references public.categories (id),
  payer_person_id uuid references public.people (id),
  status public.expense_status not null default 'pending_review',
  confidence numeric(3, 2) check (confidence between 0 and 1),
  split_method public.split_method not null default 'equal',
  source text not null default 'web' check (source in ('whatsapp', 'web', 'import')),
  message_id uuid references public.messages (id),
  evidence_path text,
  cufe text,
  image_hash text,
  created_by uuid references public.profiles (id),
  corrected_by uuid references public.profiles (id),
  corrected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Deduplicación de facturas electrónicas por CUFE
create unique index expenses_cufe_unico
  on public.expenses (cufe)
  where cufe is not null;

create index expenses_cuenta_fecha_idx on public.expenses (account_id, expense_date desc);
create index expenses_cuenta_categoria_idx on public.expenses (account_id, category_id);

create table public.expense_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  name text not null,
  quantity numeric(10, 3) not null default 1,
  unit_price_cop bigint not null default 0,
  total_cop bigint not null default 0,
  created_at timestamptz not null default now()
);

create index expense_items_gasto_idx on public.expense_items (expense_id);

create table public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  person_id uuid not null references public.people (id),
  share_percent numeric(5, 2),
  amount_cop bigint not null default 0,
  item_id uuid references public.expense_items (id),
  created_at timestamptz not null default now()
);

-- item_id admite null y un unique simple lo ignoraría; se resuelve con dos
-- índices únicos parciales (una división por persona a nivel gasto y una por ítem).
create unique index expense_splits_unico_sin_item
  on public.expense_splits (expense_id, person_id)
  where item_id is null;

create unique index expense_splits_unico_con_item
  on public.expense_splits (expense_id, person_id, item_id)
  where item_id is not null;

create table public.merchant_memory (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  merchant_text text not null,
  normalized text not null,
  category_id uuid not null references public.categories (id),
  hits int not null default 0,
  created_at timestamptz not null default now(),
  unique (account_id, normalized)
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  category_id uuid references public.categories (id), -- null = presupuesto total del mes
  period date not null check (date_trunc('month', period)::date = period), -- primer día del mes
  amount_cop bigint not null check (amount_cop > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- category_id null rompería un unique simple; dos índices parciales:
-- uno para el presupuesto total del mes y otro por categoría.
create unique index budgets_unico_total_mes
  on public.budgets (account_id, period)
  where category_id is null;

create unique index budgets_unico_categoria_mes
  on public.budgets (account_id, category_id, period)
  where category_id is not null;

create table public.training_examples (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  merchant_text text,
  raw_text text,
  category_id uuid not null references public.categories (id),
  source text not null default 'correction' check (source in ('correction', 'seed')),
  created_by uuid references public.profiles (id),
  exported_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Trigger genérico updated_at
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_accounts_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

create trigger trg_people_updated_at
  before update on public.people
  for each row execute function public.set_updated_at();

create trigger trg_categories_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

create trigger trg_expenses_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

create trigger trg_budgets_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Perfil automático al registrarse un usuario
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Grants de API (la seguridad real la impone RLS con FORCE en 00000000000010)
-- ============================================================================

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant select on all tables in schema public to anon;
