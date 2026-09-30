-- ============================================================================
-- Lucas · 00000000000060_borrar_usuarios.sql
-- Borrar un usuario (Authentication → Users o el borrado de datos de la Ley
-- 1581) sin romper nada: lo que creó queda sin autor (on delete set null) y
-- sus cuentas pasan a otra persona, primero a un admin; si nadie más queda,
-- la cuenta se borra. (Se aplicó primero en el proyecto remoto; aquí queda
-- igual para que `supabase db push` y las pruebas vean lo mismo.)
-- ============================================================================

alter table public.invitations alter column created_by drop not null;

alter table public.invitations
  drop constraint if exists invitations_created_by_fkey,
  add constraint invitations_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.whatsapp_connections
  drop constraint if exists whatsapp_connections_created_by_fkey,
  add constraint whatsapp_connections_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.account_group_links
  drop constraint if exists account_group_links_linked_by_fkey,
  add constraint account_group_links_linked_by_fkey foreign key (linked_by) references public.profiles (id) on delete set null;

alter table public.expenses
  drop constraint if exists expenses_created_by_fkey,
  add constraint expenses_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null,
  drop constraint if exists expenses_corrected_by_fkey,
  add constraint expenses_corrected_by_fkey foreign key (corrected_by) references public.profiles (id) on delete set null;

alter table public.training_examples
  drop constraint if exists training_examples_created_by_fkey,
  add constraint training_examples_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null;

create or replace function public.handoff_accounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_next uuid;
begin
  for r in select a.id from public.accounts a where a.owner_id = old.id for update loop
    select am.user_id into v_next
      from public.account_members am
     where am.account_id = r.id and am.user_id <> old.id
     order by (am.role = 'admin') desc, am.joined_at, am.user_id
     limit 1;

    if v_next is null then
      delete from public.accounts where id = r.id;
    else
      update public.accounts set owner_id = v_next where id = r.id;
      update public.account_members set role = 'owner' where account_id = r.id and user_id = v_next;
    end if;
  end loop;
  return old;
end;
$$;

create trigger trg_profiles_handoff before delete on public.profiles
  for each row execute function public.handoff_accounts();

revoke execute on function public.handoff_accounts() from public, anon, authenticated, service_role;
